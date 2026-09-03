// 自包含 HTML 报告生成器：把 task-result.json 内嵌进一个静态 HTML，
// 双击即可在浏览器查看完整链路（不依赖 Next/Neon/dev server）。
// 用法：node docs/demo-ai-uncertain/build-report.mjs
import fs from "node:fs";

const raw = JSON.parse(fs.readFileSync(new URL("./task-result.json", import.meta.url), "utf8"));

// 内嵌数据（把 < 转义为 \u003c，彻底避免 </script> 破坏标签）
const DATA = JSON.stringify(raw).replace(/</g, "\\u003c");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Code Guardian · AI 语义判定完整链路报告</title>
<style>
:root {
  --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f0f1f4; --border: #e5e7eb;
  --text: #1a1d21; --text-2: #6b7280; --brand: #6366f1; --brand-soft: #eef2ff;
  --high: #dc2626; --high-soft: #fee2e2; --medium: #d97706; --medium-soft: #fef3c7;
  --low: #16a34a; --low-soft: #dcfce7; --muted: #9ca3af;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04); --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --surface: #171a21; --surface-2: #1f232c; --border: #2a2f3a;
    --text: #e7e9ee; --text-2: #9aa3b2; --brand: #818cf8; --brand-soft: #1e2438;
    --high: #f87171; --high-soft: #2a1518; --medium: #fbbf24; --medium-soft: #2a2110;
    --low: #4ade80; --low-soft: #10261a; --muted: #5b6472;
    --shadow: 0 1px 3px rgba(0,0,0,.4);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px; line-height: 1.6; }
.container { max-width: 1080px; margin: 0 auto; padding: 24px 20px 64px; }
.topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 0 20px;
  border-bottom:1px solid var(--border); margin-bottom:24px; }
.brand { display:flex; align-items:center; gap:10px; }
.logo { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--brand),#8b5cf6);
  display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:15px; }
.brand h1 { font-size:17px; margin:0; font-weight:700; }
.brand .sub { font-size:12px; color:var(--text-2); }
.note { font-size:12px; color:var(--text-2); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
  box-shadow:var(--shadow); padding:20px; margin-bottom:16px; }
.card h2 { margin:0 0 14px; font-size:15px; font-weight:600; }
.card .desc { color:var(--text-2); font-size:13px; margin:-6px 0 14px; }
.table { width:100%; border-collapse:collapse; }
.table th, .table td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border);
  font-size:13px; vertical-align:top; }
