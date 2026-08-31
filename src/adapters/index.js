"use strict";
const adapters = [require("./jiashi"), require("./efunds"), require("./huitianfu"), require("./bosera"), require("./cmf"), require("./gf"), require("./huaan"), require("./dacheng"), require("./southern"), require("./guotai"), require("./baoying"), require("./huataipb"), require("./ccb"), require("./jpmorgan"), require("./wanjia")];
module.exports = { adapters: Object.fromEntries(adapters.map((a) => [a.id, a])) };
