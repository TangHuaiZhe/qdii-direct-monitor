"use strict";

const { buildSearchText } = require("../miniapp/utils/pinyin");

const REPOSITORY_URL = "https://github.com/TangHuaiZhe/qdii-direct-monitor";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function analyticsSnippet() {
  const websiteId = String(process.env.UMAMI_WEBSITE_ID || "").trim();
  if (!websiteId) return "";
  const src = String(process.env.UMAMI_SCRIPT_URL || "https://cloud.umami.is/script.js").trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) return "";
  return `<script defer src="${escapeHtml(src)}" data-website-id="${escapeHtml(websiteId)}"></script>`;
}

function statusLabel(status) {
  return { open: "开放申购", limited: "限额申购", suspended: "暂停申购", unavailable: "不可申购", unknown: "状态未知" }[status] || status;
}

function strategyLabel(strategy) {
  return { active: "主动", passive: "被动", unknown: "未分类" }[strategy] || "未分类";
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

function amountMarkup(row) {
  if (!row) return "";
  if (row.status === "open") return `<span class="amount">不限额</span>`;
  if (row.status !== "limited") return `<span class="amount is-muted">—</span>`;
  const value = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(row.limitAmount);
  return `<span class="amount">${escapeHtml(value)}<small>${escapeHtml(row.currency === "USD" ? "美元" : "元")}</small></span>`;
}

function statusMarkup(row) {
  const status = row?.status || "unknown";
  const note = status === "unknown" ? "未核验，不代表可申购" : statusLabel(status);
  return `<span class="channel-status status-${escapeHtml(status)}" title="${escapeHtml(note)}">${escapeHtml(statusLabel(status))}</span>`;
}

function gradeMarkup(reliability) {
  const grade = reliability?.grade || "D";
  const label = `证据等级 ${grade}，A 最高、D 最低；来源与验证方式见基金详情页`;
  return `<span class="grade grade-${escapeHtml(grade)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${escapeHtml(grade)}</span>`;
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
  if (value.includes("pinned official notice is stale")) return "固定公告已过期且与当前代销状态冲突，直销额度需重新核验";
  if (value.includes("manually verified")) return "人工核验记录，超过有效期后自动失效";
  const lower = value.toLowerCase();
  if (lower.includes("current exchange quote matched")) return "交易所官方行情与同日参考净值匹配，可校准";
  if (lower.includes("exchange reference nav cross-checked") || lower.includes("exchange quote matched with published")) return "交易所官方行情与已公布净值交叉校验一致";
  if (lower.includes("exchange quote is current")) return "交易所官方行情为当日收盘/最新成交";
  if (lower.includes("official reference nav unavailable")) return "交易所参考净值不可用，改用已公布单位净值作为分母";
  if (lower.includes("published nav cross-check is unavailable")) return "交易所参考净值可用，已公布净值暂缺，溢价未与净值交叉校验";
  if (lower.includes("official quote unavailable") || lower.includes("exchange quote unavailable")) return "交易所官方行情不可用，已降级到第三方公开行情";
  if (lower.includes("third-party") || lower.includes("third party") || lower.includes("eastmoney quote")) return "使用第三方公开行情，可靠性低于交易所官方数据";
  if (lower.includes("nav lag") || lower.includes("lags the price date") || lower.includes("net value is older")) return "净值日期滞后，实时口径仅作参考，校准口径等待净值公布";
  if (lower.includes("carried forward") || lower.includes("reused last trusted") || lower.includes("last trusted value")) return "沿用上一次可信值，非本次抓取结果";
  if (lower.includes("no trading") || lower.includes("volume is zero") || lower.includes("suspended")) return "当日无成交或停牌，不使用该价格";
  if (lower.includes("deviates from the published nav") || lower.includes("nav mismatch")) return "参考净值与单位净值偏差超阈值，已降级处理";
  if (lower.includes("onsite collection failed")) return "场内采集失败，本次未获得可信数据";
  if (lower.includes("reference nav and published nav are both unavailable")) return "参考净值与单位净值均不可用，溢价无法计算";
  if (lower.includes("published nav date unavailable")) return "已公布净值的日期缺失，校准口径无法计算";
  if (lower.includes("published nav unavailable")) return "已公布单位净值不可用，实时溢价无法计算";
  if (lower.includes("price unavailable or invalid")) return "价格缺失或异常，溢价待核验";
  if (lower.includes("premium unavailable")) return "本次无法计算可信溢价，暂不展示数值";
  if (lower.includes("quote unavailable")) return "交易所行情当前不可用，溢价待核验";
  if (lower.includes("source unavailable")) return "公开数据源当前不可用";
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
  }).slice(0, 4);
  const head = `<div class="summary-head"><h2>当前更方便购买</h2><p>先按最高可信额度排序，同额度再比较年综合费率</p></div>`;
  if (!ranked.length) return `<section class="buy-summary">${head}<p class="muted">没有发现状态和额度均可信的可申购基金。</p></section>`;
  const items = ranked.map((row, index) => {
    const fee = feeByFund.get(row.fundCode);
    const band = feeBand(fee?.annualRate);
    const feeText = Number.isFinite(fee?.annualRate)
      ? `<span class="fee-text-${band.key}">年费率 ${escapeHtml(feeLabel(fee.annualRate))}</span>`
      : "";
    return `<li class="summary-fund"><span class="summary-rank" aria-hidden="true">${index + 1}</span><div class="summary-body"><a class="summary-name" href="funds/${escapeHtml(row.fundCode)}/">${escapeHtml(row.manager)} ${escapeHtml(row.fundCode)}</a>${amountMarkup(row)}<span class="summary-meta">${statusMarkup(row)}<span>${escapeHtml(channelLabel(row.channel))}</span>${gradeMarkup(row.reliability)}${feeText}</span></div></li>`;
  }).join("");
  return `<section class="buy-summary">${head}<ol class="summary-list">${items}</ol></section>`;
}

const ONSITE_INDEX_LABELS = { nasdaq100: "纳指100", sp500: "标普500" };
const ONSITE_SOURCE_LABELS = { "exchange-quote": "交易所行情", nav: "净值来源", "nav-history": "历史净值", iopv: "参考净值" };

function onsiteIndexLabel(index) {
  return ONSITE_INDEX_LABELS[index] || String(index || "未分类");
}

function onsiteVehicleLabel(vehicle) {
  return vehicle === "ETF" || vehicle === "LOF" ? vehicle : "—";
}

function onsiteExchangeLabel(exchange) {
  return exchange === "SSE" ? "上交所" : exchange === "SZSE" ? "深交所" : String(exchange || "—");
}

function refNavKindLongLabel(kind) {
  return { iopv: "IOPV 参考净值", "reference-nav": "参考净值", "previous-nav": "前一日净值", nav: "单位净值" }[kind] || "参考净值";
}

