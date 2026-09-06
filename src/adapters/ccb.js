"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "ccb", manager: "建信基金", allowedHosts: ["ccbfund.cn"], defaultSource: () => "https://www.ccbfund.cn/resource/static/content/303416.html", detailSource: (f) => `https://m.ccbfund.cn/ccbfundmob/q/fundDetail.action?fundCode=${f.code}` });
