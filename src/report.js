"use strict";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function statusLabel(status) {
  return { open: "开放申购", limited: "限额申购", suspended: "暂停申购", unavailable: "不可申购", unknown: "状态未知" }[status] || status;
}

function channelLabel(channel) {
  const access = {
    web: "网上直销", app: "APP 直销", counter: "直销柜台", eastmoney: "天天基金",
    alipay: "支付宝", bank: "银行代销", broker: "券商代销", all: channel.kind === "direct" ? "直销机构" : "代销机构"
  }[channel.access] || channel.access;
  return channel.name && channel.name !== access ? `${access} · ${channel.name}` : access;
}

function amountLabel(row) {
  if (row?.status === "open") return "不限额";
  if (row?.status !== "limited") return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(row.limitAmount) + (row.currency === "USD" ? " 美元" : " 元");
}

function feeLabel(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function reliabilityReasonLabel(reason) {
  const value = String(reason || "");
  if (value.includes("current official product page")) return "当前官方产品页明确标注渠道";
  if (value.includes("official notice/page explicitly")) return "官方公告明确标注渠道，未验证实际下单";
  if (value.includes("current public agency sales page")) return "当前代销公开页面，未验证登录后下单";
  if (value.includes("current public fee page")) return "当前公开费率页，重要决策前请核对最新招募说明书";
  if (value.includes("channel scope is not explicit")) return "官方文本含状态信息，但渠道范围不够明确";
  if (value.includes("page fetched but")) return "页面已抓取，但无法安全解析当前渠道额度";
  if (value.includes("source unavailable")) return "公开数据源当前不可用";
  if (value.includes("manually verified")) return "人工核验记录，超过有效期后自动失效";
  return value;
}

function rankPurchasableFunds(rows) {
  const channelPriority = { web: 6, app: 5, counter: 4, all: 3, eastmoney: 2, alipay: 2, bank: 2, broker: 2 };
  const best = new Map();
  for (const row of rows || []) {
    if (!["open", "limited"].includes(row.status) || row.reliability?.grade === "D") continue;
    const prior = best.get(row.fundCode);
    const amount = row.status === "open" ? Number.POSITIVE_INFINITY : row.limitAmount;
    const priorAmount = prior?.status === "open" ? Number.POSITIVE_INFINITY : prior?.limitAmount;
    const preferred = !prior || amount > priorAmount || (amount === priorAmount && (channelPriority[row.channel.access] || 0) > (channelPriority[prior.channel.access] || 0));
    if (preferred) best.set(row.fundCode, row);
  }
  return [...best.values()].sort((left, right) => {
    const leftAmount = left.status === "open" ? Number.POSITIVE_INFINITY : left.limitAmount;
    const rightAmount = right.status === "open" ? Number.POSITIVE_INFINITY : right.limitAmount;
    return rightAmount - leftAmount || left.manager.localeCompare(right.manager, "zh-CN") || left.fundCode.localeCompare(right.fundCode);
  });
}

function purchaseSummaryHtml(rows, fees = []) {
  const feeByFund = new Map(fees.map((fee) => [fee.fundCode, fee]));
  const ranked = rankPurchasableFunds(rows).sort((left, right) => {
    const leftAmount = left.status === "open" ? Number.POSITIVE_INFINITY : left.limitAmount;
    const rightAmount = right.status === "open" ? Number.POSITIVE_INFINITY : right.limitAmount;
    return rightAmount - leftAmount || (feeByFund.get(left.fundCode)?.annualRate ?? 999) - (feeByFund.get(right.fundCode)?.annualRate ?? 999);
  }).slice(0, 6);
  if (!ranked.length) return `<section class="buy-summary"><strong>当前购买便利度：</strong>没有发现状态和额度均可信的可申购基金。</section>`;
  const text = ranked.map((row) => {
    const fee = feeByFund.get(row.fundCode);
    return `<span class="summary-fund"><b>${escapeHtml(row.manager)} ${escapeHtml(row.fundCode)}</b><em>${escapeHtml(amountLabel(row))} · ${escapeHtml(channelLabel(row.channel))}${Number.isFinite(fee?.annualRate) ? ` · 年费率 ${escapeHtml(feeLabel(fee.annualRate))}` : ""}</em></span>`;
  }).join("");
  return `<section class="buy-summary"><div><strong>当前更方便购买</strong><small>先按最高可信额度排序，同额度再比较年综合费率</small></div><div class="summary-list">${text}</div></section>`;
}

function safeSourceLink(source, label = "证据") {
  if (!source?.url) return "";
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") return "";
    return `<a class="source-link" href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  } catch { return ""; }
}

function bestChannel(rows, kind) {
  const grade = { A: 4, B: 3, C: 2, D: 1 };
  const state = { open: 4, limited: 3, suspended: 2, unavailable: 1, unknown: 0 };
  return rows.filter((row) => row.channel.kind === kind).sort((left, right) =>
    grade[right.reliability?.grade] - grade[left.reliability?.grade] ||
    state[right.status] - state[left.status] ||
    (right.limitAmount || 0) - (left.limitAmount || 0)
  )[0] || null;
}

function channelCell(row) {
  if (!row) return `<td class="channel-cell unknown"><span class="channel-status status-unknown">暂无数据</span></td>`;
  const grade = row.reliability?.grade || "D";
  return `<td class="channel-cell"><div class="channel-main"><span class="channel-status status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span><strong>${escapeHtml(amountLabel(row))}</strong></div><div class="channel-meta"><span>${escapeHtml(channelLabel(row.channel))}</span><span class="grade grade-${escapeHtml(grade)}">${escapeHtml(grade)}</span>${safeSourceLink(row.source)}</div></td>`;
}

function feeCell(fee) {
  if (!fee || !Number.isFinite(fee.annualRate)) return `<td class="fee-cell unknown"><strong>—</strong><span>费率待核验</span></td>`;
  return `<td class="fee-cell" title="管理费 ${escapeHtml(feeLabel(fee.managementRate))} + 托管费 ${escapeHtml(feeLabel(fee.custodyRate))} + 销售服务费 ${escapeHtml(feeLabel(fee.salesServiceRate))}"><strong>${escapeHtml(feeLabel(fee.annualRate))}</strong><span>管 ${escapeHtml(feeLabel(fee.managementRate))} · 托 ${escapeHtml(feeLabel(fee.custodyRate))} · 销 ${escapeHtml(feeLabel(fee.salesServiceRate))}</span>${safeSourceLink(fee.source, "费率来源")}</td>`;
}

function aggregateStatus(rows) {
  const statuses = rows.filter((row) => row.reliability?.grade !== "D").map((row) => row.status);
  if (statuses.includes("open")) return "open";
  if (statuses.includes("limited")) return "limited";
  if (statuses.includes("suspended")) return "suspended";
  if (statuses.includes("unavailable")) return "unavailable";
  return "unknown";
}

function fundTableRow(code, rows, fee) {
  const fund = rows[0];
  const direct = bestChannel(rows, "direct");
  const agency = bestChannel(rows, "agency");
  const best = rankPurchasableFunds(rows)[0] || null;
  const status = aggregateStatus(rows);
  const bestAmount = best?.status === "open" ? Number.MAX_SAFE_INTEGER : (best?.limitAmount || 0);
  const search = `${fund.fundName} ${fund.manager} ${code}`.toLowerCase();
  return `<tr class="fund-row" data-search="${escapeHtml(search)}" data-share="${escapeHtml(fund.shareClass || "其他")}" data-status="${escapeHtml(status)}" data-purchasable="${best ? "1" : "0"}" data-amount="${bestAmount}" data-fee="${Number.isFinite(fee?.annualRate) ? fee.annualRate : 999}"><td class="fund-cell"><span class="index-chip">NDX</span><div><strong>${escapeHtml(fund.fundName)}</strong><span>${escapeHtml(code)} · ${escapeHtml(fund.manager)} · ${escapeHtml(fund.shareClass || "其他")} 类</span></div></td>${channelCell(agency)}${channelCell(direct)}${feeCell(fee)}</tr>`;
}

function renderHtml(payload) {
  const grouped = new Map();
  for (const row of payload.rows || []) {
    if (!grouped.has(row.fundCode)) grouped.set(row.fundCode, []);
    grouped.get(row.fundCode).push(row);
  }
  const feeByFund = new Map((payload.fees || []).map((fee) => [fee.fundCode, fee]));
  const funds = [...grouped.entries()];
  const shareClasses = [...new Set(funds.map(([, rows]) => rows[0].shareClass || "其他"))].sort();
  const statuses = funds.map(([, rows]) => aggregateStatus(rows));
  const feeKnown = [...feeByFund.values()].filter((fee) => Number.isFinite(fee.annualRate)).length;
  const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(payload.observedAt));
  const warnings = (payload.warnings || []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const changes = (payload.changes || []).map((change) => {
    const row = change.after || change.before;
    return `<li><strong>${escapeHtml(row?.fundCode || "")}</strong> ${escapeHtml(row?.fundName || "")}：${escapeHtml(change.type)}</li>`;
  }).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QDII 申购额度与费率</title><meta name="description" content="国内纳斯达克 100 QDII 基金申购额度与综合费率，直销优先、代销补充。">
<meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:title" content="QDII 申购额度与费率"><meta property="og:description" content="纳斯达克 100 · 直销优先 · 综合费率比较"><meta property="og:url" content="https://tanghuaizhe.github.io/qdii-direct-monitor/"><meta property="og:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="QDII 申购额度与费率"><meta name="twitter:description" content="纳斯达克 100 · 直销优先 · 综合费率比较"><meta name="twitter:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png">
<style>
:root{color-scheme:light;--ink:#19221d;--muted:#68736b;--line:#e1e7e2;--paper:#f6f8f5;--card:#fff;--green:#137552;--green-soft:#e5f5ed;--amber:#9b6400;--amber-soft:#fff3d6;--red:#aa3838;--red-soft:#fdeaea;--blue:#2b66a0;--blue-soft:#eaf2fb}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.shell{width:min(1240px,calc(100% - 32px));margin:24px auto 56px}.topbar{display:flex;justify-content:space-between;align-items:center;padding:6px 2px 18px}.brand{font-size:17px;font-weight:800;letter-spacing:-.02em}.updated{font-size:12px;color:var(--muted)}.hero{background:linear-gradient(135deg,#143d2c,#1d6747 72%,#2d7957);color:#fff;border-radius:22px;padding:30px;box-shadow:0 18px 50px #153b2920}.eyebrow{display:inline-flex;background:#ffffff18;border:1px solid #ffffff28;border-radius:999px;padding:5px 10px;font-size:12px}.hero h1{margin:13px 0 7px;font-size:clamp(26px,4vw,38px);letter-spacing:-.04em}.hero p{margin:0;color:#dceddf;max-width:720px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:15px 17px}.stat strong{display:block;font-size:25px;line-height:1.15}.stat span{color:var(--muted);font-size:12px}.buy-summary{display:grid;grid-template-columns:200px 1fr;gap:14px;background:#edf7f1;border:1px solid #d0e7d9;border-radius:16px;padding:17px 19px;margin:16px 0}.buy-summary>div:first-child{display:flex;flex-direction:column}.buy-summary>div>strong{color:var(--green);font-size:15px}.buy-summary small{color:var(--muted)}.summary-list{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}.summary-fund{min-width:max-content;background:#fff;border:1px solid #dbe9df;border-radius:10px;padding:7px 10px}.summary-fund b,.summary-fund em{display:block}.summary-fund b{font-size:12px}.summary-fund em{font-size:11px;color:var(--muted);font-style:normal}.notices{margin:14px 0}.notice{background:#fff9ea;border:1px solid #efdfb7;border-radius:12px;padding:10px 15px;margin:8px 0}.notice summary{cursor:pointer;font-weight:700}.notice ul{margin:7px 0;padding-left:20px}.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 8px 28px #26382b0b}.panel-head{display:flex;justify-content:space-between;gap:16px;align-items:end;padding:19px 20px 14px}.panel-head h2{font-size:18px;margin:0}.panel-head p{margin:3px 0 0;color:var(--muted);font-size:12px}.result-count{font-weight:700;color:var(--green);white-space:nowrap}.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 20px 16px}.search{flex:1;min-width:220px;position:relative}.search input{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px 10px 34px;background:#fbfcfb;font:inherit}.search:before{content:"⌕";position:absolute;left:12px;top:8px;color:var(--muted);font-size:18px}.share-filters{display:flex;gap:6px}.filter-button,.toggle,.sort{border:1px solid var(--line);background:#fff;border-radius:9px;padding:9px 11px;color:var(--ink);font:inherit;cursor:pointer}.filter-button.active{background:var(--ink);border-color:var(--ink);color:#fff}.toggle{display:flex;align-items:center;gap:7px}.toggle input{accent-color:var(--green)}.sort{padding-right:28px}.table-wrap{overflow-x:auto;border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:980px}th,td{text-align:left;padding:14px 15px;border-bottom:1px solid #edf0ed;vertical-align:middle}th{background:#fafbfa;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.03em;position:sticky;top:0}tbody tr:hover{background:#fbfdfb}.fund-cell{display:flex;align-items:center;gap:11px;min-width:310px}.fund-cell strong,.fund-cell span{display:block}.fund-cell strong{font-size:14px}.fund-cell div>span{color:var(--muted);font-size:11px;margin-top:3px}.index-chip{display:grid!important;place-items:center;width:38px;height:38px;border-radius:10px;background:#e8f3ed;color:var(--green);font-size:10px;font-weight:900}.channel-cell{min-width:180px}.channel-main{display:flex;align-items:center;gap:8px}.channel-main strong{font-size:14px}.channel-meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;margin-top:5px}.channel-status,.grade{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:750;white-space:nowrap}.status-limited{background:var(--amber-soft);color:var(--amber)}.status-open{background:var(--green-soft);color:var(--green)}.status-suspended,.status-unavailable{background:var(--red-soft);color:var(--red)}.status-unknown{background:#edf0ed;color:#667068}.grade-A{background:var(--green-soft);color:var(--green)}.grade-B{background:var(--blue-soft);color:var(--blue)}.grade-C{background:var(--amber-soft);color:var(--amber)}.grade-D{background:#edf0ed;color:#667068}.source-link{color:var(--blue);text-decoration:none}.source-link:hover{text-decoration:underline}.fee-cell{min-width:205px}.fee-cell strong,.fee-cell span{display:block}.fee-cell strong{font-size:17px;color:var(--green)}.fee-cell span{color:var(--muted);font-size:10px;margin:2px 0}.unknown{color:var(--muted)}.empty{display:none;text-align:center;padding:34px;color:var(--muted)}.method{margin:14px 2px 0;color:var(--muted);font-size:12px}.method strong{color:var(--ink)}.footer{text-align:center;color:var(--muted);margin-top:24px;font-size:11px}@media(max-width:760px){.shell{width:min(100% - 18px,1240px);margin-top:10px}.topbar{padding:4px 3px 10px}.updated{display:none}.hero{padding:23px 20px}.stats{grid-template-columns:1fr 1fr}.buy-summary{grid-template-columns:1fr}.panel-head{align-items:start}.filters{align-items:stretch}.search{flex-basis:100%}.share-filters{overflow-x:auto}.toggle,.sort{flex:1}.method{padding:0 4px}}
</style></head><body><main class="shell">
<nav class="topbar"><span class="brand">QDII Monitor</span><span class="updated">更新于 ${escapeHtml(observed)}</span></nav>
<section class="hero"><span class="eyebrow">自动监控 · 证据可追溯</span><h1>QDII 申购额度与费率</h1><p>追踪国内纳斯达克 100 基金的直销与代销额度，并用统一口径比较长期持有费率。</p></section>
<section class="stats"><div class="stat"><strong>${grouped.size}</strong><span>基金份额</span></div><div class="stat"><strong>${statuses.filter((status) => status === "limited" || status === "open").length}</strong><span>当前可申购</span></div><div class="stat"><strong>${statuses.filter((status) => status === "suspended").length}</strong><span>暂停申购</span></div><div class="stat"><strong>${feeKnown}/${grouped.size}</strong><span>综合费率已识别</span></div></section>
${purchaseSummaryHtml(payload.rows || [], payload.fees || [])}
<div class="notices">${warnings ? `<details class="notice"><summary>抓取提示（${(payload.warnings || []).length}）</summary><ul>${warnings}</ul></details>` : ""}${changes ? `<details class="notice"><summary>本次额度变化（${(payload.changes || []).length}）</summary><ul>${changes}</ul></details>` : ""}</div>
<section class="panel"><div class="panel-head"><div><h2>基金列表</h2><p>代销、直销和年综合费率横向比较</p></div><span class="result-count"><b id="visible-count">${grouped.size}</b> 只</span></div>
<div class="filters"><label class="search"><input id="fund-search" type="search" placeholder="搜索基金名称、代码或公司" aria-label="搜索基金"></label><div class="share-filters" aria-label="份额类别"><button class="filter-button active" type="button" data-share-filter="全部">全部</button>${shareClasses.map((share) => `<button class="filter-button" type="button" data-share-filter="${escapeHtml(share)}">${escapeHtml(share)} 类</button>`).join("")}</div><label class="toggle"><input id="purchasable-only" type="checkbox">仅看可购买</label><select id="fund-sort" class="sort" aria-label="排序方式"><option value="amount">额度从高到低</option><option value="fee">综合费率从低到高</option><option value="name">基金名称</option></select></div>
<div class="table-wrap"><table><thead><tr><th>基金</th><th>代销渠道</th><th>直销渠道</th><th>年综合费率 ⓘ</th></tr></thead><tbody id="fund-body">${funds.map(([code, rows]) => fundTableRow(code, rows, feeByFund.get(code))).join("")}</tbody></table><div id="empty" class="empty">没有符合当前条件的基金</div></div></section>
<p class="method"><strong>综合费率口径：</strong>管理费率＋托管费率＋销售服务费率，均为按年计提；基金净值通常已扣除这些费用。申购费和赎回费受渠道折扣、金额及持有期影响，不并入本列。不同基金份额或渠道额度不得相加。</p>
<p class="footer">A/B/C/D 表示证据可靠性，不代表投资风险等级。未知状态不可视为开放申购。数据仅供核验，不构成投资建议。</p>
</main><script>
(() => {
  const body = document.getElementById("fund-body"); const rows = [...body.querySelectorAll(".fund-row")]; const search = document.getElementById("fund-search"); const purchasable = document.getElementById("purchasable-only"); const sort = document.getElementById("fund-sort"); const count = document.getElementById("visible-count"); const empty = document.getElementById("empty"); let share = "全部";
  function refresh() { const query = search.value.trim().toLowerCase(); const visible = rows.filter((row) => (!query || row.dataset.search.includes(query)) && (share === "全部" || row.dataset.share === share) && (!purchasable.checked || row.dataset.purchasable === "1")); const key = sort.value; visible.sort((a, b) => key === "fee" ? Number(a.dataset.fee) - Number(b.dataset.fee) || a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : key === "name" ? a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : Number(b.dataset.amount) - Number(a.dataset.amount) || Number(a.dataset.fee) - Number(b.dataset.fee)); const visibleSet = new Set(visible); rows.forEach((row) => { row.hidden = !visibleSet.has(row); }); visible.forEach((row) => body.appendChild(row)); count.textContent = String(visible.length); empty.style.display = visible.length ? "none" : "block"; }
  document.querySelectorAll("[data-share-filter]").forEach((button) => button.addEventListener("click", () => { share = button.dataset.shareFilter; document.querySelectorAll("[data-share-filter]").forEach((item) => item.classList.toggle("active", item === button)); refresh(); })); search.addEventListener("input", refresh); purchasable.addEventListener("change", refresh); sort.addEventListener("change", refresh); refresh();
})();
</script></body></html>\n`;
}

module.exports = { aggregateStatus, amountLabel, channelLabel, escapeHtml, feeLabel, purchaseSummaryHtml, rankPurchasableFunds, reliabilityReasonLabel, renderHtml, statusLabel };
