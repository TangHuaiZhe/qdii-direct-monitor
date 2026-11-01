"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { collectOnsiteQuotes } = require("../src/onsite/collect");
const config = require("../config/funds.example.json");

const OBSERVED_AT = "2026-10-30T15:05:00+08:00";
const NAV_DATE = "2026-10-29";

// Values verified against the 2026-10-30 close / 2026-10-29 NAV snapshot documented in
// docs/plan-onsite-premium.md §4.4. Used only to synthesize offline fixture responses.
const MEASURED = {
  "159501": { price: 2.158, refNav: 1.847 },
  "159513": { price: 1.781, refNav: 1.638 },
  "159632": { price: 2.434, refNav: 2.234 },
  "159659": { price: 2.356, refNav: 2.125 },
  "159660": { price: 2.358, refNav: 2.149 },
  "159696": { price: 2.072, refNav: 1.831 },
  "159941": { price: 1.649, refNav: 1.471 },
  "513100": { price: 2.239, refNav: 1.966 },
  "513110": { price: 2.455, refNav: 2.2574 },
  "513300": { price: 2.674, refNav: 2.4366 },
  "513390": { price: 2.42, refNav: 2.2067 },
  "513870": { price: 2.067, refNav: 1.8728 },
  "159612": { price: 2.047, refNav: 1.923 },
  "159655": { price: 1.984, refNav: 1.872 },
  "513500": { price: 2.657, refNav: 2.4516 },
  "513650": { price: 1.982, refNav: 1.8676 },
  "161125": { price: 3.256, refNav: 3.1403 },
  "161130": { price: 4.631, refNav: 4.3963 }
};

function fundsByCode() {
  return new Map(config.onsiteFunds.map((fund) => [fund.code, fund]));
}

function resource(body, url) {
  return { bytes: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)), contentType: "application/json", finalUrl: url };
}

function codeFrom(url, key) {
  if (key === "snap") {
    const match = String(url).match(/\/snap\/(\d{6})/);
    return match ? match[1] : "";
  }
  if (key === "code") return new URL(url).searchParams.get("code");
  const match = String(url).match(new RegExp(`[?&]${key}=([0-9]{6})`));
  return match ? match[1] : "";
}

function sseBody(code) {
  const fund = fundsByCode().get(code);
  const measured = MEASURED[code];
  return {
    code,
    date: 20261030,
    time: 150500,
    snap: [fund.name, measured.price, measured.price - 0.02, measured.refNav, measured.price, measured.price + 0.01, measured.price - 0.01, 202945148, 456043207]
  };
}

function szseBody(code) {
  const fund = fundsByCode().get(code);
  const measured = MEASURED[code];
  const isLof = fund.vehicle === "LOF";
  return {
    datetime: "2026-10-30 15:30",
    data: {
      code,
      name: fund.name,
      now: String(measured.price),
      close: String(measured.price - 0.02),
      netValue: isLof ? null : String(measured.refNav),
      prevNetValue: isLof ? String(measured.refNav) : null,
      amount: 1225154601.647,
      volume: 7393403,
      marketTime: "2026-10-30 15:30:00"
    }
  };
}

function navBody(code) {
  const measured = MEASURED[code];
  return {
    Data: { LSJZList: [{ FSRQ: NAV_DATE, DWJZ: String(measured.refNav), SGZT: "暂停申购", SHZT: "场内卖出" }] },
    ErrCode: 0,
    ErrTotalCount: 1
  };
}

function context(fetchResource, warnings = []) {
  return { observedAt: OBSERVED_AT, warnings, timeoutMs: 1000, fetchResource };
}

function successFetch(overrides = {}) {
  return async (url, options = {}) => {
    if (overrides.handler) {
      const handled = await overrides.handler(url, options);
      if (handled) return handled;
    }
    if (String(url).includes("yunhq.sse.com.cn")) return resource(sseBody(codeFrom(url, "snap")), url);
    if (String(url).includes("szse.cn/api/market")) return resource(szseBody(codeFrom(url, "code")), url);
    if (String(url).includes("f10/lsjz")) return resource(navBody(codeFrom(url, "fundCode")), url);
    throw new Error(`unexpected URL in stub: ${url}`);
  };
}

