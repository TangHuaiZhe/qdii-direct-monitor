"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "gf", manager: "广发基金", allowedHosts: ["gffunds.com.cn"], defaultSource: (f) => `https://gfwx.gffunds.com.cn/funds/?fundcode=${f.code}` });
