"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "jpmorgan", manager: "摩根基金", allowedHosts: ["cifm.com"], defaultSource: (f) => `https://www.cifm.com/fund/${f.code}/` });
