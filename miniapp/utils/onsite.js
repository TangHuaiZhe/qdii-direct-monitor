"use strict";

const { buildSearchText, normalizeSearchQuery } = require("./pinyin");
const { reliabilityReasonLabel: baseReasonLabel, formatObservedAt } = require("./funds");

const INDEX_LABELS = { nasdaq100: "纳指100", sp500: "标普500" };
const REF_NAV_KIND_LABELS = { iopv: "IOPV参考净值", "reference-nav": "参考净值", "previous-nav": "前一日净值", nav: "单位净值" };
const SOURCE_KIND_LABELS = { "exchange-quote": "交易所行情", nav: "净值来源", "nav-history": "历史净值", iopv: "参考净值" };

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function indexLabel(index) {
  return INDEX_LABELS[index] || String(index || "未分类");
}

function exchangeLabel(exchange) {
  return { SSE: "上交所", SZSE: "深交所" }[exchange] || String(exchange || "—");
}

function refNavKindLabel(kind) {
  return REF_NAV_KIND_LABELS[kind] || "参考净值";
}

function formatSignedPct(value) {
  if (!isFiniteNumber(value)) return "待核验";
  const number = Number(value);
  return (number > 0 ? "+" : "") + number.toFixed(2) + "%";
}

function formatDashPct(value) {
  return isFiniteNumber(value) ? formatSignedPct(value) : "—";
}

function formatPrice(value, digits) {
  return isFiniteNumber(value) ? Number(value).toFixed(digits === undefined ? 3 : digits) : "—";
}

function formatTurnover(value) {
  if (!isFiniteNumber(value)) return "—";
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return (number / 100000000).toFixed(2) + " 亿";
  if (Math.abs(number) >= 10000) return (number / 10000).toFixed(2) + " 万";
  return String(number);
}

function premiumBand(value, thresholds) {
  const limits = thresholds || {};
  if (!isFiniteNumber(value)) return "unknown";
  const number = Number(value);
  if (isFiniteNumber(limits.p90) && number > Number(limits.p90)) return "high";
  if (isFiniteNumber(limits.p75) && number > Number(limits.p75)) return "elevated";
  if (isFiniteNumber(limits.p25) && number < Number(limits.p25)) return "discount";
  return "normal";
}

const BAND_LABELS = { high: "高溢价", elevated: "偏高", normal: "常态", discount: "折价区", unknown: "待核验" };

function premiumBandLabel(value, thresholds) {
  return BAND_LABELS[premiumBand(value, thresholds)] || "待核验";
}

function onsiteReasonLabel(reason) {
  const value = String(reason || "");
  const lower = value.toLowerCase();
  if (lower.includes("current exchange quote matched")) return "交易所官方行情与同日参考净值匹配，可校准";
  if (lower.includes("exchange reference nav cross-checked") || lower.includes("exchange quote matched with published")) return "交易所官方行情与已公布净值交叉校验一致";
  if (lower.includes("exchange quote is current")) return "交易所官方行情为当日收盘/最新成交";
  if (lower.includes("official reference nav unavailable")) return "交易所参考净值不可用，改用已公布单位净值作为分母";
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
  if (lower.includes("nav source unavailable") || lower.includes("nav missing")) return "净值来源当前不可用，无法计算可信溢价";
  return baseReasonLabel(reason) || "未提供可靠性说明";
}

function sourceHost(url) {
  const match = String(url || "").match(/^https?:\/\/([^/]+)/i);
  return match ? match[1] : "来源链接";
}

function decorateQuote(quote, thresholds) {
  const grade = quote.reliability?.grade || "D";
  const carriedForward = quote.carriedForward === true;
  const calibrated = isFiniteNumber(quote.premiumCalibratedPct) ? Number(quote.premiumCalibratedPct) : null;
  const live = isFiniteNumber(quote.premiumLivePct) ? Number(quote.premiumLivePct) : null;
  return {
    code: quote.code,
    name: quote.name || "—",
    manager: quote.manager || "",
    index: quote.index || "",
    indexLabel: indexLabel(quote.index),
    vehicle: quote.vehicle || "",
    vehicleLabel: quote.vehicle === "ETF" || quote.vehicle === "LOF" ? quote.vehicle : "—",
    exchangeLabel: exchangeLabel(quote.exchange),
    calibratedValue: calibrated,
    liveValue: live,
    calibratedLabel: formatSignedPct(quote.premiumCalibratedPct),
    calibratedBand: premiumBand(calibrated, thresholds),
    calibratedBandLabel: premiumBandLabel(calibrated, thresholds),
    calibratedDateLabel: quote.calibratedForDate ? "校准日 " + quote.calibratedForDate : "待净值公布",
    liveLabel: formatSignedPct(quote.premiumLivePct),
    liveBand: premiumBand(live, thresholds),
    liveBandLabel: premiumBandLabel(live, thresholds),
    priceLabel: formatPrice(quote.price),
    refNavLabel: formatPrice(quote.refNav, 4),
    refNavKindLabel: refNavKindLabel(quote.refNavKind),
    navDateLabel: quote.navDate || quote.refNavDate || "—",
    turnoverLabel: formatTurnover(quote.turnoverCny),
    grade,
    gradeClass: "grade-" + grade,
    trusted: grade !== "D",
    reliabilityReason: onsiteReasonLabel(quote.reliability?.reason),
    carriedForward,
    carriedForwardLabel: carriedForward ? "沿用上次可信值" : "",
    observedAtLabel: formatObservedAt(quote.observedAt),
    originalTimeLabel: carriedForward ? "原始时间 " + formatObservedAt(quote.observedAt) : "",
    linksOtcCode: quote.linksOtcCode || "",
    applyStatus: quote.applyStatus || "",
    sources: (Array.isArray(quote.sources) ? quote.sources : []).map((source) => ({
      url: source.url,
      kind: source.kind,
      kindLabel: SOURCE_KIND_LABELS[source.kind] || source.kind || "来源",
      adapter: source.adapter || "",
      host: sourceHost(source.url)
    })),
    searchText: buildSearchText(quote.name, quote.manager, quote.code, indexLabel(quote.index))
  };
}

