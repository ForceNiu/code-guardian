// 分析引擎的纯函数（无 IO、无副作用）：AST 解析 / 符号提取 / 反向索引 / 变更 diff / 严重度判定
// 与 analyze.worker.cjs 分离，方便用 node:test 直接做单元测试。
// 注意：本文件用 CommonJS（.cjs），可被 worker_threads 直接 require，不经打包器。

const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const crypto = require("node:crypto");
const path = require("node:path");

const SOURCE_EXT = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function extractName(id) {
  if (!id) return null;
  if (id.type === "Identifier") return id.name;
  return null; // 解构 / 复杂模式暂不追踪
}

/**
 * 把 TS 类型节点转成文本（手写轻量实现，不引 @babel/generator）。
 * 只需满足两点：① any 精确识别；② 相同类型生成相同串、不同类型生成不同串（供 diff 用）。
 * 复杂类型降级为节点类型名（稳定、够用）。
 */
function typeToString(t) {
  if (!t) return "";
  switch (t.type) {
    case "TSAnyKeyword": return "any";
    case "TSUnknownKeyword": return "unknown";
    case "TSStringKeyword": return "string";
    case "TSNumberKeyword": return "number";
    case "TSBooleanKeyword": return "boolean";
    case "TSNullKeyword": return "null";
    case "TSUndefinedKeyword": return "undefined";
    case "TSVoidKeyword": return "void";
    case "TSNeverKeyword": return "never";
    case "TSObjectKeyword": return "object";
    case "TSBigIntKeyword": return "bigint";
    case "TSSymbolKeyword": return "symbol";
    case "TSThisType": return "this";
    case "TSLiteralType": {
      const lit = t.literal;
      if (lit && typeof lit.value === "string") return `"${lit.value}"`;
      return String(lit ? lit.value : "?");
    }
    case "TSTypeReference": {
      const name = t.typeName && t.typeName.name ? t.typeName.name : "?";
      if (t.typeParameters && t.typeParameters.params && t.typeParameters.params.length) {
        return `${name}<${t.typeParameters.params.map(typeToString).join(", ")}>`;
      }
      return name;
    }
    case "TSUnionType": return (t.types || []).map(typeToString).join(" | ");
    case "TSIntersectionType": return (t.types || []).map(typeToString).join(" & ");
    case "TSArrayType": return `${typeToString(t.elementType)}[]`;
    case "TSTupleType": return `[${(t.elementTypes || []).map(typeToString).join(", ")}]`;
    case "TSFunctionType": return "fn";
    case "TSParenthesizedType": return `(${typeToString(t.typeAnnotation)})`;
    case "TSTypeLiteral": {
      // 嵌套对象字面量：递归展开成员（按 name 排序，保证顺序稳定），
      // 使「只改内层字段」也能反映到 signature，避免漏检。
      const members = (t.members || [])
        .filter((m) => m.type === "TSPropertySignature" || m.type === "TSMethodSignature")
        .map((m) => {
          const key = m.key;
          const name = key && key.name !== undefined ? key.name : key && key.value;
          const ty =
            m.type === "TSPropertySignature"
              ? m.typeAnnotation
                ? typeToString(m.typeAnnotation.typeAnnotation)
                : ""
              : "fn";
          return { name: String(name), ty, optional: !!m.optional };
        })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return `{${members.map((m) => `${m.name}${m.optional ? "?" : ""}:${m.ty}`).join(",")}}`;
    }
    case "TSOptionalType": return `${typeToString(t.typeAnnotation)}?`;
    case "TSRestType": return `...${typeToString(t.typeAnnotation)}`;
    case "TSTypeOperator": return `${t.operator || ""} ${typeToString(t.typeAnnotation)}`.trim();
    case "TSIndexedAccessType": return `${typeToString(t.objectType)}[${typeToString(t.indexType)}]`;
    default: return t.type;
  }
}