.table th { color:var(--text-2); font-weight:600; font-size:12px; }
.table tbody tr:hover { background:var(--surface-2); }
.mono { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
.badge { display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:999px; font-size:12px; font-weight:600; }
.badge.high { background:var(--high-soft); color:var(--high); }
.badge.medium { background:var(--medium-soft); color:var(--medium); }
.badge.low { background:var(--low-soft); color:var(--low); }
.badge.proven { background:var(--low-soft); color:var(--low); }
.badge.heuristic { background:var(--medium-soft); color:var(--medium); }
.badge.uncertain { background:var(--surface-2); color:var(--text-2); border:1px dashed var(--border); }
.tag { display:inline-block; padding:1px 8px; border-radius:6px; font-size:11px; font-weight:600;
  background:var(--surface-2); color:var(--text-2); }
.tag.added { background:var(--low-soft); color:var(--low); }
.tag.removed { background:var(--high-soft); color:var(--high); }
.tag.modified { background:var(--medium-soft); color:var(--medium); }
.engine-tag { display:inline-flex; align-items:center; gap:4px; padding:1px 7px; border-radius:6px;
  font-size:11px; font-weight:600; white-space:nowrap; }
.engine-tag.rule { background:var(--surface-2); color:var(--text-2); }
.engine-tag.ai { background:var(--brand-soft); color:var(--brand); }
.suggestion-row td { background:var(--brand-soft); border-bottom:1px solid var(--border); padding:8px 12px; }
.suggestion-line { display:flex; align-items:flex-start; gap:6px; font-size:12px; }
.suggestion-line .mark { color:var(--brand); font-weight:700; flex:none; }
.suggestion-line .txt { color:var(--text-2); }
.risk-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.risk-card { padding:16px; border-radius:var(--radius); border:1px solid var(--border); }
.risk-card .num { font-size:28px; font-weight:700; }
.risk-card .cap { font-size:12px; color:var(--text-2); }
.risk-card.high { background:var(--high-soft); border-color:transparent; }
.risk-card.medium { background:var(--medium-soft); border-color:transparent; }
.risk-card.low { background:var(--low-soft); border-color:transparent; }
.chip-list { display:flex; flex-wrap:wrap; gap:6px; }
.chip { display:inline-block; padding:2px 8px; border-radius:6px; background:var(--surface-2);
  color:var(--text-2); font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
.meta { color:var(--text-2); font-size:12px; }
.muted { color:var(--muted); }
.legend { display:flex; flex-wrap:wrap; gap:14px; align-items:center; }
.legend .item { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-2); }

/* diff 两栏 */
.diff-layout { display:grid; grid-template-columns:220px 1fr; gap:12px; }
.diff-files { display:flex; flex-direction:column; gap:2px; max-height:600px; overflow-y:auto;
  padding:4px; background:var(--surface-2); border-radius:var(--radius); }
.diff-file-btn { display:flex; align-items:center; gap:6px; text-align:left; padding:6px 8px;
  border-radius:6px; border:none; background:transparent; color:var(--text); cursor:pointer;
  font-size:12px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff-file-btn:hover { background:var(--surface); }
.diff-file-btn.active { background:var(--brand-soft); }
.diff-pane { border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
.diff-head { padding:8px 12px; font-size:12px; background:var(--surface-2); border-bottom:1px solid var(--border);
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff-grid { display:grid; grid-template-columns:1fr 1fr; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:12px; line-height:1.5; }
.diff-col-head { padding:4px 10px; font-size:11px; color:var(--text-2); background:var(--surface-2);
  border-bottom:1px solid var(--border); }
.diff-col-head:first-child { border-right:1px solid var(--border); }
.diff-row { display:contents; }
.diff-cell { display:flex; gap:8px; padding:1px 10px; white-space:pre; overflow-x:auto; }
.diff-cell .ln { color:var(--muted); user-select:none; flex:none; min-width:24px; text-align:right; }
.diff-cell.same { }
.diff-cell.del { background:var(--high-soft); }
.diff-cell.del .ln, .diff-cell.del .code { color:var(--high); }
.diff-cell.add { background:var(--low-soft); }
.diff-cell.add .ln, .diff-cell.add .code { color:var(--low); }
.diff-cell.empty { background:var(--surface-2); }
.diff-scroll { max-height:560px; overflow:auto; }
@media (max-width:720px) { .diff-layout { grid-template-columns:1fr; } .risk-row { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="container">
  <div class="topbar">
    <div class="brand">
      <div class="logo">CG</div>
      <div>
        <h1>Code Guardian · AI 语义判定完整链路报告</h1>
        <div class="sub">确定性规则引擎 + DeepSeek/LangGraph 语义引擎 双轨审查 · 静态自包含快照</div>
      </div>
    </div>
    <div class="note">数据内嵌，离线可查</div>
  </div>
  <div id="app"></div>
</div>

<script type="application/json" id="task-data">${DATA}</script>
<script>
(function () {
  const payload = JSON.parse(document.getElementById("task-data").textContent);
  const t = payload.task;
  const r = payload.result;
  const app = document.getElementById("app");

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const SEV = { high:"高危", medium:"中危", low:"低危" };
  const CONF = { proven:"确定", heuristic:"经验", uncertain:"待定" };
  const CHG = { added:"新增", removed:"删除", modified:"修改", renamed:"重命名" };
  const STATUS_MARK = { added:"+", deleted:"−", modified:"~" };

  // 行级 diff（LCS）：把 old/new 全文拆行，标记 same / del / add
  function diffLines(aText, bText) {
    const a = aText ? aText.split("\\n") : [];
    const b = bText ? bText.split("\\n") : [];
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--)
      for (let j = n - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const rows = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { rows.push({ t:"same", l:a[i], r:b[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ t:"del", l:a[i], r:null }); i++; }
      else { rows.push({ t:"add", l:null, r:b[j] }); j++; }
    }
    while (i < m) { rows.push({ t:"del", l:a[i], r:null }); i++; }
    while (j < n) { rows.push({ t:"add", l:null, r:b[j] }); j++; }
    return rows;
  }

  function engineOf(e) { return e.suggestion ? "ai" : "rule"; }

  function renderDiff(file) {
    const rows = diffLines(file.oldContent, file.newContent);
    let html = "";
    let ln = 0, rn = 0;
    for (const row of rows) {
      let lCell, rCell;
      if (row.t === "same") {
        ln++; rn++;
        lCell = '<div class="diff-cell same"><span class="ln">' + ln + '</span><span class="code">' + esc(row.l) + '</span></div>';
        rCell = '<div class="diff-cell same"><span class="ln">' + rn + '</span><span class="code">' + esc(row.r) + '</span></div>';
      } else if (row.t === "del") {
        ln++;
        lCell = '<div class="diff-cell del"><span class="ln">' + ln + '</span><span class="code">' + esc(row.l) + '</span></div>';
        rCell = '<div class="diff-cell empty"></div>';
      } else {
        rn++;
        lCell = '<div class="diff-cell empty"></div>';
        rCell = '<div class="diff-cell add"><span class="ln">' + rn + '</span><span class="code">' + esc(row.r) + '</span></div>';
      }
      html += lCell + rCell;
    }
    return html;
  }

  const head = '<div class="card"><h2 style="margin-bottom:6px">' + esc(t.repo.name) + ' <span class="meta">MR #' + esc(t.mrId) + '</span></h2>' +
    '<div class="meta mono">' + esc(t.baseRef || "—") + ' … ' + esc(t.headRef || "—") + '</div>' +
    '<div class="meta">任务 ' + esc(t.id) + ' · 创建于 ' + new Date(t.createdAt).toLocaleString("zh-CN") + '</div></div>';

  const risk = '<div class="card"><h2>风险总览</h2><div class="risk-row">' +
    '<div class="risk-card high"><div class="num">' + r.summary.high + '</div><div class="cap">🔴 高危</div></div>' +
    '<div class="risk-card medium"><div class="num">' + r.summary.medium + '</div><div class="cap">🟡 中危</div></div>' +
    '<div class="risk-card low"><div class="num">' + r.summary.low + '</div><div class="cap">🟢 低危 / 通过</div></div>' +
    '</div><div class="meta" style="margin-top:12px">全仓 ' + r.summary.totalFiles + ' 个文件 · ' + r.summary.totalSymbols +
    ' 个导出符号 · 本次变更 ' + r.summary.changedFileCount + ' 个文件 · ' + r.summary.changedSymbolCount + ' 个符号</div></div>';

  const aiCount = r.impactChain.filter((e) => e.suggestion).length;
  const chainRows = r.impactChain.map((e) => {
    const eng = engineOf(e);
    const main = '<tr><td class="mono">' + esc(e.file) + '</td><td class="mono">' + esc(e.symbol) + '</td>' +
      '<td><span class="tag ' + e.changeType + '">' + (CHG[e.changeType] || e.changeType) + '</span></td>' +
      '<td><span class="badge ' + e.severity + '">' + SEV[e.severity] + '</span></td>' +
      '<td><span class="badge ' + e.confidence + '" title="判定来源：' + (eng === "ai" ? "AI 语义引擎" : "规则引擎") + '">' + (CONF[e.confidence] || e.confidence) + '</span></td>' +
      '<td>' + (e.impactedFiles.length ? '<div class="chip-list">' + e.impactedFiles.map((f) => '<span class="chip">' + esc(f) + '</span>').join("") + '</div>' : '<span class="muted">无直接引用方</span>') + '</td></tr>';
    const sug = e.suggestion ? '<tr class="suggestion-row"><td colspan="6"><div class="suggestion-line"><span class="mark">AI</span><span class="txt">' + esc(e.suggestion) + '</span></div></td></tr>' : "";
    return main + sug;
  }).join("");
  const chain = '<div class="card"><h2>影响链路</h2><p class="desc">「改动文件 → 导出符号 → 规则引擎/AI 定级 → 引用方」完整链路：规则引擎能确定的直接定级，uncertain 变更送 AI 语义引擎二次判定并给修复建议。</p>' +
    '<div class="meta" style="margin-bottom:10px">共 ' + r.impactChain.length + ' 条 · <span class="engine-tag rule">规则引擎</span> ' + (r.impactChain.length - aiCount) +
    ' 条 · <span class="engine-tag ai">AI 语义引擎</span> ' + aiCount + ' 条</div>' +
    '<table class="table"><thead><tr><th style="width:190px">改动文件</th><th style="width:130px">导出符号</th><th style="width:80px">变更类型</th><th style="width:70px">风险</th><th style="width:90px">置信度</th><th>影响文件（引用方）</th></tr></thead><tbody>' + chainRows + '</tbody></table></div>';

  const aiEdges = r.impactChain.filter((e) => e.suggestion);
  const aiCard = aiEdges.length ? '<div class="card"><h2>AI 语义判定明细</h2><p class="desc">规则引擎判为 <code>uncertain</code>、转交 DeepSeek 语义引擎（LangGraph 四节点：问题重述 → 上下文检索 → 影响面预测 → 修复建议）判定的变更。</p>' +
    '<table class="table"><thead><tr><th style="width:220px">变更符号</th><th style="width:80px">风险</th><th style="width:90px">置信度</th><th>AI 修复建议</th></tr></thead><tbody>' +
    aiEdges.map((e) => '<tr><td class="mono">' + esc(e.file) + '<span style="color:var(--text-2)">#' + esc(e.symbol) + '</span></td>' +
      '<td><span class="badge ' + e.severity + '">' + SEV[e.severity] + '</span></td>' +
      '<td><span class="badge ' + e.confidence + '">' + (CONF[e.confidence] || e.confidence) + '</span></td>' +
      '<td><div class="suggestion-line"><span class="mark">AI</span><span class="txt">' + esc(e.suggestion) + '</span></div></td></tr>').join("") +
    '</tbody></table></div>' : "";

  const symRows = r.changedSymbols.map((s) => '<tr><td class="mono">' + esc(s.file) + '</td><td class="mono">' + esc(s.symbol) + '</td>' +
    '<td><span class="tag ' + s.changeType + '">' + (CHG[s.changeType] || s.changeType) + '</span></td>' +
    '<td class="mono muted">' + esc(s.oldSignature ?? "—") + '</td><td class="mono">' + esc(s.newSignature ?? "—") + '</td>' +
    '<td class="mono">' + s.line + '</td></tr>').join("");
  const syms = r.changedSymbols.length ? '<div class="card"><h2>变更符号明细</h2><table class="table"><thead><tr><th>文件</th><th>符号</th><th>变更</th><th>原签名</th><th>新签名</th><th>行</th></tr></thead><tbody>' + symRows + '</tbody></table></div>' : "";

  const fileChips = r.changedFiles.map((f) => '<span class="chip"><span class="tag ' + f.status + '" style="margin-right:6px">' + (STATUS_MARK[f.status] || "~") + '</span>' + esc(f.path) + '</span>').join("");

  let diffHtml = "";
  if (r.diffs && r.diffs.length) {
    diffHtml = '<div class="card"><h2>代码 Diff</h2><p class="desc">变更文件 base（左，红=删除）与 head（右，绿=新增）逐行对比，点左侧文件名切换。</p><div class="diff-layout">' +
      '<div class="diff-files">' + r.diffs.map((d, i) => '<button class="diff-file-btn' + (i === 0 ? " active" : "") + '" data-diff="' + i + '"><span class="tag ' + d.status + '">' + (STATUS_MARK[d.status] || "~") + '</span>' + esc(d.path) + '</button>').join("") + '</div>' +
      '<div class="diff-pane"><div class="diff-head mono" id="diff-head"></div><div class="diff-scroll" id="diff-body"></div></div>' +
      '</div></div>';
  }

  app.innerHTML = head + risk + chain + aiCard + syms +
    '<div class="card"><h2>变更文件</h2><div class="chip-list">' + fileChips + '</div></div>' + diffHtml +
    '<div class="card"><h2>判定来源说明</h2><div class="legend">' +
    '<span class="item"><span class="engine-tag rule">规则引擎</span> 确定性查表定级，0 Token，可直接门禁</span>' +
    '<span class="item"><span class="engine-tag ai">AI 语义引擎</span> uncertain 变更走 DeepSeek/LangGraph 四节点</span>' +
    '<span class="item"><span class="badge proven">确定</span> proven</span>' +
    '<span class="item"><span class="badge heuristic">经验</span> heuristic</span>' +
    '<span class="item"><span class="badge uncertain">待定</span> uncertain</span>' +
    '</div></div>';

  // diff 交互
  if (r.diffs && r.diffs.length) {
    const head = document.getElementById("diff-head");
    const body = document.getElementById("diff-body");
    function show(i) {
      const d = r.diffs[i];
      head.innerHTML = esc(d.path) + ' <span class="muted">（' + (d.status === "added" ? "新增" : d.status === "deleted" ? "删除" : "修改") + '）</span>';
      body.innerHTML = '<div class="diff-col-head">base</div><div class="diff-col-head">head</div><div class="diff-grid">' + renderDiff(d) + '</div>';
    }
    document.querySelectorAll(".diff-file-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".diff-file-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        show(Number(btn.dataset.diff));
      });
    });
    show(0);
  }
})();
</script>
</body>
</html>`;

fs.writeFileSync(new URL("./report.html", import.meta.url), html, "utf8");
console.log("已生成:", new URL("./report.html", import.meta.url).pathname);
console.log("HTML 大小:", (html.length / 1024).toFixed(1), "KB");
