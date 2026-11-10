"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText, parseEffectiveDate } = require("../parser");

const API_URL = "https://www.nffund.com/nfwebApi/customer/subscriptionAndRedemptionStatus";

function parseStatusEntry(entry, fund) {
  const remark = normalizeExtractedText(entry?.remark || "");
  const sgStatus = String(entry?.sgStatus ?? "");
  const effectiveDate = parseEffectiveDate(remark);
  if (sgStatus !== "0" && sgStatus !== "1") return { status: "unknown", amount: null, effectiveDate };
  if (sgStatus === "0" || /暂停申购|暂不开放购买|不可购买/.test(remark)) return { status: "suspended", amount: null, effectiveDate };
  const amountMatch = remark.match(/(?:限额|限制金额|申购上限)\s*(?:调整)?为?\s*([\d,]+(?:\.\d+)?)\s*(万)?元/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) * (amountMatch[2] ? 10000 : 1) : null;
  if (Number.isFinite(amount) && amount > 0) return { status: "limited", amount, effectiveDate };
  if (/限额|限制申购|大额申购/.test(remark)) return { status: "unknown", amount: null, effectiveDate };
  return { status: "open", amount: null, effectiveDate };
}

function pickStatusEntry(payload, fund) {
  const list = payload?.data?.fundlist;
  if (!Array.isArray(list)) throw new Error("official status list shape changed");
  return list.find((entry) => String(entry?.fundCode) === String(fund.code)) || null;
}

const adapter = createAdapter({
  id: "southern",
  manager: "南方基金",
  allowedHosts: ["nffund.com"],
  defaultSource: () => API_URL,
  detailSource: (fund) => `https://www.nffund.com/new/personal-financing/detail.html?fundCode=${fund.code}`
});

adapter.collect = async function collect(fund, context) {
  try {
    const resource = await context.fetchResource(API_URL, {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs,
      method: "POST", body: "{}", headers: { "content-type": "application/json" }
    });
    const entry = pickStatusEntry(JSON.parse(new TextDecoder("utf-8").decode(resource.bytes)), fund);
    if (!entry) throw new Error("fund not present in official status list");
    const parsed = parseStatusEntry(entry, fund);
    const status = parsed.status;
    return [{
      fundCode: fund.code, fundName: fund.name, manager: fund.manager, index: fund.index || "nasdaq100",
      strategy: fund.strategy || "unknown", currency: fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: { kind: "direct", access: "all" }, status, limitAmount: parsed.amount,
      accountBasis: "single-fund-account-daily-cumulative", observedAt: context.observedAt,
      effectiveDate: parsed.effectiveDate, salesUrl: this.salesUrl(fund),
      source: { url: resource.finalUrl, kind: "current-status", adapter: this.id },
      reliability: status === "unknown"
        ? { grade: "D", reason: "official status page indicates a limit but the current amount was not safely parsed" }
        : { grade: "A", reason: "current official purchase/redemption status list explicitly identifies the fund and limit" },
      notes: status === "unknown" ? ["Do not treat as purchasable until the official amount is confirmed."] : []
    }];
  } catch (error) {
    context.warnings.push(`${fund.code} southern status: ${error.message}`);
    return [this.unknownRow(fund, context.observedAt, API_URL)];
  }
};

module.exports = adapter;
module.exports.parseStatusEntry = parseStatusEntry;
module.exports.pickStatusEntry = pickStatusEntry;