/** 提取函数参数细节（名称 + 类型 + 是否可选）；名称供规则引擎按名对齐（识别中间插入/删除） */
function extractParams(node) {
  if (!node.params) return [];
  return node.params.map((p) => {
    let name;
    if (p.type === "Identifier") name = p.name;
    else if (p.type === "AssignmentPattern") name = p.left && p.left.name;
    else if (p.type === "RestElement") name = p.argument && p.argument.name;
    const base = { type: "", optional: false };
    if (name != null) base.name = name;
    if (p.type === "Identifier") {
      base.type = p.typeAnnotation ? typeToString(p.typeAnnotation.typeAnnotation) : "";
      base.optional = !!p.optional;
    } else if (p.type === "AssignmentPattern") {
      // 带默认值 = 可省略
      const left = p.left;
      base.type = left && left.typeAnnotation ? typeToString(left.typeAnnotation.typeAnnotation) : "";
      base.optional = true;
    } else if (p.type === "RestElement") {
      base.type = p.typeAnnotation ? typeToString(p.typeAnnotation.typeAnnotation) : "";
      base.optional = false;
      base.rest = true;
    }
    // 解构 / 复杂模式：暂不追踪类型（name 也可能无，留空）
    return base;
  });
}

/** 提取函数返回类型文本（无注解返回 ""） */
function returnTypeText(node) {
  return node.returnType && node.returnType.typeAnnotation
    ? typeToString(node.returnType.typeAnnotation)
    : "";
}

/**
 * 提取 type/interface 的字段细节（name + 类型 + 可选性），供字段级规则（M3a-2）使用。
 * 仅处理对象字面量形态：TSInterfaceDeclaration 的 body、TSTypeAliasDeclaration 的 TSTypeLiteral。
 * type 别名引用/联合等非对象字面量返回 []（暂不追踪字段，归 uncertain 交 AI）。
 * 字段按 name 排序，保证签名稳定（interface 字段顺序语义无关，重排不应触发 modified）。
 */
function extractFields(decl) {
  let members = [];
  if (decl.type === "TSInterfaceDeclaration") {
    members = (decl.body && decl.body.body) || [];
  } else if (decl.type === "TSTypeAliasDeclaration") {
    const t = decl.typeAnnotation;
    if (t && t.type === "TSTypeLiteral") members = t.members || [];
    else return [];
  }
  const fields = [];
  for (const m of members) {
    if (m.type !== "TSPropertySignature" && m.type !== "TSMethodSignature") continue;
    const key = m.key;
    const name = key && key.name !== undefined ? key.name : key && key.value;
    if (name === undefined || name === null) continue;
    const type =
      m.type === "TSPropertySignature"
        ? (m.typeAnnotation ? typeToString(m.typeAnnotation.typeAnnotation) : "")
        : "fn";
    fields.push({ name: String(name), type, optional: !!m.optional });
  }
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return fields;
}

/**
 * 提取 enum 成员名列表（保持声明顺序，不排序——数值 enum 隐式值依赖顺序）。
 * 仅处理 TSEnumDeclaration；非 enum 返回 []。
 */
function extractEnumMembers(decl) {
  if (!decl || decl.type !== "TSEnumDeclaration") return [];
  return (decl.members || [])
    .map((m) => (m.id ? m.id.name || m.id.value : null))
    .filter((n) => n != null)
    .map(String);
}

/**
 * 提取 class 成员（方法/属性 + 可见性 + kind），供可见性规则（M3a-2）使用。
 * 覆盖 ClassMethod/ClassProperty/ClassPrivateMethod/ClassPrivateProperty/TSAbstract 系列/TSDeclareMethod。
 * 无显式 accessibility 默认 public；ES 私有字段（#foo）标为 private 且 name 带 # 前缀。
 * 成员按 name 排序（class 成员顺序对外部 API 无影响，排序保证签名稳定）。
 */
function extractClassMembers(decl) {
  if (!decl || decl.type !== "ClassDeclaration") return [];
  const body = decl.body && decl.body.body ? decl.body.body : [];
  const members = [];
  for (const m of body) {
    let kind = null;
    let name = null;
    let isPrivateField = false;
    if (m.type === "ClassMethod") {
      kind = "method";
      name = m.key && (m.key.name || m.key.value);
    } else if (m.type === "ClassPrivateMethod") {
      kind = "method";
      name = m.key && m.key.id && m.key.id.name;
      isPrivateField = true;
    } else if (m.type === "ClassProperty") {
      kind = "property";
      name = m.key && (m.key.name || m.key.value);
    } else if (m.type === "ClassPrivateProperty") {
      kind = "property";
      name = m.key && m.key.id && m.key.id.name;
      isPrivateField = true;
    } else if (m.type === "TSAbstractMethod") {
      kind = "method";
      name = m.key && (m.key.name || m.key.value);
    } else if (m.type === "TSAbstractProperty") {
      kind = "property";
      name = m.key && (m.key.name || m.key.value);
    } else if (m.type === "TSDeclareMethod") {
      kind = "method";
      name = m.key && (m.key.name || m.key.value);
    }
    if (name == null) continue;
    const visibility = isPrivateField ? "private" : m.accessibility || "public";
    members.push({ name: isPrivateField ? `#${name}` : String(name), visibility, kind });
  }
  members.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return members;
}

