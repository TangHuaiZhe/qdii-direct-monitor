"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "dacheng", manager: "大成基金", allowedHosts: ["dcfund.com.cn"], defaultSource: () => "https://www.dcfund.com.cn/plat_files/upload/ann_upload/20260602/202606021780401593666.pdf" });
