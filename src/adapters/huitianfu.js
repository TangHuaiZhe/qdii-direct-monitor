"use strict";
const { createAdapter } = require("./base");
const { focusText, parseAmount, parseStatus } = require("../parser");

function focusCurrentStatus(text, fund) {
  const matches = [...text.matchAll(new RegExp(`(?:^|\\s)${fund.code}(?=\\s|$)`, "g"))];
  const index = matches.at(-1)?.index ?? text.indexOf(fund.code);
  return index < 0 ? text : text.slice(Math.max(0, index - 220), index + 620);
}

function focusFundText(text, fund) {
  return fund.code === "001668" ? focusCurrentStatus(text, fund) : focusText(text, fund);
}

function parseCurrentStatus(text, fund) {
  if (fund.code === "001668" && /正常\s+申购(?:\s+定投)?/.test(text)) return "open";
  return parseStatus(text);
}

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

module.exports = createAdapter({ id: "huitianfu", manager: "汇添富基金", allowedHosts: ["99fund.com"], focus: focusFundText, parseAmount: parseCurrentShareAmount, parseStatus: parseCurrentStatus, defaultSource: (f) => `https://www.99fund.com/main/products/pofund/${f.code}/fundgg.shtml` });
