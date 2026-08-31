"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "baoying", manager: "宝盈基金", allowedHosts: ["byfunds.com"], defaultSource: (f) => `https://www.byfunds.com/fundDetail/${f.code}/index.html` });
