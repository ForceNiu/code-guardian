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
  resolveExportOrigin,
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
      { type: "string", optional: false, name: "id" },
      { type: "number", optional: true, name: "opt" },
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
        { type: "number", optional: false, name: "v" },
        { type: "number", optional: false, name: "c" },
      ],
    },
    { name: "TAX", type: "variable", line: 4 },
    { name: "Order", type: "class", line: 5 },
    { name: "Config", type: "type", line: 6, fields: [{ name: "a", type: "number", optional: false }] },
    // default 导出若直接是函数，必须携带签名，否则内部破坏性变更会被判为「无变化」
    { name: "default", type: "default", line: 7, paramCount: 0 },
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
        { type: "string", optional: false, name: "a" },
        { type: "number", optional: true, name: "b" },
      ],
      returnType: "Promise<void>",
    },
    { name: "g", type: "function", line: 2, paramCount: 0, params: [], async: true },
  ]);
});

test("parseFile 对空代码 / 非法代码安全降级为空", () => {
  assert.deepEqual(parseFile(""), { exports: [], imports: [], reexports: [] });
  assert.deepEqual(parseFile("   "), { exports: [], imports: [], reexports: [] });
  assert.deepEqual(parseFile("const = = 语法错误"), { exports: [], imports: [], reexports: [] });
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

// ---- M3a-2 增强：barrel 转发 / 嵌套对象类型 / 直接重命名 ----

test("parseFile 记录 export * 转发边（reexports）", () => {
  const code = [
    'export * from "./real";',
    'export { a, b as c } from "./other";',
    "export const x = 1;",
  ].join("\n");
  const { exports, reexports } = parseFile(code);
  assert.deepEqual(reexports, [{ source: "./real", line: 1 }]);
  // 具名转发仍走 exports（导出名 + local 绑定），不透传到 reexports
  const c = exports.find((e) => e.name === "c");
  assert.equal(c.type, "reexport");
  assert.equal(c.localName, "b");
});

test("parseFile 嵌套对象类型展开为字段类型文本", () => {
  const code = [
    "export interface Outer {",
    "  meta: { id: number; tag?: string };",
    "  name: string;",
    "}",
  ].join("\n");
  const { exports } = parseFile(code);
  const outer = exports.find((e) => e.name === "Outer");
  const meta = outer.fields.find((f) => f.name === "meta");
  // 成员按名排序 + 可选标记保留，保证签名稳定可比对
  assert.equal(meta.type, "{id:number,tag?:string}");
});

test("diffSymbols 识别直接符号重命名（恰好一删一增 + 同类型同签名）", () => {
  const file = "src/util.ts";
  const o = { name: "foo", type: "function", line: 1, params: [], returnType: "", async: false };
  const n = { name: "bar", type: "function", line: 1, params: [], returnType: "", async: false };
  const out = diffSymbols(file, [o], [n]);
  assert.equal(out.length, 1);
  assert.equal(out[0].changeType, "renamed");
  assert.equal(out[0].symbol, "foo");
  assert.equal(out[0].newName, "bar");
});

test("diffSymbols 不误配：两个增删同签名符号时保持 removed/added", () => {
  const file = "src/util.ts";
  const a = { name: "a", type: "function", line: 1, params: [], returnType: "", async: false };
  const b = { name: "b", type: "function", line: 2, params: [], returnType: "", async: false };
  const c = { name: "c", type: "function", line: 1, params: [], returnType: "", async: false };
  const d = { name: "d", type: "function", line: 2, params: [], returnType: "", async: false };
  const out = diffSymbols(file, [a, b], [c, d]);
  assert.equal(out.filter((x) => x.changeType === "renamed").length, 0);
  assert.equal(out.filter((x) => x.changeType === "removed").length, 2);
  assert.equal(out.filter((x) => x.changeType === "added").length, 2);
});

// ---- barrel 穿透：resolveExportOrigin ----

test("resolveExportOrigin 直接定义即返回自身", () => {
  const exportsByFile = new Map([["src/real.ts", [{ name: "foo", type: "function" }]]]);
  const reexportsByFile = new Map();
  const files = new Set(["src/real.ts"]);
  assert.equal(
    resolveExportOrigin("src/real.ts", "foo", exportsByFile, reexportsByFile, files),
    "src/real.ts",
  );
});

test("resolveExportOrigin 穿透 export * 到定义文件", () => {
  const exportsByFile = new Map([
    ["src/barrel.ts", []], // barrel 自身不定义符号
    ["src/real.ts", [{ name: "foo", type: "function" }]],
  ]);
  const reexportsByFile = new Map([["src/barrel.ts", [{ source: "./real", line: 1 }]]]);
  const files = new Set(["src/barrel.ts", "src/real.ts"]);
  assert.equal(
    resolveExportOrigin("src/barrel.ts", "foo", exportsByFile, reexportsByFile, files),
    "src/real.ts",
  );
});

test("resolveExportOrigin 支持多级 barrel 链", () => {
  const exportsByFile = new Map([["src/deep/real.ts", [{ name: "foo", type: "function" }]]]);
  const reexportsByFile = new Map([
    ["src/index.ts", [{ source: "./mid", line: 1 }]],
    ["src/mid.ts", [{ source: "./deep/real", line: 1 }]],
    ["src/deep/real.ts", []],
  ]);
  const files = new Set(["src/index.ts", "src/mid.ts", "src/deep/real.ts"]);
  assert.equal(
    resolveExportOrigin("src/index.ts", "foo", exportsByFile, reexportsByFile, files),
    "src/deep/real.ts",
  );
});

test("resolveExportOrigin 循环转发不死循环（a -> b -> a）", () => {
  const exportsByFile = new Map([
    ["src/a.ts", []],
    ["src/b.ts", []],
  ]);
  const reexportsByFile = new Map([
    ["src/a.ts", [{ source: "./b", line: 1 }]],
    ["src/b.ts", [{ source: "./a", line: 1 }]],
  ]);
  const files = new Set(["src/a.ts", "src/b.ts"]);
  assert.equal(resolveExportOrigin("src/a.ts", "foo", exportsByFile, reexportsByFile, files), null);
});

test("resolveExportOrigin 符号不存在时返回 null", () => {
  const exportsByFile = new Map([["src/real.ts", [{ name: "bar", type: "function" }]]]);
  const reexportsByFile = new Map();
  const files = new Set(["src/real.ts"]);
  assert.equal(resolveExportOrigin("src/real.ts", "foo", exportsByFile, reexportsByFile, files), null);
});

test("resolveExportOrigin 可穿透到 base 侧已删除文件（删除文件的引用方不漏报）", () => {
  // real.ts 在 head 已删 → exportsByFile 无它，但 files 集合把它纳入解析范围
  const exportsByFile = new Map();
  const reexportsByFile = new Map();
  const files = new Set(["src/consumer.ts", "src/deleted.ts"]);
  assert.equal(
    resolveExportOrigin("src/deleted.ts", "anything", exportsByFile, reexportsByFile, files),
    null, // 无导出可查 → null，调用方回退到 targetFile 本身，引用方仍被登记
  );
});

// ---- tsconfig 路径别名解析 ----

const { resolveImportWithAlias, buildPathAliases, parseJsonc } = require("../src/worker/analyze-core.cjs");

test("parseJsonc 能剥离注释与尾逗号", () => {
  const text = `{
    // 行注释
    "compilerOptions": {
      "baseUrl": ".", /* 块注释 */
      "paths": { "@/*": ["./src/*"] },
    },
  }`;
  const obj = parseJsonc(text);
  assert.deepEqual(obj.compilerOptions.paths, { "@/*": ["./src/*"] });
  assert.equal(obj.compilerOptions.baseUrl, ".");
});

test("parseJsonc 不误伤字符串里的 https://", () => {
  const obj = parseJsonc('{ "url": "https://example.com//x" }');
  assert.equal(obj.url, "https://example.com//x");
});

test("buildPathAliases 解析 @/* 通配映射", () => {
  const aliases = buildPathAliases('{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }');
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].prefix, "@/");
  assert.equal(aliases[0].targetBase, "./src/");
  assert.equal(aliases[0].baseDir, ".");
});

