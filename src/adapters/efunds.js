"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "efunds", manager: "易方达基金", allowedHosts: ["efunds.com.cn"], defaultSource: (f) => `https://e.efunds.com.cn/cart/aips?form=&fundCode=${f.code}` });
