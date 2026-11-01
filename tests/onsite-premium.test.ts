"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePremium, summarizeQuotes, tradingDaysBetween } = require("../src/onsite/premium");

function input(overrides = {}) {
  return {
    code: "513100",
    price: 2.239,
    priceDate: "2026-10-30",
    priceSource: "official",
    officialRefNav: 1.966,
    officialRefNavKind: "iopv",
    nav: 1.9663,
    navDate: "2026-10-29",
    volume: 202945148,
    turnoverCny: 456043207,
    closeByDate: {},
    settings: {},
    ...overrides
  };
}

function quote(code, overrides = {}) {
  return {
    code,
    name: code,
    manager: "",
    index: "nasdaq100",
    exchange: "SSE",
    vehicle: "ETF",
    currency: "CNY",
    price: 2,
    priceAt: "2026-10-30T15:00:00+08:00",
    priceDate: "2026-10-30",
    refNav: 1.9,
    refNavKind: "iopv",
    refNavDate: "2026-10-29",
    nav: 1.9,
    navDate: "2026-10-29",
    premiumLivePct: 5.26,
    premiumLiveBasis: "iopv",
    premiumCalibratedPct: null,
    calibratedForDate: null,
    turnoverCny: 10000000,
    applyStatus: "暂停申购",
    linksOtcCode: null,
    reliability: { grade: "A", reason: "test" },
    sources: [],
    observedAt: "2026-10-30T15:05:00+08:00",
    notes: [],
    carriedForward: false,
    ...overrides
  };
}

test("computes a live premium from the official reference NAV", () => {
  const result = evaluatePremium(input());
  assert.equal(result.reliability.grade, "A");
  assert.equal(result.refNav, 1.966);
  assert.equal(result.refNavKind, "iopv");
  assert.equal(result.refNavDate, "2026-10-29");
  assert.equal(result.premiumLiveBasis, "iopv");
  assert.equal(result.premiumLivePct, 13.89);
  assert.equal(result.premiumCalibratedPct, null);
  assert.equal(result.calibratedForDate, null);
});

test("computes a negative premium (discount) without treating it as an error", () => {
  const result = evaluatePremium(input({
    price: 1.5,
    priceDate: "2026-10-30",
    officialRefNav: 1.6,
    nav: 1.6,
    navDate: "2026-10-30"
  }));
  assert.equal(result.reliability.grade, "A");
  assert.equal(result.premiumLivePct, -6.25);
});

test("falls back to the published NAV when the official reference NAV is zero", () => {
  const result = evaluatePremium(input({
    price: 1.6,
    priceDate: "2026-10-30",
    officialRefNav: 0,
    officialRefNavKind: null,
    nav: 1.6,
    navDate: "2026-10-30"
  }));
  assert.equal(result.reliability.grade, "B");
  assert.equal(result.refNav, 1.6);
  assert.equal(result.refNavKind, "nav");
  assert.equal(result.premiumLiveBasis, "nav");
  assert.equal(result.premiumLivePct, 0);
});

test("keeps a B-grade indicative premium when only the published NAV is missing", () => {
  const result = evaluatePremium(input({ nav: null, navDate: null }));
  assert.equal(result.reliability.grade, "B");
  assert.equal(result.reliability.reason, "official exchange reference NAV available; the published NAV cross-check is unavailable");
  assert.equal(result.premiumLivePct, 13.89);
  assert.equal(result.premiumLiveBasis, "iopv");
  assert.equal(result.refNav, 1.966);
  assert.equal(result.refNavDate, null);
  assert.equal(result.premiumCalibratedPct, null);
  assert.equal(result.calibratedForDate, null);
  assert.ok(result.notes.some((note) => /cross-checked/.test(note)));
});

test("withholds the premium when both NAV sources are missing", () => {
  const result = evaluatePremium(input({ officialRefNav: null, officialRefNavKind: null, nav: null, navDate: null }));
  assert.equal(result.reliability.grade, "D");
  assert.equal(result.refNav, null);
  assert.equal(result.premiumLivePct, null);
});

test("withholds the premium when there is no trading volume (suspended)", () => {
  const result = evaluatePremium(input({ volume: 0 }));
  assert.equal(result.reliability.grade, "D");
  assert.equal(result.premiumLivePct, null);
  assert.equal(result.premiumCalibratedPct, null);
  assert.match(result.reliability.reason, /volume/i);
});

test("withholds the premium when the official reference NAV disagrees with the published NAV", () => {
  const result = evaluatePremium(input({ officialRefNav: 2.0, nav: 1.98 }));
  assert.equal(result.reliability.grade, "D");
  assert.equal(result.premiumLivePct, null);
  assert.match(result.reliability.reason, /deviates/);
});

test("degrades to C (but still shows the live value) when the NAV lags the price date", () => {
  const result = evaluatePremium(input({ navDate: "2026-10-27", officialRefNav: 1.966, nav: 1.9663 }));
  assert.equal(result.reliability.grade, "C");
  assert.equal(result.premiumLivePct, 13.89);
  assert.match(result.reliability.reason, /lags/);
  assert.ok(result.notes.some((note) => /lags/.test(note)));
});

test("computes the calibrated premium only when the same valuation-day close exists", () => {
  const matched = evaluatePremium(input({
    officialRefNav: 1.9663,
    nav: 1.9663,
    closeByDate: { "2026-10-29": { "513100": 2.239 } }
  }));
  assert.equal(matched.calibratedForDate, "2026-10-29");
  assert.equal(matched.premiumCalibratedPct, 13.87);

  const unmatched = evaluatePremium(input({
    closeByDate: { "2026-10-28": { "513100": 2.239 } }
  }));
  assert.equal(unmatched.premiumCalibratedPct, null);
  assert.equal(unmatched.calibratedForDate, null);
});