test("buildPathAliases 对非法 JSON / 无 paths 安全返回空", () => {
  assert.deepEqual(buildPathAliases("不是 JSON"), []);
  assert.deepEqual(buildPathAliases("{}"), []);
  assert.deepEqual(buildPathAliases(undefined), []);
});

test("resolveImportWithAlias 能解析 @/ 别名到真实文件", () => {
  const aliases = buildPathAliases('{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }');
  const allFiles = new Set(["src/components/NavBar.tsx", "src/lib/utils.ts", "src/app/page.tsx"]);
  assert.equal(
    resolveImportWithAlias("@/components/NavBar", "src/app/page.tsx", allFiles, aliases),
    "src/components/NavBar.tsx",
  );
  // 目录 → 补 /index
  assert.equal(
    resolveImportWithAlias("@/lib/utils", "src/app/page.tsx", allFiles, aliases),
    "src/lib/utils.ts",
  );
});

test("resolveImportWithAlias 无别名时退化为纯相对解析（行为不变）", () => {
  const allFiles = new Set(["src/utils/format.ts", "src/app/page.tsx"]);
  assert.equal(resolveImportWithAlias("../utils/format", "src/app/page.tsx", allFiles, []), "src/utils/format.ts");
  // 裸包名依然不解析（node_modules 不关心）
  assert.equal(resolveImportWithAlias("react", "src/app/page.tsx", allFiles, []), null);
  assert.equal(resolveImportWithAlias("@/x", "src/app/page.tsx", allFiles, []), null);
});

