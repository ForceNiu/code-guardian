// 规则引擎单元测试（node:test + assert，零额外依赖）
// 覆盖 rules.cjs 的 runRules / classifyFunctionChange / containsAny，每条规则正例 + 反例。

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  runRules,
  classifyFunctionChange,
  classifyTypeFieldChange,
  classifyEnumChange,
  classifyClassChange,
  containsAny,
  isFunctionLike,
} = require("../src/worker/rules.cjs");

// 辅助构造器
function fn(params = [], extra = {}) {
  return { name: "f", type: "function", line: 1, params, ...extra };
}
function param(type, optional = false) {
  return { type, optional };
}
// type/interface 符号构造器
function typeSym(fields = [], extra = {}) {
  return { name: "T", type: "type", line: 1, ...(fields.length ? { fields } : {}), ...extra };
}
function field(name, type, optional = false) {
  return { name, type, optional };
}

test("重命名导出：high/proven（删了旧导出名，下游 import 旧名的崩了）", () => {
  const cs = {
    changeType: "renamed",
    oldSymbol: { type: "reexport", localName: "x", name: "oldName" },
    newSymbol: { type: "reexport", localName: "x", name: "newName" },
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
  // proven 的 high 不受影响面升级影响（已到顶）
  assert.deepEqual(runRules(cs, 8), { severity: "high", confidence: "proven" });
});

test("删除导出：有引用 → high/proven，无引用 → medium/proven", () => {
  assert.deepEqual(runRules({ changeType: "removed", oldSymbol: fn() }, 3), {
    severity: "high",
    confidence: "proven",
  });
  assert.deepEqual(runRules({ changeType: "removed", oldSymbol: fn() }, 0), {
    severity: "medium",
    confidence: "proven",
  });
});

test("新增导出：不含 any → low/proven；含 any → medium/proven", () => {
  assert.deepEqual(runRules({ changeType: "added", newSymbol: fn([param("number")]) }, 0), {
    severity: "low",
    confidence: "proven",
  });
  // 参数含 any
  assert.deepEqual(runRules({ changeType: "added", newSymbol: fn([param("any")]) }, 0), {
    severity: "medium",
    confidence: "proven",
  });
  // 返回类型含 any
  assert.deepEqual(
    runRules({ changeType: "added", newSymbol: fn([], { returnType: "any" }) }, 0),
    { severity: "medium", confidence: "proven" },
  );
});

test("async 状态变 → high/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("string")], { async: true }),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("返回类型变 → high/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([], { returnType: "string" }),
        newSymbol: fn([], { returnType: "number" }),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("新增必填参数 → high/proven；新增可选参数 → low/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("string"), param("number")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("string"), param("number", true)]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
});

test("移除参数 → high/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string"), param("number")]),
        newSymbol: fn([param("string")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("参数可选↔必填：optional→required → high，required→optional → low", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string", true)]),
        newSymbol: fn([param("string", false)]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string", false)]),
        newSymbol: fn([param("string", true)]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
});

test("参数类型：any→具体 收紧 high；具体→any 放宽 low；具体→具体 不明 heuristic", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("any")]),
        newSymbol: fn([param("string")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("any")]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("number")]),
      },
      1,
    ),
    { severity: "medium", confidence: "heuristic" },
  );
});

test("非函数符号修改且无字段（纯 type 别名/class/variable）→ low/uncertain", () => {
  const oldSym = { name: "Config", type: "type", line: 1 };
  const newSym = { name: "Config", type: "type", line: 1 };
  assert.deepEqual(runRules({ changeType: "modified", oldSymbol: oldSym, newSymbol: newSym }, 2), {
    severity: "low",
    confidence: "uncertain",
  });
});

test("影响面升级：heuristic/uncertain 在 ≥5 时升档，proven 不升", () => {
  // heuristic medium → high
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("number")]),
      },
      5,
    ),
    { severity: "high", confidence: "heuristic" },
  );
  // uncertain low → medium
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: { name: "C", type: "type" },
        newSymbol: { name: "C", type: "type" },
      },
      6,
    ),
    { severity: "medium", confidence: "uncertain" },
  );
  // proven low 不升（新增可选参数，引用再多也不崩）
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: fn([param("string")]),
        newSymbol: fn([param("string"), param("number", true)]),
      },
      8,
    ),
    { severity: "low", confidence: "proven" },
  );
});

