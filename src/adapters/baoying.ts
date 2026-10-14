"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "baoying", manager: "宝盈基金", allowedHosts: ["byfunds.com"], defaultSource: (f) => `http://www.byfunds.com/fundDetail/${f.code}/index.html` });