function nodeKind(node) {
  // 箭头函数 / 函数表达式也走同一条路径：export const X = (props) => {} 这类
  // React 常见写法必须能提取签名，否则参数变化完全检测不到。
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "TSDeclareFunction" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  ) {
    return {
      type: "function",
      paramCount: node.params ? node.params.length : 0,
      params: extractParams(node),
      returnType: returnTypeText(node),
      async: !!node.async,
    };
  }
  if (node.type === "ClassDeclaration") {
    const members = extractClassMembers(node);
    const result = { type: "class" };
    if (members.length) result.classMembers = members;
    return result;
  }
  if (node.type === "TSEnumDeclaration") {
    const members = extractEnumMembers(node);
    const result = { type: "enum" };
    if (members.length) result.enumMembers = members;
    return result;
  }
  if (node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration") {
    const fields = extractFields(node);
    const result = { type: "type" };
    if (fields.length) result.fields = fields;
    // type 别名（非 interface）且非对象字面量时，记录目标类型文本，供别名类型变化定级
    if (node.type === "TSTypeAliasDeclaration") {
      const t = node.typeAnnotation;
      if (t && t.type !== "TSTypeLiteral") result.aliasType = typeToString(t);
    }
    return result;
  }
  return { type: "variable" };
}

/**
 * 把 nodeKind() 提取到的函数/类细节挂到符号上（只挂非空字段，保持签名稳定）。
 * 用于 default 导出与 const 变量导出——它们此前不携带任何签名信息。
 */
function attachKindInfo(sym, info) {
  if (!info) return sym;
  if (info.paramCount !== undefined) sym.paramCount = info.paramCount;
  if (info.params && info.params.length) sym.params = info.params;
  if (info.returnType) sym.returnType = info.returnType;
  if (info.async) sym.async = info.async;
  if (info.classMembers && info.classMembers.length) sym.classMembers = info.classMembers;
  return sym;
}

/** 判断节点是否是「可直接提取签名的函数/类形态」 */
function isSignatureBearing(node) {
  return (
    !!node &&
    (node.type === "FunctionDeclaration" ||
      node.type === "TSDeclareFunction" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "ClassDeclaration")
  );
}

/**
 * 把 Babel 解析失败归类（U5，2026-09-19）。
 *
 * 此前 catch 一律返回三个空数组，三种性质完全不同的情况在报告上**长得一模一样**：
 *   ① "unsupported" —— **我们的能力边界**（没开对应插件：装饰器 / .vue / 新语法）
 *   ② "syntax"      —— **用户代码本身有语法错误**
 *   ③ "empty"       —— 空文件
 * ① 需要我们去补能力，② 是使用者的问题，混为一谈等于把"我们不支持"伪装成"没问题"。
 * 🔴 与项目红线同向：致命缺陷全在「少报」方向（见 docs/DEVELOPING.md §1）。
 */
function classifyParseError(err) {
  const msg = (err && err.message) || "";
  // Babel 对未启用插件的典型措辞：「This experimental syntax requires enabling the parser plugin: decorators」
  if (/requires enabling|parser plugin|experimental syntax|Cannot use import statement/i.test(msg)) {
    return "unsupported";
  }
  return "syntax";
}