test("classifyFunctionChange 直接分类", () => {
  assert.equal(
    classifyFunctionChange(fn([param("string")]), fn([param("string"), param("number")])),
    "addedRequiredParam",
  );
  assert.equal(
    classifyFunctionChange(fn([param("string", true)]), fn([param("string")])),
    "paramOptionalToRequired",
  );
  assert.equal(
    classifyFunctionChange(fn([], { returnType: "string" }), fn([], { returnType: "number" })),
    "returnTypeChanged",
  );
});

test("containsAny 识别 any 参数与返回类型", () => {
  assert.equal(containsAny(fn([param("any")])), true);
  assert.equal(containsAny(fn([], { returnType: "any" })), true);
  assert.equal(containsAny(fn([param("string")])), false);
  assert.equal(containsAny(null), false);
});

// ===== M3a-2：type/interface 字段级规则 =====

test("删除字段 → high/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("name", "string"), field("age", "number")]),
        newSymbol: typeSym([field("name", "string")]),
      },
      2,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("新增必填字段 → high/proven；新增可选字段 → low/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("name", "string")]),
        newSymbol: typeSym([field("name", "string"), field("age", "number")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("name", "string")]),
        newSymbol: typeSym([field("name", "string"), field("age", "number", true)]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
});

test("字段重命名（删旧+增新）→ high/proven", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("fullName", "string")]),
        newSymbol: typeSym([field("name", "string")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("字段可选↔必填：optional→required → high，required→optional → low", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("age", "number", true)]),
        newSymbol: typeSym([field("age", "number", false)]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("age", "number", false)]),
        newSymbol: typeSym([field("age", "number", true)]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
});

test("字段类型：any→具体 收紧 high；具体→any 放宽 low；具体→具体 不明 heuristic", () => {
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("v", "any")]),
        newSymbol: typeSym([field("v", "string")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("v", "string")]),
        newSymbol: typeSym([field("v", "any")]),
      },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([field("v", "string")]),
        newSymbol: typeSym([field("v", "number")]),
      },
      1,
    ),
    { severity: "medium", confidence: "heuristic" },
  );
});

