"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const huaan = require("../src/adapters/huaan");
const huitianfu = require("../src/adapters/huitianfu");
const southern = require("../src/adapters/southern");
const tianhong = require("../src/adapters/tianhong");
const { adapters } = require("../src/adapters");

test("official adapter produces a direct observation with evidence", async () => {
  const html = "<html><body>040046 交易状态 单日单账户限额直销100元 代销10元限额申购</body></html>";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(html), contentType: "text/html", finalUrl: url }) };
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", currency: "CNY", shareClass: "A", officialSources: [{ url: "https://www.huaan.com.cn/funds/040046/index.shtml", kind: "product" }] }, context);
  assert.equal(rows[0].channel.kind, "direct");
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 100);
  assert.equal(rows[0].reliability.grade, "A");
});

test("unparseable official page is unknown, never open", async () => {
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("<html>layout changed</html>"), contentType: "text/html", finalUrl: url }) };
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "product" }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].reliability.grade, "D");
});

test("one notice can explicitly cover web, app, and counter direct channels", async () => {
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("040046 限制申购金额（单位：人民币元） 100.00 暂停大额申购"), contentType: "text/html", finalUrl: url }) };
  const channels = ["web", "app", "counter"].map((access) => ({ kind: "direct", access }));
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "notice", channels }] }, context);
  assert.deepEqual(rows.map((row) => row.channel.access), ["web", "app", "counter"]);
  assert.ok(rows.every((row) => row.limitAmount === 100 && row.reliability.grade === "B"));
});

test("Huitianfu uses the current share-table value instead of an older amount mentioned later", async () => {
  const text = "基金主代码 018966 下属基金份额的交易代码 018966 018967 018969 018968 021773 下属基金份额的限制申购金额 10.00 10.00 2.00 2.00 10.00 注：此前限制金额为50人民币元 暂停大额申购";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  const rows = await huitianfu.collect({ code: "018966", name: "汇添富纳指", manager: "汇添富基金", currency: "CNY", officialSources: [{ url: "https://www.99fund.com/x", kind: "notice", channel: { kind: "direct", access: "all" } }] }, context);
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 10);
});

test("Southern parses the latest A-share purchase limit notice", async () => {
  const text = "基金主代码 016452 暂停大额申购起始日 2025年11月20日 下属基金份额的代码 016452 016453 021000 该基金份额的限制金额 100元 100元 2万元 自2025年11月20日起，如个人投资者单日单个基金账户单笔申购本基金A类基金份额超过100元，则仅对100元确认成功";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  const rows = await southern.collect({ code: "016452", name: "南方纳指", manager: "南方基金", currency: "CNY", officialSources: [{ url: "https://www.nffund.com/x", kind: "notice", channel: { kind: "direct", access: "all" } }] }, context);
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 100);
});

test("Tianhong parses the official A/C share limit notice", async () => {
  const text = "基金主代码 018043 暂停大额申购起始日 2026年04月08日 限制申购金额（单位：人民币元） 100.00 下属分级基金的交易代码 018043 018044 022525 该分级基金是否暂停大额申购 是 是 是";
  const context = { observedAt: "2026-09-01T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  for (const [code, shareClass] of [["018043", "A"], ["018044", "C"]]) {
    const rows = await tianhong.collect({ code, name: `天弘纳指${shareClass}`, manager: "天弘基金", currency: "CNY", shareClass,
      officialSources: [{ url: "https://cdn-thweb.tianhongjijin.com.cn/fundnotice/x", kind: "notice", channel: { kind: "direct", access: "all" }, effectiveDate: "2026-04-08" }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 100);
    assert.equal(rows[0].effectiveDate, "2026-04-08");
    assert.equal(rows[0].reliability.grade, "B");
  }
});

test("Tianhong page shape changes fail closed", async () => {
  const context = { observedAt: "2026-09-01T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("018043 页面升级中"), contentType: "text/html", finalUrl: url }) };
  const rows = await tianhong.collect({ code: "018043", name: "天弘纳指A", manager: "天弘基金", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.thfund.com.cn/fund/018043", kind: "product", channel: { kind: "direct", access: "web" } }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].limitAmount, null);
  assert.equal(rows[0].reliability.grade, "D");
});

test("new manager adapters are registered", () => {
  for (const id of ["guotai", "baoying", "huataipb", "ccb", "jpmorgan", "wanjia", "tianhong"]) assert.ok(adapters[id], id);
});
