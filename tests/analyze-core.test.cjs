// 引擎纯函数单元测试（node:test + assert，零额外依赖）
// 覆盖 analyze-core.cjs 的 8 个纯函数，固化当前已跑通的行为，防止将来改坏。

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  md5,
  extractName,
  nodeKind,
  signature,
  parseFile,
  resolveImport,
  diffSymbols,
  resolveFileSymbols,
} = require("../src/worker/analyze-core.cjs");

test("md5 返回标准哈希", () => {
  assert.equal(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5("hello"), "5d41402abc4b2a76b9719d911017c592");
});

test("extractName 提取标识符名", () => {
  assert.equal(extractName({ type: "Identifier", name: "foo" }), "foo");
  assert.equal(extractName({ type: "ObjectPattern" }), null); // 解构暂不追踪
  assert.equal(extractName(null), null);
});

test("nodeKind 识别声明类型与参数个数", () => {
  assert.deepEqual(nodeKind({ type: "FunctionDeclaration", params: [] }), {
    type: "function",
    paramCount: 0,
    params: [],
    returnType: "",
    async: false,
  });
  assert.deepEqual(nodeKind({ type: "FunctionDeclaration", params: [], async: true }), {
    type: "function",
    paramCount: 0,
    params: [],
    returnType: "",
    async: true,
  });
  assert.deepEqual(nodeKind({ type: "ClassDeclaration" }), { type: "class" });
  assert.deepEqual(nodeKind({ type: "TSInterfaceDeclaration" }), { type: "type" });
  assert.deepEqual(nodeKind({ type: "TSTypeAliasDeclaration" }), { type: "type" });
  assert.deepEqual(nodeKind({ type: "VariableDeclaration" }), { type: "variable" });
});

test("nodeKind 提取函数参数类型 / 可选 / 返回类型", () => {
  const fnNode = {
    type: "FunctionDeclaration",
    params: [
      {
        type: "Identifier",
        name: "id",
        optional: false,
        typeAnnotation: { type: "TSTypeAnnotation", typeAnnotation: { type: "TSStringKeyword" } },
      },
      {
        type: "Identifier",
        name: "opt",
        optional: true,
        typeAnnotation: { type: "TSTypeAnnotation", typeAnnotation: { type: "TSNumberKeyword" } },
      },
    ],
    returnType: { type: "TSTypeAnnotation", typeAnnotation: { type: "TSVoidKeyword" } },
    async: false,
  };
  assert.deepEqual(nodeKind(fnNode), {
    type: "function",
    paramCount: 2,
    params: [
      { type: "string", optional: false },
      { type: "number", optional: true },
    ],
    returnType: "void",
    async: false,
  });
});

test("signature 生成签名（函数带参数个数）", () => {
  assert.equal(signature({ type: "function", paramCount: 2 }), "function(2)"); // 旧数据（仅 paramCount）回退
  assert.equal(signature({ type: "function" }), "function(?)"); // 无 paramCount 回退 ?
  assert.equal(signature({ type: "variable" }), "variable");
  assert.equal(signature({ type: "class" }), "class");
});

test("signature 细签名（参数类型 / 可选 / 返回类型 / async）", () => {
  const sym = {
    type: "function",
    params: [
      { type: "string", optional: false },
      { type: "number", optional: true },
    ],
    returnType: "void",
  };
  assert.equal(signature(sym), "function(string,number?):void");
  assert.equal(signature({ ...sym, async: true }), "async function(string,number?):void");
});

