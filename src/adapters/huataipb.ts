"use strict";
const { createAdapter } = require("./base");

function focusFund(text, fund) {
  const match = String(text).match(new RegExp(`"fundcode"\\s*:\\s*"${fund.code}"`));
  if (!match || match.index === undefined) return "";
  const next = String(text).slice(match.index + match[0].length).search(/"fundcode"\s*:/);
  return String(text).slice(match.index, next < 0 ? undefined : match.index + match[0].length + next);
}

function parseAmount(text) {
  const match = String(text).match(/"limitmoney"\s*:\s*"每日\s*([\d,.]+)\s*(万)?元"/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, "")) * (match[2] ? 10000 : 1);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency: "CNY" } : null;
}

function parseStatus(text) {
  if (/"limitmoney"\s*:\s*"每日\s*[\d,.]+\s*(?:万)?元"/.test(text)) return "limited";
  if (/"statusStr"\s*:\s*"(?:暂停|停止|关闭)[^"]*"/.test(text)) return "suspended";
  if (/"statusStr"\s*:\s*"正常开放"/.test(text)) return "open";
  return "unknown";
}

module.exports = createAdapter({
  id: "huataipb",
  manager: "华泰柏瑞基金",
  allowedHosts: ["huatai-pb.com"],
  defaultSource: (f) => `https://www.huatai-pb.com/products/zhishu/${f.code}/index.html`,
  focus: focusFund,
  parseAmount,
  parseStatus
});