test("type 别名（无字段）改成对象字面量（有字段）→ 按新增字段定级", () => {
  // type X = string  →  type X = { name: string }（新增必填字段）
  assert.deepEqual(
    runRules(
      {
        changeType: "modified",
        oldSymbol: typeSym([]),
        newSymbol: typeSym([field("name", "string")]),
      },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
});

test("classifyTypeFieldChange 直接分类", () => {
  assert.equal(
    classifyTypeFieldChange(typeSym([field("a", "string")]), typeSym([field("a", "string"), field("b", "number")])),
    "addedRequiredField",
  );
  assert.equal(
    classifyTypeFieldChange(typeSym([field("a", "string")]), typeSym([])),
    "removedField",
  );
  assert.equal(
    classifyTypeFieldChange(typeSym([field("a", "string", true)]), typeSym([field("a", "string", false)])),
    "fieldOptionalToRequired",
  );
  assert.equal(
    classifyTypeFieldChange(typeSym([field("a", "string")]), typeSym([field("a", "number")])),
    "fieldTypeUnclear",
  );
});

test("type 别名目标类型变化：any→具体 收紧 high；具体→any 放宽 low；具体→具体 heuristic", () => {
  const aliasSym = (aliasType) => ({ name: "X", type: "type", aliasType });
  assert.deepEqual(
    runRules(
      { changeType: "modified", oldSymbol: aliasSym("any"), newSymbol: aliasSym("string") },
      1,
    ),
    { severity: "high", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      { changeType: "modified", oldSymbol: aliasSym("string"), newSymbol: aliasSym("any") },
      1,
    ),
    { severity: "low", confidence: "proven" },
  );
  assert.deepEqual(
    runRules(
      { changeType: "modified", oldSymbol: aliasSym("string"), newSymbol: aliasSym("number") },
      1,
    ),
    { severity: "medium", confidence: "heuristic" },
  );
});

// enum 符号构造器
function enumSym(members = []) {
  return { name: "E", type: "enum", line: 1, ...(members.length ? { enumMembers: members } : {}) };
}

test("删除 enum 成员 → high/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: enumSym(["Red", "Green", "Blue"]),
    newSymbol: enumSym(["Red", "Green"]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("新增 enum 成员 → low/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: enumSym(["Red"]),
    newSymbol: enumSym(["Red", "Green"]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "low", confidence: "proven" });
});

test("enum 成员重命名（删旧+增新）→ high/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: enumSym(["Red", "Green"]),
    newSymbol: enumSym(["Red", "Blue"]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("enum 成员集相同（仅顺序变）→ low/uncertain 交 AI", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: enumSym(["Red", "Green"]),
    newSymbol: enumSym(["Green", "Red"]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "low", confidence: "uncertain" });
});

test("classifyEnumChange 直接分类", () => {
  assert.equal(classifyEnumChange(enumSym(["Red", "Green", "Blue"]), enumSym(["Red", "Green"])), "removedEnumMember");
  assert.equal(classifyEnumChange(enumSym(["Red"]), enumSym(["Red", "Green"])), "addedEnumMember");
  assert.equal(classifyEnumChange(enumSym(["Red", "Green"]), enumSym(["Green", "Red"])), "unknown");
});

// class 符号构造器
function classSym(members = []) {
  return { name: "C", type: "class", line: 1, ...(members.length ? { classMembers: members } : {}) };
}
function member(name, visibility = "public", kind = "method") {
  return { name, visibility, kind };
}

test("删除 class 成员 → high/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: classSym([member("render"), member("helper")]),
    newSymbol: classSym([member("render")]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("新增 class 成员 → low/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: classSym([member("render")]),
    newSymbol: classSym([member("render"), member("helper")]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "low", confidence: "proven" });
});

test("class 成员重命名（删旧+增新）→ high/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: classSym([member("render")]),
    newSymbol: classSym([member("draw")]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("可见性 public→private 收紧 high；private→public 放宽 low", () => {
  const narrow = {
    changeType: "modified",
    oldSymbol: classSym([member("render", "public")]),
    newSymbol: classSym([member("render", "private")]),
  };
  assert.deepEqual(runRules(narrow, 0), { severity: "high", confidence: "proven" });
  const widen = {
    changeType: "modified",
    oldSymbol: classSym([member("render", "private")]),
    newSymbol: classSym([member("render", "public")]),
  };
  assert.deepEqual(runRules(widen, 0), { severity: "low", confidence: "proven" });
});

test("protected 参与收紧/放宽方向判定", () => {
  const p2pro = { changeType: "modified", oldSymbol: classSym([member("x", "public")]), newSymbol: classSym([member("x", "protected")]) };
  assert.deepEqual(runRules(p2pro, 0), { severity: "high", confidence: "proven" });
  const pro2pri = { changeType: "modified", oldSymbol: classSym([member("x", "protected")]), newSymbol: classSym([member("x", "private")]) };
  assert.deepEqual(runRules(pro2pri, 0), { severity: "high", confidence: "proven" });
  const pri2pro = { changeType: "modified", oldSymbol: classSym([member("x", "private")]), newSymbol: classSym([member("x", "protected")]) };
  assert.deepEqual(runRules(pri2pro, 0), { severity: "low", confidence: "proven" });
});

test("方法↔属性 kind 变 → high/proven", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: classSym([{ name: "x", visibility: "public", kind: "method" }]),
    newSymbol: classSym([{ name: "x", visibility: "public", kind: "property" }]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("classifyClassChange 直接分类", () => {
  assert.equal(classifyClassChange(classSym([member("a"), member("b")]), classSym([member("a")])), "removedClassMember");
  assert.equal(classifyClassChange(classSym([member("a")]), classSym([member("a"), member("b")])), "addedClassMember");
  assert.equal(classifyClassChange(classSym([member("a", "public")]), classSym([member("a", "private")])), "memberVisibilityNarrowed");
  assert.equal(classifyClassChange(classSym([member("a", "private")]), classSym([member("a", "public")])), "memberVisibilityWidened");
  assert.equal(
    classifyClassChange(
      classSym([{ name: "a", visibility: "public", kind: "method" }]),
      classSym([{ name: "a", visibility: "public", kind: "property" }]),
    ),
    "memberKindChanged",
  );
  assert.equal(classifyClassChange(classSym([member("a")]), classSym([member("a")])), "unknown");
});

// 参数名感知对齐（P5 修复）：识别「中间插入/删除必填参数」这类破坏性变更
function fnNamed(pdefs) {
  return { name: "f", type: "function", line: 1, params: pdefs.map((p) => ({ ...p })) };
}

test("中间插入必填参数 → addedRequiredParam（high/proven）", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: fnNamed([{ name: "a", type: "number" }, { name: "b", type: "string" }]),
    newSymbol: fnNamed([{ name: "a", type: "number" }, { name: "c", type: "boolean" }, { name: "b", type: "string" }]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("中间插入可选参数 → addedOptionalParam（low/proven）", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: fnNamed([{ name: "a", type: "number" }, { name: "b", type: "string" }]),
    newSymbol: fnNamed([{ name: "a", type: "number" }, { name: "c", type: "boolean", optional: true }, { name: "b", type: "string" }]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "low", confidence: "proven" });
});

test("中间删除参数 → removedParam（high/proven）", () => {
  const cs = {
    changeType: "modified",
    oldSymbol: fnNamed([{ name: "a", type: "number" }, { name: "b", type: "string" }, { name: "c", type: "boolean" }]),
    newSymbol: fnNamed([{ name: "a", type: "number" }, { name: "c", type: "boolean" }]),
  };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("重命名导出 → high/proven（下游 import 旧名即崩）", () => {
  const cs = { changeType: "renamed", symbol: "oldName", newName: "newName" };
  assert.deepEqual(runRules(cs, 0), { severity: "high", confidence: "proven" });
});

test("重命名导出即使零引用也保持 high/proven（语义即破坏性）", () => {
  const cs = { changeType: "renamed", symbol: "a", newName: "b" };
  assert.deepEqual(runRules(cs, 99), { severity: "high", confidence: "proven" });
});

// ---------------------------------------------------------------------------
// default 导出 / const 箭头函数导出走函数签名规则（2026-09-15）
// 修复前：runRules 只认 type === "function"，这两种 React 最常见写法全部落
//        low/uncertain → 每条都要喂给 LangGraph 语义引擎烧 Token。
// ---------------------------------------------------------------------------

test("isFunctionLike：default / const 箭头导出只要带参数就算函数型", () => {
  assert.equal(isFunctionLike({ type: "function", params: [] }), true);
  assert.equal(isFunctionLike({ type: "default", params: [{ type: "{a:string}", name: "props" }] }), true);
  assert.equal(isFunctionLike({ type: "variable", params: [{ type: "string", name: "a" }] }), true);
  // 无签名的降级形态：export default memo(X) / export const TAX = 0.1
  assert.equal(isFunctionLike({ type: "default" }), false);
  assert.equal(isFunctionLike({ type: "variable" }), false);
  assert.equal(isFunctionLike({ type: "type", fields: [{ name: "a", type: "number" }] }), false);
  assert.equal(isFunctionLike(null), false);
});

test("default / const 箭头导出的参数变化与具名函数同级（不再落 uncertain）", () => {
  const p1 = [{ type: "{a:string}", optional: false, name: "props" }];
  const p2 = [{ type: "{a:string,b:string}", optional: false, name: "props" }];
  const mk = (type) => ({
    changeType: "modified",
    oldSymbol: { name: "X", type, line: 1, params: p1 },
    newSymbol: { name: "X", type, line: 1, params: p2 },
  });
  const asFunction = runRules(mk("function"), 1);
  // 三种写法必须给出完全一致的判定，否则 React 项目里同样的改动会有两套标准
  assert.deepEqual(runRules(mk("default"), 1), asFunction);
  assert.deepEqual(runRules(mk("variable"), 1), asFunction);
  // 且不能再是 uncertain（要能靠规则直接定级，不走 AI）
  assert.notEqual(asFunction.confidence, "uncertain");
});

// ---------------------------------------------------------------------------
// 「已知缺陷样本集」第 1 条（配套断言，2026-09-16）
// 种类变化（function → const 箭头，参数完全不变）应当落 uncertain 交 AI 判断，
// 既不能静默丢弃（diffSymbols 侧断言，见 analyze-core.test.cjs），
// 也不能因为它「看着像纯重构」就直接放过。
// 依据：function 声明有提升（hoisting），const 箭头函数没有（TDZ），
//      this 绑定与可构造性亦不同 —— 属真实语义变更，规则引擎证不出 break，故交 AI。
// ---------------------------------------------------------------------------
test("种类变化（function → const 箭头，参数不变）落 uncertain 交 AI，不误判也不静默", () => {
  const params = [
    { type: "number", optional: false, name: "a" },
    { type: "number", optional: false, name: "b" },
  ];
  const r = runRules(
    {
      changeType: "modified",
      oldSymbol: { name: "add", type: "function", line: 1, params, returnType: "number" },
      newSymbol: { name: "add", type: "variable", line: 1, params, returnType: "number" },
    },
    1,
  );
  assert.equal(r.confidence, "uncertain");
  assert.equal(r.severity, "low");
});

// ---------------------------------------------------------------------------
// 已知缺陷样本集 · 第 3 条（定级侧）：0 参 → 有参
// 检测侧同族断言见 tests/analyze-core.test.cjs 末尾（那一组证明「不是漏报」）。
// 本条回答的是另一个问题：**检出来之后定级准不准**。
//
// ✅ A3 已于 2026-09-16 修复（`isFunctionLike` 补判 `sym.paramCount !== undefined`）。
//    **修复过程本身就是这套样本集的价值兑现**：修之前这三条是这样的 ——
//    第 1 条（具名函数）绿、第 2/3 条（default / const）断言的是 `low/uncertain`。
//    改完 `rules.cjs` 后，第 2/3 条**如期变红**（不是意外挂掉），再【有意】翻面为 proven 系。
//    没有这组断言，你分不清「A3 修好了 0 参这一族」和「顺手把别的族也改了」。
//    🔵 附带结论：本条也守住了 A3「只能 OR、不能替换」的判据 —— 若谁把 params 判据换成
//    paramCount 判据，第 1 条（有 params 无 paramCount）会立刻变红。
// 第 1 条是**对照基准**（控制组）：具名函数同样 0 参，却能正确走参数规则 —— 不得回归。
// ---------------------------------------------------------------------------

test("0 参 → 有参：具名函数走参数规则，high/proven（对照基准，不得回归）", () => {
  const r = runRules(
    {
      changeType: "modified",
      oldSymbol: { name: "f", type: "function", line: 1, paramCount: 0, params: [] },
      newSymbol: {
        name: "f",
        type: "function",
        line: 1,
        paramCount: 1,
        params: [{ type: "number", optional: false, name: "a" }],
      },
    },
    0,
  );
  assert.equal(r.severity, "high");
  assert.equal(r.confidence, "proven");
});

test("0 参 → 有参：export default 导出走参数规则，high/proven（A3 已修，原为缺口标记）", () => {
  const r = runRules(
    {
      changeType: "modified",
      oldSymbol: { name: "default", type: "default", line: 1, paramCount: 0 },
      newSymbol: {
        name: "default",
        type: "default",
        line: 1,
        paramCount: 1,
        params: [{ type: "{a:string}", optional: false, name: "props" }],
      },
    },
    0,
  );
  assert.equal(r.severity, "high");
  assert.equal(r.confidence, "proven");
});

test("0 参 → 有参：const 箭头导出走参数规则，high/proven（A3 已修，原为缺口标记）", () => {
  const r = runRules(
    {
      changeType: "modified",
      oldSymbol: { name: "C", type: "variable", line: 1, paramCount: 0 },
      newSymbol: {
        name: "C",
        type: "variable",
        line: 1,
        paramCount: 1,
        params: [{ type: "{x:string}", optional: false, name: "props" }],
      },
    },
    0,
  );
  assert.equal(r.severity, "high");
  assert.equal(r.confidence, "proven");
});

