"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "guotai", manager: "国泰基金", allowedHosts: ["gtfund.com"], defaultSource: (f) => `https://e.gtfund.com/etrade/Jijin/view/id/${f.code}` });