test("collects all 18 configured funds from the official quote source", async () => {
  const warnings = [];
  const result = await collectOnsiteQuotes(config.onsiteFunds, config.onsite, context(successFetch(), warnings), {});
  assert.equal(result.quotes.length, 18);
  assert.equal(warnings.length, 0);
  assert.deepEqual(result.health, { officialOk: 18, fallback: 0, failed: 0, degradedCodes: [] });
  assert.equal(result.summary.count, 18);
  assert.equal(result.summary.degraded, 0);
  assert.equal(result.summary.thresholds.p25, null);
  for (const quote of result.quotes) {
    // LOF listings have no IOPV; they use the published NAV and therefore grade B.
    assert.equal(quote.reliability.grade, quote.vehicle === "LOF" ? "B" : "A", quote.code);
    assert.equal(quote.priceSource, "official", quote.code);
    assert.ok(quote.price > 0, quote.code);
    assert.ok(quote.premiumLivePct > 0, quote.code);
    assert.equal(quote.priceDate, "2026-10-30");
    assert.equal(quote.navDate, NAV_DATE);
    assert.equal(quote.applyStatus, "暂停申购");
  }
  assert.equal(result.quotes.find((quote) => quote.code === "513100").premiumLivePct, 13.89);
  assert.equal(result.quotes.find((quote) => quote.code === "161130").refNavKind, "nav");
  assert.equal(result.quotes.find((quote) => quote.code === "161130").premiumLivePct, 5.34);
  assert.deepEqual(Object.keys(result.closeByDate), ["2026-10-30"]);
  assert.equal(Object.keys(result.closeByDate["2026-10-30"]).length, 18);
  assert.equal(result.closeByDate["2026-10-30"]["513100"], 2.239);
});

test("official quote requests use canonical SSE select and NAV requests send Referer", async () => {
  const seen = [];
  const fetchResource = successFetch({
    handler: (url, options) => {
      seen.push({ url: String(url), options });
      return null;
    }
  });
  await collectOnsiteQuotes(config.onsiteFunds, config.onsite, context(fetchResource), {});
  const sseRequest = seen.find((entry) => entry.url.includes("yunhq.sse.com.cn"));
  assert.match(sseRequest.url, /select=name,last,preclose,iopv,open,high,low,volume,amount/);
  assert.deepEqual(sseRequest.options.allowedHosts, ["sse.com.cn"]);
  const navRequests = seen.filter((entry) => entry.url.includes("f10/lsjz"));
  assert.equal(navRequests.length, 18);
  for (const request of navRequests) assert.equal(request.options.headers.Referer, "https://fundf10.eastmoney.com/");
});

