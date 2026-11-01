"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { beijingDateOf, parseEastmoneyNav, parseEastmoneyQuote, parseSseSnapshot, parseSzseQuote } = require("../src/onsite/parse");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", "onsite", name), "utf8");
}

test("parses a Shanghai snapshot fixture with the fixed select order", () => {
  const quote = parseSseSnapshot(fixture("sse-snap-513100.json"), "513100");
  assert.ok(quote);
  assert.equal(quote.name, "纳指ETF");
  assert.equal(quote.last, 2.239);
  assert.equal(quote.price, 2.239);
  assert.equal(quote.iopv, 1.966);
  assert.equal(quote.refNav, 1.966);
  assert.equal(quote.refNavKind, "iopv");
  assert.equal(quote.volume, 202945148);
  assert.equal(quote.amount, 456043207);
  assert.equal(quote.date, "20261030");
  assert.equal(quote.time, "16:29:02");
  assert.equal(quote.priceDate, "2026-10-30");
  assert.equal(quote.priceAt, "2026-10-30T16:29:02+08:00");
});

test("a Shanghai snapshot for a different fund code is rejected", () => {
  assert.equal(parseSseSnapshot(fixture("sse-snap-513100.json"), "513500"), null);
});

test("a Shanghai snapshot with missing or non-finite fields is rejected", () => {
  assert.equal(parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261030, time: 162902 }), "513100"), null);
  assert.equal(parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261030, time: 162902, snap: ["纳指ETF", null, null, 1.966, null, null, null, 1, 1] }), "513100"), null);
  assert.equal(parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261030, time: 162902, snap: ["纳指ETF", "abc", null, 1.966, null, null, null, 1, 1] }), "513100"), null);
  assert.equal(parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261030, time: 162902, snap: ["纳指ETF", 2.239] }), "513100"), null);
  assert.equal(parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261330, time: 162902, snap: ["纳指ETF", 2.239, null, 1.966, null, null, null, 1, 1] }), "513100"), null);
  assert.equal(parseSseSnapshot("not json at all", "513100"), null);
  assert.equal(parseSseSnapshot("{}", "513100"), null);
});

test("a non-positive Shanghai iopv becomes null but does not invent a value", () => {
  const quote = parseSseSnapshot(JSON.stringify({ code: "513100", date: 20261030, time: 162902, snap: ["纳指ETF", 2.239, null, 0, 2.241, 2.258, 2.234, 202945148, 456043207] }), "513100");
  assert.ok(quote);
  assert.equal(quote.iopv, null);
  assert.equal(quote.refNav, null);
  assert.equal(quote.refNavKind, null);
  assert.equal(quote.price, 2.239);
});

test("parses a Shenzhen ETF fixture and uses netValue as the reference NAV", () => {
  const quote = parseSzseQuote(fixture("szse-quote-159941-etf.json"), "159941", "ETF");
  assert.ok(quote);
  assert.equal(quote.name, "纳指ETF广发");
  assert.equal(quote.now, 1.649);
  assert.equal(quote.price, 1.649);
  assert.equal(quote.close, 1.69);
  assert.equal(quote.refNav, 1.471);
  assert.equal(quote.refNavKind, "reference-nav");
  assert.equal(quote.volume, 7393403);
  assert.equal(quote.amount, 1225154601.647);
  assert.equal(quote.priceDate, "2026-10-30");
  assert.equal(quote.priceAt, "2026-10-30T15:30:00+08:00");
});

test("parses a Shenzhen LOF fixture and uses prevNetValue as the reference NAV", () => {
  const quote = parseSzseQuote(fixture("szse-quote-161130-lof.json"), "161130", "LOF");
  assert.ok(quote);
  assert.equal(quote.refNav, 4.3963);
  assert.equal(quote.refNavKind, "previous-nav");
  assert.equal(quote.now, 4.631);
});

