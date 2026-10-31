"use strict";
const { createAdapter } = require("./base");
const { resourceToHtml } = require("../parser");

function parseInlineLimit(html) {
  const match = String(html || "").match(/limits:\s*(\{"buy":[\s\S]*?\}),\s*flags:/);
  if (!match) return null;
  let limits;
  try { limits = JSON.parse(match[1]); } catch { return null; }
  const buy = limits?.buy || {};
  const amount = Number(buy.accumulation ?? buy.high);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

const adapter = createAdapter({ id: "guotai", manager: "国泰基金", allowedHosts: ["gtfund.com"], defaultSource: (f) => `https://e.gtfund.com/etrade/Jijin/view/id/${f.code}` });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const rows = await collectBase(fund, context);
  try {
    const resource = await context.fetchResource(this.defaultSource(fund), { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const limitAmount = parseInlineLimit(resourceToHtml(resource));
    if (limitAmount) {
      rows.push({
        fundCode: fund.code, fundName: fund.name, manager: fund.manager, index: fund.index || "nasdaq100",
        strategy: fund.strategy || "unknown", currency: fund.currency || "CNY", shareClass: fund.shareClass || "",
        channel: { kind: "direct", access: "web" }, status: "limited", limitAmount,
        accountBasis: "single-fund-account-daily-cumulative", observedAt: context.observedAt, effectiveDate: null,
        salesUrl: this.salesUrl(fund),
        source: { url: resource.finalUrl, kind: "product", adapter: this.id },
        reliability: { grade: "A", reason: "current official product page explicitly identifies the channel" },
        notes: []
      });
    }
  } catch (error) {
    context.warnings.push(`${fund.code} guotai limits: ${error.message}`);
  }
  return rows;
};

module.exports = adapter;
module.exports.parseInlineLimit = parseInlineLimit;
