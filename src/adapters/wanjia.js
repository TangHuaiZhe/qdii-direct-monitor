"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "wanjia", manager: "万家基金", allowedHosts: ["wjasset.com"], defaultSource: (f) => `https://www.wjasset.com/products/qdii/${f.code}/news/report/index.html` });
