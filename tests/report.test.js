"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { amountLabel, feeBand, feeLabel, rankPurchasableFunds, reliabilityReasonLabel, renderFundHtml, renderHtml } = require("../src/report");

function payload(overrides = {}) {
  return { observedAt: "2026-08-29T04:47:59.125Z", warnings: [], changes: [], fees: [{
    fundCode: "040046", managementRate: 0.6, custodyRate: 0.2, salesServiceRate: 0, annualRate: 0.8,
    reliability: { grade: "B", reason: "current public fee page" }, source: { url: "https://fundf10.eastmoney.com/jjfl_040046.html" }
  }], rows: [{
    fundCode: "040046", fundName: "华安纳指", manager: "华安基金", currency: "CNY", shareClass: "A",
    channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100,
    reliability: { grade: "A", reason: "official" }, source: { url: "https://www.huaan.com.cn/funds/040046/index.shtml" }
  }], ...overrides };
}

test("renders a self-contained Chinese HTML report", () => {
  const html = renderHtml(payload());
  assert.match(html, /<!doctype html>/);
  assert.match(html, /QDII 申购额度与费率/);
  assert.match(html, /网上直销/);
  assert.match(html, /100 元/);
  assert.match(html, /费率来源/);
  assert.match(html, /0\.80%/);
  assert.match(html, /仅看可购买/);
  assert.match(html, /综合费率从低到高/);
  assert.match(html, /og:image/);
  assert.match(html, /qdii-direct-monitor\/og\.png/);
  assert.match(html, /--primary:#b4232f/);
  assert.match(html, /linear-gradient\(135deg,#7f1420,#b4232f 72%,#cf4450\)/);
});

test("escapes untrusted source data", () => {
  const html = renderHtml(payload({ rows: [{ ...payload().rows[0], fundName: "<script>alert(1)</script>" }] }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("formats USD limits independently", () => {
  assert.equal(amountLabel({ status: "limited", limitAmount: 1000, currency: "USD" }), "1,000 美元");
  assert.equal(feeLabel(0.8), "0.80%");
});

test("classifies fee color bands at the requested boundaries", () => {
  assert.equal(feeBand(0.8).key, "low");
  assert.equal(feeBand(0.81).key, "normal");
  assert.equal(feeBand(1).key, "normal");
  assert.equal(feeBand(1.01).key, "high");
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
  assert.match(html, /当前更方便购买/);
  assert.match(html, /先按最高可信额度排序/);
  assert.match(html, /华安基金 040046/);
  assert.match(html, /年费率 0\.80%/);
  assert.match(html, /fee-low/);
  assert.match(html, /低费率/);
});

test("renders an indexable fund detail page", () => {
  const html = renderFundHtml(payload(), "040046");
  assert.match(html, /华安纳指 040046/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /最高可信直销额度/);
  assert.match(html, /--primary:#b4232f/);
});
