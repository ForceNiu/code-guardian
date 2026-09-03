// 确定性规则引擎（M3a）：消费 diffSymbols 产出的 ChangedSymbol，输出 { severity, confidence }。
// 纯函数、无 IO、无副作用，可被 node:test 直接单测（CommonJS，同 analyze-core.cjs）。
//
// 判据（业界 semver 口径，见 docs/architecture.md §8）：
//   删 / 收紧 = breaking（会崩）；增 / 放宽 = 兼容（不崩）。
// 置信度三档：
//   proven   —— 变更自身即证据，可直接定级、直接作为门禁（规则引擎 0 Token 处理）；
//   heuristic —— 类型文本变了但证明不了 break，需转 AI / 人工复核（不 fail）；
//   uncertain —— 归不了类，交 LangGraph 语义引擎。

// 影响面升级映射（对标 SonarQube Impact×Likelihood：不确定类变更，波及广才升档）
const UPGRADE = { low: "medium", medium: "high", high: "high" };

/** 判断符号是否含 any（参数或返回类型）—— R17 新增 any 信号 */
function containsAny(sym) {
  if (!sym) return false;
  if (sym.returnType === "any") return true;
  return (sym.params || []).some((p) => p.type === "any");
}

/**
 * 分类函数签名变更：对比 old/new 的 async / returnType / params，
 * 返回一个变更类型标签，供查表定级。
 * 简化约定：新增参数按「追加到尾部」对齐（覆盖最常见场景，插入中间参数后续精确化）。
 */
function classifyFunctionChange(oldSym, newSym) {
  // 同步 ↔ 异步（async 会让返回类型从 T 变 Promise<T>，故优先于返回类型判断）
  if (!!oldSym.async !== !!newSym.async) return "asyncChanged";

  // 返回类型变
  const oldRet = oldSym.returnType || "";
  const newRet = newSym.returnType || "";
  if (oldRet !== newRet) return "returnTypeChanged";

  const op = oldSym.params || [];
  const np = newSym.params || [];

  // 新增参数
  if (np.length > op.length) {
    const added = np[op.length]; // 尾部新增
    return added && added.optional ? "addedOptionalParam" : "addedRequiredParam";
  }
  // 移除参数
  if (np.length < op.length) return "removedParam";

  // 参数个数相同，逐个对比
  for (let i = 0; i < np.length; i++) {
    if (!!op[i].optional !== !!np[i].optional) {
      return np[i].optional ? "paramRequiredToOptional" : "paramOptionalToRequired";
    }
    const ot = op[i].type || "";
    const nt = np[i].type || "";
    if (ot !== nt) {
      if (ot === "any" && nt !== "any") return "paramTypeNarrowed"; // any→具体 = 收紧
      if (ot !== "any" && nt === "any") return "paramTypeWidened"; // 具体→any = 放宽
      return "paramTypeUnclear"; // 具体→具体，方向不明
    }
  }

  return "unknown"; // 理论不会到（diffSymbols 仅在签名变时产出 modified）
}

/**
 * 分类 type/interface 字段变更（M3a-2）：对比 old/new 的 fields（按 name 对齐），
 * 返回变更类型标签，供查表定级。判据与函数参数同构：删字段/增必填=breaking，增可选/放宽=兼容。
 * 字段重命名会被识别为「删旧字段 + 增新字段」→ removedField（high）。
 */
function classifyTypeFieldChange(oldSym, newSym) {
  const of = oldSym.fields || [];
  const nf = newSym.fields || [];
  const oldMap = new Map(of.map((f) => [f.name, f]));
  const newMap = new Map(nf.map((f) => [f.name, f]));

  // 字段增删优先（含重命名：删旧 + 增新，先命中 removedField）
  const removed = of.filter((f) => !newMap.has(f.name));
  const added = nf.filter((f) => !oldMap.has(f.name));
  if (removed.length > 0) return "removedField";
  if (added.length > 0) {
    return added.every((f) => f.optional) ? "addedOptionalField" : "addedRequiredField";
  }

  // 字段集相同，逐个对比 optional / type
  for (const f of nf) {
    const oldF = oldMap.get(f.name);
    if (!oldF) continue; // 理论不会（added 已处理）
    if (!!oldF.optional !== !!f.optional) {
      return f.optional ? "fieldRequiredToOptional" : "fieldOptionalToRequired";
    }
    const ot = oldF.type || "";
    const nt = f.type || "";
    if (ot !== nt) {
      if (ot === "any" && nt !== "any") return "fieldTypeNarrowed"; // any→具体 = 收紧
      if (ot !== "any" && nt === "any") return "fieldTypeWidened"; // 具体→any = 放宽
      return "fieldTypeUnclear"; // 具体→具体，方向不明
    }
  }

  return "unknown";
}

