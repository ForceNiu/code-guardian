// 规则引擎单元测试（node:test + assert，零额外依赖）
// 覆盖 rules.cjs 的 runRules / classifyFunctionChange / containsAny，每条规则正例 + 反例。

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runRules, classifyFunctionChange, containsAny } = require("../src/worker/rules.cjs");

// 辅助构造器
function fn(params = [], extra = {}) {
  return { name: "f", type: "function", line: 1, params, ...extra };
}
function param(type, optional = false) {
  return { type, optional };
}

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

test("非函数符号修改（type/class 字段级）→ low/uncertain", () => {
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