function formatPremium(value) {
  if (!Number.isFinite(value)) return "待核验";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatQuotePrice(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatTurnoverCny(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)} 万`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatOnsiteTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(date);
}

function premiumBand(value, thresholds: any = {}) {
  if (!Number.isFinite(value)) return { key: "unknown", label: "待核验" };
  if (Number.isFinite(thresholds.p90) && value > thresholds.p90) return { key: "high", label: "高溢价" };
  if (Number.isFinite(thresholds.p75) && value > thresholds.p75) return { key: "elevated", label: "偏高" };
  if (Number.isFinite(thresholds.p25) && value < thresholds.p25) return { key: "discount", label: "折价区" };
  return { key: "normal", label: "常态" };
}

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function onsiteTrustedQuotes(payload) {
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
  return quotes.filter((quote) => quote && /^\d{6}$/.test(String(quote.code || "")));
}

function onsiteReliabilitySummary(reason) {
  return reliabilityReasonLabel(reason) || "未提供可靠性说明";
}

const ONSITE_SECTION_CSS = `
.onsite{margin:14px 0;padding:14px 18px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}
.onsite-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:6px 16px}
.onsite-head h2{margin:0;font-size:18px;letter-spacing:-.01em}
.onsite-head p{margin:4px 0 0;color:var(--muted);font-size:12px}
.onsite-method{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfbfc;color:var(--muted);font-size:12px;line-height:1.6}
.onsite-method strong{color:var(--ink)}
.onsite-health{margin:8px 0 0;color:var(--amber);font-size:12px;line-height:1.5}
.onsite-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
.onsite-stat{padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:#fdfdfe}
.onsite-stat dt{color:var(--muted);font-size:12px}
.onsite-stat dd{margin:4px 0 0;color:var(--ink);font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.onsite-stat dd small{font-size:12px;font-weight:600;color:var(--muted)}
.onsite-stat-note{display:block;margin-top:3px;color:var(--muted);font-size:11px;line-height:1.4}
.onsite-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 16px;margin:4px 0 12px}
.onsite-table-wrap{margin-top:10px;overflow-x:auto}
#onsite-table{min-width:1040px;table-layout:auto;font-size:13px}
#onsite-table th,#onsite-table td{padding:8px 10px;vertical-align:top}
#onsite-table th{white-space:nowrap}
#onsite-table tr[hidden]{display:none}
.onsite-code{color:var(--ink);font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none}
.onsite-code:hover{color:var(--primary);text-decoration:underline}
.onsite-name{display:block;font-size:13px;line-height:1.4}
.onsite-manager{display:block;color:var(--muted);font-size:11px}
.vehicle-badge{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--slate-soft);color:var(--slate);font-size:12px;font-weight:700}
.vehicle-lof{background:var(--primary-soft);color:var(--primary)}
.onsite-date{display:block;margin-top:2px;color:var(--muted);font-size:11px;font-weight:500;line-height:1.4}
.onsite-ref-kind{display:block;margin-top:2px;color:var(--muted);font-size:11px;font-weight:500}
.onsite-premium{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.onsite-premium.premium-high{color:var(--red)}
.onsite-premium.premium-elevated{color:var(--amber)}
.onsite-premium.premium-normal{color:var(--ink)}
.onsite-premium.premium-discount{color:var(--green)}
.onsite-premium.premium-unknown{color:var(--muted);font-weight:650}
.onsite-why{display:block;margin-top:3px;max-width:150px;color:var(--muted);font-size:11px;line-height:1.4}
.carry-badge{display:inline-block;margin-top:4px;padding:1px 6px;border:1px dashed #b9bec6;border-radius:999px;color:var(--slate);font-size:11px;font-weight:600;line-height:1.5}
.onsite-placeholder{margin-top:12px;padding:26px 18px;border:1px dashed var(--line-strong);border-radius:12px;background:#fbfbfc;text-align:center}
.onsite-placeholder p{margin:0}
.onsite-placeholder .onsite-placeholder-title{margin-bottom:4px;color:var(--ink);font-size:15px;font-weight:750}
.onsite-degraded{display:grid;gap:4px;margin:12px 0 0;padding:0;list-style:none;color:var(--muted);font-size:12px;line-height:1.5;text-align:left}
.onsite-top3{margin:14px 0 12px}
.onsite-top3-note{margin:0 0 8px;color:var(--muted);font-size:12px}
.onsite-top3-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.onsite-top3-item{display:grid;grid-template-columns:84px minmax(0,1fr) auto;align-items:center;gap:6px 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fdfdfe;text-align:left}
.onsite-top3-name{display:flex;flex-direction:column;min-width:0}
.onsite-top3-name strong{overflow:hidden;font-size:13px;line-height:1.4;text-overflow:ellipsis;white-space:nowrap}
.onsite-top3-name small{color:var(--muted);font-size:11px;line-height:1.5}
.onsite-top3-metrics{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px 12px}
.onsite-top3-metrics span{display:inline-flex;flex-direction:column;align-items:flex-end;gap:2px}
.onsite-top3-metrics small{color:var(--muted);font-size:10px;font-weight:600}
.onsite-more{margin-top:10px}
.onsite-all[hidden]{display:none}
@media(max-width:900px){
.onsite-table-wrap{overflow:visible;margin-top:6px}
#onsite-table{min-width:0}
#onsite-table tbody tr.onsite-row{grid-template-columns:1fr 1fr;align-items:start}
#onsite-table .onsite-cell-fund{grid-column:1/-1;padding-bottom:10px;border-bottom:1px solid var(--line)}
#onsite-table .onsite-cell-evidence{grid-column:1/-1;padding-top:8px;border-top:1px solid var(--line)}
#onsite-table td[data-label]::before{content:attr(data-label);display:block;margin-bottom:1px;color:var(--muted);font-size:11px;font-weight:650}
#onsite-table .onsite-why{max-width:none}
}
@media(max-width:760px){
.onsite{padding:12px 14px 14px}
.onsite-top3-item{grid-template-columns:70px minmax(0,1fr)}
.onsite-top3-metrics{grid-column:1/-1;justify-content:flex-start}
.onsite-stats{grid-template-columns:1fr}
.onsite-stat{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 12px}
.onsite-stat dd{margin:0;font-size:18px}
.onsite-stat-note{margin-top:0;text-align:right}
}
`;

const ONSITE_DETAIL_CSS = `
.onsite-metric-primary strong{color:#ffd7dc}
.carry-note{margin:14px 0 0;padding:10px 12px;border:1px dashed #ffffff70;border-radius:10px;background:#ffffff14;color:#ffe3e6;font-size:12px;line-height:1.6}
.degraded-note{margin:0 0 12px;padding:10px 12px;border:1px solid #d9b46a;border-radius:10px;background:#fffbf0;color:#71571c;font-size:12px;line-height:1.6}
.onsite-facts{margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.7}
.onsite-facts strong{color:var(--ink)}
.onsite-sources .source-group{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.onsite-sources .source-kind{display:inline-block}
.onsite-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.onsite-links a{font-weight:700}
`;

const ONSITE_SCRIPT = `(() => {
  const toggle = document.getElementById("onsite-toggle-all");
  const all = document.getElementById("onsite-all");
  if (toggle && all) {
    const collapsedLabel = toggle.dataset.collapsedLabel || "查看全部";
    const expandedLabel = toggle.dataset.expandedLabel || "收起列表";
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      all.hidden = expanded;
      toggle.textContent = expanded ? collapsedLabel : expandedLabel;
    });
  }
  const table = document.getElementById("onsite-table");
  const body = document.getElementById("onsite-body");
  if (!table || !body) return;
  const rows = [...body.querySelectorAll(".onsite-row")];
  const indexButtons = [...document.querySelectorAll("[data-onsite-index-filter]")];
  const vehicleButtons = [...document.querySelectorAll("[data-onsite-vehicle-filter]")];
  const count = document.getElementById("onsite-visible-count");
  const empty = document.getElementById("onsite-empty");
  let index = "全部";
  let vehicle = "全部";
  function sync(buttons, attribute, value) {
    buttons.forEach((button) => {
      const active = button.dataset[attribute] === value;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
  }
  function refresh() {
    const visible = rows.filter((row) => (index === "全部" || row.dataset.onsiteIndex === index) && (vehicle === "全部" || row.dataset.onsiteVehicle === vehicle));
    const visibleSet = new Set(visible);
    rows.forEach((row) => { row.hidden = !visibleSet.has(row); });
    if (count) count.textContent = String(visible.length);
    if (empty) empty.style.display = visible.length ? "none" : "block";
  }
  indexButtons.forEach((button) => button.addEventListener("click", () => { index = button.dataset.onsiteIndexFilter; sync(indexButtons, "onsiteIndexFilter", index); refresh(); }));
  vehicleButtons.forEach((button) => button.addEventListener("click", () => { vehicle = button.dataset.onsiteVehicleFilter; sync(vehicleButtons, "onsiteVehicleFilter", vehicle); refresh(); }));
  refresh();
})();`;

function onsitePlaceholderHtml(quotes, method, head) {
  const degraded = quotes.filter((quote) => (quote.reliability?.grade || "D") === "D");
  const reasonItems = degraded.slice(0, 8).map((quote) =>
    `<li><strong>${escapeHtml(quote.code)}</strong> ${escapeHtml(quote.name || "")}：${escapeHtml(onsiteReliabilitySummary(quote.reliability?.reason))}</li>`
  ).join("");
  const copy = quotes.length
    ? `本次抓取 ${quotes.length} 只均为 D 级或未完成核验，不回退显示历史值。`
    : "本次数据没有场内行情记录，不显示历史值。";
  return `<section class="onsite" id="onsite-premium">${head}${method}<div class="onsite-placeholder" role="status"><p class="onsite-placeholder-title">暂无可信场内数据</p><p class="muted">${escapeHtml(copy)}</p>${reasonItems ? `<ul class="onsite-degraded">${reasonItems}</ul>` : ""}</div></section>`;
}

function onsiteSectionHtml(payload) {
  const quotes = onsiteTrustedQuotes(payload);
  const summary = payload?.premiumSummary || null;
  const thresholds = summary?.thresholds || {};
  const highPremiumPct = Number.isFinite(thresholds.highPremiumPct) ? thresholds.highPremiumPct : 5;
  const calibratedForDate = summary?.calibratedForDate || quotes.map((quote) => quote.calibratedForDate).find(Boolean) || "";
  const asOf = summary?.asOf || payload?.observedAt || "";
  const count = Number.isFinite(summary?.count) ? summary.count : quotes.length;
  const title = `场内折溢价 · 校准日 ${calibratedForDate || "待净值公布"} · ${count} 只 · 抓取时间 ${formatOnsiteTime(asOf)}`;
  const trusted = quotes.filter((quote) => (quote.reliability?.grade || "D") !== "D");
  const head = `<div class="onsite-head"><div><h2>场内折溢价</h2><p>${escapeHtml(title)}</p></div><span class="result-count" role="status" aria-live="polite"><b id="onsite-visible-count">${quotes.length}</b> 只</span></div>`;
  const method = `<p class="onsite-method"><strong>口径：</strong>校准溢价 = 同日收盘价 ÷ 同日单位净值 − 1，净值公布后通常滞后 1–2 个交易日，是本板块主指标；实时溢价含美股时差，<strong>不代表真实溢价，也不代表套利空间</strong>。场内指标与场外申购额度分开展示，不相加、不互相推断。</p>`;
  const exchangeHealth = payload?.health?.exchange;
  const degradedCodes = Array.isArray(exchangeHealth?.degradedCodes) ? exchangeHealth.degradedCodes.filter(Boolean) : [];
  const healthNote = exchangeHealth
    ? `<p class="onsite-health">行情采集：官方可用 ${escapeHtml(exchangeHealth.officialOk ?? 0)} 只 · 第三方降级 ${escapeHtml(exchangeHealth.fallback ?? 0)} 只 · 失败 ${escapeHtml(exchangeHealth.failed ?? 0)} 只${degradedCodes.length ? ` · 需关注 ${escapeHtml(degradedCodes.join("、"))}` : ""}</p>`
    : "";
  if (!quotes.length || !trusted.length) return onsitePlaceholderHtml(quotes, method, head);

  const calibratedValues = trusted.map((quote) => quote.premiumCalibratedPct).filter((value) => Number.isFinite(value));
  const rankedByCalibrated = trusted.filter((quote) => Number.isFinite(quote.premiumCalibratedPct)).sort((left, right) => right.premiumCalibratedPct - left.premiumCalibratedPct);
  const highest = calibratedValues.length ? Math.max(...calibratedValues) : null;
  const highestQuote = rankedByCalibrated[0] || null;
  const median = calibratedValues.length ? medianOf(calibratedValues) : null;
  const highCount = Array.isArray(summary?.highPremiumCodes)
    ? summary.highPremiumCodes.length
    : calibratedValues.filter((value) => value >= highPremiumPct).length;
  const stats = `<dl class="onsite-stats"><div class="onsite-stat"><dt>最高校准溢价</dt><dd>${highest === null ? "—" : escapeHtml(formatPremium(highest))}</dd><span class="onsite-stat-note">${highestQuote ? `${escapeHtml(highestQuote.code)} ${escapeHtml(highestQuote.name || "")}` : "暂无可校准数据"}</span></div><div class="onsite-stat"><dt>校准溢价中位数</dt><dd>${median === null ? "—" : escapeHtml(formatPremium(median))}</dd><span class="onsite-stat-note">基于 ${calibratedValues.length} 只有效校准</span></div><div class="onsite-stat"><dt>高溢价只数</dt><dd>${escapeHtml(highCount)}<small> / ${trusted.length}</small></dd><span class="onsite-stat-note">≥ ${escapeHtml(highPremiumPct)}% 警示线</span></div></dl>`;

  const indexOptions = ([...new Set(quotes.map((quote) => quote.index || "").filter(Boolean))] as string[]).sort();
  const vehicleOptions = ([...new Set(quotes.map((quote) => quote.vehicle || "").filter(Boolean))] as string[]).sort();
  const filterGroup = (label: string, attribute: string, options: string[]) => `<div class="filter-group" role="group" aria-label="按${label}筛选"><span class="filter-label">${label}</span><div class="chips"><button class="filter-button active" type="button" ${attribute}="全部" aria-pressed="true">全部</button>${options.map((option) => `<button class="filter-button" type="button" ${attribute}="${escapeHtml(option)}" aria-pressed="false">${escapeHtml(option === "ETF" || option === "LOF" ? option : onsiteIndexLabel(option))}</button>`).join("")}</div></div>`;
  const filters = `<div class="onsite-filters">${filterGroup("指数", "data-onsite-index-filter", indexOptions)}${filterGroup("类型", "data-onsite-vehicle-filter", vehicleOptions)}</div>`;

  const effectivePremium = (quote) => {
    if (Number.isFinite(quote.premiumCalibratedPct)) return quote.premiumCalibratedPct;
    if (Number.isFinite(quote.premiumLivePct)) return quote.premiumLivePct;
    return null;
  };
  const sorted = quotes.slice().sort((left, right) => {
    const leftValue = effectivePremium(left);
    const rightValue = effectivePremium(right);
    if (leftValue === null && rightValue === null) return String(left.code).localeCompare(String(right.code));
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return leftValue - rightValue || String(left.code).localeCompare(String(right.code));
  });
  const lowest = sorted
    .filter((quote) => (quote.reliability?.grade || "D") !== "D" && quote.carriedForward !== true && effectivePremium(quote) !== null)
    .slice(0, 3);
  const lowestItems = lowest.map((quote) => {
    const calibrated = quote.premiumCalibratedPct;
    const live = quote.premiumLivePct;
    const calibratedBand = premiumBand(calibrated, thresholds);
    const liveBand = premiumBand(live, thresholds);
    return `<li class="onsite-top3-item"><a class="onsite-code" href="onsite/${escapeHtml(quote.code)}/">${escapeHtml(quote.code)}</a><span class="onsite-top3-name"><strong>${escapeHtml(quote.name || "—")}</strong><small>${escapeHtml(onsiteIndexLabel(quote.index))} · ${escapeHtml(onsiteVehicleLabel(quote.vehicle))} · 净值日期 ${escapeHtml(quote.navDate || quote.refNavDate || "—")}</small></span><span class="onsite-top3-metrics"><span><b class="onsite-premium premium-${calibratedBand.key}">${escapeHtml(formatPremium(calibrated))}</b><small>校准</small></span><span><b class="onsite-premium premium-${liveBand.key}">${escapeHtml(formatPremium(live))}</b><small>实时</small></span></span></li>`;
  }).join("");
  const lowestBlock = lowest.length
    ? `<div class="onsite-top3"><p class="onsite-top3-note">按溢价率由低到高，先看最低的 3 只（校准溢价优先，暂缺时使用实时溢价）</p><ul class="onsite-top3-list">${lowestItems}</ul><button class="filter-button onsite-more" id="onsite-toggle-all" type="button" aria-expanded="false" aria-controls="onsite-all" data-collapsed-label="查看全部 ${escapeHtml(quotes.length)} 只">查看全部 ${escapeHtml(quotes.length)} 只</button></div>`
    : "";
  const rows = sorted.map((quote) => {
    const grade = quote.reliability?.grade || "D";
    const calibrated = quote.premiumCalibratedPct;
    const live = quote.premiumLivePct;
    const calibratedBand = premiumBand(calibrated, thresholds);
    const liveBand = premiumBand(live, thresholds);
    const reason = onsiteReliabilitySummary(quote.reliability?.reason);
    const carried = quote.carriedForward === true;
    const carriedBadge = carried
      ? `<span class="carry-badge" title="沿用上次可信值，原始抓取时间 ${escapeHtml(formatOnsiteTime(quote.observedAt))}">沿用上次可信值 · 原始时间 ${escapeHtml(formatOnsiteTime(quote.observedAt))}</span>`
      : "";
    const detailHref = `onsite/${escapeHtml(quote.code)}/`;
    return `<tr class="onsite-row" data-onsite-index="${escapeHtml(quote.index || "")}" data-onsite-vehicle="${escapeHtml(quote.vehicle || "")}" data-onsite-premium="${Number.isFinite(calibrated) ? calibrated : ""}" data-onsite-code="${escapeHtml(quote.code)}"><td class="onsite-cell-code" data-label="代码"><a class="onsite-code" href="${detailHref}">${escapeHtml(quote.code)}</a></td><td class="onsite-cell-fund" data-label="名称"><strong class="onsite-name">${escapeHtml(quote.name || "—")}</strong><span class="onsite-manager">${escapeHtml(quote.manager || "")}</span>${carriedBadge}</td><td data-label="指数">${escapeHtml(onsiteIndexLabel(quote.index))}</td><td data-label="类型"><span class="vehicle-badge vehicle-${escapeHtml(String(quote.vehicle || "").toLowerCase())}">${escapeHtml(onsiteVehicleLabel(quote.vehicle))}</span></td><td data-label="收盘价">${escapeHtml(formatQuotePrice(quote.price))}<small class="onsite-date">${escapeHtml(quote.priceDate || "")}</small></td><td data-label="参考净值">${escapeHtml(formatQuotePrice(quote.refNav, 4))}<small class="onsite-ref-kind">${escapeHtml(refNavKindLongLabel(quote.refNavKind))}</small></td><td class="onsite-cell-calibrated" data-label="校准溢价"><span class="onsite-premium premium-${calibratedBand.key}">${escapeHtml(formatPremium(calibrated))}</span><small class="onsite-date">${escapeHtml(quote.calibratedForDate ? `校准日 ${quote.calibratedForDate}` : "")}</small></td><td data-label="实时溢价"><span class="onsite-premium premium-${liveBand.key}">${escapeHtml(formatPremium(live))}</span><small class="onsite-date">含美股时差</small></td><td data-label="净值日期">${escapeHtml(quote.navDate || quote.refNavDate || "—")}</td><td data-label="成交额">${escapeHtml(formatTurnoverCny(quote.turnoverCny))}</td><td data-label="可靠性"><span class="grade grade-${escapeHtml(grade)}" title="${escapeHtml(reason)}" aria-label="证据等级 ${escapeHtml(grade)}">${escapeHtml(grade)}</span><small class="onsite-why">${escapeHtml(reason)}</small></td><td class="onsite-cell-evidence" data-label="证据"><a class="source-link" href="${detailHref}">详情与来源</a></td></tr>`;
  }).join("");
  const table = `<div class="table-wrap onsite-table-wrap"><table id="onsite-table"><caption class="sr-only">场内折溢价：校准溢价按同日收盘价与同日单位净值计算，实时溢价含美股时差；D 级表示无法核验，不代表可交易。</caption><thead><tr><th scope="col">代码</th><th scope="col">名称</th><th scope="col">指数</th><th scope="col">类型</th><th scope="col">收盘价</th><th scope="col">参考净值</th><th scope="col">校准溢价</th><th scope="col">实时溢价</th><th scope="col">净值日期</th><th scope="col">成交额</th><th scope="col">可靠性</th><th scope="col">证据</th></tr></thead><tbody id="onsite-body">${rows}</tbody></table><div id="onsite-empty" class="empty" role="status"><p>没有符合当前条件的场内基金</p></div></div>`;
  const allWrapper = `<div class="onsite-all" id="onsite-all"${lowest.length ? " hidden" : ""}>${filters}${table}</div>`;
  return `<section class="onsite" id="onsite-premium">${head}${method}${healthNote}${stats}${lowestBlock}${allWrapper}</section>`;
}

function renderOnsiteFundHtml(payload, code, baseUrl = "https://tanghuaizhe.github.io/qdii-direct-monitor/") {
  const quotesByCode = payload?.quotesByCode;
  const quote = (quotesByCode && quotesByCode[code]) || onsiteTrustedQuotes(payload).find((item) => String(item.code) === String(code));
  if (!quote || !/^\d{6}$/.test(String(quote.code || ""))) return null;
  const grade = quote.reliability?.grade || "D";
  const reason = onsiteReliabilitySummary(quote.reliability?.reason);
  const thresholds = payload?.premiumSummary?.thresholds || {};
  const calibrated = quote.premiumCalibratedPct;
  const live = quote.premiumLivePct;
  const calibratedBand = premiumBand(calibrated, thresholds);
  const liveBand = premiumBand(live, thresholds);
  const carried = quote.carriedForward === true;
  const observed = formatOnsiteTime(quote.observedAt || payload?.observedAt);
  const root = String(baseUrl).replace(/\/$/, "");
  const url = `${root}/onsite/${encodeURIComponent(quote.code)}/`;
  const description = `${quote.name}（${quote.code}）场内折溢价、收盘价、参考净值、成交额与来源。`;
  const title = `${quote.name} ${quote.code}｜场内折溢价与参考净值`;
  const originalTime = quote.observedAt ? `<time datetime="${escapeHtml(quote.observedAt)}">${escapeHtml(observed)}</time>` : escapeHtml(observed);
  const carryNote = carried
    ? `<p class="carry-note">沿用上次可信值 · 原始时间 ${originalTime}：本次抓取未能更新，这个数字不代表最新行情，请以下方来源与净值日期为准。</p>`
    : "";
  const degradedNote = grade === "D"
    ? `<p class="degraded-note">本次数据为 D 级：${escapeHtml(reason)}。页面保留来源用于核验，不展示未经核验的溢价数值。</p>`
    : "";
  const metrics = `<div class="metric"><div class="onsite-metric-primary"><strong>${escapeHtml(formatPremium(calibrated))}</strong><span>校准溢价 · ${escapeHtml(calibratedBand.label)}${quote.calibratedForDate ? ` · 校准日 ${escapeHtml(quote.calibratedForDate)}` : " · 待净值公布"}</span></div><div><strong>${escapeHtml(formatPremium(live))}</strong><span>实时溢价 · ${escapeHtml(liveBand.label)}${quote.navDate ? ` · 净值日期 ${escapeHtml(quote.navDate)}` : ""}，含美股时差</span></div><div><strong>${escapeHtml(formatQuotePrice(quote.price))}</strong><span>收盘价${quote.priceDate ? ` · ${escapeHtml(quote.priceDate)}` : ""}</span></div><div><strong>${escapeHtml(formatQuotePrice(quote.refNav, 4))}</strong><span>${escapeHtml(refNavKindLongLabel(quote.refNavKind))}${quote.refNavDate ? ` · ${escapeHtml(quote.refNavDate)}` : ""}</span></div><div><strong>${escapeHtml(formatTurnoverCny(quote.turnoverCny))}</strong><span>成交额</span></div><div class="onsite-metric-grade"><strong><span class="grade grade-${escapeHtml(grade)}">${escapeHtml(grade)}</span></strong><span>可靠性 · ${escapeHtml(grade === "D" ? "待核验" : reason)}</span></div></div>`;

  const sources = Array.isArray(quote.sources) ? quote.sources : [];
  const sourceGroups = sources.map((source) => {
    const label = ONSITE_SOURCE_LABELS[source?.kind] || source?.kind || "来源";
    const link = safeSourceLink(source, label, true);
    if (!link) return "";
    return `<div class="source-group"><span class="source-kind">${escapeHtml(label)}${source?.adapter ? ` · ${escapeHtml(source.adapter)}` : ""}</span>${link}</div>`;
  }).filter(Boolean).join("");
  const sourcesHtml = sourceGroups
    ? `<div class="onsite-sources">${sourceGroups}</div>`
    : `<p class="muted">本次没有可公开展示的来源链接，请以交易所与基金公司公开页面为准。</p>`;

  const facts = `<p class="onsite-facts"><strong>抓取时间：</strong>${escapeHtml(observed)} · <strong>价格时间：</strong>${escapeHtml(quote.priceAt || "—")} · <strong>净值日期：</strong>${escapeHtml(quote.navDate || quote.refNavDate || "—")} · <strong>校准日：</strong>${escapeHtml(quote.calibratedForDate || "待净值公布")} · <strong>申购状态：</strong>${escapeHtml(quote.applyStatus || "未提供")}</p>`;

  const otcCode = quote.linksOtcCode && /^\d{6}$/.test(String(quote.linksOtcCode)) ? String(quote.linksOtcCode) : "";
  const otcHtml = otcCode
    ? `<div class="source-group"><span class="source-kind">关联场外份额</span><a class="source-link" href="funds/${escapeHtml(otcCode)}/">查看场外份额 ${escapeHtml(otcCode)} 的申购额度</a></div><p class="muted">场外申购额度与场内溢价是两套指标，分开展示，不相加、不互相推断。</p>`
    : `<p class="muted">暂未配置对应的场外份额。</p>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(root + "/og.png")}"><script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "Dataset", name: `${quote.name}场内折溢价与参考净值`, description, url, identifier: quote.code, dateModified: quote.observedAt || payload?.observedAt, isPartOf: { "@type": "WebSite", name: "QDII Monitor", url: baseUrl } })}</script><style>${DETAIL_CSS}${ONSITE_DETAIL_CSS}</style>${analyticsSnippet()}</head><body><main class="page"><a class="back" href="../../">← 返回基金列表</a><p class="crumb">QDII Monitor / 场内折溢价 / ${escapeHtml(onsiteIndexLabel(quote.index))} / ${escapeHtml(quote.code)}</p><section class="hero"><span class="code">${escapeHtml(quote.code)}</span><h1>${escapeHtml(quote.name)}</h1><p>${escapeHtml(quote.manager || "")} · 场内 ${escapeHtml(onsiteVehicleLabel(quote.vehicle))} · ${escapeHtml(onsiteExchangeLabel(quote.exchange))} · 抓取时间 ${escapeHtml(observed)}</p>${metrics}${carryNote}</section>${degradedNote}<section class="card"><h2>口径说明</h2><p><strong>校准溢价</strong>：同一估值日的收盘价 ÷ 当日单位净值 − 1；净值公布后计算，通常滞后 1–2 个交易日，是本页主指标。<br><strong>实时溢价</strong>：现价 ÷ 最新公布参考净值 − 1；QDII 净值含美股时差，偏大或偏小都正常，不代表真实溢价，也不代表可以套利。</p>${facts}</section><section class="card onsite-sources-card"><h2>来源与证据</h2>${sourcesHtml}</section><section class="card"><h2>关联场外份额</h2>${otcHtml}</section><p class="muted">免责声明：历史溢价不代表未来，溢价率高时买入存在价格回归风险；交易所公开行情与公开净值不等于登录后下单验证。数据仅供核验，不构成投资建议。</p></main></body></html>`;
}

function officialSiteLinkAllowed(url) {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  if (url.hostname === "www.byfunds.com" || url.hostname.endsWith(".byfunds.com")) return true;
  // SSE quote API is only reachable over HTTP (its HTTPS port is unreachable) and is an official exchange host.
  return url.hostname === "sse.com.cn" || url.hostname.endsWith(".sse.com.cn");
}

function safeSourceUrl(source) {
  if (!source?.url) return "";
  try {
    const url = new URL(source.url);
    if (!officialSiteLinkAllowed(url)) return "";
    return escapeHtml(url.toString());
  } catch { return ""; }
}

function safeSourceLink(source, label = "证据", showUrl = false, withLink = true) {
  const href = safeSourceUrl(source);
  if (!href) return "";
  const urlLink = `<a class="evidence-url" href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`;
  if (!withLink) return `<span class="evidence">${urlLink}</span>`;
  const link = `<a class="source-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  if (!showUrl) return link;
  return `<span class="evidence"><span class="evidence-head">${link}</span>${urlLink}</span>`;
}

function salesDetailRow(rows, kind) {
  return bestChannel((rows || []).filter((row) => row.channel?.kind === kind && (kind === "direct" ? row.salesUrl : row.source?.kind === "public-sales-page")), kind);
}

function salesDetailUrl(row) {
  return row?.channel?.kind === "direct" ? row.salesUrl : row?.source?.url;
}

function salesDetailLink(row, className = "sales-link") {
  const href = salesDetailUrl(row);
  if (!href) return "";
  const direct = row.channel?.kind === "direct";
  const relation = direct ? "直销" : "代销";
  const label = direct ? "前往直销官网" : "查看代销详情";
  const fund = [row?.fundCode, row?.manager].filter(Boolean).join(" ");
  const ariaLabel = `${label}${fund ? "：" + fund : ""}（在新窗口打开${relation}网站）`;
  try {
    const url = new URL(href);
    if (!officialSiteLinkAllowed(url)) return "";
    return `<a class="${escapeHtml(className)}" href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(ariaLabel)}">${label} <span aria-hidden="true">↗</span></a>`;
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

function channelCell(row, detailRow, kind = "agency") {
  const kindClass = kind === "direct" ? "channel-direct" : "channel-agency";
  const kindLabel = kind === "direct" ? "直销渠道" : "代销渠道";
  if (!row) {
    return `<td class="channel-cell ${kindClass} is-empty"><span class="channel-kind">${kindLabel}</span><span class="channel-status status-unknown" title="暂无可信数据">暂无数据</span></td>`;
  }
  const channelName = escapeHtml(channelLabel(row.channel));
  const salesLink = salesDetailLink(row);
  return `<td class="channel-cell ${kindClass}"><span class="channel-kind">${kindLabel} · ${channelName}</span><div class="channel-top">${statusMarkup(row)}${amountMarkup(row)}</div><div class="channel-meta"><span class="channel-name">${channelName}</span>${gradeMarkup(row.reliability)}${salesLink}</div></td>`;
}

function feeCell(fee) {
  if (!fee || !Number.isFinite(fee.annualRate)) {
    return `<td class="fee-cell unknown"><span class="fee-kind">年综合费率</span><div class="fee-top"><strong class="fee-rate">—</strong><span class="fee-tag">费率待核验</span></div><div class="fee-split">来源见基金详情页</div></td>`;
  }
  const band = feeBand(fee.annualRate);
  const breakdown = `管 ${feeLabel(fee.managementRate)} · 托 ${feeLabel(fee.custodyRate)} · 销 ${feeLabel(fee.salesServiceRate)}`;
  return `<td class="fee-cell fee-${band.key}" title="管理费 ${escapeHtml(feeLabel(fee.managementRate))} + 托管费 ${escapeHtml(feeLabel(fee.custodyRate))} + 销售服务费 ${escapeHtml(feeLabel(fee.salesServiceRate))}"><span class="fee-kind">年综合费率</span><div class="fee-top"><strong class="fee-rate">${escapeHtml(feeLabel(fee.annualRate))}</strong><span class="fee-tag">${escapeHtml(band.label)}</span></div><div class="fee-split">${escapeHtml(breakdown)}</div></td>`;
}

function sortableChannelAmount(row) {
  if (!row || !["open", "limited"].includes(row.status)) return "";
  return row.status === "open" ? Number.MAX_SAFE_INTEGER : row.limitAmount;
}

function managerMark(manager) {
  const name = String(manager || "");
  const initial = Array.from(name).find((character) => /[\u3400-\u9fff]/.test(character)) || Array.from(name)[0] || "基";
  const tone = Array.from(name).reduce((hash, character) => (hash * 31 + character.codePointAt(0)) >>> 0, 0) % 6;
  return { initial, tone };
}

function aggregateStatus(rows) {
  const statuses = rows.filter((row) => row.reliability?.grade !== "D").map((row) => row.status);
  if (statuses.includes("open")) return "open";
  if (statuses.includes("limited")) return "limited";
  if (statuses.includes("suspended")) return "suspended";
  if (statuses.includes("unavailable")) return "unavailable";
  return "unknown";
}

function changeValue(row) {
  if (!row) return "无记录";
  const amount = row.status === "limited" ? ` ${amountLabel(row)}` : "";
  return `${statusLabel(row.status)}${amount}`;
}

function changeDescription(change) {
  const row = change.after || change.before;
  const channel = row?.channel ? channelLabel(row.channel) : "渠道";
  if (change.type === "channel-added") return `新增${channel}：${changeValue(change.after)}`;
  if (change.type === "channel-removed") return `移除${channel}：${changeValue(change.before)}`;
  return `${channel}：${changeValue(change.before)} → ${changeValue(change.after)}`;
}

function fundTableRow(code, rows, fee) {
  const fund = rows[0];
  const direct = bestChannel(rows, "direct");
  const agency = bestChannel(rows, "agency");
  const best = rankPurchasableFunds(rows)[0] || null;
  const status = aggregateStatus(rows);
  const bestAmount = best?.status === "open" ? Number.MAX_SAFE_INTEGER : (best?.limitAmount || 0);
  const search = buildSearchText(fund.fundName, fund.manager, code);
  const mark = managerMark(fund.manager);
  const strategy = fund.strategy || "unknown";
  const strategyBadge = `<b class="strategy-badge strategy-${escapeHtml(strategy)}">${escapeHtml(strategyLabel(strategy))}</b>`;
  return `<tr class="fund-row" data-search="${escapeHtml(search)}" data-share="${escapeHtml(fund.shareClass || "其他")}" data-strategy="${escapeHtml(strategy)}" data-status="${escapeHtml(status)}" data-purchasable="${best ? "1" : "0"}" data-amount="${bestAmount}" data-agency-amount="${sortableChannelAmount(agency)}" data-direct-amount="${sortableChannelAmount(direct)}" data-fee="${Number.isFinite(fee?.annualRate) ? fee.annualRate : ""}"><td class="fund-column"><div class="fund-cell"><span class="index-chip manager-tone-${mark.tone}" aria-hidden="true">${escapeHtml(mark.initial)}</span><div class="fund-body"><strong><a class="fund-link" href="funds/${escapeHtml(code)}/">${escapeHtml(fund.fundName)}</a></strong><span class="fund-meta">${escapeHtml(code)} · ${escapeHtml(fund.manager)} · ${strategyBadge} · ${escapeHtml(fund.shareClass || "其他")} 类</span></div></div></td>${channelCell(direct, salesDetailRow(rows, "direct"), "direct")}${channelCell(agency, salesDetailRow(rows, "agency"), "agency")}${feeCell(fee)}</tr>`;
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function deploymentLinks(payload) {
  const commit = String(payload.gitCommit || process.env.GITHUB_SHA || "").trim();
  const commitLink = /^[0-9a-f]{7,40}$/i.test(commit)
    ? `<a class="commit-link" href="${REPOSITORY_URL}/commit/${escapeHtml(commit)}" target="_blank" rel="noopener noreferrer" title="部署提交 ${escapeHtml(commit)}">commit <code>${escapeHtml(commit.slice(0, 7))}</code></a>`
    : "";
  const githubLink = `<a class="github-link" href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看本项目" title="GitHub 项目"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.02-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.63.07-.62.07-.62 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.12a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.04.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/></svg></a>`;
  return commitLink + githubLink;
}

function holdingsSectionHtml(holding) {
  if (!holding || holding.reliability?.grade === "D" || !holding.items?.length) {
    return `<section class="card"><h2>十大持仓股</h2><p>最新持仓暂待核验。</p></section>`;
  }
  const grade = holding.reliability?.grade || "D";
  const scope = holding.exposure === "look-through" ? `目标 ETF ${holding.sourceCode} 穿透持仓` : "本基金直接披露持仓";
  const weightHeading = holding.exposure === "look-through" ? "占目标 ETF 净值" : "占基金净值";
  const rows = holding.items.map((item) => `<tr><td>${escapeHtml(item.rank)}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.market)}</td><td><strong>${escapeHtml(Number(item.weight).toFixed(2))}%</strong></td></tr>`).join("");
  return `<section class="card"><h2>十大持仓股</h2><p class="muted">${escapeHtml(scope)} · 报告期 ${escapeHtml(holding.asOf)} · <span class="grade grade-${escapeHtml(grade)}">${escapeHtml(grade)}</span> ${safeSourceLink(holding.source, "查看持仓来源")}</p><p class="muted">持仓为报告期末快照，不代表当前实时仓位；联接基金展示目标 ETF 的穿透持仓，比例未经联接基金 ETF 仓位折算。</p><div class="table-wrap"><table class="holdings-table"><thead><tr><th>排名</th><th>股票</th><th>代码</th><th>市场</th><th>${escapeHtml(weightHeading)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// Shared inline CSS for fund/onsite detail pages (kept identical so both reuse the same design language).
const DETAIL_CSS = ":root{--ink:#241b1c;--muted:#75686a;--line:#eadfe0;--paper:#faf6f5;--primary:#b4232f;--green:#137552;--green-soft:#e5f5ed;--blue:#2b66a0}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",sans-serif}.page{width:min(940px,calc(100% - 28px));margin:28px auto 60px}.back{color:var(--primary);text-decoration:none}.crumb{color:var(--muted);font-size:12px;margin:16px 0}.hero,.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-top:14px}.hero{background:linear-gradient(135deg,#7f1420,#b4232f 72%,#cf4450);color:#fff}.hero p{color:#f9dfe2}.code{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#ffffff20;border-radius:6px;padding:4px 7px}.hero h1{font-size:27px;margin:12px 0 4px}.muted{color:var(--muted);font-size:12px}.metric{display:flex;align-items:stretch;gap:18px;flex-wrap:wrap;margin-top:15px}.metric>div{min-width:150px;padding:10px 0}.metric strong{display:block;color:#fff;font-size:20px}.metric span{color:#f6dfe2;font-size:12px}.metric .fee-metric{min-width:190px;padding:10px 14px;background:#fff;border:1px solid #ffffff99;border-radius:10px;box-shadow:0 8px 22px #4e071430}.metric .fee-metric span{color:#57494c}.sales-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid #ffffff2e}.sales-button{display:inline-flex;align-items:center;gap:5px;padding:8px 12px;border:1px solid #ffffff66;border-radius:8px;background:#fff;color:var(--primary);font-weight:750;text-decoration:none}.sales-button:hover{background:#fff4f5}.sales-link{display:inline-flex;align-items:center;gap:4px;font-weight:700}.fee{font-weight:800}.fee-low{color:var(--green)}.fee-normal{color:#7a4b00}.fee-high{color:#9a2f36}.metric .fee-metric .fee-low{color:#0f6b4a}.metric .fee-metric .fee-normal{color:#7a4b00}.metric .fee-metric .fee-high{color:#9a2f36}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #f1e9ea}th{color:var(--muted);font-size:12px}.grade{display:inline-block;border-radius:999px;padding:2px 6px;margin-right:6px;font-size:11px;background:#eaf2fb;color:var(--blue)}.strategy-badge{display:inline-block;border-radius:999px;padding:2px 7px;margin:0 4px;font-size:11px;font-weight:800;line-height:1.35;white-space:nowrap}.strategy-active{background:#fff0d6;color:#9a5700;border:1px solid #f0cd8f}.strategy-passive{background:#e5f0ff;color:#1d5f9d;border:1px solid #bdd7f2}.strategy-unknown{background:#eef0ee;color:#667068;border:1px solid #d9ddda}.evidence{display:block;max-width:100%;margin-top:4px;line-height:1.45}.evidence-head{display:inline-flex}.evidence-url{display:block;color:var(--muted);font:600 9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;text-decoration:none}.evidence-url:hover{color:var(--primary);text-decoration:underline}.source-group{padding:10px 0;border-bottom:1px solid var(--line)}.source-group:last-child{border-bottom:0;padding-bottom:0}.source-kind{display:block;color:var(--muted);font-size:12px;font-weight:750}a{color:var(--primary)}@media(max-width:650px){.hero h1{font-size:22px}.metric{gap:8px}.metric>div{min-width:calc(50% - 4px)}.metric .fee-metric{min-width:100%}.sales-button{flex:1;justify-content:center}.table-wrap{overflow-x:auto}table{min-width:600px}}";

function renderFundHtmlWithoutHoldings(payload, code, baseUrl = "https://tanghuaizhe.github.io/qdii-direct-monitor/") {
  const rows = (payload.rows || []).filter((row) => row.fundCode === code);
  if (!rows.length) return null;
  const fund = rows[0];
  const fee = (payload.fees || []).find((item) => item.fundCode === code);
  const direct = bestChannel(rows, "direct");
  const agency = bestChannel(rows, "agency");
  const indexLabel = { nasdaqTechnology: "纳斯达克科技", globalMobileInternet: "全球移动互联", globalTechnology: "全球科技先锋" }[fund.index] || "纳斯达克100";
  const fundStrategy = strategyLabel(fund.strategy);
  const band = feeBand(fee?.annualRate);
  const url = `${baseUrl.replace(/\/$/, "")}/funds/${encodeURIComponent(code)}/`;
  const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(payload.observedAt));
  const description = `${fund.fundName}（${code}）申购额度、直销与代销渠道、年综合费率及来源。`;
  const directDetail = salesDetailRow(rows, "direct");
  const agencyDetail = salesDetailRow(rows, "agency");
  const detailActions = [salesDetailLink(directDetail, "sales-button"), salesDetailLink(agencyDetail, "sales-button")].filter(Boolean).join("");
  const channelRows = rows.map((row) => {
    const isDetailSource = row === directDetail || row === agencyDetail;
    const sameAsSales = isDetailSource && salesDetailUrl(row) === row.source?.url;
    const evidenceLink = row.channel.kind === "direct" && sameAsSales
      ? safeSourceLink(row.source, "证据", true, false)
      : sameAsSales ? "" : safeSourceLink(row.source, "证据", row.channel.kind === "direct");
    return `<tr><td>${escapeHtml(row.channel.kind === "direct" ? "直销" : "代销")}</td><td>${escapeHtml(channelLabel(row.channel))}</td><td>${escapeHtml(statusLabel(row.status))}</td><td>${escapeHtml(amountLabel(row))}</td><td><span class="grade grade-${escapeHtml(row.reliability?.grade || "D")}">${escapeHtml(row.reliability?.grade || "D")}</span>${evidenceLink}${isDetailSource ? salesDetailLink(row) : ""}</td></tr>`;
  }).join("");
  const directSources = [...new Map<string, any>(rows.filter((row) => row.channel.kind === "direct" && row.reliability?.grade !== "D" && row.source?.url).map((row) => [row.source.url, row.source])).values()];
  const noticePageUrl = directDetail?.source?.pageUrl || directSources.find((source) => source.pageUrl)?.pageUrl || payload.noticePages?.[code] || "";
  const noticePageLink = noticePageUrl ? safeSourceLink({ url: noticePageUrl, kind: "notice-index" }, "基金公告页", true) : `<span class="muted">未配置</span>`;
  const latestNoticeLinks = directSources.map((source) => safeSourceLink(source, "最新额度公告", true)).join("");
  const noticeSourcesSection = `<section class="card"><h2>公告与额度来源</h2><div class="source-group"><span class="source-kind">基金公告页</span>${noticePageLink}</div><div class="source-group"><span class="source-kind">最新额度公告/文档</span>${latestNoticeLinks || `<span class="muted">暂无可信公告</span>`}</div></section>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(fund.fundName)} ${escapeHtml(code)}｜申购额度与费率</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(fund.fundName)} ${escapeHtml(code)}｜申购额度与费率"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(baseUrl.replace(/\/$/, "/og.png"))}"><script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "Dataset", name: `${fund.fundName}申购额度与费率`, description, url, identifier: code, dateModified: payload.observedAt, isPartOf: { "@type": "WebSite", name: "QDII Monitor", url: baseUrl } })}</script><style>${DETAIL_CSS}</style>${analyticsSnippet()}</head><body><main class="page"><a class="back" href="../../">← 返回基金列表</a><p class="crumb">QDII Monitor / ${escapeHtml(indexLabel)} / ${escapeHtml(code)}</p><section class="hero"><span class="code">${escapeHtml(code)}</span><h1>${escapeHtml(fund.fundName)}</h1><p>${escapeHtml(fund.manager)} · <span class="strategy-badge strategy-${escapeHtml(fund.strategy || "unknown")}">${escapeHtml(fundStrategy)}</span>基金 · 更新时间 ${escapeHtml(observed)}</p><div class="metric"><div><strong>${escapeHtml(amountLabel(direct))}</strong><span>最高可信直销额度</span></div><div><strong>${escapeHtml(amountLabel(agency))}</strong><span>代销额度</span></div><div class="fee-metric"><strong class="fee fee-${band.key}">${escapeHtml(feeLabel(fee?.annualRate))}</strong><span>年综合费率 · ${escapeHtml(band.label)}</span></div></div>${detailActions ? `<div class="sales-actions" aria-label="基金销售网站入口">${detailActions}</div>` : ""}</section>${noticeSourcesSection}<section class="card"><h2>渠道与证据</h2><div class="table-wrap"><table><thead><tr><th>关系</th><th>入口</th><th>状态</th><th>每日额度</th><th>可靠性 / 来源</th></tr></thead><tbody>${channelRows}</tbody></table></div></section><section class="card"><h2>费率拆分</h2>${fee ? `<p class="fee fee-${band.key}">年综合费率 ${escapeHtml(feeLabel(fee.annualRate))}（${escapeHtml(band.label)}）</p><p class="muted">管理费 ${escapeHtml(feeLabel(fee.managementRate))} + 托管费 ${escapeHtml(feeLabel(fee.custodyRate))} + 销售服务费 ${escapeHtml(feeLabel(fee.salesServiceRate))}</p>${safeSourceLink(fee.source, "查看费率来源")}` : `<p>费率待核验。</p>`}</section><p class="muted">综合费率为年度运作费用合计，不包含因渠道、金额和持有期不同而变化的申购费、赎回费。数据仅供核验，不构成投资建议。</p></main></body></html>`;
}

function renderFundHtml(payload, code, baseUrl = "https://tanghuaizhe.github.io/qdii-direct-monitor/") {
  const html = renderFundHtmlWithoutHoldings(payload, code, baseUrl);
  if (!html) return null;
  const holding = (payload.holdings || []).find((item) => item.fundCode === code);
  return html.replace(
    `<section class="card"><h2>渠道与证据</h2>`,
    `${holdingsSectionHtml(holding)}<section class="card"><h2>渠道与证据</h2>`
  ).replace("年综合费率及来源。", "年综合费率、十大持仓及来源。").replace(
    "</style>",
    `.holdings-table{min-width:0}.holdings-table td:nth-child(1){width:58px}.holdings-table td:nth-child(5),.holdings-table th:nth-child(5){text-align:right;white-space:nowrap}@media(max-width:650px){.holdings-table th:nth-child(4),.holdings-table td:nth-child(4){display:none}.holdings-table th,.holdings-table td{padding-left:6px;padding-right:6px}}</style>`
  );
}

function missingDirectFunds(funds) {
  return funds.filter(([, rows]) => {
    const direct = (rows || []).filter((row) => row.channel?.kind === "direct");
    return !direct.some((row) => row.reliability?.grade !== "D");
  });
}

function missingDataSectionHtml(funds) {
  const missing = missingDirectFunds(funds);
  if (!missing.length) return "";
  const items = missing.map(([code, rows]) => {
    const fund = rows[0];
    const direct = bestChannel(rows, "direct");
    const reason = direct ? reliabilityReasonLabel(direct.reliability?.reason) : "尚未配置可解析的官方直销数据源";
    return `<li class="missing-item"><div class="missing-fund"><a href="funds/${escapeHtml(code)}/">${escapeHtml(fund.fundName)}</a><span>${escapeHtml(code)} · ${escapeHtml(fund.manager)} · ${escapeHtml(fund.shareClass || "其他")} 类</span></div><div class="missing-meta"><span class="channel-status status-unknown">${escapeHtml(direct ? statusLabel(direct.status) : "暂无数据")}</span><span>${escapeHtml(direct ? channelLabel(direct.channel) : "直销")}</span><span class="grade grade-D">D</span></div><p class="missing-reason">原因：${escapeHtml(reason)}</p><div class="missing-actions">${safeSourceLink(direct?.source)}${salesDetailLink(direct)}</div></li>`;
  }).join("");
  return `<details class="missing-section" id="missing-data"><summary>直销数据未抓取到的基金（${missing.length} 只）</summary><p class="missing-intro">这些基金没有可信的直销观察，状态未知，不代表开放申购；可逐只排查数据源或解析规则。</p><ul class="missing-list">${items}</ul></details>`;
}

function noticeHealthSectionHtml(noticeHealth) {
  const issues = (noticeHealth?.timelines || []).filter((item) => item.status === "stale" || item.status === "unavailable");
  if (!issues.length) return "";
  const items = issues.map((item) => {
    const detail = item.status === "unavailable" ? "公告索引不可用" : "发现到更新公告，但未安全解析";
    const latest = item.latestRelevantNotice ? `（最新公告 ${escapeHtml(item.latestRelevantNotice)}）` : "";
    return `<li><strong>${escapeHtml(item.fundCode)}</strong> ${escapeHtml(item.adapter)}：${detail}${latest}</li>`;
  }).join("");
  return `<details class="notice" id="notice-health"><summary>公告发现异常（${issues.length}）</summary><ul>${items}</ul></details>`;
}

function renderHtml(payload) {
  const grouped = new Map();
  for (const row of payload.rows || []) {
    if (!grouped.has(row.fundCode)) grouped.set(row.fundCode, []);
    grouped.get(row.fundCode).push(row);
  }
  const feeByFund = new Map<string, any>((payload.fees || []).map((fee) => [fee.fundCode, fee]));
  const funds = [...grouped.entries()];
  const shareClasses = [...new Set(funds.map(([, rows]) => rows[0].shareClass || "其他"))].sort();
  const strategies = [...new Set(funds.map(([, rows]) => rows[0].strategy || "unknown"))].sort();
  const statuses = funds.map(([, rows]) => aggregateStatus(rows));
  const total = grouped.size;
  const purchasable = statuses.filter((status) => status === "open" || status === "limited").length;
  const suspended = statuses.filter((status) => status === "suspended").length;
  const feeKnown = [...feeByFund.values()].filter((fee) => Number.isFinite(fee.annualRate)).length;
  const observed = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(payload.observedAt));
  const repositoryLinks = deploymentLinks(payload);
  const warnings = (payload.warnings || []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const changes = (payload.changes || []).map((change) => {
    const row = change.after || change.before;
    return `<li><strong>${escapeHtml(row?.fundCode || "")}</strong> ${escapeHtml(row?.fundName || "")}：${escapeHtml(changeDescription(change))}</li>`;
  }).join("");
  const sortOptions = `<option value="amount">额度从高到低</option><option value="fee">综合费率从低到高</option><option value="name">基金名称</option>`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QDII 申购额度与费率</title><meta name="description" content="国内纳斯达克 100 QDII 基金申购额度与综合费率，直销优先、代销补充。">
<meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:title" content="QDII 申购额度与费率"><meta property="og:description" content="纳斯达克 100 · 直销优先 · 综合费率比较"><meta property="og:url" content="https://tanghuaizhe.github.io/qdii-direct-monitor/"><meta property="og:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="QDII 申购额度与费率"><meta name="twitter:description" content="纳斯达克 100 · 直销优先 · 综合费率比较"><meta name="twitter:image" content="https://tanghuaizhe.github.io/qdii-direct-monitor/og.png">
<link rel="canonical" href="https://tanghuaizhe.github.io/qdii-direct-monitor/"><script type="application/ld+json">${jsonLd({ "@context": "https://schema.org", "@type": "ItemList", name: "纳斯达克100 QDII基金申购额度与费率", numberOfItems: funds.length, itemListElement: funds.map(([code, rows], index) => ({ "@type": "ListItem", position: index + 1, name: rows[0].fundName, url: `https://tanghuaizhe.github.io/qdii-direct-monitor/funds/${code}/` })) })}</script>
<style>
:root{color-scheme:light;--ink:#1d2026;--ink-soft:#3f434b;--muted:#5c5f66;--faint:#8a8d94;--line:#e4e5e9;--line-strong:#d3d5db;--paper:#f4f5f7;--card:#fff;--primary:#b4232f;--primary-deep:#781322;--primary-soft:#f8e8eb;--green:#0f6b4a;--green-soft:#e5f5ed;--amber:#8a5a00;--amber-soft:#fff3d6;--red:#9e2b32;--red-soft:#fdeaea;--slate:#414751;--slate-soft:#eef0f3;--radius:14px;--radius-sm:9px;--shadow:0 8px 28px #1d20260f}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}a{color:var(--primary)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--primary);outline-offset:2px;border-radius:4px}.shell{width:min(1200px,calc(100% - 32px));margin:0 auto 56px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.skip-link{position:absolute;left:12px;top:-48px;z-index:20;padding:10px 14px;border-radius:8px;background:var(--primary);color:#fff;font-size:13px;text-decoration:none}.skip-link:focus{top:12px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:68px;padding:10px 0}.brand{display:flex;align-items:center;gap:10px;color:var(--ink)}.brand-symbol{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--primary);color:#fff;font:900 16px/1 "Arial Narrow","Avenir Next Condensed",sans-serif}.brand-name{font-size:14px;font-weight:800;line-height:1.1}.brand-name small{display:block;margin-top:4px;color:var(--muted);font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.topbar-actions{display:flex;align-items:center;gap:10px}.updated{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.commit-link{color:var(--muted);font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none}.commit-link:hover{color:var(--primary)}.commit-link code{font:inherit}.github-link{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--line-strong);border-radius:9px;color:var(--ink);background:#fff;text-decoration:none}.github-link:hover{border-color:var(--primary);color:var(--primary)}.github-link svg{width:17px;height:17px}.refresh-button{min-height:34px;padding:0 12px;border:1px solid var(--primary);border-radius:9px;background:transparent;color:var(--primary);font:700 13px/1 inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease}.refresh-button:hover{background:var(--primary);color:#fff}
.masthead{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:24px;align-items:center;padding:20px 24px;border-radius:16px;background:var(--primary-deep);color:#fff;box-shadow:0 14px 40px #7813221f}.masthead-copy{min-width:0}.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid #ffffff30;border-radius:999px;background:#ffffff1a;color:#fff;font-size:12px;font-weight:600;letter-spacing:.02em}.live-dot{width:7px;height:7px;border-radius:50%;background:#ff8a96}.masthead h1{margin:14px 0 10px;font-size:clamp(26px,3.4vw,38px);font-weight:900;line-height:1.12;letter-spacing:-.02em}.masthead h1 em{color:#ffc4cb;font-style:normal}.masthead p{margin:0;max-width:52ch;color:#f0dadd;font-size:13px;line-height:1.65}.snapshot{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;border:1px solid #ffffff26;border-radius:12px;background:#ffffff26;overflow:hidden}.snapshot>div{background:var(--primary-deep);padding:14px 16px}.snapshot dt{color:#f0dadd;font-size:12px;line-height:1.3}.snapshot dd{margin:5px 0 0;color:#fff;font:800 26px/1 "Avenir Next","PingFang SC",sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.snapshot dd small{font-size:13px;font-weight:700;color:#f0dadd}.masthead-time{display:none}
.buy-summary{margin:14px 0;padding:14px 18px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}.summary-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px;margin-bottom:12px}.summary-head h2{margin:0;font-size:16px;letter-spacing:-.01em}.summary-head p{margin:0;color:var(--muted);font-size:12px}.summary-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}.summary-fund{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fdfdfe}.summary-rank{flex:0 0 22px;display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--primary-soft);color:var(--primary);font:800 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.summary-body{min-width:0}.summary-name{display:block;color:var(--ink);font-size:13px;font-weight:700;line-height:1.35;text-decoration:underline;text-decoration-color:#c9ccd3;text-decoration-thickness:1px;text-underline-offset:2px}.summary-name:hover{color:var(--primary);text-decoration-color:currentColor}.summary-amount{display:block;margin-top:4px;font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em}.summary-amount small{font-size:12px;font-weight:600;color:var(--muted)}.summary-amount.is-muted{font-size:16px;color:var(--muted)}.summary-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:4px;color:var(--muted);font-size:12px}.fee-text-low{color:var(--green);font-weight:700}.fee-text-normal{color:var(--amber);font-weight:700}.fee-text-high{color:var(--red);font-weight:700}
.notices{display:grid;gap:8px;margin:0 0 18px}.notice{margin:0;padding:10px 14px;border:1px solid #efe3bf;border-radius:10px;background:#fffbf0}.notice>summary{cursor:pointer;font-size:13px;font-weight:650;color:var(--ink)}.notice ul{margin:8px 0 2px;padding-left:20px;font-size:13px;line-height:1.7}.notice li+li{margin-top:2px}
.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}#fund-list{scroll-margin-top:8px}.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:14px 18px 10px}.panel-head h2{margin:0;font-size:18px;letter-spacing:-.01em}.panel-head p{margin:4px 0 0;max-width:72ch;color:var(--muted);font-size:12px;line-height:1.55}.result-count{color:var(--primary);font-size:12px;font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}.filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 16px;padding:0 18px 12px;border-bottom:1px solid var(--line)}.search{position:relative;flex:1 1 240px;min-width:200px}.search input{width:100%;height:40px;padding:0 12px 0 36px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:#fff;color:var(--ink);font:inherit;font-size:14px}.search input::placeholder{color:#6f7278}.search:before{content:"";position:absolute;left:12px;top:11px;width:14px;height:14px;border:2px solid var(--muted);border-radius:50%}.search:after{content:"";position:absolute;left:23px;top:24px;width:7px;height:2px;border-radius:2px;background:var(--muted);transform:rotate(45deg)}.filter-group{display:flex;flex-direction:column;gap:5px}.filter-label{color:var(--muted);font-size:12px;font-weight:600;line-height:1}.chips{display:flex;gap:6px}.filter-button{min-height:34px;padding:0 12px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:#fff;color:var(--ink-soft);font:600 13px/1 inherit;white-space:nowrap;cursor:pointer}.filter-button:hover{border-color:var(--primary);color:var(--primary)}.filter-button.active{background:var(--primary);border-color:var(--primary);color:#fff}.filter-button.active:hover{color:#fff}.toggle{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:#fff;color:var(--ink-soft);font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}.toggle input{width:15px;height:15px;accent-color:var(--primary)}.sort-label{display:flex;flex-direction:column;gap:5px}.sort{height:34px;padding:0 10px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:#fff;color:var(--ink);font:inherit;font-size:13px;cursor:pointer}
.table-wrap{overflow:visible}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:9px 14px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line)}thead th{position:sticky;top:0;z-index:2;padding:9px 14px;border-bottom:1px solid var(--line-strong);background:#fff;color:var(--muted);font-size:12px;font-weight:650;box-shadow:0 2px 6px #1d20260d}thead th:first-child{width:36%}thead th:nth-child(2),thead th:nth-child(3){width:22%}thead th:nth-child(4){width:20%}.column-sort{display:inline-flex;align-items:center;gap:4px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.column-sort:hover{color:var(--primary)}.column-sort span{font-size:11px;color:var(--faint)}.column-sort.active span{color:var(--primary)}tbody tr{transition:background-color .12s ease}tbody tr:hover{background:#fbf7f7}.fund-cell{display:flex;align-items:center;gap:10px;min-width:0}.fund-body{flex:1 1 auto}.fund-body{min-width:0}.index-chip{flex:0 0 34px;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--primary-soft);color:var(--ink);font:800 17px/1 "Avenir Next","PingFang SC",sans-serif}.manager-tone-0{background:#f8e4e7;color:#8e1c2c}.manager-tone-1{background:#f7ecd8;color:#76501a}.manager-tone-2{background:#e2f0ea;color:#226149}.manager-tone-3{background:#e3edf7;color:#2f5f8a}.manager-tone-4{background:#ede7f5;color:#5e467e}.manager-tone-5{background:#f7e6df;color:#8a4933}.fund-link{color:var(--ink);font-size:15px;font-weight:700;line-height:1.4;text-decoration:underline;text-decoration-color:#c9ccd3;text-decoration-thickness:1px;text-underline-offset:3px}.fund-link:hover{color:var(--primary);text-decoration-color:currentColor}.fund-meta{display:block;margin-top:3px;overflow:hidden;color:var(--muted);font-size:12px;line-height:1.45;text-overflow:ellipsis;white-space:nowrap}.strategy-badge{display:inline-block;margin:0 2px;padding:1px 6px;border-radius:999px;font-size:12px;font-weight:700;line-height:1.4;white-space:nowrap}.strategy-active{background:#fff0d6;color:#9a5700;border:1px solid #f0cd8f}.strategy-passive{background:#e5f0ff;color:#1d5f9d;border:1px solid #bdd7f2}.strategy-unknown{background:#eef0ee;color:#667068;border:1px solid #d9ddda}
.channel-cell{min-width:0}.channel-kind{display:none}.channel-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.channel-status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:650;white-space:nowrap}.status-open{background:var(--green-soft);color:var(--green)}.status-limited{background:var(--amber-soft);color:var(--amber)}.status-suspended,.status-unavailable{background:var(--red-soft);color:var(--red)}.status-unknown{background:var(--slate-soft);color:var(--slate);border:1px dashed #9aa0a8}.amount{font-size:15px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.01em;white-space:nowrap}.amount small{margin-left:2px;color:var(--muted);font-size:12px;font-weight:600}.amount.is-muted{color:var(--muted);font-weight:650}.channel-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;color:var(--muted);font-size:12px;line-height:1.4}.channel-name{color:var(--ink-soft);font-weight:600}.grade{display:inline-block;min-width:20px;padding:1px 6px;border-radius:999px;font-size:12px;font-weight:700;line-height:1.35;text-align:center}.grade-A{background:var(--green-soft);color:var(--green)}.grade-B{background:#eaf2fb;color:#2b66a0}.grade-C{background:#fff;color:var(--amber);border:1px solid #d9b46a}.grade-D{background:#fff;color:var(--slate);border:1px solid #b9bec6}.sales-link{display:inline-flex;align-items:center;min-height:22px;color:var(--ink-soft);font-size:12px;font-weight:650;text-decoration:none;white-space:nowrap}.sales-link:hover{color:var(--primary);text-decoration:underline;text-underline-offset:2px}.sales-link span{margin-left:2px}.channel-cell.is-empty .channel-status{margin-top:2px}
.fee-cell{min-width:0}.fee-kind{display:none}.fee-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.fee-rate{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em}.fee-tag{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--slate-soft);color:var(--slate);font-size:12px;font-weight:650;white-space:nowrap}.fee-split{margin-top:4px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.fee-low .fee-rate{color:var(--green)}.fee-low .fee-tag{background:var(--green-soft);color:var(--green)}.fee-normal .fee-rate{color:var(--amber)}.fee-normal .fee-tag{background:var(--amber-soft);color:var(--amber)}.fee-high .fee-rate{color:var(--red)}.fee-high .fee-tag{background:var(--red-soft);color:var(--red)}.fee-cell.unknown .fee-rate,.fee-cell.unknown .fee-split{color:var(--muted)}
.evidence-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:8px;color:var(--muted);font-size:12px}.evidence-legend span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.evidence-legend .grade{min-width:18px;padding:0 5px}.refresh-button{white-space:nowrap}.masthead h1 em{white-space:nowrap}.empty{display:none;padding:36px 20px;color:var(--muted);font-size:14px;text-align:center}.empty p{margin:0 0 12px}.method{margin:16px 0 0;padding:14px 18px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--muted);font-size:12px;line-height:1.8}.method strong{color:var(--ink)}.footer{margin:22px 0 0;color:var(--muted);font-size:12px;line-height:1.7;text-align:center}
.missing-section{margin:16px 0 0;padding:0 18px;border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:10px;background:#fff}.missing-section>summary{padding:14px 0;color:var(--ink);font-size:13px;font-weight:750;cursor:pointer}.missing-section[open]>summary{margin-bottom:12px;border-bottom:1px solid var(--line)}.missing-intro{margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.6}.missing-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin:0;padding:0 0 16px;list-style:none}.missing-item{padding:12px 14px;border:1px solid var(--line);border-radius:9px;background:#fdfdfe}.missing-fund a{color:var(--primary);font-weight:750;text-decoration:none}.missing-fund a:hover{text-decoration:underline}.missing-fund span{display:block;margin-top:3px;color:var(--muted);font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.missing-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}.missing-reason{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.6}.missing-actions{display:flex;flex-wrap:wrap;gap:8px}
@media(max-width:900px){.masthead{grid-template-columns:1fr;gap:20px;padding:22px}.snapshot{grid-template-columns:repeat(4,minmax(0,1fr))}.snapshot>div{padding:10px 12px}.snapshot dd{font-size:22px}.summary-list{grid-template-columns:repeat(2,minmax(0,1fr))}.panel-head{align-items:flex-start}}
@media(max-width:900px){.table-wrap{overflow:visible}table,tbody,tr,td{display:block;width:auto}thead{display:none}table{table-layout:auto}tbody td{width:auto}tbody tr{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:14px;border-bottom:1px solid var(--line)}tbody tr:last-child{border-bottom:0}td{padding:0;border-bottom:0}.fund-column{grid-column:1/-1;padding-bottom:12px;border-bottom:1px solid var(--line)}.fund-cell{gap:9px}.fund-meta{white-space:normal}.channel-cell,.fee-cell{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfbfc}.channel-cell{border-left-width:3px}.channel-agency{border-left-color:#9aa0a8}.channel-direct{border-left-color:var(--primary)}.channel-kind{display:block;margin-bottom:6px;color:var(--muted);font-size:12px;font-weight:650}.channel-direct .channel-kind{color:var(--primary)}.channel-top{align-items:baseline;gap:6px}.channel-name{display:none}.amount{font-size:16px}.channel-meta{margin-top:4px}.sales-link{min-height:26px}.fee-cell{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.fee-kind{display:inline;color:var(--muted);font-size:12px;font-weight:650}.fee-top{flex:0 0 auto}.fee-split{flex:1 1 auto;margin-top:0;text-align:left}}@media(max-width:760px){html,body{overflow-x:clip}.shell{width:min(100% - 20px,1200px)}.topbar{min-height:60px}.updated,.commit-link{display:none}.masthead{padding:16px 18px;border-radius:14px}.masthead h1{margin:10px 0 8px}.buy-summary{margin:12px 0;padding:12px 14px 14px}.panel-head{padding:14px 16px 10px}.filters{padding:0 16px 10px}tbody tr{padding:12px}.masthead h1{font-size:28px}.snapshot{grid-template-columns:repeat(4,minmax(0,1fr))}.snapshot>div{padding:8px 9px}.snapshot dt{font-size:12px;line-height:1.25}.snapshot dd{font-size:18px}.snapshot dd small{font-size:11px}.summary-head p{display:none}.summary-fund{padding:10px}.summary-list{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(230px,1fr);grid-template-columns:none;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x proximity}.summary-fund{scroll-snap-align:start}.filters{gap:10px}.filter-group{width:auto;flex:1 1 45%;min-width:0}.filter-group .chips{flex-wrap:nowrap}.filter-group .chips{overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.filter-group .chips::-webkit-scrollbar{display:none}.toggle,.sort-label{flex:1 1 46%}.sort-label .filter-label{display:none}.sort{width:100%}.search input{font-size:16px}.sort{font-size:16px}.filter-button{min-height:38px}.toggle{min-height:38px}.masthead-time{display:block;margin-top:10px;color:#f0dadd;font-size:12px;font-variant-numeric:tabular-nums}.method{font-size:12px}}
@media(max-width:360px){tbody tr{grid-template-columns:1fr}.fee-split{text-align:left}.brand-name small{display:none}.refresh-button{padding:0 10px}.topbar-actions{gap:6px}.brand-symbol{width:30px;height:30px}.topbar{flex-wrap:wrap;row-gap:8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}tbody tr,.refresh-button{transition:none}}
${ONSITE_SECTION_CSS}</style>${analyticsSnippet()}</head><body><a class="skip-link" href="#fund-list">跳到基金列表</a><main class="shell">
<header class="topbar"><span class="brand"><span class="brand-symbol" aria-hidden="true">Q</span><span class="brand-name">QDII 额度监控<small>DIRECT MONITOR</small></span></span><div class="topbar-actions"><span class="updated">更新于 <time datetime="${escapeHtml(payload.observedAt)}">${escapeHtml(observed)}</time></span>${repositoryLinks}<button id="refresh-page" class="refresh-button" type="button" aria-label="刷新页面数据">↻ 刷新数据</button></div></header>
<section class="masthead"><div class="masthead-copy"><span class="eyebrow"><i class="live-dot" aria-hidden="true"></i>NASDAQ 100 · 场外份额监控</span><h1>QDII 申购额度 <em>一眼看清</em></h1><p>直销优先、代销补充，不同渠道额度不相加；每条状态都绑定来源与 A–D 证据等级，未知状态不代表可申购；公告与公开页不等于登录后下单验证。</p><p class="masthead-time">更新于 <time datetime="${escapeHtml(payload.observedAt)}">${escapeHtml(observed)}</time></p></div><dl class="snapshot" aria-label="最新快照"><div><dt>基金份额</dt><dd>${total}</dd></div><div><dt>当前可申购</dt><dd>${purchasable}</dd></div><div><dt>暂停申购</dt><dd>${suspended}</dd></div><div><dt>综合费率已识别</dt><dd>${feeKnown}<small>/${total}</small></dd></div></dl></section>
${purchaseSummaryHtml(payload.rows || [], payload.fees || [])}
${onsiteSectionHtml(payload)}
<div class="notices">${warnings ? `<details class="notice"><summary>抓取提示（${(payload.warnings || []).length}）</summary><ul>${warnings}</ul></details>` : ""}${noticeHealthSectionHtml(payload.noticeHealth)}${changes ? `<details class="notice"><summary>本次申购状态与额度变化（${(payload.changes || []).length}）</summary><ul>${changes}</ul></details>` : ""}</div>
<section class="panel" id="fund-list"><div class="panel-head"><div><h2>基金列表</h2><p>直销、代销横向比较；未知状态不代表可申购；来源与证据见各基金详情页。</p><div class="evidence-legend" aria-label="证据等级说明"><span><b class="grade grade-A">A</b>官方产品/状态页</span><span><b class="grade grade-B">B</b>官方公告或公开代销页</span><span><b class="grade grade-C">C</b>人工核验，限时有效</span><span><b class="grade grade-D">D</b>无法核验</span></div></div><span class="result-count" role="status" aria-live="polite"><b id="visible-count">${total}</b> 只</span></div>
<div class="filters"><label class="search"><span class="sr-only">搜索基金</span><input id="fund-search" type="search" placeholder="搜索名称、代码、公司或拼音" aria-label="搜索基金名称、代码、公司或拼音"></label><div class="filter-group" role="group" aria-label="按策略筛选"><span class="filter-label">策略</span><div class="chips"><button class="filter-button active" type="button" data-strategy-filter="全部" aria-pressed="true">全部</button>${strategies.map((strategy) => `<button class="filter-button" type="button" data-strategy-filter="${escapeHtml(strategy)}" aria-pressed="false">${escapeHtml(strategyLabel(strategy))}</button>`).join("")}</div></div><div class="filter-group" role="group" aria-label="按份额类别筛选"><span class="filter-label">份额</span><div class="chips"><button class="filter-button active" type="button" data-share-filter="全部" aria-pressed="true">全部</button>${shareClasses.map((share) => `<button class="filter-button" type="button" data-share-filter="${escapeHtml(share)}" aria-pressed="false">${escapeHtml(share)} 类</button>`).join("")}</div></div><label class="toggle"><input id="purchasable-only" type="checkbox">仅看可购买</label><label class="sort-label"><span class="filter-label">排序</span><select id="fund-sort" class="sort" aria-label="排序方式">${sortOptions}</select></label></div>
<div class="table-wrap"><table><caption class="sr-only">基金列表：代销与直销渠道分开核验，额度不相加；A/B/C/D 表示证据可靠性，不代表投资风险；未知状态不可视为开放申购。</caption><thead><tr><th scope="col">基金</th><th scope="col" aria-sort="none"><button class="column-sort" type="button" data-column-sort="direct" aria-label="按直销渠道每日额度排序">直销渠道 <span aria-hidden="true">↕</span></button></th><th scope="col" aria-sort="none"><button class="column-sort" type="button" data-column-sort="agency" aria-label="按代销渠道每日额度排序">代销渠道 <span aria-hidden="true">↕</span></button></th><th scope="col" aria-sort="none"><button class="column-sort" type="button" data-column-sort="fee" aria-label="按年综合费率排序">年综合费率 <span class="sr-only">（管理费＋托管费＋销售服务费）</span><span aria-hidden="true">↕</span></button></th></tr></thead><tbody id="fund-body">${funds.map(([code, rows]) => fundTableRow(code, rows, feeByFund.get(code))).join("")}</tbody></table><div id="empty" class="empty" role="status"><p>没有符合当前条件的基金</p><button id="clear-filters" class="filter-button" type="button">清除筛选</button></div></div></section>
<p class="method"><strong>综合费率口径：</strong>管理费率＋托管费率＋销售服务费率，均为按年计提；<span class="fee-text-low">≤0.80% 为低费率</span>，<span class="fee-text-normal">&gt;0.80% 且 ≤1.00% 为正常</span>，<span class="fee-text-high">&gt;1.00% 为高费率</span>。基金净值通常已扣除这些费用。申购费和赎回费受渠道折扣、金额及持有期影响，不并入本列。不同基金份额或渠道额度不得相加；费率与额度来源及证据见各基金详情页。</p>
${missingDataSectionHtml(funds)}
<p class="footer">A/B/C/D 表示证据可靠性，不代表投资风险等级。未知状态不可视为开放申购，公告也不等于登录后下单验证。数据仅供核验，不构成投资建议。</p>
</main><script>
(() => {
  const refreshButton = document.getElementById("refresh-page");
  if (refreshButton) refreshButton.addEventListener("click", () => window.location.reload());
  const body = document.getElementById("fund-body"); const rows = [...body.querySelectorAll(".fund-row")]; const search = document.getElementById("fund-search"); const purchasable = document.getElementById("purchasable-only"); const sort = document.getElementById("fund-sort"); const count = document.getElementById("visible-count"); const empty = document.getElementById("empty"); const clearFilters = document.getElementById("clear-filters"); const columnButtons = [...document.querySelectorAll("[data-column-sort]")]; const strategyButtons = [...document.querySelectorAll("[data-strategy-filter]")]; const shareButtons = [...document.querySelectorAll("[data-share-filter]")]; let share = "全部"; let strategy = "全部"; let columnSort = null;
  function nullableNumber(value) { const number = Number(value); return Number.isFinite(number) && value !== "" ? number : null; }
  function compareNullableValues(left, right, direction) { if (left === null && right !== null) return 1; if (left !== null && right === null) return -1; if (left !== null && right !== null && left !== right) return (left - right) * direction; return 0; }
  function compareColumnRows(left, right) { const key = columnSort.key === "fee" ? "fee" : \`\${columnSort.key}Amount\`; const leftValue = nullableNumber(left.dataset[key]); const rightValue = nullableNumber(right.dataset[key]); if (leftValue === null && rightValue !== null) return 1; if (leftValue !== null && rightValue === null) return -1; if (leftValue !== null && rightValue !== null && leftValue !== rightValue) return (leftValue - rightValue) * columnSort.direction; return left.dataset.search.localeCompare(right.dataset.search, "zh-CN"); }
  function syncPressed(buttons, key) { buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[key] === (key === "strategyFilter" ? strategy : share)))); }
  function syncColumnButtons() { columnButtons.forEach((button) => { const key = button.dataset.columnSort; const active = columnSort?.key === key; button.classList.toggle("active", active); button.querySelector("span").textContent = active ? (columnSort.direction === 1 ? "↑" : "↓") : "↕"; const th = button.closest("th"); if (th) th.setAttribute("aria-sort", active ? (columnSort.direction === 1 ? "ascending" : "descending") : "none"); }); }
  function refresh() { const query = search.value.trim().toLowerCase().replace(/[^a-z0-9\\u3400-\\u9fff]+/g, ""); const visible = rows.filter((row) => (!query || row.dataset.search.includes(query)) && (share === "全部" || row.dataset.share === share) && (strategy === "全部" || row.dataset.strategy === strategy) && (!purchasable.checked || row.dataset.purchasable === "1")); const key = sort.value; visible.sort((a, b) => columnSort ? compareColumnRows(a, b) : key === "fee" ? compareNullableValues(nullableNumber(a.dataset.fee), nullableNumber(b.dataset.fee), 1) || a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : key === "name" ? a.dataset.search.localeCompare(b.dataset.search, "zh-CN") : Number(b.dataset.amount) - Number(a.dataset.amount) || Number(a.dataset.fee || 0) - Number(b.dataset.fee || 0)); const visibleSet = new Set(visible); rows.forEach((row) => { row.hidden = !visibleSet.has(row); }); visible.forEach((row) => body.appendChild(row)); count.textContent = String(visible.length); empty.style.display = visible.length ? "none" : "block"; }
  columnButtons.forEach((button) => button.addEventListener("click", () => { const key = button.dataset.columnSort; if (columnSort?.key !== key) columnSort = { key, direction: 1 }; else if (columnSort.direction === 1) columnSort = { key, direction: -1 }; else { columnSort = null; sort.value = "amount"; } syncColumnButtons(); refresh(); }));
  strategyButtons.forEach((button) => button.addEventListener("click", () => { strategy = button.dataset.strategyFilter; syncPressed(strategyButtons, "strategyFilter"); refresh(); }));
  shareButtons.forEach((button) => button.addEventListener("click", () => { share = button.dataset.shareFilter; syncPressed(shareButtons, "shareFilter"); refresh(); }));
  search.addEventListener("input", refresh); purchasable.addEventListener("change", refresh); sort.addEventListener("change", () => { columnSort = null; syncColumnButtons(); refresh(); });
  clearFilters.addEventListener("click", () => { search.value = ""; share = "全部"; strategy = "全部"; purchasable.checked = false; sort.value = "amount"; columnSort = null; syncPressed(shareButtons, "shareFilter"); syncPressed(strategyButtons, "strategyFilter"); syncColumnButtons(); refresh(); });
  syncColumnButtons(); refresh();
})();
</script><script>${ONSITE_SCRIPT}</script></body></html>`;
}

module.exports = { aggregateStatus, amountLabel, analyticsSnippet, channelLabel, escapeHtml, feeBand, feeLabel, formatPremium, onsiteSectionHtml, purchaseSummaryHtml, rankPurchasableFunds, reliabilityReasonLabel, renderFundHtml, renderHtml, renderOnsiteFundHtml, statusLabel, strategyLabel };
