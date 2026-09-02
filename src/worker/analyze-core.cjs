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
    case "TSTypeLiteral": return "{...}";
    case "TSOptionalType": return `${typeToString(t.typeAnnotation)}?`;
    case "TSRestType": return `...${typeToString(t.typeAnnotation)}`;
    case "TSTypeOperator": return `${t.operator || ""} ${typeToString(t.typeAnnotation)}`.trim();
    case "TSIndexedAccessType": return `${typeToString(t.objectType)}[${typeToString(t.indexType)}]`;
    default: return t.type;
  }
}

/** 提取函数参数细节（类型 + 是否可选） */
function extractParams(node) {
  if (!node.params) return [];
  return node.params.map((p) => {
    if (p.type === "Identifier") {
      return {
        type: p.typeAnnotation ? typeToString(p.typeAnnotation.typeAnnotation) : "",
        optional: !!p.optional,
      };
    }
    if (p.type === "AssignmentPattern") {
      // 带默认值 = 可省略
      const left = p.left;
      return {
        type: left && left.typeAnnotation ? typeToString(left.typeAnnotation.typeAnnotation) : "",
        optional: true,
      };
    }
    if (p.type === "RestElement") {
      return {
        type: p.typeAnnotation ? typeToString(p.typeAnnotation.typeAnnotation) : "",
        optional: false,
        rest: true,
      };
    }
    // 解构 / 复杂模式：暂不追踪类型
    return { type: "", optional: false };
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
  if (node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction") {
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

/** 解析单文件，提取导出符号 + import 声明（解析失败安全降级为空） */
function parseFile(code) {
  const exports = [];
  const imports = [];
  if (!code || !code.trim()) return { exports, imports };
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
    });
  } catch {
    return { exports, imports };
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
            if (name) exports.push({ name, type: "variable", line });
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
            exports.push(sym);
          }
        }
      }
    },
    ExportDefaultDeclaration(p) {
      const line = p.node.loc ? p.node.loc.start.line : 0;
      exports.push({ name: "default", type: "default", line });
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

  return { exports, imports };
}

/** 把相对导入说明符解析成仓库内文件路径（补全扩展名 / index），无法解析返回 null */
function resolveImport(source, importerRel, allFiles) {
  if (!source.startsWith(".")) return null; // 仅追踪仓库内相对引用（node_modules 不关心）
  const importerDir = path.posix.dirname(importerRel);
  const base = path.posix.normalize(path.posix.join(importerDir, source));
  const candidates = [base];
  for (const ext of SOURCE_EXT) {
    candidates.push(base + ext, base + "/index" + ext);
  }
  for (const c of candidates) {
    if (allFiles.has(c)) return c;
  }
  return null;
}

function signature(sym) {
  if (sym.type === "function") {
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
  if (sym.type === "class" && Array.isArray(sym.classMembers) && sym.classMembers.length) {
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
    } else if (o && n && signature(o) !== signature(n)) {
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
  if (!removed.length || !added.length) return changed;

  const result = [];
  const pairedAdded = new Set();
  for (const r of removed) {
    const a = added.find((x) => !pairedAdded.has(x) && x.newSymbol.localName === r.oldSymbol.localName);
    if (a) {
      pairedAdded.add(a);
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
    } else {
      result.push(r); // 无配对的 removed 保留原样
    }
  }
  for (const c of changed) {
    if (c.changeType === "removed") continue; // removed 已在上面对待
    if (c.changeType === "added" && pairedAdded.has(c)) continue; // 已配对成 renamed
    result.push(c);
  }
  return result;
}

/**
 * 决定某文件的导出符号 + import 用缓存还是重新解析（增量缓存核心判断，纯函数）。
 * - 变更文件：始终重新解析（内容变了，缓存不可信）
 * - 未变更文件：内容哈希命中缓存则复用，否则解析
 * 返回 { exports, imports, hitCache }。
 */
function resolveFileSymbols(file, isChanged, content, hash, cache) {
  if (!isChanged && cache && cache.hashByFile && cache.hashByFile[file] === hash) {
    return {
      exports: cache.exportsByFile[file] || [],
      imports: cache.importsByFile[file] || [],
      hitCache: true,
    };
  }
  const parsed = parseFile(content);
  return { exports: parsed.exports, imports: parsed.imports, hitCache: false };
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
};
