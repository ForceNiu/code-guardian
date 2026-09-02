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
  if (node.type === "ClassDeclaration") return { type: "class" };
  if (node.type === "TSInterfaceDeclaration" || node.type === "TSTypeAliasDeclaration") {
    return { type: "type" };
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
            exports.push(sym);
          }
        }
      } else if (node.specifiers) {
        for (const spec of node.specifiers) {
          const name = spec.exported && (spec.exported.name || spec.exported.value);
          if (name) exports.push({ name, type: "unknown", line });
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
  if (sym.type !== "function") return sym.type;
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
  return changed;
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
  nodeKind,
  signature,
  parseFile,
  resolveImport,
  diffSymbols,
  resolveFileSymbols,
};