function buildOnsiteQuotes(payload) {
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes.filter((quote) => quote && /^\d{6}$/.test(String(quote.code || ""))) : [];
  const thresholds = payload?.premiumSummary?.thresholds || {};
  const effective = (quote) => (quote.calibratedValue !== null ? quote.calibratedValue : quote.liveValue);
  return quotes.map((quote) => decorateQuote(quote, thresholds)).sort((left, right) => {
    const leftValue = effective(left);
    const rightValue = effective(right);
    const leftKnown = isFiniteNumber(leftValue);
    const rightKnown = isFiniteNumber(rightValue);
    if (!leftKnown && !rightKnown) return String(left.code).localeCompare(String(right.code));
    if (!leftKnown) return 1;
    if (!rightKnown) return -1;
    return leftValue - rightValue || String(left.code).localeCompare(String(right.code));
  });
}

/**
 * The page starts with the three listings whose premium is lowest (calibrated first,
 * falling back to the live figure), mirroring the web dashboard. D-grade and
 * carried-forward rows are not ranked here: they have no current premium to compare.
 */
function lowestPremiumQuotes(quotes, limit) {
  const count = isFiniteNumber(limit) ? Number(limit) : 3;
  const effective = (quote) => (quote.calibratedValue !== null ? quote.calibratedValue : quote.liveValue);
  return (quotes || [])
    .filter((quote) => quote && quote.trusted && !quote.carriedForward && isFiniteNumber(effective(quote)))
    .sort((left, right) => effective(left) - effective(right) || String(left.code).localeCompare(String(right.code)))
    .slice(0, Math.max(0, count));
}

function findOnsiteQuote(payload, code) {
  return buildOnsiteQuotes(payload).find((quote) => quote.code === String(code)) || null;
}

function onsiteSummary(payload) {
  const quotes = buildOnsiteQuotes(payload);
  const summary = payload?.premiumSummary || {};
  const thresholds = summary.thresholds || {};
  const trusted = quotes.filter((quote) => quote.trusted);
  const calibratedValues = trusted.map((quote) => quote.calibratedValue).filter((value) => value !== null);
  const highest = calibratedValues.length ? Math.max(...calibratedValues) : null;
  const highestQuote = highest === null ? null : trusted.find((quote) => quote.calibratedValue === highest) || null;
  const sortedValues = [...calibratedValues].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);
  const median = sortedValues.length
    ? (sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2)
    : null;
  const highPremiumPct = isFiniteNumber(thresholds.highPremiumPct) ? Number(thresholds.highPremiumPct) : 5;
  const highCount = Array.isArray(summary.highPremiumCodes)
    ? summary.highPremiumCodes.length
    : calibratedValues.filter((value) => value >= highPremiumPct).length;
  const exchangeHealth = payload?.health?.exchange;
  const degradedCodes = Array.isArray(exchangeHealth?.degradedCodes) ? exchangeHealth.degradedCodes : [];
  return {
    count: quotes.length,
    trustedCount: trusted.length,
    hasData: trusted.length > 0,
    calibratedForDateLabel: summary.calibratedForDate || "待净值公布",
    asOfLabel: formatObservedAt(summary.asOf || payload?.observedAt),
    highestLabel: formatDashPct(highest),
    highestNote: highestQuote ? highestQuote.code + " " + highestQuote.name : "暂无可校准数据",
    medianLabel: formatDashPct(median),
    calibratedCount: calibratedValues.length,
    highCount,
    highPremiumPct,
    degradedLabel: summary.degraded || 0,
    healthLabel: exchangeHealth
      ? "官方行情可用 " + (exchangeHealth.officialOk || 0) + " 只 · 降级 " + (exchangeHealth.fallback || 0) + " 只 · 失败 " + (exchangeHealth.failed || 0) + " 只"
      : "",
    degradedCodes
  };
}

function filterOnsiteQuotes(quotes, filters) {
  const query = normalizeSearchQuery(filters?.query);
  const index = filters?.index || "全部";
  return (quotes || []).filter((quote) =>
    (!query || quote.searchText.includes(query)) && (index === "全部" || quote.index === index)
  );
}

function onsiteIndexOptions(quotes) {
  return ["全部", ...new Set((quotes || []).map((quote) => quote.index).filter(Boolean))];
}

module.exports = {
  buildOnsiteQuotes,
  exchangeLabel,
  filterOnsiteQuotes,
  findOnsiteQuote,
  formatPrice,
  formatSignedPct,
  formatTurnover,
  indexLabel,
  lowestPremiumQuotes,
  onsiteIndexOptions,
  onsiteReasonLabel,
  onsiteSummary,
  premiumBand,
  premiumBandLabel,
  refNavKindLabel
};