test("parseFile 提取导出符号与 import", () => {
  const code = [
    'import { add } from "./math";',
    'import type { User } from "./types";',
    "export function formatPrice(v: number, c: number) { return v; }",
    "export const TAX = 0.1;",
    "export class Order {}",
    "export interface Config { a: number }",
    "export default function main() {}",
  ].join("\n");

  const { exports, imports } = parseFile(code);

  assert.deepEqual(exports, [
    {
      name: "formatPrice",
      type: "function",
      line: 3,
      paramCount: 2,
      params: [
        { type: "number", optional: false },
        { type: "number", optional: false },
      ],
    },
    { name: "TAX", type: "variable", line: 4 },
    { name: "Order", type: "class", line: 5 },
    { name: "Config", type: "type", line: 6, fields: [{ name: "a", type: "number", optional: false }] },
    { name: "default", type: "default", line: 7 },
  ]);

  assert.deepEqual(imports, [
    { name: "add", source: "./math", line: 1 },
    { name: "User", source: "./types", line: 2 },
  ]);
});

test("parseFile 提取函数参数类型 / 可选 / 返回类型 / async", () => {
  const code = [
    "export function f(a: string, b?: number): Promise<void> { return Promise.resolve(); }",
    "export async function g() {}",
  ].join("\n");
  const { exports } = parseFile(code);
  assert.deepEqual(exports, [
    {
      name: "f",
      type: "function",
      line: 1,
      paramCount: 2,
      params: [
        { type: "string", optional: false },
        { type: "number", optional: true },
      ],
      returnType: "Promise<void>",
    },
    { name: "g", type: "function", line: 2, paramCount: 0, params: [], async: true },
  ]);
});

test("parseFile 对空代码 / 非法代码安全降级为空", () => {
  assert.deepEqual(parseFile(""), { exports: [], imports: [] });
  assert.deepEqual(parseFile("   "), { exports: [], imports: [] });
  assert.deepEqual(parseFile("const = = 语法错误"), { exports: [], imports: [] });
});

test("resolveImport 解析相对路径并补全扩展名", () => {
  const allFiles = new Set([
    "src/utils/format.ts",
    "src/utils/math.ts",
    "src/pages/home.tsx",
    "src/services/api.ts",
    "src/components/button/index.ts",
  ]);

  // 同目录补 .ts
  assert.equal(resolveImport("./format", "src/utils/api.ts", allFiles), "src/utils/format.ts");
  // 上一级目录
  assert.equal(resolveImport("../utils/math", "src/services/api.ts", allFiles), "src/utils/math.ts");
  // 补 /index.ts
  assert.equal(
    resolveImport("./button", "src/components/app.tsx", allFiles),
    "src/components/button/index.ts",
  );
  // 非相对路径（node_modules）不追踪
  assert.equal(resolveImport("react", "src/pages/home.tsx", allFiles), null);
  // 不存在的相对路径
  assert.equal(resolveImport("./missing", "src/pages/home.tsx", allFiles), null);
});

test("diffSymbols 识别 added / removed / modified（携带结构化符号）", () => {
  const file = "src/utils/format.ts";

  // 新增符号
  const newSym = {
    name: "formatCurrency",
    type: "function",
    line: 10,
    paramCount: 1,
    params: [{ type: "number", optional: false }],
  };
  assert.deepEqual(diffSymbols(file, [], [newSym]), [
    { file, symbol: "formatCurrency", changeType: "added", newSignature: "function(number)", newSymbol: newSym, line: 10 },
  ]);

  // 删除符号
  const oldSym = {
    name: "formatDate",
    type: "function",
    line: 5,
    paramCount: 1,
    params: [{ type: "string", optional: false }],
  };
  assert.deepEqual(diffSymbols(file, [oldSym], []), [
    { file, symbol: "formatDate", changeType: "removed", oldSignature: "function(string)", oldSymbol: oldSym, line: 5 },
  ]);

  // 改签名（参数个数 1 → 2）
  const o2 = {
    name: "formatPrice",
    type: "function",
    line: 3,
    paramCount: 1,
    params: [{ type: "number", optional: false }],
  };
  const n2 = {
    name: "formatPrice",
    type: "function",
    line: 3,
    paramCount: 2,
    params: [
      { type: "number", optional: false },
      { type: "number", optional: false },
    ],
  };
  assert.deepEqual(diffSymbols(file, [o2], [n2]), [
    {
      file,
      symbol: "formatPrice",
      changeType: "modified",
      oldSignature: "function(number)",
      newSignature: "function(number,number)",
      oldSymbol: o2,
      newSymbol: n2,
      line: 3,
    },
  ]);

  // 签名未变 → 不产生变更
  assert.deepEqual(
    diffSymbols(
      file,
      [{ name: "tax", type: "variable", line: 4 }],
      [{ name: "tax", type: "variable", line: 4 }],
    ),
    [],
  );
});

