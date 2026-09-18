"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({
  id: "tianhong",
  manager: "天弘基金",
  allowedHosts: ["thfund.com.cn", "tianhongjijin.com.cn"],
  defaultSource: (fund) => `https://www.thfund.com.cn/fund/${fund.code}`
});