test("resolveImportWithAlias 尊重 baseUrl 子目录", () => {
  const aliases = buildPathAliases('{ "compilerOptions": { "baseUrl": "./config", "paths": { "~/*": ["../src/*"] } } }');
  const allFiles = new Set(["src/lib/a.ts", "src/app/page.tsx"]);
  assert.equal(resolveImportWithAlias("~/lib/a", "src/app/page.tsx", allFiles, aliases), "src/lib/a.ts");
});

// ---------------------------------------------------------------------------
// default 导出 / const 箭头函数导出的签名盲区修复（2026-09-15）
// 修复前：这两类导出的 signature() 恒等于类型名（"default" / "variable"），
//        参数变化永远比较不出差异 → 破坏性变更静默漏报（真实仓库实测占比 15%~41%）。
// ---------------------------------------------------------------------------

test("parseFile 为 default 导出的函数提取签名", () => {
  const code = "export default function Page(props: { a: string }) { return props.a; }";
  const { exports } = parseFile(code);
  assert.deepEqual(exports, [
    {
      name: "default",
      type: "default",
      line: 1,
      paramCount: 1,
      params: [{ type: "{a:string}", optional: false, name: "props" }],
    },
  ]);
});

test("parseFile 为 default 导出的箭头函数提取签名", () => {
  const { exports } = parseFile("export default (props: { a: string }) => props.a;");
  assert.equal(exports[0].name, "default");
  assert.equal(exports[0].paramCount, 1);
  assert.deepEqual(exports[0].params, [{ type: "{a:string}", optional: false, name: "props" }]);
});

test("parseFile 为 const 箭头函数导出提取签名（React 组件最常见写法）", () => {
  const { exports } = parseFile("export const Comp = (props: { a: string }) => props.a;");
  assert.deepEqual(exports, [
    {
      name: "Comp",
      type: "variable",
      line: 1,
      paramCount: 1,
      params: [{ type: "{a:string}", optional: false, name: "props" }],
    },
  ]);
});

test("signature 对 default / variable 带参数时输出函数签名而非类型名", () => {
  const def = parseFile("export default function Page(props: { a: string }) {}").exports[0];
  const arrow = parseFile("export const C = (props: { a: string }) => null;").exports[0];
  assert.equal(signature(def), "function({a:string})");
  assert.equal(signature(arrow), "function({a:string})");
});

