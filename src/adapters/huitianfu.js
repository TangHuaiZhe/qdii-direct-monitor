"use strict";
const { createAdapter } = require("./base");
const { parseAmount } = require("../parser");

function parseCurrentShareAmount(text, fund) {
  const compact = text.replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1");
  const codes = compact.match(/下属基金份额的交易代码\s+((?:\d{6}\s+){1,8})/)?.[1]?.match(/\d{6}/g) || [];
  const values = compact.match(/下属基金份额的限制申购金额\s+((?:[\d,.]+\s+){1,8})/)?.[1]?.match(/[\d,]+(?:\.\d+)?/g) || [];
  const index = codes.indexOf(fund.code);
  if (index >= 0 && values[index]) {
    const amount = Number(values[index].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, currency: fund.currency || "CNY" };
  }
  return parseAmount(text);
}

module.exports = createAdapter({ id: "huitianfu", manager: "汇添富基金", allowedHosts: ["99fund.com"], parseAmount: parseCurrentShareAmount, defaultSource: (f) => `https://www.99fund.com/main/products/pofund/${f.code}/fundgg.shtml` });