test("resolveFileSymbols 增量缓存：变更重解析 / 命中复用 / miss 解析", () => {
  const file = "src/a.ts";
  const code = "export function f() {}";
  const hash = md5(code);
  const cache = {
    hashByFile: { [file]: hash },
    exportsByFile: { [file]: [{ name: "f", type: "function", line: 1, paramCount: 0 }] },
    importsByFile: { [file]: [{ name: "x", source: "./b", line: 1 }] },
  };

  // 1) 变更文件：即使哈希命中也强制重解析（缓存不可信）
  const changed = resolveFileSymbols(file, true, code, hash, cache);
  assert.equal(changed.hitCache, false);
  assert.deepEqual(changed.exports, [{ name: "f", type: "function", line: 1, paramCount: 0, params: [] }]);
  assert.deepEqual(changed.imports, []); // code 里本无 import，证明走了 parse

  // 2) 未变更 + 命中：复用缓存（imports 来自缓存而非 parse）
  const hit = resolveFileSymbols(file, false, code, hash, cache);
  assert.equal(hit.hitCache, true);
  assert.deepEqual(hit.exports, cache.exportsByFile[file]);
  assert.deepEqual(hit.imports, [{ name: "x", source: "./b", line: 1 }]);

  // 3) 未变更 + 哈希不匹配：重解析
  const miss = resolveFileSymbols(file, false, code, "stale-hash", cache);
  assert.equal(miss.hitCache, false);
  assert.deepEqual(miss.imports, []);

  // 4) 未变更 + 无缓存：重解析
  const nocache = resolveFileSymbols(file, false, code, hash, undefined);
  assert.equal(nocache.hitCache, false);
});

// ===== M3a-2：type/interface 字段提取 =====

test("nodeKind 提取 type/interface 字段（属性 / 可选 / 方法，按 name 排序）", () => {
  const iface = {
    type: "TSInterfaceDeclaration",
    body: {
      body: [
        {
          type: "TSPropertySignature",
          key: { type: "Identifier", name: "name" },
          optional: false,
          typeAnnotation: { type: "TSTypeAnnotation", typeAnnotation: { type: "TSStringKeyword" } },
        },
        {
          type: "TSPropertySignature",
          key: { type: "Identifier", name: "age" },
          optional: true,
          typeAnnotation: { type: "TSTypeAnnotation", typeAnnotation: { type: "TSNumberKeyword" } },
        },
        { type: "TSMethodSignature", key: { type: "Identifier", name: "greet" }, optional: false },
      ],
    },
  };
  assert.deepEqual(nodeKind(iface), {
    type: "type",
    fields: [
      { name: "age", type: "number", optional: true },
      { name: "greet", type: "fn", optional: false },
      { name: "name", type: "string", optional: false },
    ],
  });
});

test("parseFile 提取 interface 字段 / type 别名对象字面量字段，非对象字面量无字段", () => {
  const code = [
    "export interface User { name: string; age?: number }",
    "export type Point = { x: number; y: number }",
    "export type ID = string", // 非对象字面量，不追踪字段
  ].join("\n");
  const { exports } = parseFile(code);
  assert.deepEqual(exports, [
    {
      name: "User",
      type: "type",
      line: 1,
      fields: [
        { name: "age", type: "number", optional: true },
        { name: "name", type: "string", optional: false },
      ],
    },
    {
      name: "Point",
      type: "type",
      line: 2,
      fields: [
        { name: "x", type: "number", optional: false },
        { name: "y", type: "number", optional: false },
      ],
    },
    { name: "ID", type: "type", line: 3, aliasType: "string" },
  ]);
});

