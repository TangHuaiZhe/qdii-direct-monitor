"use strict";

function marketLabel(item) {
  const symbol = String(item.xq_symbol || "").toUpperCase();
  if (symbol.startsWith("HK")) return "港股";
  if (symbol.startsWith("SH") || symbol.startsWith("SZ") || item.amarket === true) return "A股";
  return "美股";
}

function parseHoldingsPayload(value) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  const data = payload?.result_code === 0 ? payload.data : null;
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.source || "")) || !Array.isArray(data.stock_list)) return null;
  const items = data.stock_list.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    code: String(item.code || "").trim(),
    name: String(item.name || "").trim(),
    market: marketLabel(item),
    weight: Number(item.percent)
  }));
  if (!items.length || items.some((item) => !item.code || !item.name || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 100)) return null;
  return { asOf: data.source, items };
}

async function collectHoldings(plan, context) {
  const url = `https://danjuanapp.com/djapi/fundx/base/fund/record/asset/percent?fund_code=${encodeURIComponent(plan.sourceCode)}`;
  try {
    const resource = await context.fetchResource(url, { allowedHosts: ["danjuanapp.com", "danjuanfunds.com"], timeoutMs: context.timeoutMs });
    const parsed = parseHoldingsPayload(new TextDecoder("utf-8").decode(resource.bytes));
    if (!parsed) throw new Error("holdings payload was not safely parsed");
    return {
      portfolioCode: plan.portfolioCode,
      sourceCode: plan.sourceCode,
      exposure: plan.exposure,
      ...parsed,
      observedAt: context.observedAt,
      source: { url: resource.finalUrl, kind: "public-portfolio-page", adapter: "danjuan" },
      reliability: { grade: "B", reason: "current public portfolio page; holdings are a report-period snapshot, not real-time positions" }
    };
  } catch (error) {
    context.warnings.push(`${plan.portfolioCode} holdings: ${error.message}`);
    return {
      portfolioCode: plan.portfolioCode,
      sourceCode: plan.sourceCode,
      exposure: plan.exposure,
      asOf: null,
      items: [],
      observedAt: context.observedAt,
      source: { url, kind: "public-portfolio-page", adapter: "danjuan" },
      reliability: { grade: "D", reason: "holdings source unavailable or not parseable" }
    };
  }
}

module.exports = { collectHoldings, marketLabel, parseHoldingsPayload };
