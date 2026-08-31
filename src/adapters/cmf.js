"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "cmf", manager: "招商基金", allowedHosts: ["cmfchina.com"], defaultSource: () => "https://www.cmfchina.com/web/notice/index.html" });