/** 解析单文件，提取导出符号 + import 声明（解析失败安全降级为空，但**带失败原因**） */
function parseFile(code) {
  const exports = [];
  const imports = [];
  const reexports = []; // export * from "./x"（barrel 转发边，供影响图穿透到定义处）
  if (!code || !code.trim()) return { exports, imports, reexports, parseError: "empty" };
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
    });
  } catch (err) {
    return { exports, imports, reexports, parseError: classifyParseError(err) };
  }

  // 预扫描顶层声明：`export default Page` 这种「先声明、后导出」的写法需要借 local 声明的签名，
  // 否则会和 `export default function Page(){}` 判成两个不同签名，把纯语法重构误报成 API 变更。
  const localDecls = new Map();
  for (const node of ast.program.body || []) {
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      localDecls.set(node.id.name, node);
    } else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations || []) {
        const n = extractName(d.id);
        if (n && d.init) localDecls.set(n, d.init);
      }
    }
  }

  traverse(ast, {
    ExportNamedDeclaration(p) {
      const node = p.node;
      const line = node.loc ? node.loc.start.line : 0;
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            const name = extractName(d.id);
            if (!name) continue;
            const sym = { name, type: "variable", line };
            // export const Comp = (props) => {} —— React 里最常见的组件写法。
            // 不提取签名的话，箭头函数组件的参数变化（如新增必填 prop）完全检测不到。
            if (
              d.init &&
              (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
            ) {
              attachKindInfo(sym, nodeKind(d.init));
            }
            exports.push(sym);
          }
        } else {
          const info = nodeKind(decl);
          const name = decl.id ? decl.id.name : null;
          if (name) {
            const sym = { name, type: info.type, line };
            if (info.paramCount !== undefined) sym.paramCount = info.paramCount; // 仅函数携带参数个数
            if (info.params) sym.params = info.params; // 函数参数细节（M3 原料）
            if (info.returnType) sym.returnType = info.returnType; // 非空才存
            if (info.async) sym.async = info.async; // 非 async 不存
            if (info.fields && info.fields.length) sym.fields = info.fields; // type/interface 字段（M3a-2 原料，非空才存）
            if (info.aliasType) sym.aliasType = info.aliasType; // type 别名目标类型（M3a-2 原料，非空才存）
            if (info.enumMembers && info.enumMembers.length) sym.enumMembers = info.enumMembers; // enum 成员（M3a-2 原料，非空才存）
            if (info.classMembers && info.classMembers.length) sym.classMembers = info.classMembers; // class 成员（M3a-2 原料，非空才存）
            exports.push(sym);
          }
        }
      } else if (node.specifiers) {
        for (const spec of node.specifiers) {
          // export { local as exported } / export { local as exported } from './x'
          // ExportSpecifier：记导出名（下游 import 的 key）+ local 绑定映射（重命名导出识别用，M3a-2）
          const name = spec.exported && (spec.exported.name || spec.exported.value);
          const localName = spec.local && (spec.local.name || spec.local.value);
          if (name) {
            const sym = { name, type: "reexport", line };
            if (localName) sym.localName = localName;
            // 🔴 2026-09-16 修复：`export { C as default }` / `export { C as x }`（**无 `from`**，
            // 即导出的是本文件自己的绑定）此前只记 localName，signature() 输出 `reexport:C`
            // —— base/head 两边完全相同 → diffSymbols 判「无变化」→ 本地函数的签名变化**静默漏报**。
            // 与下方 `export default C`（裸标识符借 local 签名）是同一族问题：导出名不是本地名时丢签名。
            // 修法：能解析到携带签名的本地声明就借其签名。
            // ⚠️ type 必须保持 "reexport"：pairRenameExports 靠它识别「重命名导出」，
            //    改成 function/default 会让 `export { C as x }` → `export { C as y }` 退化成 removed+added。
            // ⚠️ 有 `from` 的跨模块转发**不借**：本文件没有它的声明，凭空造签名会制造假阳性。
            if (localName && !node.source) {
              const target = localDecls.get(localName);
              if (isSignatureBearing(target)) attachKindInfo(sym, nodeKind(target));
            }
            exports.push(sym);
          }
        }
      }
    },
    ExportDefaultDeclaration(p) {
      const line = p.node.loc ? p.node.loc.start.line : 0;
      const sym = { name: "default", type: "default", line };
      // default 导出此前签名恒为 "default"：内部任何破坏性变更都会被判为「无变化」而静默漏报。
      // Next.js 的 page / layout / route 几乎全是 `export default function`，必须提取签名。
      let decl = p.node.declaration;
      // 🔴 2026-09-16 修复：HOC 包裹形态 `export default memo(X)` / `forwardRef(X)` / `connect(m)(X)`。
      // 此前 declaration 是 CallExpression → isSignatureBearing() 不认 → 符号不带任何签名
      // → **被包裹组件的 props 变化完全检测不到**（实测变更数 = 0）。React 里 memo/forwardRef 很常见。
      // 保守解包：只沿 CallExpression 的**第一个实参**向下（限 5 层），取到标识符才继续借 local 声明。
      // 这样 `defineConfig({...})`（对象实参）、`createRoot(document.getElementById(...))`（member 实参）
      // 都解不出标识符 → 不产生签名，不会制造噪音。
      let hops = 0;
      while (decl && decl.type === "CallExpression" && hops < 5) {
        decl = (decl.arguments && decl.arguments[0]) || null;
        hops++;
      }
      // export default Page（裸标识符）→ 借 local 声明的签名，避免纯语法重构被误报为 API 变更
      if (decl && decl.type === "Identifier") {
        const target = localDecls.get(decl.name);
        if (target) decl = target;
      }
      if (isSignatureBearing(decl)) {
        attachKindInfo(sym, nodeKind(decl));
      }
      exports.push(sym);
    },
    ExportAllDeclaration(p) {
      // export * from "./x"：记录 barrel 转发边（无具名 specifier），供反向索引穿透
      const line = p.node.loc ? p.node.loc.start.line : 0;
      const source = p.node.source && p.node.source.value;
      if (source) reexports.push({ source, line });
    },
    ImportDeclaration(p) {
      const line = p.node.loc ? p.node.loc.start.line : 0;
      const source = p.node.source.value;
      for (const spec of p.node.specifiers) {
        let name;
        if (spec.type === "ImportDefaultSpecifier") name = "default";
        else if (spec.type === "ImportNamespaceSpecifier") name = "*";
        else if (spec.type === "ImportSpecifier") name = spec.imported.name || spec.imported.value;
        if (name) imports.push({ name, source, line });
      }
    },
  });

  return { exports, imports, reexports };
}