test("signature type 字段签名 / 别名签名；无字段无别名的 type 回退为 'type'", () => {
  const sym = {
    type: "type",
    fields: [
      { name: "age", type: "number", optional: true },
      { name: "name", type: "string", optional: false },
    ],
  };
  assert.equal(signature(sym), "type{age:number?,name:string}");
  assert.equal(signature({ type: "type", aliasType: "string" }), "type=string");
  assert.equal(signature({ type: "type" }), "type");
});

test("diffSymbols 识别 type 字段变更（modified，携带 old/new 结构化符号）", () => {
  const file = "src/types.ts";
  const o = {
    name: "User",
    type: "type",
    line: 1,
    fields: [{ name: "name", type: "string", optional: false }],
  };
  const n = {
    name: "User",
    type: "type",
    line: 1,
    // extractFields 已按 name 排序，签名才稳定
    fields: [
      { name: "age", type: "number", optional: false },
      { name: "name", type: "string", optional: false },
    ],
  };
  assert.deepEqual(diffSymbols(file, [o], [n]), [
    {
      file,
      symbol: "User",
      changeType: "modified",
      oldSignature: "type{name:string}",
      newSignature: "type{age:number,name:string}",
      oldSymbol: o,
      newSymbol: n,
      line: 1,
    },
  ]);
});

test("parseFile 提取 reexport 的导出名 + local 绑定映射", () => {
  const { exports } = parseFile(`
    const a = 1;
    const b = 2;
    export { a as x, b };
    export { a as y } from "./other";
  `);
  const x = exports.find((s) => s.name === "x");
  const b2 = exports.find((s) => s.name === "b");
  const y = exports.find((s) => s.name === "y");
  assert.equal(x.type, "reexport");
  assert.equal(x.localName, "a"); // export { a as x }：导出名 x，local 绑定 a
  assert.equal(b2.type, "reexport");
  assert.equal(b2.localName, "b"); // export { b } 无别名：local === exported
  assert.equal(y.type, "reexport");
  assert.equal(y.localName, "a"); // export { a as y } from './other' 同样记 local 映射
});

test("signature reexport 体现 local 绑定（导出名变化走配对，local 变化走 modified）", () => {
  assert.equal(signature({ type: "reexport", name: "y", localName: "x" }), "reexport:x");
  assert.equal(signature({ type: "reexport", name: "x", localName: "x" }), "reexport:x");
});

test("diffSymbols 识别重命名导出（renamed：导出名变但 local 绑定相同）", () => {
  const file = "src/index.ts";
  const o = { name: "oldName", type: "reexport", localName: "x", line: 1 };
  const n = { name: "newName", type: "reexport", localName: "x", line: 1 };
  assert.deepEqual(diffSymbols(file, [o], [n]), [
    {
      file,
      symbol: "oldName",
      newName: "newName",
      localName: "x",
      changeType: "renamed",
      oldSignature: "reexport:x",
      newSignature: "reexport:x",
      oldSymbol: o,
      newSymbol: n,
      line: 1,
    },
  ]);
});

test("diffSymbols 不误配对：removed reexport 无同名 local 的 added 时保留为 removed", () => {
  const file = "src/index.ts";
  const o = { name: "gone", type: "reexport", localName: "x", line: 1 };
  const n = { name: "other", type: "reexport", localName: "w", line: 1 };
  const result = diffSymbols(file, [o], [n]);
  assert.equal(result.length, 2);
  assert.ok(result.some((c) => c.changeType === "removed" && c.symbol === "gone"));
  assert.ok(result.some((c) => c.changeType === "added" && c.symbol === "other"));
});

