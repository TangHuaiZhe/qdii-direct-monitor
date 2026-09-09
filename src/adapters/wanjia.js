"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText, parseAmount, parseShareAmount } = require("../parser");

function parseDirectAmount(text, fund) {
  const value = normalizeExtractedText(text);
  const match = value.match(/(?:本公司)?直销渠道[^。；]{0,220}?累计金额限制(?:调整)?为?\s*([\d][\d,\s]*)元/);
  if (match) {
    const amount = Number(match[1].replace(/[,\s]/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, currency: fund.currency || "CNY" };
  }
  if (/代销渠道/.test(value) && /直销渠道/.test(value)) return null;
  return parseShareAmount(value, fund) || parseAmount(value);
}

module.exports = createAdapter({ id: "wanjia", manager: "万家基金", allowedHosts: ["wjasset.com"], parseAmount: parseDirectAmount, defaultSource: (f) => `https://www.wjasset.com/products/qdii/${f.code}/news/report/index.html`, detailSource: (f) => `https://www.wjasset.com/products/qdii/${f.code}/index.html` });