/** 按候选路径命中文件：原样 / 补扩展名 / 补 /index */
function resolveCandidates(base, allFiles) {
  const candidates = [base];
  for (const ext of SOURCE_EXT) {
    candidates.push(base + ext, base + "/index" + ext);
  }
  for (const c of candidates) {
    if (allFiles.has(c)) return c;
  }
  return null;
}

/** 把相对导入说明符解析成仓库内文件路径（补全扩展名 / index），无法解析返回 null */
function resolveImport(source, importerRel, allFiles) {
  if (!source.startsWith(".")) return null; // 仅追踪仓库内相对引用（node_modules 不关心）
  const importerDir = path.posix.dirname(importerRel);
  const base = path.posix.normalize(path.posix.join(importerDir, source));
  return resolveCandidates(base, allFiles);
}

/**
 * 宽松 JSON 解析：tsconfig.json 常带行注释、块注释与尾逗号（即 JSONC），标准 JSON.parse 会直接抛错。
 *
 * 用**字符串感知**的逐字符扫描，而不是正则替换：正则无法区分
 * `"https://x"` 里的斜杠和真正的注释，会截断字符串。这里是纯函数，便于单测。
 */
function parseJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === "\n") { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") { out += text[++i] ?? ""; continue; } // 转义字符整体保留
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")); // 去尾逗号
}

/**
 * 从 tsconfig.json 内容构建路径别名表（compilerOptions.paths + baseUrl）。
 * 支持递归解析 `extends` 链（最多 3 层），子配置覆盖父配置。
 * 只处理 `前缀/*` → `目标/*` 的通配形式；无别名的项目返回空数组。
 *
 * @param {string} tsconfigText  tsconfig.json 文本内容
 * @param {string} tsconfigDir   tsconfig.json 所在目录（相对仓库根的 posix 路径，或绝对路径）
 * @param {Object} [options] 可选配置
 * @param {Function} [options.readFileSync] 自定义文件读取函数（测试用），默认用 node:fs
 * @param {Set<string>} [visited]  已访问文件路径集，用于循环引用检测（内部使用）
 * @param {string} [currentFilePath] 当前正在处理的文件路径（内部使用，用于循环检测）
 * @returns {Array<{prefix: string, targetBase: string, baseDir: string}>}
 */