test("export default memo(X) 等非函数形态不产生签名（降级，不制造噪音）", () => {
  const code = 'import { memo } from "react";\nfunction Page() {}\nexport default memo(Page);';
  const { exports } = parseFile(code);
  assert.deepEqual(exports, [{ name: "default", type: "default", line: 3 }]);
  assert.equal(signature(exports[0]), "default");
});

test("非函数 const 导出行为不变（仍为 variable）", () => {
  const { exports } = parseFile("export const TAX = 0.1;");
  assert.deepEqual(exports, [{ name: "TAX", type: "variable", line: 1 }]);
  assert.equal(signature(exports[0]), "variable");
});

test("diffSymbols 识别 default 导出参数变化（修复前静默漏报）", () => {
  const base = parseFile("export default function Page(props: { a: string }) { return props.a; }").exports;
  const head = parseFile(
    "export default function Page(props: { a: string; b: string }) { return props.a + props.b; }"
  ).exports;
  const changed = diffSymbols("src/Page.tsx", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].symbol, "default");
  assert.equal(changed[0].changeType, "modified");
  assert.notEqual(changed[0].oldSignature, changed[0].newSignature);
});

test("diffSymbols 识别 const 箭头函数参数变化（修复前静默漏报）", () => {
  const base = parseFile("export const Comp = (props: { a: string }) => props.a;").exports;
  const head = parseFile("export const Comp = (props: { a: string; b: string }) => props.a;").exports;
  const changed = diffSymbols("src/Comp.tsx", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].changeType, "modified");
});

// ---------------------------------------------------------------------------
// 「已知缺陷样本集」第 1 条 —— 回归修复（2026-09-16）
//
// 缺陷：签名修复让 `export function f(a,b)` 与 `export const f = (a,b) => …` 在带参数时
//      算出**完全相同**的签名 → diffSymbols 判「无变化」→ 整条变更静默消失。
// 实测：sample-repo fixture 变更符号数 9 → 4（丢的 5 个全是带参数的函数转箭头）；
//      而 0 参数的 HomePage 仅因新旧走不同分支而「碰巧」被检出。
// 规律：**凡是「少报」方向的缺陷，单测都不会自己报警**——必须显式断言「必须检出」。
// ---------------------------------------------------------------------------
test("diffSymbols 识别 export function → export const 箭头函数的种类变化（同参数，回归修复）", () => {
  const base = parseFile("export function add(a: number, b: number): number { return a + b; }").exports;
  const head = parseFile("export const add = (a: number, b: number): number => a + b;").exports;
  const changed = diffSymbols("src/utils/math.ts", base, head);
  assert.equal(changed.length, 1, "带参数的同签名种类变化必须被检出（修复前静默漏报）");
  assert.equal(changed[0].symbol, "add");
  assert.equal(changed[0].changeType, "modified");
  assert.equal(changed[0].oldSymbol.type, "function");
  assert.equal(changed[0].newSymbol.type, "variable");
});

test("diffSymbols 识别 export function → export const 的 0 参数形态（回归修复）", () => {
  const base = parseFile("export function tick(): void {}").exports;
  const head = parseFile("export const tick = (): void => {};").exports;
  const changed = diffSymbols("src/tick.ts", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].changeType, "modified");
});

test("diffSymbols 对同种类同签名的纯重写仍不误报（防过度修复）", () => {
  const base = parseFile("export const Comp = (props: { a: string }) => props.a;").exports;
  const head = parseFile("export const Comp = (props: { a: string }) => { return props.a; };").exports;
  assert.deepEqual(diffSymbols("src/Comp.tsx", base, head), []);
});

test("diffSymbols 对 default 导出无参数变化时仍不误报", () => {
  const base = parseFile("export default function Page() { return 1; }").exports;
  const head = parseFile("export default function Page() { return 2; }").exports;
  assert.deepEqual(diffSymbols("src/Page.tsx", base, head), []);
});

test("export default 裸标识符时借 local 声明的签名", () => {
  const code = "function Page(props: { a: string }) { return props.a; }\nexport default Page;";
  const { exports } = parseFile(code);
  const def = exports.find((e) => e.name === "default");
  assert.equal(def.paramCount, 1);
  assert.deepEqual(def.params, [{ type: "{a:string}", optional: false, name: "props" }]);
});

