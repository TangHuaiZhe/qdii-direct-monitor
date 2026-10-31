"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const huataipb = require("../src/adapters/huataipb");

test("Huatai-PB parses each share from the current official product metadata", async () => {
  const text = `var FundArr = [
    {"fundcode":"019524","fundFullName":"华泰柏瑞纳指A","limitmoney":"每日5元","statusStr":"正常开放"},
    {"fundcode":"019525","fundFullName":"华泰柏瑞纳指C","limitmoney":"每日5元","statusStr":"正常开放"}
  ];`;
  const context = { observedAt: "2026-10-31T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "application/javascript", finalUrl: url }) };
  for (const [code, shareClass] of [["019524", "A"], ["019525", "C"]]) {
    const rows = await huataipb.collect({ code, name: `华泰柏瑞纳指${shareClass}`, manager: "华泰柏瑞基金", currency: "CNY", shareClass,
      officialSources: [{ url: "https://www.huatai-pb.com/common/index.html.js", kind: "current-status", channel: { kind: "direct", access: "web" } }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 5);
    assert.equal(rows[0].channel.access, "web");
    assert.equal(rows[0].reliability.grade, "A");
  }
});

test("Huatai-PB product metadata shape changes fail closed", async () => {
  const context = { observedAt: "2026-10-31T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from('{"fundcode":"019524","message":"升级中"}'), contentType: "application/javascript", finalUrl: url }) };
  const rows = await huataipb.collect({ code: "019524", name: "华泰柏瑞纳指A", manager: "华泰柏瑞基金", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.huatai-pb.com/common/index.html.js", kind: "current-status", channel: { kind: "direct", access: "web" } }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].limitAmount, null);
  assert.equal(rows[0].reliability.grade, "D");
});

test("Huatai-PB config uses current product metadata instead of a pinned notice", () => {
  const config = require("../config/funds.example.json");
  for (const code of ["019524", "019525"]) {
    const source = config.funds.find((fund) => fund.code === code).officialSources[0];
    assert.equal(source.url, "https://www.huatai-pb.com/common/index.html.js");
    assert.equal(source.kind, "current-status");
    assert.deepEqual(source.channel, { kind: "direct", access: "web" });
  }
});