test("nodeKind 提取 enum 成员（按声明顺序）", () => {
  const decl = {
    type: "TSEnumDeclaration",
    members: [
      { type: "TSEnumMember", id: { type: "Identifier", name: "Red" } },
      { type: "TSEnumMember", id: { type: "Identifier", name: "Green" } },
    ],
  };
  assert.deepEqual(nodeKind(decl), { type: "enum", enumMembers: ["Red", "Green"] });
  assert.deepEqual(nodeKind({ type: "TSEnumDeclaration", members: [] }), { type: "enum" });
});

test("parseFile 提取 enum 成员", () => {
  const { exports } = parseFile(`export enum Color { Red, Green = 2, Blue }`);
  const color = exports.find((s) => s.name === "Color");
  assert.equal(color.type, "enum");
  assert.deepEqual(color.enumMembers, ["Red", "Green", "Blue"]);
});

test("signature enum 签名", () => {
  assert.equal(signature({ type: "enum", enumMembers: ["Red", "Green"] }), "enum{Red,Green}");
});

test("diffSymbols 识别 enum 成员变更（modified）", () => {
  const file = "src/color.ts";
  const o = { name: "Color", type: "enum", line: 1, enumMembers: ["Red", "Green", "Blue"] };
  const n = { name: "Color", type: "enum", line: 1, enumMembers: ["Red", "Green"] };
  assert.deepEqual(diffSymbols(file, [o], [n]), [
    {
      file,
      symbol: "Color",
      changeType: "modified",
      oldSignature: "enum{Red,Green,Blue}",
      newSignature: "enum{Red,Green}",
      oldSymbol: o,
      newSymbol: n,
      line: 1,
    },
  ]);
});

test("nodeKind 提取 class 成员（方法/属性 + 可见性，按 name 排序）", () => {
  const decl = {
    type: "ClassDeclaration",
    body: {
      body: [
        { type: "ClassMethod", key: { name: "render" } },
        { type: "ClassMethod", key: { name: "helper" }, accessibility: "private" },
        { type: "ClassProperty", key: { name: "count" }, accessibility: "protected" },
      ],
    },
  };
  assert.deepEqual(nodeKind(decl), {
    type: "class",
    classMembers: [
      { name: "count", visibility: "protected", kind: "property" },
      { name: "helper", visibility: "private", kind: "method" },
      { name: "render", visibility: "public", kind: "method" },
    ],
  });
  // 无成员 class 不存 classMembers
  assert.deepEqual(nodeKind({ type: "ClassDeclaration", body: { body: [] } }), { type: "class" });
});

test("parseFile 提取 class 成员", () => {
  const { exports } = parseFile(`
    export class Widget {
      render() {}
      private helper() {}
      protected count = 0;
    }
  `);
  const w = exports.find((s) => s.name === "Widget");
  assert.equal(w.type, "class");
  assert.deepEqual(w.classMembers, [
    { name: "count", visibility: "protected", kind: "property" },
    { name: "helper", visibility: "private", kind: "method" },
    { name: "render", visibility: "public", kind: "method" },
  ]);
});

test("signature class 签名（成员:可见性，方法加 ()）", () => {
  const sym = {
    type: "class",
    classMembers: [
      { name: "count", visibility: "private", kind: "property" },
      { name: "render", visibility: "public", kind: "method" },
    ],
  };
  assert.equal(signature(sym), "class{count:private,render():public}");
});

test("diffSymbols 识别 class 成员变更（modified）", () => {
  const file = "src/widget.ts";
  const o = {
    name: "Widget",
    type: "class",
    line: 1,
    classMembers: [{ name: "render", visibility: "public", kind: "method" }],
  };
  const n = {
    name: "Widget",
    type: "class",
    line: 1,
    classMembers: [{ name: "render", visibility: "private", kind: "method" }],
  };
  assert.deepEqual(diffSymbols(file, [o], [n]), [
    {
      file,
      symbol: "Widget",
      changeType: "modified",
      oldSignature: "class{render():public}",
      newSignature: "class{render():private}",
      oldSymbol: o,
      newSymbol: n,
      line: 1,
    },
  ]);
});
