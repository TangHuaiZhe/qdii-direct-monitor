"use strict";
const { createAdapter } = require("./base");
module.exports = createAdapter({ id: "huataipb", manager: "华泰柏瑞基金", allowedHosts: ["huatai-pb.com"], defaultSource: (f) => `https://www.huatai-pb.com/products/zhishu/${f.code}/index.html` });