/**
 * 分类 enum 成员变更（M3a-2）：对比 old/new 的 enumMembers（成员名列表，按声明顺序）。
 * 删成员（含重命名=删旧+增新）→ removedEnumMember（high）；增成员 → addedEnumMember（low）。
 * 成员集相同（含顺序变化，数值 enum 隐式值可能变）→ unknown 交 AI。
 */
function classifyEnumChange(oldSym, newSym) {
  const om = oldSym.enumMembers || [];
  const nm = newSym.enumMembers || [];
  const oldSet = new Set(om);
  const newSet = new Set(nm);
  const removed = om.filter((m) => !newSet.has(m));
  const added = nm.filter((m) => !oldSet.has(m));
  if (removed.length > 0) return "removedEnumMember"; // 含重命名：删旧 + 增新
  if (added.length > 0) return "addedEnumMember";
  return "unknown"; // 成员集相同（含顺序变化）→ 交 AI
}

/** 可见性等级：数值越大越"私有"（用于判断收紧/放宽方向） */
const VIS_LEVEL = { public: 0, protected: 1, private: 2 };

/**
 * 分类 class 成员变更（M3a-2）：对比 old/new 的 classMembers（成员名 + 可见性 + kind）。
 * 删成员（含重命名=删旧+增新）→ removedClassMember（high）；增成员 → addedClassMember（low）；
 * 可见性收紧（public→private/protected）→ memberVisibilityNarrowed（high）；放宽 → memberVisibilityWidened（low）；
 * 方法↔属性 kind 变 → memberKindChanged（high，调用方式变）。
 */
function classifyClassChange(oldSym, newSym) {
  const om = oldSym.classMembers || [];
  const nm = newSym.classMembers || [];
  const oldMap = new Map(om.map((m) => [m.name, m]));
  const newMap = new Map(nm.map((m) => [m.name, m]));

  const removed = om.filter((m) => !newMap.has(m.name));
  const added = nm.filter((m) => !oldMap.has(m.name));
  if (removed.length > 0) return "removedClassMember"; // 含重命名：删旧 + 增新
  if (added.length > 0) return "addedClassMember";

  for (const m of nm) {
    const oldM = oldMap.get(m.name);
    if (!oldM) continue;
    if (oldM.kind !== m.kind) return "memberKindChanged"; // 方法↔属性
    const ol = VIS_LEVEL[oldM.visibility] ?? 0;
    const nl = VIS_LEVEL[m.visibility] ?? 0;
    if (ol !== nl) return nl > ol ? "memberVisibilityNarrowed" : "memberVisibilityWidened";
  }
  return "unknown";
}

// 规则表：变更类型 -> { severity, confidence }
const RULE_TABLE = {
  asyncChanged:            { severity: "high",   confidence: "proven" },
  returnTypeChanged:       { severity: "high",   confidence: "proven" },
  addedRequiredParam:      { severity: "high",   confidence: "proven" },
  addedOptionalParam:      { severity: "low",    confidence: "proven" },
  removedParam:            { severity: "high",   confidence: "proven" },
  paramOptionalToRequired: { severity: "high",   confidence: "proven" },
  paramRequiredToOptional: { severity: "low",    confidence: "proven" },
  paramTypeNarrowed:       { severity: "high",   confidence: "proven" },
  paramTypeWidened:        { severity: "low",    confidence: "proven" },
  paramTypeUnclear:        { severity: "medium", confidence: "heuristic" },
  // type/interface 字段级（M3a-2）：判据与函数参数同构
  removedField:            { severity: "high",   confidence: "proven" },
  addedRequiredField:      { severity: "high",   confidence: "proven" },
  addedOptionalField:      { severity: "low",    confidence: "proven" },
  fieldOptionalToRequired: { severity: "high",   confidence: "proven" },
  fieldRequiredToOptional: { severity: "low",    confidence: "proven" },
  fieldTypeNarrowed:       { severity: "high",   confidence: "proven" },
  fieldTypeWidened:        { severity: "low",    confidence: "proven" },
  fieldTypeUnclear:        { severity: "medium", confidence: "heuristic" },
  // enum 成员（M3a-2）：判据与函数参数/字段同构
  removedEnumMember:       { severity: "high",   confidence: "proven" },
  addedEnumMember:         { severity: "low",    confidence: "proven" },
  // class 成员（M3a-2）：删/收紧=breaking，增/放宽=兼容
  removedClassMember:       { severity: "high",  confidence: "proven" },
  addedClassMember:         { severity: "low",   confidence: "proven" },
  memberKindChanged:        { severity: "high",  confidence: "proven" },
  memberVisibilityNarrowed: { severity: "high",  confidence: "proven" },
  memberVisibilityWidened:  { severity: "low",   confidence: "proven" },
  unknown:                 { severity: "low",    confidence: "uncertain" },
};

