"use strict";
const adapters = [require("./jiashi"), require("./efunds"), require("./huitianfu"), require("./bosera"), require("./cmf"), require("./gf"), require("./huaan"), require("./dacheng"), require("./southern")];
module.exports = { adapters: Object.fromEntries(adapters.map((a) => [a.id, a])) };
