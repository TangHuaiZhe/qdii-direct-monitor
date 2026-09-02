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

function feeBand(value) {
  if (!Number.isFinite(value)) return { key: "unknown", label: "待核验" };
  if (value <= 0.8) return { key: "low", label: "低费率" };
  if (value <= 1) return { key: "normal", label: "正常" };
  return { key: "high", label: "高费率" };
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
    const band = feeBand(fee?.annualRate);
    return `<span class="summary-fund"><b>${escapeHtml(row.manager)} ${escapeHtml(row.fundCode)}</b><em>${escapeHtml(amountLabel(row))} · ${escapeHtml(channelLabel(row.channel))}${Number.isFinite(fee?.annualRate) ? ` · <span class="fee-text-${band.key}">年费率 ${escapeHtml(feeLabel(fee.annualRate))}</span>` : ""}</em></span>`;
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
  const band = feeBand(fee.annualRate);
  return `<td class="fee-cell fee-${band.key}" title="管理费 ${escapeHtml(feeLabel(fee.managementRate))} + 托管费 ${escapeHtml(feeLabel(fee.custodyRate))} + 销售服务费 ${escapeHtml(feeLabel(fee.salesServiceRate))}"><div class="fee-head"><strong>${escapeHtml(feeLabel(fee.annualRate))}</strong><span class="fee-tag">${escapeHtml(band.label)}</span></div><span>管 ${escapeHtml(feeLabel(fee.managementRate))} · 托 ${escapeHtml(feeLabel(fee.custodyRate))} · 销 ${escapeHtml(feeLabel(fee.salesServiceRate))}</span>${safeSourceLink(fee.source, "费率来源")}</td>`;
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
  return `<tr class="fund-row" data-search="${escapeHtml(search)}" data-share="${escapeHtml(fund.shareClass || "其他")}" data-status="${escapeHtml(status)}" data-purchasable="${best ? "1" : "0"}" data-amount="${bestAmount}" data-fee="${Number.isFinite(fee?.annualRate) ? fee.annualRate : 999}"><td class="fund-cell"><span class="index-chip">NDX</span><div><strong><a class="fund-link" href="funds/${escapeHtml(code)}/">${escapeHtml(fund.fundName)}</a></strong><span>${escapeHtml(code)} · ${escapeHtml(fund.manager)} · ${escapeHtml(fund.shareClass || "其他")} 类</span></div></td>${channelCell(agency)}${channelCell(direct)}${feeCell(fee)}</tr>`;
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderFundHtml(payload, code, baseUrl = "https://tanghuaizhe.github.io/qdii-direct-monitor/") {
  const rows = (payload.rows || []).filter((row) => row.fundCode === code);
  if (!rows.length) return null;
  const fund = rows[0];
  const fee = (payload.fees || []).find((item) => item.fundCode === code);
  const direct = bestChannel(rows, "direct");
  const agency = bestChannel(rows, "agency");
  const band = feeBand(fee?.annualRate);
  const url = `${baseUrl.replace(/\/$/, "")}/funds/${encodeURIComponent(code)}/`;
  const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(payload.observedAt));
  const description = `${fund.fundName}（${code}）申购额度、直销与代销渠道、年综合费率及来源。`;
  const channelRows = rows.map((row) => `<tr><td>${escapeHtml(row.channel.kind === "direct" ? "直销" : "代销")}</td><td>${escapeHtml(channelLabel(row.channel))}</td><td>${escapeHtml(statusLabel(row.status))}</td><td>${escapeHtml(amountLabel(row))}</td><td><span class="grade grade-${escapeHtml(row.reliability?.grade || "D")}">${escapeHtml(row.reliability?.grade || "D")}</span>${safeSourceLink(row.source)}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(fund.fundName)} ${escapeHtml(code)}｜申购额度与费率</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(fund.fundName)} ${escapeHtml(code)}｜申购额度与费率"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(baseUrl.replace(/\/$/, "/og.png"))}"><script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "Dataset", name: `${fund.fundName}申购额度与费率`, description, url, identifier: code, dateModified: payload.observedAt, isPartOf: { "@type": "WebSite", name: "QDII Monitor", url: baseUrl } })}</script><style>:root{--ink:#241b1c;--muted:#75686a;--line:#eadfe0;--paper:#faf6f5;--primary:#b4232f;--green:#137552;--green-soft:#e5f5ed;--blue:#2b66a0}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.page{width:min(940px,calc(100% - 28px));margin:28px auto 60px}.back{color:var(--primary);text-decoration:none}.crumb{color:var(--muted);font-size:12px;margin:16px 0}.hero,.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-top:14px}.hero{background:linear-gradient(135deg,#7f1420,#b4232f 72%,#cf4450);color:#fff}.hero p{color:#f9dfe2}.code{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#ffffff20;border-radius:6px;padding:4px 7px}.hero h1{font-size:27px;margin:12px 0 4px}.muted{color:var(--muted);font-size:12px}.metric{display:flex;gap:18px;flex-wrap:wrap;margin-top:15px}.metric strong{display:block;font-size:20px}.metric span{color:var(--muted);font-size:12px}.fee{font-weight:800}.fee-low{color:var(--green)}.fee-normal{color:#9b6400}.fee-high{color:#aa3838}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #f1e9ea}th{color:var(--muted);font-size:12px}.grade{display:inline-block;border-radius:999px;padding:2px 6px;margin-right:6px;font-size:11px;background:#eaf2fb;color:var(--blue)}a{color:var(--primary)}@media(max-width:650px){.hero h1{font-size:22px}.table-wrap{overflow-x:auto}table{min-width:600px}}</style></head><body><main class="page"><a class="back" href="../../">← 返回基金列表</a><p class="crumb">QDII Monitor / 纳斯达克100 / ${escapeHtml(code)}</p><section class="hero"><span class="code">${escapeHtml(code)}</span><h1>${escapeHtml(fund.fundName)}</h1><p>${escapeHtml(fund.manager)} · 更新时间 ${escapeHtml(observed)}</p><div class="metric"><div><strong>${escapeHtml(amountLabel(direct))}</strong><span>最高可信直销额度</span></div><div><strong>${escapeHtml(amountLabel(agency))}</strong><span>代销额度</span></div><div><strong class="fee fee-${band.key}">${escapeHtml(feeLabel(fee?.annualRate))}</strong><span>年综合费率 · ${escapeHtml(band.label)}</span></div></div></section><section class="card"><h2>渠道与证据</h2><div class="table-wrap"><table><thead><tr><th>关系</th><th>入口</th><th>状态</th><th>每日额度</th><th>可靠性 / 来源</th></tr></thead><tbody>${channelRows}</tbody></table></div></section><section class="card"><h2>费率拆分</h2>${fee ? `<p class="fee fee-${band.key}">年综合费率 ${escapeHtml(feeLabel(fee.annualRate))}（${escapeHtml(band.label)}）</p><p class="muted">管理费 ${escapeHtml(feeLabel(fee.managementRate))} + 托管费 ${escapeHtml(feeLabel(fee.custodyRate))} + 销售服务费 ${escapeHtml(feeLabel(fee.salesServiceRate))}</p>${safeSourceLink(fee.source, "查看费率来源")}` : `<p>费率待核验。</p>`}</section><p class="muted">综合费率为年度运作费用合计，不包含因渠道、金额和持有期不同而变化的申购费、赎回费。数据仅供核验，不构成投资建议。</p></main></body></html>`;
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
<link rel="canonical" href="https://tanghuaizhe.github.io/qdii-direct-monitor/"><script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "ItemList", name: "纳斯达克100 QDII基金申购额度与费率", numberOfItems: funds.length, itemListElement: funds.map(([code, rows], index) => ({ "@type": "ListItem", position: index + 1, name: rows[0].fundName, url: `https://tanghuaizhe.github.io/qdii-direct-monitor/funds/${code}/` })) })}</script>
<style>
:root{color-scheme:light;--ink:#241b1c;--muted:#75686a;--line:#eadfe0;--paper:#faf6f5;--card:#fff;--primary:#b4232f;--primary-soft:#fbeaec;--green:#137552;--green-soft:#e5f5ed;--amber:#9b6400;--amber-soft:#fff3d6;--red:#aa3838;--red-soft:#fdeaea;--blue:#2b66a0;--blue-soft:#eaf2fb}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.shell{width:min(1240px,calc(100% - 32px));margin:24px auto 56px}.topbar{display:flex;justify-content:space-between;align-items:center;padding:6px 2px 18px}.brand{font-size:17px;font-weight:800;letter-spacing:-.02em;color:var(--primary)}.updated{font-size:12px;color:var(--muted)}.hero{background:linear-gradient(135deg,#7f1420,#b4232f 72%,#cf4450);color:#fff;border-radius:22px;padding:30px;box-shadow:0 18px 50px #7f142026}.eyebrow{display:inline-flex;background:#ffffff18;border:1px solid #ffffff28;border-radius:999px;padding:5px 10px;font-size:12px}.hero h1{margin:13px 0 7px;font-size:clamp(26px,4vw,38px);letter-spacing:-.04em}.hero p{margin:0;color:#f9dfe2;max-width:720px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:15px 17px}.stat strong{display:block;font-size:25px;line-height:1.15}.stat span{color:var(--muted);font-size:12px}.buy-summary{display:grid;grid-template-columns:200px 1fr;gap:14px;background:var(--primary-soft);border:1px solid #efcdd1;border-radius:16px;padding:17px 19px;margin:16px 0}.buy-summary>div:first-child{display:flex;flex-direction:column}.buy-summary>div>strong{color:var(--primary);font-size:15px}.buy-summary small{color:var(--muted)}.summary-list{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}.summary-fund{min-width:max-content;background:#fff;border:1px solid #efdadd;border-radius:10px;padding:7px 10px}.summary-fund b,.summary-fund em{display:block}.summary-fund b{font-size:12px}.summary-fund em{font-size:11px;color:var(--muted);font-style:normal}.fee-text-low{color:var(--green);font-weight:700}.fee-text-normal{color:var(--amber);font-weight:700}.fee-text-high{color:var(--red);font-weight:700}.notices{margin:14px 0}.notice{background:#fff9ea;border:1px solid #efdfb7;border-radius:12px;padding:10px 15px;margin:8px 0}.notice summary{cursor:pointer;font-weight:700}.notice ul{margin:7px 0;padding-left:20px}.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 8px 28px #5b23270d}.panel-head{display:flex;justify-content:space-between;gap:16px;align-items:end;padding:19px 20px 14px}.panel-head h2{font-size:18px;margin:0}.panel-head p{margin:3px 0 0;color:var(--muted);font-size:12px}.result-count{font-weight:700;color:var(--primary);white-space:nowrap}.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 20px 16px}.search{flex:1;min-width:220px;position:relative}.search input{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px 10px 34px;background:#fffafa;font:inherit}.search:before{content:"⌕";position:absolute;left:12px;top:8px;color:var(--muted);font-size:18px}.share-filters{display:flex;gap:6px}.filter-button,.toggle,.sort{border:1px solid var(--line);background:#fff;border-radius:9px;padding:9px 11px;color:var(--ink);font:inherit;cursor:pointer}.filter-button.active{background:var(--primary);border-color:var(--primary);color:#fff}.toggle{display:flex;align-items:center;gap:7px}.toggle input{accent-color:var(--primary)}.sort{padding-right:28px}.table-wrap{overflow-x:auto;border-top:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:980px}th,td{text-align:left;padding:14px 15px;border-bottom:1px solid #f1e9ea;vertical-align:middle}th{background:#fdf9f9;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.03em;position:sticky;top:0}tbody tr:hover{background:#fffafa}.fund-cell{display:flex;align-items:center;gap:11px;min-width:310px}.fund-cell strong,.fund-cell span{display:block}.fund-cell strong{font-size:14px}.fund-cell div>span{color:var(--muted);font-size:11px;margin-top:3px}.fund-link{color:var(--primary)}.index-chip{display:grid!important;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--primary-soft);color:var(--primary);font-size:10px;font-weight:900}.channel-cell{min-width:180px}.channel-main{display:flex;align-items:center;gap:8px}.channel-main strong{font-size:14px}.channel-meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;margin-top:5px}.channel-status,.grade{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:750;white-space:nowrap}.status-limited{background:var(--amber-soft);color:var(--amber)}.status-open{background:var(--green-soft);color:var(--green)}.status-suspended,.status-unavailable{background:var(--red-soft);color:var(--red)}.status-unknown{background:#edf0ed;color:#667068}.grade-A{background:var(--green-soft);color:var(--green)}.grade-B{background:var(--blue-soft);color:var(--blue)}.grade-C{background:var(--amber-soft);color:var(--amber)}.grade-D{background:#edf0ed;color:#667068}.source-link{color:var(--primary);text-decoration:none}.source-link:hover{text-decoration:underline}.fee-cell{min-width:205px}.fee-cell>span{display:block;color:var(--muted);font-size:10px;margin:2px 0}.fee-head{display:flex;align-items:center;gap:7px}.fee-head strong{font-size:17px}.fee-tag{display:inline-block!important;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:750;margin:0!important}.fee-low .fee-head strong{color:var(--green)}.fee-low .fee-tag{background:var(--green-soft);color:var(--green)}.fee-normal .fee-head strong{color:var(--amber)}.fee-normal .fee-tag{background:var(--amber-soft);color:var(--amber)}.fee-high .fee-head strong{color:var(--red)}.fee-high .fee-tag{background:var(--red-soft);color:var(--red)}.unknown{color:var(--muted)}.empty{display:none;text-align:center;padding:34px;color:var(--muted)}.method{margin:14px 2px 0;color:var(--muted);font-size:12px}.method strong{color:var(--ink)}.footer{text-align:center;color:var(--muted);margin-top:24px;font-size:11px}@media(max-width:760px){.shell{width:min(100% - 18px,1240px);margin-top:10px}.topbar{padding:4px 3px 10px}.updated{display:none}.hero{padding:23px 20px}.stats{grid-template-columns:1fr 1fr}.buy-summary{grid-template-columns:1fr}.panel-head{align-items:start}.filters{align-items:stretch}.search{flex-basis:100%}.share-filters{overflow-x:auto}.toggle,.sort{flex:1}.method{padding:0 4px}}
</style><style>
:root{--ink:#17181c;--muted:#686b73;--line:#dfe1e5;--paper:#f1f2f4;--card:#fff;--primary:#ad1f30;--primary-deep:#781322;--primary-soft:#f8e8eb;--terminal:#202126;--shadow:0 18px 48px #25262b10}body{background-color:var(--paper);background-image:linear-gradient(#ffffff70 1px,transparent 1px);background-size:100% 40px;font-family:"Avenir Next","PingFang SC","Microsoft YaHei",sans-serif}.shell{width:min(1280px,calc(100% - 40px));margin:0 auto 64px}.topbar{min-height:76px;padding:14px 2px}.brand{display:flex;align-items:center;gap:10px;color:var(--ink);line-height:1}.brand-symbol{display:grid;place-items:center;width:36px;height:36px;background:var(--primary);color:#fff;border-radius:7px;font:900 18px/1 "Arial Narrow","Avenir Next Condensed",sans-serif}.brand-name{font:800 14px/1.05 "Avenir Next","PingFang SC",sans-serif;letter-spacing:.02em}.brand-name small{display:block;margin-top:5px;color:var(--muted);font:700 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em}.topbar-actions{display:flex;align-items:center;gap:12px}.updated{font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}.refresh-button{border:1px solid var(--primary);background:transparent;color:var(--primary);border-radius:7px;padding:8px 12px;font:750 12px/1 "Avenir Next","PingFang SC",sans-serif;cursor:pointer;transition:background-color .18s ease,color .18s ease,transform .18s ease}.refresh-button:hover{background:var(--primary);color:#fff;transform:translateY(-1px)}.refresh-button:focus-visible,.filter-button:focus-visible,.search input:focus-visible,.sort:focus-visible{outline:3px solid #d74b5c55;outline-offset:2px}.hero{position:relative;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(240px,.75fr);align-items:end;min-height:300px;overflow:hidden;border:1px solid #ffffff1f;border-radius:14px;padding:44px 46px;background:var(--primary-deep);background-image:linear-gradient(#ffffff0c 1px,transparent 1px),linear-gradient(90deg,#ffffff0c 1px,transparent 1px);background-size:32px 32px;box-shadow:0 24px 64px #78132226}.hero:after{content:"";position:absolute;inset:auto 0 0;height:5px;background:linear-gradient(90deg,#e75060 0 34%,#fff 34% 35%,#b92739 35% 100%)}.hero-copy,.hero-code{position:relative;z-index:1}.eyebrow{align-items:center;gap:8px;background:#12030633;border-color:#ffffff35;border-radius:5px;padding:7px 10px;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.live-dot,.rail-live i{width:7px;height:7px;border-radius:50%;background:#ff7a88;box-shadow:0 0 0 4px #ff7a8825}.hero h1{max-width:690px;margin:20px 0 14px;font-family:"DIN Alternate","Avenir Next Condensed","PingFang SC",sans-serif;font-size:clamp(36px,5.4vw,66px);font-weight:900;line-height:.98;letter-spacing:-.055em}.hero h1 em{color:#ffb7bf;font-style:normal}.hero p{max-width:610px;color:#f6dfe2;font-size:14px;line-height:1.75}.hero-code{justify-self:end;width:min(100%,330px);padding:6px 0 2px;text-align:right;color:#fff}.hero-code span,.hero-code small{display:block;font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;opacity:.68}.hero-code strong{display:block;margin:8px 0 4px;color:transparent;font:900 clamp(72px,10vw,132px)/.8 "Arial Narrow","Avenir Next Condensed",sans-serif;letter-spacing:-.08em;-webkit-text-stroke:1.5px #ffffffa6}.market-rail{display:flex;align-items:center;gap:0;overflow-x:auto;margin:0 12px;background:var(--terminal);color:#d8d9dd;border-radius:0 0 8px 8px;white-space:nowrap;scrollbar-width:none}.market-rail::-webkit-scrollbar{display:none}.market-rail span{padding:10px 16px;border-right:1px solid #ffffff16;font:650 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em}.market-rail .rail-live{display:flex;align-items:center;gap:9px;color:#fff}.stats{gap:1px;overflow:hidden;margin:18px 0;background:var(--line);border:1px solid var(--line);border-radius:10px}.stat{border:0;border-radius:0;padding:18px 20px}.stat strong{font-family:"DIN Alternate",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:29px;letter-spacing:-.03em}.stat span{display:block;margin-top:7px;font-size:11px;font-weight:650;letter-spacing:.02em}.buy-summary{grid-template-columns:210px 1fr;background:#fff;border:1px solid var(--line);border-left:4px solid var(--primary);border-radius:10px;padding:18px 20px;box-shadow:var(--shadow)}.buy-summary>div>strong{color:var(--ink);font-size:14px}.buy-summary small{margin-top:4px;font-size:10px}.summary-fund{background:#f7f7f8;border-color:#e6e7ea;border-radius:7px;padding:9px 11px}.summary-fund b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.notices{margin:12px 0}.notice{background:#fff9ea;border-color:#ead79f;border-radius:8px}.panel{border-radius:12px;box-shadow:var(--shadow)}.panel-head{padding:23px 24px 17px;border-bottom:1px solid #ececef}.panel-head h2{font-family:"DIN Alternate","Avenir Next Condensed","PingFang SC",sans-serif;font-size:22px;letter-spacing:-.02em}.result-count{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.filters{padding:16px 24px;background:#fafafb}.search input{height:44px;border-color:#d8dade;border-radius:7px;background:#fff;padding-left:38px}.search input::placeholder{color:#989aa1}.filter-button,.toggle,.sort{min-height:38px;border-color:#d8dade;border-radius:7px}.filter-button.active{background:var(--primary);border-color:var(--primary)}.table-wrap{border-top:0}th,td{padding:16px 18px;border-bottom-color:#ececef}th{background:#f4f4f6;color:#747780;font:750 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em}tbody tr{transition:background-color .15s ease}tbody tr:nth-child(even){background:#fcfcfd}tbody tr:hover{background:#fff5f6}.fund-cell{min-width:330px}.fund-cell strong{font-size:14px;line-height:1.45}.fund-cell div>span{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.index-chip{width:42px;height:42px;border-radius:7px;background:var(--terminal);color:#fff;font-family:"Arial Narrow",sans-serif;letter-spacing:.05em}.channel-main strong,.fee-head strong{font-family:"DIN Alternate",ui-monospace,SFMono-Regular,Menlo,monospace}.source-link{display:inline-flex;align-items:center;min-height:22px;color:var(--primary);font-weight:700}.method{margin:16px 0 0;padding:16px 18px;background:#fff;border:1px solid var(--line);border-radius:8px;line-height:1.8}.footer{margin-top:18px}.empty{background:#fff}.back:focus-visible,a:focus-visible{outline:3px solid #d74b5c55;outline-offset:3px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.refresh-button,tbody tr{transition:none}.refresh-button:hover{transform:none}}@media(max-width:760px){.shell{width:min(100% - 18px,1280px);margin-top:0}.topbar{min-height:64px;padding:10px 2px}.brand-symbol{width:32px;height:32px}.hero{grid-template-columns:1fr;min-height:280px;padding:30px 22px}.hero h1{font-size:42px}.hero-code{position:absolute;right:20px;bottom:20px;width:auto;opacity:.2}.hero-code span,.hero-code small{display:none}.hero-code strong{font-size:92px}.market-rail{margin:0 7px}.stats{grid-template-columns:1fr 1fr}.stat{padding:16px}.stat:nth-child(odd){border-right:1px solid var(--line)}.stat:nth-child(-n+2){border-bottom:1px solid var(--line)}.buy-summary{grid-template-columns:1fr;padding:16px}.panel-head{padding:20px 18px 14px}.filters{padding:14px 18px}.updated{display:none}th,td{padding:14px}.method{margin-inline:2px}}
</style><style>@media(max-width:760px){.table-wrap{overflow:visible}table{min-width:0}thead{display:none}tbody{display:block}tbody tr{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 14px;border-bottom:1px solid var(--line)}tbody tr:nth-child(even){background:#fafafb}td{border:0;padding:0}.fund-cell{grid-column:1/-1;min-width:0;padding-bottom:13px;border-bottom:1px solid #e8e9ec}.fund-cell>div{min-width:0}.fund-cell strong{font-size:13px}.fund-link{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.channel-cell{position:relative;min-width:0;padding:25px 10px 10px;background:#f5f5f7;border-radius:7px}.channel-cell:before,.fee-cell:before{position:absolute;top:8px;left:10px;color:#8b8e96;font:750 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.channel-cell:nth-child(2):before{content:"代销渠道"}.channel-cell:nth-child(3):before{content:"直销渠道"}.channel-main{align-items:flex-start;flex-direction:column;gap:7px}.channel-meta{flex-wrap:wrap}.fee-cell{position:relative;grid-column:1/-1;min-width:0;padding:26px 10px 10px;background:#fff;border:1px solid #e8e9ec;border-radius:7px}.fee-cell:before{content:"年综合费率"}.fee-cell>span{font-size:9px}.source-link{min-height:28px}.unknown{color:var(--muted)}}
</style></head><body><main class="shell">
<nav class="topbar"><span class="brand"><span class="brand-symbol">Q</span><span class="brand-name">QDII 额度监控<small>DIRECT MONITOR</small></span></span><div class="topbar-actions"><span class="updated">更新于 ${escapeHtml(observed)}</span><button id="refresh-page" class="refresh-button" type="button" aria-label="刷新页面数据">↻ 刷新数据</button></div></nav>
<section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="live-dot"></span>NASDAQ 100 · 场外份额监控</span><h1>QDII 申购额度<br><em>一眼看清</em></h1><p>直销与代销分开核验，额度不相加；每条状态都保留来源和证据等级。</p></div><div class="hero-code" aria-hidden="true"><span>NASDAQ INDEX</span><strong>NDX</strong><small>100 / CN QDII</small></div></section>
<div class="market-rail" aria-label="监控方法与数据时间"><span class="rail-live"><i></i>最新快照</span><span>${escapeHtml(observed)}</span><span>直销优先</span><span>渠道额度不相加</span><span>A—D 证据分级</span><span>${(payload.warnings || []).length} 条抓取提示</span></div>
<section class="stats"><div class="stat"><strong>${grouped.size}</strong><span>基金份额</span></div><div class="stat"><strong>${statuses.filter((status) => status === "limited" || status === "open").length}</strong><span>当前可申购</span></div><div class="stat"><strong>${statuses.filter((status) => status === "suspended").length}</strong><span>暂停申购</span></div><div class="stat"><strong>${feeKnown}/${grouped.size}</strong><span>综合费率已识别</span></div></section>
${purchaseSummaryHtml(payload.rows || [], payload.fees || [])}
<div class="notices">${warnings ? `<details class="notice"><summary>抓取提示（${(payload.warnings || []).length}）</summary><ul>${warnings}</ul></details>` : ""}${changes ? `<details class="notice"><summary>本次额度变化（${(payload.changes || []).length}）</summary><ul>${changes}</ul></details>` : ""}</div>
<section class="panel"><div class="panel-head"><div><h2>基金列表</h2><p>代销、直销和年综合费率横向比较</p></div><span class="result-count"><b id="visible-count">${grouped.size}</b> 只</span></div>
<div class="filters"><label class="search"><input id="fund-search" type="search" placeholder="搜索基金名称、代码或公司" aria-label="搜索基金"></label><div class="share-filters" aria-label="份额类别"><button class="filter-button active" type="button" data-share-filter="全部">全部</button>${shareClasses.map((share) => `<button class="filter-button" type="button" data-share-filter="${escapeHtml(share)}">${escapeHtml(share)} 类</button>`).join("")}</div><label class="toggle"><input id="purchasable-only" type="checkbox">仅看可购买</label><select id="fund-sort" class="sort" aria-label="排序方式"><option value="amount">额度从高到低</option><option value="fee">综合费率从低到高</option><option value="name">基金名称</option></select></div>
<div class="table-wrap"><table><thead><tr><th>基金</th><th>代销渠道</th><th>直销渠道</th><th>年综合费率 ⓘ</th></tr></thead><tbody id="fund-body">${funds.map(([code, rows]) => fundTableRow(code, rows, feeByFund.get(code))).join("")}</tbody></table><div id="empty" class="empty">没有符合当前条件的基金</div></div></section>
<p class="method"><strong>综合费率口径：</strong>管理费率＋托管费率＋销售服务费率，均为按年计提；<span class="fee-text-low">≤0.80% 为低费率</span>，<span class="fee-text-normal">&gt;0.80% 且 ≤1.00% 为正常</span>，<span class="fee-text-high">&gt;1.00% 为高费率</span>。基金净值通常已扣除这些费用。申购费和赎回费受渠道折扣、金额及持有期影响，不并入本列。不同基金份额或渠道额度不得相加。</p>
<p class="footer">A/B/C/D 表示证据可靠性，不代表投资风险等级。未知状态不可视为开放申购。数据仅供核验，不构成投资建议。</p>
</main><script>
(() => {
  document.getElementById("refresh-page").addEventListener("click", () => window.location.reload());
  const body = document.getElementById("fund-body"); const rows = [...body.querySelectorAll(".fund-row")]; const search = document.getElementById("fund-search"); const purchasable = document.getElementById("purchasable-only"); const sort = document.getElementById("fund-sort"); const count = document.getElementById("visible-count"); const empty = document.getElementById("empty"); let share = "全部";
  function refresh() { const query = search.value.trim().toLowerCase(); const visible = rows.filter((row) => (!query || row.dataset.search.includes(query)) && (share === "全部" || row.dataset.share === share) && (!purchasable.checked || row.dataset.purchasable === "1")); const key = sort.value; visible.sort((a, b) => key === "fee" ? Number(a.dataset.fee) - Number(b.dataset.fee) || a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : key === "name" ? a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : Number(b.dataset.amount) - Number(a.dataset.amount) || Number(a.dataset.fee) - Number(b.dataset.fee)); const visibleSet = new Set(visible); rows.forEach((row) => { row.hidden = !visibleSet.has(row); }); visible.forEach((row) => body.appendChild(row)); count.textContent = String(visible.length); empty.style.display = visible.length ? "none" : "block"; }
  document.querySelectorAll("[data-share-filter]").forEach((button) => button.addEventListener("click", () => { share = button.dataset.shareFilter; document.querySelectorAll("[data-share-filter]").forEach((item) => item.classList.toggle("active", item === button)); refresh(); })); search.addEventListener("input", refresh); purchasable.addEventListener("change", refresh); sort.addEventListener("change", refresh); refresh();
})();
</script></body></html>\n`;
}

module.exports = { aggregateStatus, amountLabel, channelLabel, escapeHtml, feeBand, feeLabel, purchaseSummaryHtml, rankPurchasableFunds, reliabilityReasonLabel, renderFundHtml, renderHtml, statusLabel };