test("a C-grade time lag still allows a valid calibrated premium", () => {
  const result = evaluatePremium(input({
    navDate: "2026-10-27",
    officialRefNav: 1.9663,
    nav: 1.9663,
    closeByDate: { "2026-10-27": { "513100": 2.0 } }
  }));
  assert.equal(result.reliability.grade, "C");
  assert.equal(result.calibratedForDate, "2026-10-27");
  assert.equal(result.premiumCalibratedPct, 1.71);
});

test("a third-party price is B-grade and never pretends to be an official quote", () => {
  const result = evaluatePremium(input({ priceSource: "eastmoney", officialRefNav: null, officialRefNavKind: null }));
  assert.equal(result.reliability.grade, "B");
  assert.equal(result.premiumLiveBasis, "nav");
  assert.ok(result.notes.some((note) => /third-party/i.test(note)));
});

test("weekday lag approximation counts trading days between dates", () => {
  assert.equal(tradingDaysBetween("2026-10-29", "2026-10-30"), 1);
  assert.equal(tradingDaysBetween("2026-10-30", "2026-10-30"), 0);
  assert.equal(tradingDaysBetween("2026-10-27", "2026-10-30"), 3);
  assert.equal(tradingDaysBetween("2026-10-30", "2026-11-02"), 1);
});

test("summarizeQuotes reports counts, high-premium codes and calibrated quantiles", () => {
  const quotes = [
    quote("159501", { premiumCalibratedPct: 1, calibratedForDate: "2026-10-29" }),
    quote("159513", { premiumCalibratedPct: 2, calibratedForDate: "2026-10-28" }),
    quote("159632", { premiumCalibratedPct: 3, calibratedForDate: "2026-10-29" }),
    quote("159659", { premiumCalibratedPct: 4, calibratedForDate: "2026-10-29" }),
    quote("159660", { premiumCalibratedPct: 5, calibratedForDate: "2026-10-29" }),
    quote("159696", { premiumCalibratedPct: null, premiumLivePct: 6, reliability: { grade: "B", reason: "third-party" } })
  ];
  const summary = summarizeQuotes(quotes, { highPremiumPct: 5 }, "2026-10-30T15:05:00+08:00");
  assert.equal(summary.asOf, "2026-10-30T15:05:00+08:00");
  assert.equal(summary.count, 6);
  assert.equal(summary.degraded, 0);
  assert.equal(summary.calibratedForDate, "2026-10-29");
  assert.deepEqual(summary.highPremiumCodes, ["159660", "159696"]);
  assert.deepEqual(summary.thresholds, { highPremiumPct: 5, p25: 2, p75: 4, p90: 4.6 });
});

test("summarizeQuotes counts D-grade quotes and keeps quantiles null on a thin sample", () => {
  const quotes = [
    quote("159501", { premiumCalibratedPct: 1, calibratedForDate: "2026-10-29" }),
    quote("159513", { premiumCalibratedPct: 2, calibratedForDate: "2026-10-29" }),
    quote("159632", { premiumCalibratedPct: 3, calibratedForDate: "2026-10-29" }),
    quote("159659", { premiumCalibratedPct: null, premiumLivePct: null, reliability: { grade: "D", reason: "failed" } })
  ];
  const summary = summarizeQuotes(quotes, {}, "2026-10-30T15:05:00+08:00");
  assert.equal(summary.degraded, 1);
  assert.equal(summary.thresholds.highPremiumPct, 5);
  assert.equal(summary.thresholds.p25, null);
  assert.equal(summary.thresholds.p75, null);
  assert.equal(summary.thresholds.p90, null);
});

test("summarizeQuotes handles an empty collection", () => {
  const summary = summarizeQuotes([], {}, "2026-10-30T15:05:00+08:00");
  assert.deepEqual(summary, {
    asOf: "2026-10-30T15:05:00+08:00",
    calibratedForDate: null,
    count: 0,
    degraded: 0,
    highPremiumCodes: [],
    thresholds: { highPremiumPct: 5, p25: null, p75: null, p90: null }
  });
});

test("summarizeQuotes excludes carried-forward quotes from stats but counts them as degraded", () => {
  const quotes = [
    quote("159501", { premiumCalibratedPct: 1, calibratedForDate: "2026-10-29" }),
    quote("159513", { premiumCalibratedPct: 2, calibratedForDate: "2026-10-29" }),
    quote("159632", { premiumCalibratedPct: 3, calibratedForDate: "2026-10-29" }),
    quote("159659", { premiumCalibratedPct: 4, calibratedForDate: "2026-10-29" }),
    quote("159660", { premiumCalibratedPct: 90, premiumLivePct: 90, calibratedForDate: "2026-10-31", carriedForward: true }),
    quote("159696", { premiumCalibratedPct: null, premiumLivePct: null, reliability: { grade: "D", reason: "failed" } })
  ];
  const summary = summarizeQuotes(quotes, {}, "2026-10-30T15:05:00+08:00");
  assert.equal(summary.count, 6);
  // One carried-forward quote + one D-grade quote are both "degraded display".
  assert.equal(summary.degraded, 2);
  // The carried-forward quote's 2026-10-31 date and +90% value must not leak into stats.
  assert.equal(summary.calibratedForDate, "2026-10-29");
  assert.deepEqual(summary.highPremiumCodes, []);
  assert.deepEqual(summary.thresholds, { highPremiumPct: 5, p25: 1.75, p75: 3.25, p90: 3.7 });
});
