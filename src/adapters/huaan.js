"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "huaan", manager: "华安基金", allowedHosts: ["huaan.com.cn"], defaultSource: (f) => `https://www.huaan.com.cn/funds/${f.code}/index.shtml` });