/**
 * 规则引擎入口：一条变更符号 + 影响面 -> { severity, confidence }。
 * @param {object} cs            ChangedSymbol（changeType / oldSymbol / newSymbol）
 * @param {number} impactedCount 引用该符号的文件数
 */
function runRules(cs, impactedCount) {
  const { changeType } = cs;

  let result;

  if (changeType === "renamed") {
    // 重命名导出（export { x as y } → export { x as z }）：删了旧导出名，下游 import 旧名的崩了 → high/proven
    result = { severity: "high", confidence: "proven" };
  } else if (changeType === "removed") {
    // 删除导出：有引用 → high；无引用 → medium（均 proven）
    result =
      impactedCount > 0
        ? { severity: "high", confidence: "proven" }
        : { severity: "medium", confidence: "proven" };
  } else if (changeType === "added") {
    // 新增导出：含 any → medium；否则 low（均 proven）
    result = containsAny(cs.newSymbol)
      ? { severity: "medium", confidence: "proven" }
      : { severity: "low", confidence: "proven" };
  } else {
    // modified：函数 → 函数签名规则；type/interface → 字段级规则（M3a-2）；其余归 uncertain
    const oldSym = cs.oldSymbol || {};
    const newSym = cs.newSymbol || {};
    if (oldSym.type === "function" && newSym.type === "function") {
      const label = classifyFunctionChange(oldSym, newSym);
      result = RULE_TABLE[label] || RULE_TABLE.unknown;
    } else if (oldSym.type === "type" && newSym.type === "type") {
      const hasFields = (s) => Array.isArray(s.fields) && s.fields.length > 0;
      if (hasFields(oldSym) || hasFields(newSym)) {
        const label = classifyTypeFieldChange(oldSym, newSym);
        result = RULE_TABLE[label] || RULE_TABLE.unknown;
      } else if (oldSym.aliasType || newSym.aliasType) {
        // type 别名目标类型变化：复用字段级「收窄/放宽/不明」规则（语义同构）
        const ot = oldSym.aliasType || "";
        const nt = newSym.aliasType || "";
        if (ot !== "any" && nt === "any") result = RULE_TABLE.fieldTypeWidened;
        else if (ot === "any" && nt !== "any") result = RULE_TABLE.fieldTypeNarrowed;
        else result = RULE_TABLE.fieldTypeUnclear;
      } else {
        // 无字段无别名的 type 符号归 uncertain 交 AI
        result = { severity: "low", confidence: "uncertain" };
      }
    } else if (oldSym.type === "enum" && newSym.type === "enum") {
      const label = classifyEnumChange(oldSym, newSym);
      result = RULE_TABLE[label] || RULE_TABLE.unknown;
    } else if (oldSym.type === "class" && newSym.type === "class") {
      const label = classifyClassChange(oldSym, newSym);
      result = RULE_TABLE[label] || RULE_TABLE.unknown;
    } else {
      result = { severity: "low", confidence: "uncertain" };
    }
  }

  // 影响面升级：仅对「不确定」类变更（heuristic/uncertain）升档；
  // proven 的 low（明确不崩）即使引用多也不升级，proven 的 high 已到顶。
  if (impactedCount >= 5 && result.confidence !== "proven") {
    result = { ...result, severity: UPGRADE[result.severity] };
  }

  return result;
}

module.exports = { runRules, classifyFunctionChange, classifyTypeFieldChange, classifyEnumChange, classifyClassChange, containsAny };
