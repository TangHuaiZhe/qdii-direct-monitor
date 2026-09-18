"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "bosera", manager: "博时基金", allowedHosts: ["bosera.com"], defaultSource: (f) => `https://www.bosera.com/fund/${f.code}.html` });
