"use strict";

const { fetchResource } = require("./http");
const { focusText, parseAmount, parseStatus, resourceToText } = require("./parser");

async function collectEastmoney(fund, context) {
  const url = `https://fund.eastmoney.com/${fund.code}.html`;
  try {
    const resource = await context.fetchResource(url, { allowedHosts: ["eastmoney.com"], timeoutMs: context.timeoutMs });
    const fullText = await resourceToText(resource);
    const tradeIndex = fullText.indexOf("交易状态");
    const text = tradeIndex >= 0 ? fullText.slice(tradeIndex, tradeIndex + 500) : focusText(fullText, fund, 500);
    const amount = parseAmount(text);
    let status = parseStatus(text);
    if (status === "limited" && !amount) status = "unknown";
    return {
      fundCode: fund.code, fundName: fund.name, manager: fund.manager, currency: amount?.currency || fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, status, limitAmount: amount?.amount || null,
      observedAt: context.observedAt, source: { url: resource.finalUrl, kind: "public-sales-page", adapter: "eastmoney" },
      reliability: { grade: status === "unknown" ? "D" : "B", reason: status === "unknown" ? "public sales page shape was not safely parsed" : "current public agency sales page; logged-in order submission was not tested" },
      notes: status === "unknown" ? ["An unknown result is not evidence that purchases are open."] : []
    };
  } catch (error) {
    context.warnings.push(`${fund.code} eastmoney: ${error.message}`);
    return {
      fundCode: fund.code, fundName: fund.name, manager: fund.manager, currency: fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, status: "unknown", limitAmount: null,
      observedAt: context.observedAt, source: { url, kind: "public-sales-page", adapter: "eastmoney" },
      reliability: { grade: "D", reason: "agency source unavailable" }, notes: ["Retry later or verify in the distributor app."]
    };
  }
}

function collectManual(fund, observedAt, warnings) {
  const now = Date.parse(observedAt);
  return (fund.manualChannels || []).flatMap((item) => {
    const verified = Date.parse(item.verifiedAt || "");
    const expires = Date.parse(item.expiresAt || "");
    if (!Number.isFinite(verified) || !Number.isFinite(expires) || verified > now || expires <= now) {
      warnings.push(`${fund.code} ignored expired/invalid manual channel ${item.channel?.access || "unknown"}`);
      return [];
    }
    return [{ fundCode: fund.code, fundName: fund.name, manager: fund.manager, currency: item.currency || fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: item.channel, status: item.status, limitAmount: item.limitAmount ?? null, observedAt, source: { url: item.sourceUrl, kind: "manual-verification", adapter: "manual" },
      reliability: { grade: "C", reason: `manually verified at ${item.verifiedAt}; expires at ${item.expiresAt}` }, notes: item.notes || [] }];
  });
}

module.exports = { collectEastmoney, collectManual };
