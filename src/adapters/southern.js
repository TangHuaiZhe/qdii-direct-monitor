"use strict";
const { createAdapter } = require("./base");

module.exports = createAdapter({
  id: "southern",
  manager: "南方基金",
  allowedHosts: ["nffund.com"],
  defaultSource: () => "https://www.nffund.com/new/transaction-guide/product-status-and-limits.html"
});