test("onsite collection honours its concurrency setting", async () => {
  let active = 0;
  let peak = 0;
  const fetchResource = async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (String(url).includes("yunhq.sse.com.cn")) return resource(sseBody(codeFrom(url, "snap")), url);
    if (String(url).includes("szse.cn/api/market")) return resource(szseBody(codeFrom(url, "code")), url);
    if (String(url).includes("f10/lsjz")) return resource(navBody(codeFrom(url, "fundCode")), url);
    throw new Error("unexpected");
  };
  await collectOnsiteQuotes(config.onsiteFunds, config.onsite, context(fetchResource), {});
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test("falls back to the Eastmoney public quote when the official quote fails", async () => {
  const fund = fundsByCode().get("513100");
  const warnings = [];
  const fetchResource = successFetch({
    handler: (url) => {
      if (String(url).includes("yunhq.sse.com.cn")) throw new Error("HTTP 502");
      if (String(url).includes("push2.eastmoney.com")) {
        return resource(fs.readFileSync(path.join(__dirname, "fixtures", "onsite", "eastmoney-push2-513100.json"), "utf8"), url);
      }
      if (String(url).includes("f10/lsjz")) {
        return resource(fs.readFileSync(path.join(__dirname, "fixtures", "onsite", "eastmoney-nav-513100.json"), "utf8"), url);
      }
      return null;
    }
  });
  const result = await collectOnsiteQuotes([fund], config.onsite, context(fetchResource, warnings), {});
  assert.equal(result.quotes.length, 1);
  const quote = result.quotes[0];
  assert.equal(quote.reliability.grade, "B");
  assert.equal(quote.priceSource, "eastmoney");
  assert.equal(quote.price, 2.239);
  assert.equal(quote.priceDate, "2026-10-30");
  assert.equal(quote.refNav, 1.9663);
  assert.equal(quote.refNavKind, "nav");
  assert.equal(quote.premiumLivePct, 13.87);
  // A fallback close is still the exchange close, so it is persisted for calibration;
  // its lower grade is already reflected on the quote (B).
  assert.deepEqual(result.closeByDate, { "2026-10-30": { "513100": 2.239 } });
  assert.deepEqual(result.health, { officialOk: 0, fallback: 1, failed: 0, degradedCodes: [] });
  assert.ok(warnings.some((warning) => /official quote/.test(warning)));
  assert.deepEqual(quote.sources.map((source) => source.kind), ["third-party-quote", "nav"]);
});

test("a later fallback close replaces an earlier stored close but stays grade B", async () => {
  const fund = fundsByCode().get("513100");
  const fetchResource = successFetch({
    handler: (url) => {
      if (String(url).includes("yunhq.sse.com.cn")) throw new Error("HTTP 502");
      if (String(url).includes("push2.eastmoney.com")) return resource(fs.readFileSync(path.join(__dirname, "fixtures", "onsite", "eastmoney-push2-513100.json"), "utf8"), url);
      if (String(url).includes("f10/lsjz")) return resource(fs.readFileSync(path.join(__dirname, "fixtures", "onsite", "eastmoney-nav-513100.json"), "utf8"), url);
      return null;
    }
  });
  const existing = { "2026-10-30": { "513100": 2.0 }, "2026-10-29": { "513100": 1.98 } };
  const result = await collectOnsiteQuotes([fund], config.onsite, context(fetchResource), existing);
  assert.equal(result.quotes[0].priceSource, "eastmoney");
  assert.equal(result.quotes[0].reliability.grade, "B");
  // The 15:05/20:30 close must overwrite an earlier (possibly intraday) value for the same date.
  assert.deepEqual(result.closeByDate, { "2026-10-29": { "513100": 1.98 }, "2026-10-30": { "513100": 2.239 } });
});

test("isolates a total failure as one D-grade quote instead of throwing", async () => {
  const fund = fundsByCode().get("513100");
  const warnings = [];
  const fetchResource = async (url) => {
    throw new Error(`upstream unavailable: ${url}`);
  };
  const result = await collectOnsiteQuotes([fund], config.onsite, context(fetchResource, warnings), {});
  const quote = result.quotes[0];
  assert.equal(quote.reliability.grade, "D");
  assert.equal(quote.price, null);
  assert.equal(quote.premiumLivePct, null);
  assert.equal(quote.premiumCalibratedPct, null);
  assert.ok(quote.notes.length > 0);
  assert.deepEqual(result.health, { officialOk: 0, fallback: 0, failed: 1, degradedCodes: ["513100"] });
  assert.equal(result.summary.degraded, 1);
  assert.ok(warnings.length >= 3);
});

test("keeps a B-grade indicative premium when only the published NAV fails", async () => {
  const fund = fundsByCode().get("513100");
  const fetchResource = successFetch({
    handler: (url) => {
      if (String(url).includes("f10/lsjz")) throw new Error("HTTP 403");
      return null;
    }
  });
  const result = await collectOnsiteQuotes([fund], config.onsite, context(fetchResource), {});
  const quote = result.quotes[0];
  assert.equal(quote.reliability.grade, "B");
  assert.equal(quote.reliability.reason, "official exchange reference NAV available; the published NAV cross-check is unavailable");
  assert.equal(quote.priceSource, "official");
  assert.equal(quote.price, 2.239);
  assert.equal(quote.refNav, 1.966);
  assert.equal(quote.refNavKind, "iopv");
  assert.equal(quote.refNavDate, null);
  assert.equal(quote.premiumLivePct, 13.89);
  assert.equal(quote.premiumCalibratedPct, null);
  assert.ok(quote.notes.some((note) => /cross-checked/.test(note)));
  assert.deepEqual(result.health, { officialOk: 1, fallback: 0, failed: 0, degradedCodes: [] });
  assert.equal(result.summary.degraded, 0);
  assert.deepEqual(result.closeByDate, { "2026-10-30": { "513100": 2.239 } });
});

test("merges closes into closeByDate and only keeps the most recent five dates", async () => {
  const fund = fundsByCode().get("513100");
  const existing = {
    "2026-10-23": { "513100": 2.0 },
    "2026-10-24": { "513100": 2.01 },
    "2026-10-25": { "513100": 2.02 },
    "2026-10-26": { "513100": 2.03 },
    "2026-10-27": { "513100": 2.04 },
    "2026-10-28": { "513100": 2.05 },
    "2026-10-29": { "513100": 2.1 },
    "2026-10-30": { "513100": 1.5 }
  };
  const result = await collectOnsiteQuotes([fund], config.onsite, context(successFetch()), existing);
  assert.deepEqual(Object.keys(result.closeByDate), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(result.closeByDate["2026-10-30"]["513100"], 2.239);
  assert.equal(result.closeByDate["2026-10-29"]["513100"], 2.1);
});

test("skips funds disabled in the onsite configuration", async () => {
  const fund = { ...fundsByCode().get("513100"), enabled: false };
  const result = await collectOnsiteQuotes([fund], config.onsite, context(successFetch()), {});
  assert.deepEqual(result.quotes, []);
  assert.deepEqual(result.health, { officialOk: 0, fallback: 0, failed: 0, degradedCodes: [] });
  assert.deepEqual(result.closeByDate, {});
});