function buildPathAliases(tsconfigText, tsconfigDir = "", options = {}, currentFilePath) {
  const { readFileSync = require("node:fs").readFileSync } = options;
  const visited = options._visited || new Set();

  if (!tsconfigText) return [];

  // 循环引用保护：基于文件完整路径
  const tsconfigDirNorm = path.posix.normalize(tsconfigDir || ".");
  const resolvedCurrentFile = currentFilePath || path.posix.join(tsconfigDirNorm, "tsconfig.json");
  if (visited.has(resolvedCurrentFile)) return [];
  visited.add(resolvedCurrentFile);

  let cfg;
  try {
    cfg = parseJsonc(tsconfigText);
  } catch {
    return []; // 解析失败就当没有别名，不影响主链路
  }

  const co = cfg.compilerOptions || {};
  const baseDir = path.posix.normalize(path.posix.join(tsconfigDirNorm, co.baseUrl || "."));

  // 先递归解析父配置（extends）
  let parentAliases = [];
  if (cfg.extends) {
    const extendPath = cfg.extends;
    // extends 可以是相对路径（相对于当前 tsconfig 目录）或 npm 包名
    if (typeof extendPath === "string" && !extendPath.startsWith(".")) {
      // npm 包如 "tsconfig/node20" — 暂不支持，忽略
    } else if (typeof extendPath === "string") {
      const parentDir = path.posix.dirname(path.posix.join(tsconfigDirNorm, extendPath));
      const parentFile = path.posix.basename(extendPath) === extendPath
        ? path.posix.join(parentDir, "tsconfig.json") // 目录形式 extends: "./base"
        : path.posix.join(tsconfigDirNorm, extendPath);        // 文件形式 extends: "./base.json"
      try {
        const parentText = readFileSync(parentFile, "utf8");
        parentAliases = buildPathAliases(parentText, parentDir, {
          readFileSync,
          _visited: visited,
        }, parentFile); // 传入父文件的实际路径用于循环检测
      } catch {
        // 父配置读不到就当没有，不阻断
      }
    }
  }

  // 合并：父配置在前，子配置在后（子配置覆盖同 prefix + 同 baseDir）
  const aliases = [...parentAliases];
  for (const [pattern, targets] of Object.entries(co.paths || {})) {
    if (!Array.isArray(targets)) continue;
    for (const t of targets) {
      if (typeof t !== "string") continue;
      const prefix = pattern.endsWith("/*") ? pattern.slice(0, -1) : pattern;
      const targetBase = t.endsWith("/*") ? t.slice(0, -1) : t;
      // 子配置覆盖：移除同 prefix 且同 baseDir 的父配置项
      const idx = aliases.findIndex((a) => a.prefix === prefix && a.baseDir === baseDir);
      if (idx >= 0) aliases.splice(idx, 1);
      aliases.push({ prefix, targetBase, baseDir });
    }
  }
  return aliases;
}

/**
 * 解析导入说明符：先按相对路径，失败再试 tsconfig 路径别名。
 * 为什么必须有别名：现代 Next/TS 项目 90%+ 的内部引用走 `@/xxx`，
 * 只认相对路径会让影响图漏掉绝大多数引用（实测 interview-forge 可见率仅 7.7%）。
 */
function resolveImportWithAlias(source, importerRel, allFiles, aliases) {
  const direct = resolveImport(source, importerRel, allFiles);
  if (direct) return direct;
  if (!aliases || aliases.length === 0) return null;
  for (const a of aliases) {
    if (!source.startsWith(a.prefix)) continue;
    const rest = source.slice(a.prefix.length);
    const base = path.posix.normalize(path.posix.join(a.baseDir, a.targetBase + rest));
    const hit = resolveCandidates(base, allFiles);
    if (hit) return hit;
  }
  return null;
}

/** 函数签名文本：function / default / variable 三种类型只要带 params 就共用同一套表达 */
function functionSignatureText(sym) {
  if (Array.isArray(sym.params)) {
    const params = sym.params
      .map((p) => `${p.type || "?"}${p.optional ? "?" : ""}${p.rest ? "..." : ""}`)
      .join(",");
    const ret = sym.returnType ? `:${sym.returnType}` : "";
    const prefix = sym.async ? "async " : "";
    return `${prefix}function(${params})${ret}`;
  }
  return `function(${sym.paramCount ?? "?"})`; // 旧数据（仅 paramCount）回退
}

function signature(sym) {
  if (sym.type === "function") return functionSignatureText(sym);
  // default 导出 / const 箭头函数导出：此前签名恒等于类型名，参数变化被完全忽略 → 静默漏报。
  // 现在只要携带 params 就参与比较（无参数时仍回落到类型名，避免制造噪音）。
  if (Array.isArray(sym.params) && sym.params.length) return functionSignatureText(sym);
  // type/interface 字段签名：type{字段:类型?,...}，字段变化才触发 modified（M3a-2）
  if (sym.type === "type" && Array.isArray(sym.fields) && sym.fields.length) {
    const fields = sym.fields
      .map((f) => `${f.name}:${f.type || "?"}${f.optional ? "?" : ""}`)
      .join(",");
    return `type{${fields}}`;
  }
  // type 别名签名：type=目标类型，目标类型变化才触发 modified（M3a-2）
  if (sym.type === "type" && sym.aliasType) {
    return `type=${sym.aliasType}`;
  }
  // reexport 签名：体现 local 绑定（导出名变化走 removed+added 配对，local 变化走 modified）
  if (sym.type === "reexport") return `reexport:${sym.localName || sym.name}`;
  // enum 签名：enum{成员,...}，成员变化才触发 modified（M3a-2，成员保持声明顺序）
  if (sym.type === "enum" && Array.isArray(sym.enumMembers) && sym.enumMembers.length) {
    return `enum{${sym.enumMembers.join(",")}}`;
  }
  // class 签名：class{成员:可见性,...}，方法加 ()，成员变化才触发 modified（M3a-2）
  if (Array.isArray(sym.classMembers) && sym.classMembers.length) { // 含 default 导出的 class
    const members = sym.classMembers
      .map((m) => `${m.name}${m.kind === "method" ? "()" : ""}:${m.visibility}`)
      .join(",");
    return `class{${members}}`;
  }
  return sym.type;
}

