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
  if (row.status === "open") return "不限额/未披露限额";
  if (row.status !== "limited") return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(row.limitAmount) + (row.currency === "USD" ? " 美元" : " 元");
}

function reliabilityReasonLabel(reason) {
  const value = String(reason || "");
  if (value.includes("current official product page")) return "当前官方产品页明确标注渠道";
  if (value.includes("official notice/page explicitly")) return "官方公告明确标注渠道，未验证实际下单";
  if (value.includes("current public agency sales page")) return "当前代销公开页面，未验证登录后下单";
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
    if (!['open', 'limited'].includes(row.status) || row.reliability?.grade === "D") continue;
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

function purchaseSummaryHtml(rows) {
  const ranked = rankPurchasableFunds(rows);
  if (!ranked.length) return `<section class="buy-summary"><strong>当前购买便利度：</strong>没有发现状态和额度均可信的可申购基金。</section>`;
  const groups = [];
  for (const row of ranked) {
    const key = `${row.status}|${row.currency}|${row.limitAmount ?? "open"}`;
    let group = groups.find((item) => item.key === key);
    if (!group) { group = { key, label: amountLabel(row), rows: [] }; groups.push(group); }
    group.rows.push(row);
  }
  const text = groups.map((group) => `<span class="rank-group"><b>${escapeHtml(group.label)}</b>：${group.rows.map((row) => `${escapeHtml(row.manager)} ${escapeHtml(row.fundCode)}（${escapeHtml(channelLabel(row.channel))}）`).join("、")}</span>`).join(`<span class="rank-separator">；</span>`);
  return `<section class="buy-summary"><strong>当前购买便利度：</strong><span>按每只基金最高可用单日额度排名，${text}</span><small>暂停和未知状态不列入；不同渠道额度不相加。</small></section>`;
}

function safeSourceLink(source) {
  if (!source?.url) return "—";
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") return "—";
    return `<a href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">查看证据</a>`;
  } catch { return "—"; }
}

function rowHtml(row) {
  const grade = row.reliability?.grade || "D";
  return `<tr>
    <td><span class="kind kind-${escapeHtml(row.channel.kind)}">${row.channel.kind === "direct" ? "直销" : "代销"}</span></td>
    <td>${escapeHtml(channelLabel(row.channel))}</td>
    <td><span class="status status-${escapeHtml(row.status)}">${escapeHtml(statusLabel(row.status))}</span></td>
    <td class="amount">${escapeHtml(amountLabel(row))}</td>
    <td><span class="grade grade-${escapeHtml(grade)}">${escapeHtml(grade)}</span><span class="reason">${escapeHtml(reliabilityReasonLabel(row.reliability?.reason))}</span></td>
    <td>${safeSourceLink(row.source)}</td>
  </tr>`;
}

function fundCard([code, rows]) {
  const fund = rows[0];
  const trusted = rows.filter((row) => row.reliability?.grade !== "D").length;
  return `<section class="fund-card">
    <header><div><span class="code">${escapeHtml(code)}</span><h2>${escapeHtml(fund.fundName)}</h2></div><span class="coverage">${trusted}/${rows.length} 条可信</span></header>
    <div class="manager">${escapeHtml(fund.manager)} · ${escapeHtml(fund.currency)}${fund.shareClass ? ` · ${escapeHtml(fund.shareClass)} 类` : ""}</div>
    <div class="table-wrap"><table><thead><tr><th>关系</th><th>销售入口</th><th>状态</th><th>每日额度</th><th>可靠性</th><th>来源</th></tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table></div>
  </section>`;
}

