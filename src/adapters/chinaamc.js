"use strict";
const { createAdapter } = require("./base");

module.exports = createAdapter({ id: "chinaamc", manager: "华夏基金", allowedHosts: ["chinaamc.com"], defaultSource: (fund) => `https://fund.chinaamc.com/fund/${fund.code}/index.shtml` });