/** 对比某文件 base/head 的导出符号，输出变更符号列表（added / removed / modified） */
function diffSymbols(file, oldExports, newExports) {
  const changed = [];
  const oldMap = new Map(oldExports.map((s) => [s.name, s]));
  const newMap = new Map(newExports.map((s) => [s.name, s]));
  const names = new Set([...oldMap.keys(), ...newMap.keys()]);
  for (const name of names) {
    const o = oldMap.get(name);
    const n = newMap.get(name);
    if (!o && n) {
      changed.push({ file, symbol: name, changeType: "added", newSignature: signature(n), newSymbol: n, line: n.line });
    } else if (o && !n) {
      changed.push({ file, symbol: name, changeType: "removed", oldSignature: signature(o), oldSymbol: o, line: o.line });
    } else if (
      o &&
      n &&
      // 签名不同 → 常规 modified。
      // 🔴 但**导出「种类」变化也必须产出 modified**：`export function f(a,b)` 与
      // `export const f = (a,b) => …` 在带参数时 signature() 算出**完全相同的文本**，
      // 若只比签名，这类变更会整条静默消失（2026-09-16 实测：sample-repo fixture
      // 变更符号数 9 → 4，丢的 5 个全是带参数的函数转箭头）。
      // 这类变更语义上真实存在（function 声明有提升、const 箭头无 → TDZ；this 绑定与
      // 可构造性亦不同），且规则引擎会落 unknown → low/uncertain 交 AI 判断，不制造假阳性。
      (signature(o) !== signature(n) || o.type !== n.type)
    ) {
      changed.push({
        file,
        symbol: name,
        changeType: "modified",
        oldSignature: signature(o),
        newSignature: signature(n),
        oldSymbol: o,
        newSymbol: n,
        line: n.line,
      });
    }
  }
  return pairRenameExports(changed);
}

/**
 * 识别「重命名导出」：removed 的 reexport 与 added 的 reexport 若 local 绑定相同，
 * 说明是同一个东西改了导出名（export { x as y } → export { x as z }），
 * 合并成一条 changeType="renamed" 变更，供规则引擎精确定级（M3a-2）。
 */
function pairRenameExports(changed) {
  const removed = changed.filter(
    (c) => c.changeType === "removed" && c.oldSymbol && c.oldSymbol.type === "reexport" && c.oldSymbol.localName
  );
  const added = changed.filter(
    (c) => c.changeType === "added" && c.newSymbol && c.newSymbol.type === "reexport" && c.newSymbol.localName
  );

  const result = [];
  const pairedAdded = new Set();
  const pairedRemoved = new Set();
  for (const r of removed) {
    const a = added.find((x) => !pairedAdded.has(x) && x.newSymbol.localName === r.oldSymbol.localName);
    if (a) {
      pairedAdded.add(a);
      pairedRemoved.add(r);
      result.push({
        file: r.file,
        symbol: r.symbol, // 旧导出名
        newName: a.symbol, // 新导出名
        localName: r.oldSymbol.localName,
        changeType: "renamed",
        oldSignature: r.oldSignature,
        newSignature: a.newSignature,
        oldSymbol: r.oldSymbol,
        newSymbol: a.newSymbol,
        line: a.line,
      });
    }
  }
  // 未配对的 removed（含非 reexport）与其余变更原样保留，避免「有配对就丢件」
  for (const c of changed) {
    if (pairedAdded.has(c) || pairedRemoved.has(c)) continue;
    result.push(c);
  }

  // 直接符号重命名（非 re-export）：如 export function foo → export function bar。
  // 保守判定：整份变更里「恰好 1 删 + 1 增」、同为非 reexport/default、符号类型相同且签名相同
  // → 合并为一条 changeType="renamed"（避免多个同签名符号互相误配）。
  const dirRemoved = result.filter(
    (c) => c.changeType === "removed" && c.oldSymbol && c.oldSymbol.type !== "reexport" && c.oldSymbol.type !== "default"
  );
  const dirAdded = result.filter(
    (c) => c.changeType === "added" && c.newSymbol && c.newSymbol.type !== "reexport" && c.newSymbol.type !== "default"
  );
  if (dirRemoved.length === 1 && dirAdded.length === 1) {
    const r = dirRemoved[0];
    const a = dirAdded[0];
    if (r.oldSymbol.type === a.newSymbol.type && r.oldSignature === a.newSignature) {
      result.splice(result.indexOf(r), 1);
      result.splice(result.indexOf(a), 1);
      result.push({
        file: r.file,
        symbol: r.symbol, // 旧名
        newName: a.symbol, // 新名
        changeType: "renamed",
        oldSignature: r.oldSignature,
        newSignature: a.newSignature,
        oldSymbol: r.oldSymbol,
        newSymbol: a.newSymbol,
        line: a.line,
      });
    }
  }

  return result;
}

