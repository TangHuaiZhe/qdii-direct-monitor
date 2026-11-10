"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText, parseEffectiveDate } = require("../parser");

const API_ROOT = "https://ilcapp.tianhongjijin.com.cn/face2face/th/fundInfo/viewFund";

function parseFundStatus(payload, fund) {
  const info = payload?.payload?.fundInfo;
  if (!info) throw new Error("official fund status shape changed");
  if (String(info.fundCode || "") !== String(fund.code)) throw new Error("official fund code mismatch");
  const notices = (payload.payload.marquees || []).map((item) => normalizeExtractedText(`${item?.title || ""} ${item?.subTitle || ""}`)).join(" ");
  const effectiveDate = parseEffectiveDate(notices);
  if (/暂停申购|暂停定投|暂不开放购买|不可购买/.test(notices)) return { status: "suspended", amount: null, effectiveDate };
  const amountMatch = notices.match(/(?:限购|限额|限制申购|单日[^，。；]{0,40}?不超过|累计[^，。；]{0,40}?不超过)\D{0,40}?([\d,]+(?:\.\d+)?)\s*(万)?元/);
  if (amountMatch) {
    const amount = Number(amountMatch[1].replace(/,/g, "")) * (amountMatch[2] ? 10000 : 1);
    if (Number.isFinite(amount) && amount > 0) return { status: "limited", amount, effectiveDate };
  }
  if (/限购|限额|限制申购/.test(notices) || String(info.fundStatus) !== "0") return { status: "unknown", amount: null, effectiveDate };
  return { status: "open", amount: null, effectiveDate };
}

const adapter = createAdapter({
  id: "tianhong",
  manager: "天弘基金",
  allowedHosts: ["tianhongjijin.com.cn", "thfund.com.cn"],
  defaultSource: (fund) => `${API_ROOT}/${fund.code}`,
  detailSource: (fund) => `https://www.thfund.com.cn/fund/${fund.code}`
});

adapter.collect = async function collect(fund, context) {
  try {
    const resource = await context.fetchResource(this.defaultSource(fund), { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const parsed = parseFundStatus(JSON.parse(new TextDecoder("utf-8").decode(resource.bytes)), fund);
    return [{
      fundCode: fund.code, fundName: fund.name, manager: fund.manager, index: fund.index || "nasdaq100",
      strategy: fund.strategy || "unknown", currency: fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: { kind: "direct", access: "all" }, status: parsed.status, limitAmount: parsed.amount,
      accountBasis: "single-fund-account-daily-cumulative", observedAt: context.observedAt,
      effectiveDate: parsed.effectiveDate, salesUrl: this.salesUrl(fund),
      source: { url: resource.finalUrl, kind: "current-status", adapter: this.id },
      reliability: parsed.status === "unknown"
        ? { grade: "D", reason: "official fund status page indicates a limit but the current amount was not safely parsed" }
        : { grade: "A", reason: "current official fund status page explicitly identifies the fund and subscription status" },
      notes: parsed.status === "unknown" ? ["Do not treat as purchasable until the official amount is confirmed."] : []
    }];
  } catch (error) {
    context.warnings.push(`${fund.code} tianhong status: ${error.message}`);
    return [this.unknownRow(fund, context.observedAt, this.detailSource(fund))];
  }
};

module.exports = adapter;
module.exports.parseFundStatus = parseFundStatus;