test("纯语法重构（export default function → 先声明后导出）不误报为 API 变更", () => {
  const base = parseFile("export default function Home(props: { a: string }) { return props.a; }").exports;
  const head = parseFile(
    "function Home(props: { a: string }) { return props.a; }\nexport default Home;"
  ).exports;
  assert.deepEqual(diffSymbols("src/app/page.tsx", base, head), []);
});

test("default 导出真实参数变化仍能被检出（Next 15→16 searchParams 变 Promise 场景）", () => {
  const base = parseFile("export default async function Home() { return null; }").exports;
  const head = parseFile(
    "export default async function Home(props: { searchParams: Promise<{ tag?: string }> }) { return null; }"
  ).exports;
  const changed = diffSymbols("src/app/page.tsx", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].changeType, "modified");
});

// ---- 已知缺陷样本集 · 第 2 条：export default class 的成员变化 ----
// 背景：signature() 的 class 分支守卫曾被放宽（sym.type === "class" → 只看 classMembers），
// 使 `export default class` 的成员变化从「检测不到」变为「检得到」。
// 这是同一类 default 导出签名盲区的修复，但 2026-09-16 提交前审查发现它**零断言覆盖** ——
// 与三次「少报」事故（git show 引号 / 签名盲区 / B4）是同一个模式：真实检测面扩张，没有断言守着。
// 本组断言的职责：钉住这个行为。删除 class 守卫的放宽，第 2、3 条必须变红。

test("parseFile 为 export default class 提取成员（default 导出签名盲区）", () => {
  const { exports } = parseFile("export default class Widget { render() {} }");
  const def = exports.find((e) => e.name === "default");
  assert.equal(def.type, "default");
  assert.deepEqual(def.classMembers, [{ name: "render", visibility: "public", kind: "method" }]);
  // 关键：签名不再是常量 "default"，而是真实成员签名
  assert.equal(signature(def), "class{render():public}");
});

test("diffSymbols 识别 export default class 成员变化（修复前静默漏报）", () => {
  const base = parseFile("export default class Widget { render() {} }").exports;
  const head = parseFile("export default class Widget { render() {} destroy() {} }").exports;
  const changed = diffSymbols("src/widget.ts", base, head);
  assert.equal(changed.length, 1, "default 导出 class 的成员增加必须被检出（修复前签名恒为 'default'，静默漏报）");
  assert.equal(changed[0].symbol, "default");
  assert.equal(changed[0].changeType, "modified");
  assert.equal(changed[0].oldSignature, "class{render():public}");
  assert.equal(changed[0].newSignature, "class{destroy():public,render():public}");
});

test("diffSymbols 识别 export default class 成员可见性变化（public → private）", () => {
  const base = parseFile("export default class Widget { render() {} }").exports;
  const head = parseFile("export default class Widget { private render() {} }").exports;
  const changed = diffSymbols("src/widget.ts", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].oldSignature, "class{render():public}");
  assert.equal(changed[0].newSignature, "class{render():private}");
});

test("export default class 内容不变时不误报（防过度修复）", () => {
  const base = parseFile("export default class Widget { render() {} }").exports;
  const head = parseFile("export default class Widget { render() {} }").exports;
  assert.deepEqual(diffSymbols("src/widget.ts", base, head), []);
});

