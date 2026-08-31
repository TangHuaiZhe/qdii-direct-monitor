"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { amountLabel, rankPurchasableFunds, reliabilityReasonLabel, renderHtml } = require("../src/report");

function payload(overrides = {}) {
  return { observedAt: "2026-08-29T04:47:59.125Z", warnings: [], changes: [], rows: [{
    fundCode: "040046", fundName: "华安纳指", manager: "华安基金", currency: "CNY", shareClass: "A",
    channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100,
    reliability: { grade: "A", reason: "official" }, source: { url: "https://www.huaan.com.cn/funds/040046/index.shtml" }
  }], ...overrides };
}

test("renders a self-contained Chinese HTML report", () => {
  const html = renderHtml(payload());
  assert.match(html, /<!doctype html>/);
  assert.match(html, /QDII 申购额度监控/);
  assert.match(html, /网上直销/);
  assert.match(html, /100 元/);
  assert.match(html, /查看证据/);
  assert.match(html, /og:image/);
  assert.match(html, /qdii-direct-monitor\/og\.png/);
});

test("escapes untrusted source data", () => {
  const html = renderHtml(payload({ rows: [{ ...payload().rows[0], fundName: "<script>alert(1)</script>" }] }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("formats USD limits independently", () => {
  assert.equal(amountLabel({ status: "limited", limitAmount: 1000, currency: "USD" }), "1,000 美元");
});

test("localizes known reliability explanations", () => {
  assert.equal(reliabilityReasonLabel("current public agency sales page; logged-in order submission was not tested"), "当前代销公开页面，未验证登录后下单");
});

test("purchase ranking chooses each fund's highest usable channel", () => {
  const base = payload().rows[0];
  const ranked = rankPurchasableFunds([
    { ...base, channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, limitAmount: 10 },
    { ...base, channel: { kind: "direct", access: "web" }, limitAmount: 100 },
    { ...base, fundCode: "016452", manager: "南方基金", channel: { kind: "direct", access: "all" }, limitAmount: 50 },
    { ...base, fundCode: "016055", manager: "博时基金", status: "suspended", limitAmount: null }
  ]);
  assert.deepEqual(ranked.map((row) => [row.fundCode, row.limitAmount, row.channel.access]), [["040046", 100, "web"], ["016452", 50, "all"]]);
});

test("HTML includes a concise purchase-convenience summary", () => {
  const html = renderHtml(payload());
  assert.match(html, /当前购买便利度/);
  assert.match(html, /按每只基金最高可用单日额度排名/);
  assert.match(html, /华安基金 040046（网上直销）/);
});