test("a Shenzhen quote for a different fund code or with no price is rejected", () => {
  assert.equal(parseSzseQuote(fixture("szse-quote-159941-etf.json"), "161130", "ETF"), null);
  assert.equal(parseSzseQuote(JSON.stringify({ datetime: "2026-10-30 15:30", data: { code: "159941", name: "纳指ETF广发", now: "0", netValue: "1.471" } }), "159941"), null);
  assert.equal(parseSzseQuote(JSON.stringify({ datetime: "2026-10-30 15:30", data: { code: "159941", name: "纳指ETF广发", now: "--", netValue: "1.471" } }), "159941"), null);
  assert.equal(parseSzseQuote(JSON.stringify({ datetime: "2026-10-30 15:30", data: { name: "纳指ETF广发", now: "1.649" } }), "159941"), null);
  assert.equal(parseSzseQuote("<html>blocked</html>", "159941"), null);
});

test("parses Eastmoney NAV history and keeps the latest valuation date", () => {
  const nav = parseEastmoneyNav(fixture("eastmoney-nav-513100.json"), "513100");
  assert.ok(nav);
  assert.equal(nav.nav, 1.9663);
  assert.equal(nav.navDate, "2026-10-29");
  assert.equal(nav.applyStatus, "暂停申购");
  assert.equal(nav.redemptionStatus, "场内卖出");
});

test("Eastmoney NAV failures return null instead of a guessed NAV", () => {
  assert.equal(parseEastmoneyNav(JSON.stringify({ Data: { LSJZList: [] }, ErrCode: 0 }), "513100"), null);
  assert.equal(parseEastmoneyNav(JSON.stringify({ Data: { LSJZList: [{ FSRQ: "2026-10-29", DWJZ: "1.9663" }] }, ErrCode: -999 }), "513100"), null);
  assert.equal(parseEastmoneyNav(JSON.stringify({ Data: { LSJZList: [{ FSRQ: "2026-10-29", DWJZ: "0.0000" }] }, ErrCode: 0 }), "513100"), null);
  assert.equal(parseEastmoneyNav(JSON.stringify({ Data: { LSJZList: [{ FSRQ: "not-a-date", DWJZ: "1.9663" }] }, ErrCode: 0 }), "513100"), null);
  assert.equal(parseEastmoneyNav("blocked by anti-bot", "513100"), null);
  assert.equal(parseEastmoneyNav(JSON.stringify({ Data: { fundCode: "159941", LSJZList: [{ FSRQ: "2026-10-29", DWJZ: "1.9663" }] }, ErrCode: 0 }), "513100"), null);
});

test("parses the Eastmoney push2 fallback quote using f59 decimals", () => {
  const quote = parseEastmoneyQuote(fixture("eastmoney-push2-513100.json"), "513100");
  assert.ok(quote);
  assert.equal(quote.price, 2.239);
  assert.equal(quote.preclose, 2.289);
  assert.equal(quote.name, "纳指ETF");
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: { f43: 2239, f57: "513100", f58: "纳指ETF", f59: 2, f60: 2289 } }), "513100").price, 22.39);
});

test("Eastmoney push2 failures return null", () => {
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: { f43: 2239, f57: "159941", f58: "x", f59: 3 } }), "513100"), null);
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: { f43: "-", f57: "513100", f58: "x", f59: 3 } }), "513100"), null);
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: { f43: 2239, f57: "513100" } }), "513100"), null);
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: { f43: 2239, f57: "513100", f59: 99 } }), "513100"), null);
  assert.equal(parseEastmoneyQuote(JSON.stringify({ data: null }), "513100"), null);
});

test("beijingDateOf converts an ISO timestamp into the Beijing calendar date", () => {
  assert.equal(beijingDateOf("2026-10-30T15:05:00+08:00"), "2026-10-30");
  assert.equal(beijingDateOf("2026-10-30T00:30:00+08:00"), "2026-10-30");
  assert.equal(beijingDateOf("2026-10-29T17:00:00Z"), "2026-10-30");
  assert.equal(beijingDateOf("not-a-time"), null);
});