// ---- 已知缺陷样本集 · 第 3 条：0 参 → 有参（检测侧）----
// 根因（2026-09-16 实测三种写法的符号形态）：
//   `export function f()`                  → { type: "function", params: [] }        ← params 存在（空数组）
//   `export default async function Home()` → { type: "default",  paramCount: 0 }     ← params 不存在
//   `export const C = () => null`          → { type: "variable", paramCount: 0 }     ← params 不存在
// 差别来自 attachKindInfo 只在 `info.params.length` 非空时才挂 params；具名函数则整包 Object.assign。
// 于是 0 参时 default / variable 两种写法的 signature() 会【回落到类型名】，定级侧随之失去精度。
// 🔵 重要澄清：这【不是漏报】——三种写法在 diffSymbols 层都【检出了】变更（见下方断言）。
//    问题只在【定级精度】：走不进参数 heuristic → 恒定 low/uncertain → 白烧 AI Token（见 A3）。
//    「静默丢弃」（B4 / 签名盲区）与「定级不准」（本条）是两种性质，不要混为一谈。
// 📌 定级侧同族断言在 tests/rules.test.cjs 末尾。
//    ⚠️ 分层要分清：A3 的修法（`isFunctionLike` 改判 `paramCount !== undefined`）**只动 rules 层定级**，
//    **不改 signature()** —— 所以修 A3 后**本文件的断言应全部保持绿色**（签名仍回落为类型名），
//    只有 rules.test.cjs 那两条会变红。若哪天连 signature() 一起改（让 0 参也输出 `function()`），
//    则本文件这两条也必须【有意】更新 —— 这正是分层断言的价值：谁被改动，一眼可见。

test("0 参 → 加第一个参数：具名函数（对照基准，参数变化永远优于类型名回落）", () => {
  const base = parseFile("export function f() { return 1; }").exports;
  const head = parseFile("export function f(a: number) { return 1; }").exports;
  const changed = diffSymbols("src/f.ts", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].changeType, "modified");
  assert.equal(changed[0].oldSignature, "function()");
  assert.equal(changed[0].newSignature, "function(number)");
});

test("0 参 → 加第一个参数：export default 导出必须检出（签名回落为 'default'，但非漏报）", () => {
  const base = parseFile("export default async function Home() { return null; }").exports;
  const head = parseFile(
    "export default async function Home(props: { a: string }) { return null; }"
  ).exports;
  const changed = diffSymbols("src/app/page.tsx", base, head);
  assert.equal(changed.length, 1, "0 参 → 有参必须被检出（整类 default 导出漏检曾是签名盲区事故）");
  assert.equal(changed[0].changeType, "modified");
  // 📌 缺口标记（检测层现状）：0 参时 params 不挂到符号上，故签名回落为类型名。
  //    A3 只改 rules 层，**不会**改这里；本断言在 A3 修复后应仍然成立。
  assert.equal(changed[0].oldSignature, "default");
  assert.equal(changed[0].newSignature, "async function({a:string})");
});

test("0 参 → 加第一个参数：const 箭头导出必须检出（签名回落为 'variable'，但非漏报）", () => {
  const base = parseFile("export const C = () => null;").exports;
  const head = parseFile("export const C = (props: { x: string }) => null;").exports;
  const changed = diffSymbols("src/C.tsx", base, head);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].changeType, "modified");
  // 📌 缺口标记（检测层现状）—— 同 default 那条：A3 修复后本断言应仍然成立（signature() 不受 A3 影响）
  assert.equal(changed[0].oldSignature, "variable");
  assert.equal(changed[0].newSignature, "function({x:string})");
});

test("0 参导出纯重写（参数确实没变）不误报（防过度修复）", () => {
  const base = parseFile("export const C = () => null;").exports;
  const head = parseFile("export const C = () => undefined;").exports;
  assert.deepEqual(diffSymbols("src/C.tsx", base, head), []);
});

test("0 参 default 导出改成同名 const 导出：报 removed + added（导出名已不是 'default'，属保守方向）", () => {
  const base = parseFile("export default function Home() { return null; }").exports;
  const head = parseFile("export const Home = (a: number) => null;").exports;
  const changed = diffSymbols("src/x.ts", base, head);
  // `export default function Home()` 的导出名是 'default'（local 名 Home 并未具名导出），
  // head 变成具名导出 'Home' → 是「default 消失 + Home 新增」，语义正确。
  // 报得比实际"重命名"更保守（removed/added 而非 renamed）属于安全方向——不会漏报。
  assert.deepEqual(
    changed.map((c) => [c.symbol, c.changeType]).sort(),
    [["Home", "added"], ["default", "removed"]],
  );
});
