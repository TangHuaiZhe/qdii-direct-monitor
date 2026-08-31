"use strict";

const { resourceToText } = require("./parser");

function parsePercent(text, label) {
  const match = String(text || "").match(new RegExp(`${label}\\s*([\\d.]+)%`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function parseOperatingFees(text) {
  const managementRate = parsePercent(text, "管理费率");
  const custodyRate = parsePercent(text, "托管费率");
  const parsedSalesServiceRate = parsePercent(text, "销售服务费率");
  const salesServiceRate = parsedSalesServiceRate == null && /销售服务费率\s*(?:---|无)/.test(String(text || "")) ? 0 : parsedSalesServiceRate;
  if ([managementRate, custodyRate, salesServiceRate].some((value) => value == null)) return null;
  return {
    managementRate,
    custodyRate,
    salesServiceRate,
    annualRate: Number((managementRate + custodyRate + salesServiceRate).toFixed(4))
  };
}

async function collectOperatingFees(fund, context) {
  const url = `https://fundf10.eastmoney.com/jjfl_${fund.code}.html`;
  try {
    const resource = await context.fetchResource(url, { allowedHosts: ["eastmoney.com"], timeoutMs: context.timeoutMs });
    const parsed = parseOperatingFees(await resourceToText(resource));
    if (!parsed) throw new Error("fee table was not safely parsed");
    return {
      fundCode: fund.code,
      ...parsed,
      observedAt: context.observedAt,
      source: { url: resource.finalUrl, kind: "public-fee-page", adapter: "eastmoney" },
      reliability: { grade: "B", reason: "current public fee page; verify against the latest fund prospectus when making a material decision" }
    };
  } catch (error) {
    context.warnings.push(`${fund.code} fees: ${error.message}`);
    return {
      fundCode: fund.code,
      managementRate: null,
      custodyRate: null,
      salesServiceRate: null,
      annualRate: null,
      observedAt: context.observedAt,
      source: { url, kind: "public-fee-page", adapter: "eastmoney" },
      reliability: { grade: "D", reason: "fee source unavailable or not parseable" }
    };
  }
}

module.exports = { collectOperatingFees, parseOperatingFees };
