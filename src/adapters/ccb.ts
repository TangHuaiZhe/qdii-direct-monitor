"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText } = require("../parser");

function parseDirectAmount(text, fund) {
  const value = normalizeExtractedText(text);
  const codesMatch = value.match(/下属分级基金的交易代码\s+((?:\d{6}\s+){1,7}\d{6})/);
  if (!codesMatch) return null;
  const codes = codesMatch[1].match(/\d{6}/g) || [];
  const index = codes.indexOf(String(fund.code));
  if (index < 0) return null;
  const tail = value.slice(codesMatch.index + codesMatch[0].length);
  const label = tail.match(/下属分级基金的限制申购金额（单位：(人民币元|美元)）\s*/);
  if (!label) return null;
  const segment = tail.slice(label.index + label[0].length).split(/下属分级基金的限制定期|其他需要提示/)[0];
  const values = segment.match(/[-—]|[\d,]+(?:\.\d+)?/g) || [];
  const raw = values[index];
  if (!raw || /^[-—]$/.test(raw)) return null;
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: label[1] === "美元" ? "USD" : (fund.currency || "CNY") };
}

module.exports = createAdapter({ id: "ccb", manager: "建信基金", allowedHosts: ["ccbfund.cn"], parseAmount: parseDirectAmount, defaultSource: () => "https://www.ccbfund.cn/resource/static/content/303416.html", detailSource: (f) => `https://m.ccbfund.cn/ccbfundmob/q/fundDetail.action?fundCode=${f.code}` });
