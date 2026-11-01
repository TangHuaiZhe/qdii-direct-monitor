"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSnapshot, compareSnapshots, normalizeObservation, normalizeQuote, observationKey } = require("../src/model");

function row(overrides = {}) {
  return { fundCode: "040046", fundName: "华安纳指", manager: "华安", currency: "CNY", shareClass: "A",
    channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "2026-08-29T00:00:00Z",
    reliability: { grade: "A", reason: "test" }, ...overrides };
}

function quote(overrides = {}) {
  return { code: "513100", name: "纳指ETF国泰", manager: "国泰基金", index: "nasdaq100", exchange: "SSE", vehicle: "ETF",
    currency: "CNY", price: 2.239, priceAt: "2026-10-30T15:05:00+08:00", priceDate: "2026-10-30",
    refNav: 1.966, refNavKind: "iopv", refNavDate: "2026-10-29", nav: 1.9663, navDate: "2026-10-29",
    premiumLivePct: 13.89, premiumLiveBasis: "iopv", premiumCalibratedPct: 13.87, calibratedForDate: "2026-10-29",
    turnoverCny: 456043207, applyStatus: "暂停申购", linksOtcCode: null,
    reliability: { grade: "A", reason: "test" }, sources: [], observedAt: "2026-10-30T15:05:00+08:00", notes: [],
    ...overrides };
}

test("snapshot key separates direct web from direct counter", () => {
  assert.notEqual(observationKey(normalizeObservation(row())), observationKey(normalizeObservation(row({ channel: { kind: "direct", access: "counter" } }))));
});

test("snapshot key separates Eastmoney from bank agency", () => {
  const a = normalizeObservation(row({ channel: { kind: "agency", access: "eastmoney", name: "天天基金" } }));
  const b = normalizeObservation(row({ channel: { kind: "agency", access: "bank", name: "招商银行" } }));
  assert.notEqual(a.key, b.key);
});

test("limited status requires amount", () => {
  assert.throws(() => normalizeObservation(row({ limitAmount: null })), /positive/);
});

test("normalizes an explicit fund strategy", () => {
  assert.equal(normalizeObservation(row({ strategy: "active" })).strategy, "active");
  assert.throws(() => normalizeObservation(row({ strategy: "tactical" })), /invalid strategy/);
});

test("snapshot preserves the direct sales URL independently of evidence", () => {
  const normalized = normalizeObservation(row({
    salesUrl: "https://www.huaan.com.cn/funds/040046/index.shtml",
    source: { url: "https://www.huaan.com.cn/notice.pdf", kind: "notice" }
  }));
  assert.equal(normalized.salesUrl, "https://www.huaan.com.cn/funds/040046/index.shtml");
  assert.equal(normalized.source.url, "https://www.huaan.com.cn/notice.pdf");
});

test("compare detects increase and status changes", () => {
  const before = buildSnapshot("a", [row()]);
  const after = buildSnapshot("b", [row({ limitAmount: 1000 })]);
  assert.equal(compareSnapshots(before, after)[0].type, "amount-increased");
  const suspended = buildSnapshot("c", [row({ status: "suspended", limitAmount: null })]);
  assert.equal(compareSnapshots(after, suspended)[0].type, "status-changed");
});

test("normalizeQuote validates codes, prices and premium types", () => {
  const normalized = normalizeQuote(quote());
  assert.equal(normalized.code, "513100");
  assert.equal(normalized.price, 2.239);
  assert.equal(normalized.premiumLivePct, 13.89);
  assert.equal(normalized.carriedForward, false);
  assert.throws(() => normalizeQuote(quote({ code: "51310" })), /invalid quote code/);
  assert.throws(() => normalizeQuote(quote({ price: "abc" })), /invalid quote price/);
  assert.throws(() => normalizeQuote(quote({ price: 0 })), /invalid quote price/);
  assert.throws(() => normalizeQuote(quote({ premiumLivePct: "n/a" })), /invalid quote premiumLivePct/);
  assert.throws(() => normalizeQuote(quote({ premiumCalibratedPct: null, premiumLivePct: null, reliability: { grade: "Z" } })), /reliability/);
  const degraded = normalizeQuote(quote({ price: null, refNav: null, premiumLivePct: null, premiumCalibratedPct: null, reliability: { grade: "D", reason: "failed" } }));
  assert.equal(degraded.price, null);
  assert.equal(degraded.premiumLivePct, null);
});

test("buildSnapshot with onsite quotes bumps the schema to 4 and indexes quotes/closeByDate", () => {
  const snapshot = buildSnapshot("2026-10-30T15:05:00+08:00", [row()], [], [], [quote()], { "2026-10-30": { "513100": 2.239 } });
  assert.equal(snapshot.schemaVersion, 4);
  assert.equal(snapshot.quotes.length, 1);
  assert.equal(snapshot.quotesByCode["513100"].premiumLivePct, 13.89);
  assert.deepEqual(snapshot.closeByDate, { "2026-10-30": { "513100": 2.239 } });
});

test("buildSnapshot keeps the legacy four-argument behaviour without onsite data", () => {
  assert.equal(buildSnapshot("a", [row()]).schemaVersion, 1);
  assert.equal(buildSnapshot("a", [row()], [{ fundCode: "040046", annualRate: 0.8 }]).schemaVersion, 2);
  assert.equal(buildSnapshot("a", [row()], [], [{ fundCode: "040046" }]).schemaVersion, 3);
  assert.equal(buildSnapshot("a", [row()]).quotes, undefined);
  assert.equal(buildSnapshot("a", [row()]).closeByDate, undefined);
});
