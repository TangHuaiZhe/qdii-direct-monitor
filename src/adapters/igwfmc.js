"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "igwfmc", manager: "景顺长城基金", allowedHosts: ["igwfmc.com"], defaultSource: (fund) => `https://www.igwfmc.com/main/jjcp/product/${fund.code}/detail.html` });