function renderHtml(payload) {
  const grouped = new Map();
  for (const row of payload.rows || []) {
    if (!grouped.has(row.fundCode)) grouped.set(row.fundCode, []);
    grouped.get(row.fundCode).push(row);
  }
  const knownDirect = (payload.rows || []).filter((row) => row.channel.kind === "direct" && row.status !== "unknown").length;
  const knownAgency = (payload.rows || []).filter((row) => row.channel.kind === "agency" && row.status !== "unknown").length;
  const unknown = (payload.rows || []).filter((row) => row.status === "unknown").length;
  const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(payload.observedAt));
  const warnings = (payload.warnings || []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const changes = (payload.changes || []).map((change) => {
    const row = change.after || change.before;
    return `<li><strong>${escapeHtml(row?.fundCode || "")}</strong> ${escapeHtml(row?.fundName || "")}：${escapeHtml(change.type)}</li>`;
  }).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QDII 申购额度监控</title>
<meta name="description" content="国内纳斯达克 100 QDII 基金申购额度监控，直销优先、代销补充。">
<meta property="og:type" content="website"><meta property="og:locale" content="zh_CN">
<meta property="og:title" content="QDII 申购额度监控"><meta property="og:description" content="纳斯达克 100 · 直销优先 · 每日更新">
<meta property="og:url" content="https://tanghuaizhe.github.io/qdii-direct-monitor/"><meta property="og:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="QDII 申购额度监控"><meta name="twitter:description" content="纳斯达克 100 · 直销优先 · 每日更新"><meta name="twitter:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png">
<style>
:root{color-scheme:light;--ink:#182018;--muted:#657066;--line:#dfe6df;--paper:#f4f7f2;--card:#fff;--green:#176b45;--amber:#9a5b00;--red:#a02f2f;--blue:#285d92}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.shell{width:min(1180px,calc(100% - 32px));margin:36px auto 64px}.hero{background:linear-gradient(135deg,#173b2b,#255e43);color:#fff;border-radius:20px;padding:28px 30px;box-shadow:0 16px 50px #1d3b2920}.hero h1{margin:0 0 6px;font-size:28px}.hero p{margin:0;color:#d9eadf}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}.stat strong{display:block;font-size:25px}.stat span,.manager,.reason{color:var(--muted)}.buy-summary{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;background:#e8f4ec;border:1px solid #cce2d3;border-radius:14px;padding:14px 17px;margin:14px 0;color:#244b35}.buy-summary>strong{color:var(--green);white-space:nowrap}.buy-summary small{width:100%;color:var(--muted)}.rank-group b{color:var(--ink)}.rank-separator{color:#8ba092}.notice{background:#fff8e8;border:1px solid #efddb1;border-radius:12px;padding:12px 16px;margin:14px 0}.notice h3{margin:0 0 4px;font-size:14px}.notice ul{margin:4px 0;padding-left:20px}.fund-card{background:var(--card);border:1px solid var(--line);border-radius:16px;margin:14px 0;padding:18px;box-shadow:0 5px 20px #273b2b0a}.fund-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.fund-card header>div{display:flex;align-items:center;gap:10px}.fund-card h2{font-size:17px;margin:0}.code{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#edf2ed;border-radius:7px;padding:4px 7px}.coverage{font-size:12px;color:var(--muted);white-space:nowrap}.manager{margin:4px 0 13px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:800px}th,td{text-align:left;padding:10px 9px;border-top:1px solid #edf0ed;vertical-align:middle}th{color:var(--muted);font-size:12px;font-weight:600}.amount{font-weight:700}.kind,.status,.grade{display:inline-block;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:650;white-space:nowrap}.kind-direct{background:#e4f4ea;color:var(--green)}.kind-agency{background:#e9f1fb;color:var(--blue)}.status-limited{background:#fff0cf;color:var(--amber)}.status-open{background:#e4f4ea;color:var(--green)}.status-suspended,.status-unavailable{background:#fde7e7;color:var(--red)}.status-unknown{background:#edf0ed;color:#687168}.grade{margin-right:7px}.grade-A{background:#d9f1e2;color:var(--green)}.grade-B{background:#e7eff9;color:var(--blue)}.grade-C{background:#fff0cf;color:var(--amber)}.grade-D{background:#ecefec;color:#687168}.reason{font-size:12px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.footer{text-align:center;color:var(--muted);margin-top:22px;font-size:12px}@media(max-width:720px){.shell{width:min(100% - 20px,1180px);margin-top:10px}.hero{padding:22px}.stats{grid-template-columns:1fr 1fr}.fund-card header>div{align-items:flex-start;flex-direction:column;gap:5px}.reason{display:none}}
</style></head><body><main class="shell">
<section class="hero"><h1>QDII 申购额度监控</h1><p>纳斯达克 100 相关基金 · 直销优先，代销补充 · 更新时间 ${escapeHtml(observed)}</p></section>
<section class="stats"><div class="stat"><strong>${grouped.size}</strong><span>基金份额</span></div><div class="stat"><strong>${knownDirect}</strong><span>已识别直销</span></div><div class="stat"><strong>${knownAgency}</strong><span>已识别代销</span></div><div class="stat"><strong>${unknown}</strong><span>未知记录</span></div></section>
${purchaseSummaryHtml(payload.rows || [])}
${warnings ? `<aside class="notice"><h3>抓取提示</h3><ul>${warnings}</ul></aside>` : ""}
${changes ? `<aside class="notice"><h3>本次变化</h3><ul>${changes}</ul></aside>` : ""}
${[...grouped.entries()].map(fundCard).join("")}
<p class="footer">A/B/C/D 表示证据可靠性，不代表投资风险等级。未知状态不可视为开放申购。本页由定时任务自动更新，也可运行 npm start 手动更新。</p>
</main></body></html>\n`;
}

module.exports = { amountLabel, channelLabel, escapeHtml, purchaseSummaryHtml, rankPurchasableFunds, reliabilityReasonLabel, renderHtml, statusLabel };