/**
 * 决定某文件的导出符号 + import 用缓存还是重新解析（增量缓存核心判断，纯函数）。
 * - 变更文件：始终重新解析（内容变了，缓存不可信）
 * - 未变更文件：内容哈希命中缓存则复用，否则解析
 * 返回 { exports, imports, reexports, parseError?, hitCache }
 * （parseError 见 parseFile 的 U5 说明；缓存命中分支不带该字段）。
 */
function resolveFileSymbols(file, isChanged, content, hash, cache) {
  if (!isChanged && cache && cache.hashByFile && cache.hashByFile[file] === hash) {
    return {
      exports: cache.exportsByFile[file] || [],
      imports: cache.importsByFile[file] || [],
      reexports: (cache.reexportsByFile && cache.reexportsByFile[file]) || [],
      hitCache: true,
    };
  }
  const parsed = parseFile(content);
  return {
    exports: parsed.exports,
    imports: parsed.imports,
    reexports: parsed.reexports,
    // U5：透传解析失败原因（undefined 表示解析成功），供上层汇总到 summary.parseFailures
    parseError: parsed.parseError,
    hitCache: false,
  };
}

/**
 * 沿 barrel 转发边解析「符号真正被定义的文件」。
 *
 * 场景：`consumer.ts` → `import { foo } from "./barrel"`，而 `barrel.ts` 只写
 * `export * from "./real"`，`foo` 实际定义在 `real.ts`。
 * 若不做穿透，反向索引会把 consumer 注册在 `barrel#foo` 上，而变更符号来自
 * `real.ts#foo` → 影响链路查不到引用方（核心卖点直接失效）。
 *
 * @param {string} targetFile import 直接指向的文件
 * @param {string} name       符号名
 * @param {Map<string, Array>} exportsByFile     file -> 导出符号
 * @param {Map<string, Array>} reexportsByFile   file -> [{ source, line }] 转发边
 * @param {Set<string>} files  可解析的文件全集（含 base 侧已删除文件）
 * @param {Set<string>} [seen] 递归访问集，用于截断循环转发（a → b → a）
 * @returns {string|null} 定义文件路径；解析不到返回 null
 */
function resolveExportOrigin(targetFile, name, exportsByFile, reexportsByFile, files, seen, aliases) {
  const visited = seen || new Set();
  if (!targetFile || visited.has(targetFile)) return null;
  const defined = (exportsByFile.get(targetFile) || []).some((s) => s.name === name);
  if (defined) return targetFile;
  visited.add(targetFile);
  for (const re of reexportsByFile.get(targetFile) || []) {
    const next = resolveImportWithAlias(re.source, targetFile, files, aliases);
    const origin = resolveExportOrigin(next, name, exportsByFile, reexportsByFile, files, visited);
    if (origin) return origin;
  }
  return null;
}

module.exports = {
  SOURCE_EXT,
  md5,
  extractName,
  typeToString,
  extractFields,
  extractEnumMembers,
  extractClassMembers,
  nodeKind,
  signature,
  parseFile,
  resolveImport,
  diffSymbols,
  pairRenameExports,
  resolveFileSymbols,
  resolveExportOrigin,
  resolveCandidates,
  parseJsonc,
  buildPathAliases,
  resolveImportWithAlias,
};
