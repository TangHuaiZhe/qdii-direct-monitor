"use strict";
const { createAdapter } = require("./base");
function focusCurrentRow(text, fund) {
  const start = text.indexOf(fund.code);
  if (start < 0) return text.slice(0, 1800);
  const tail = text.slice(start);
  const date = tail.match(/20\d{2}\/\d{1,2}\/\d{1,2}/);
  return tail.slice(0, date ? date.index + date[0].length + 240 : 900);
}
module.exports = createAdapter({ id: "jiashi", manager: "嘉实基金", allowedHosts: ["jsfund.cn"], focus: focusCurrentRow, defaultSource: () => "https://www.jsfund.cn/main/a/20151216/191092.shtml" });
