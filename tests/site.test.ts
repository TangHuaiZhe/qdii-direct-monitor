"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSite } = require("../src/site");

test("buildSite publishes dashboard, SEO discovery files, and fund pages", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const siteDir = path.join(root, "site");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "latest.html"), "<!doctype html><title>monitor</title>");
  fs.writeFileSync(path.join(dataDir, "latest.json"), JSON.stringify({
    observedAt: "2026-08-31T00:00:00Z",
    rows: [{
      fundCode: "040046",
      fundName: "华安纳指",
      manager: "华安基金",
      currency: "CNY",
      shareClass: "A",
      channel: { kind: "direct", access: "web" },
      status: "limited",
      limitAmount: 100,
      reliability: { grade: "A", reason: "official" },
      source: { url: "https://example.com/fund/040046" }
    }],
    fees: [{
      fundCode: "040046",
      annualRate: 0.8,
      managementRate: 0.6,
      custodyRate: 0.2,
      salesServiceRate: 0,
      reliability: { grade: "B", reason: "public" },
      source: { url: "https://example.com/fee/040046" }
    }]
  }));
  fs.writeFileSync(path.join(dataDir, "state.json"), "private runtime state");
  const socialImage = path.join(root, "og.png");
  fs.writeFileSync(socialImage, "image");

  const result = buildSite({ dataDir, siteDir, socialImage });

  assert.deepEqual(result.files, [
    "index.html", "latest.html", "latest.json", "og.png", ".nojekyll",
    "robots.txt", "sitemap.xml", "funds/040046/index.html"
  ]);
  assert.equal(fs.readFileSync(path.join(siteDir, "index.html"), "utf8"), "<!doctype html><title>monitor</title>");
  assert.equal(fs.existsSync(path.join(siteDir, "state.json")), false);
  assert.match(fs.readFileSync(path.join(siteDir, "robots.txt"), "utf8"), /Sitemap: .*sitemap\.xml/);
  assert.match(fs.readFileSync(path.join(siteDir, "sitemap.xml"), "utf8"), /funds\/040046\//);
  assert.match(fs.readFileSync(path.join(siteDir, "funds/040046/index.html"), "utf8"), /rel="canonical"/);
});

test("buildSite fails instead of deploying an empty dashboard", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildSite({ dataDir: root, siteDir: path.join(root, "site") }), /missing generated monitor output/);
});

function onsiteQuote(overrides = {}) {
  return {
    code: "513100",
    name: "纳指ETF国泰",
    manager: "国泰基金",
    index: "nasdaq100",
    exchange: "SSE",
    vehicle: "ETF",
    currency: "CNY",
    price: 2.239,
    priceAt: "2026-10-30T15:00:00+08:00",
    priceDate: "2026-10-30",
    refNav: 1.966,
    refNavKind: "iopv",
    refNavDate: "2026-10-29",
    nav: 1.9663,
    navDate: "2026-10-29",
    premiumLivePct: 13.89,
    premiumLiveBasis: "iopv",
    premiumCalibratedPct: 2.14,
    calibratedForDate: "2026-10-29",
    turnoverCny: 456043207,
    applyStatus: "暂停申购",
    linksOtcCode: "016532",
    reliability: { grade: "A", reason: "current exchange quote matched with published NAV" },
    sources: [
      { url: "http://yunhq.sse.com.cn:32041/v1/sh1/snap/513100", kind: "exchange-quote", adapter: "sse" },
      { url: "https://api.fund.eastmoney.com/f10/lsjz?fundCode=513100", kind: "nav", adapter: "eastmoney" }
    ],
    observedAt: "2026-10-30T15:05:00+08:00",
    notes: [],
    carriedForward: false,
    ...overrides
  };
}

function writeOnsiteFixture(root, payload) {
  const dataDir = path.join(root, "data");
  const siteDir = path.join(root, "site");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "latest.html"), "<!doctype html><title>monitor</title>");
  fs.writeFileSync(path.join(dataDir, "latest.json"), JSON.stringify({
    observedAt: "2026-10-30T15:05:00+08:00",
    rows: [],
    ...payload
  }));
  const socialImage = path.join(root, "og.png");
  fs.writeFileSync(socialImage, "image");
  return { dataDir, siteDir, socialImage };
}

test("buildSite publishes onsite detail pages and their sitemap entries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const carried = onsiteQuote({
    code: "159941", name: "纳指ETF广发", manager: "广发基金", index: "nasdaq100", exchange: "SZSE",
    premiumCalibratedPct: 5.42, carriedForward: true, reliability: { grade: "C", reason: "carried forward: reused last trusted value" },
    observedAt: "2026-10-29T15:05:00+08:00", linksOtcCode: null,
    sources: [{ url: "https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code=159941", kind: "exchange-quote", adapter: "szse" }]
  });
  const degraded = onsiteQuote({
    code: "161125", name: "标普500LOF", manager: "易方达基金", index: "sp500", exchange: "SZSE", vehicle: "LOF",
    price: null, priceAt: null, priceDate: null, refNav: null, refNavKind: null, refNavDate: null, nav: null, navDate: null,
    premiumLivePct: null, premiumLiveBasis: null, premiumCalibratedPct: null, calibratedForDate: null, turnoverCny: null,
    reliability: { grade: "D", reason: "official quote unavailable; nav source unavailable" }, sources: [], linksOtcCode: null
  });
  const quotes = [onsiteQuote(), carried, degraded, onsiteQuote({ code: "51310", name: "非法代码" })];
  const options = writeOnsiteFixture(root, {
    quotes,
    quotesByCode: Object.fromEntries(quotes.filter((quote) => /^\d{6}$/.test(quote.code)).map((quote) => [quote.code, quote])),
    premiumSummary: { asOf: "2026-10-30T15:05:00+08:00", calibratedForDate: "2026-10-29", count: 3, degraded: 1, highPremiumCodes: [], thresholds: { highPremiumPct: 5, p25: null, p75: null, p90: null } }
  });
  const result = buildSite(options);

  assert.ok(result.files.includes("onsite/513100/index.html"));
  assert.ok(result.files.includes("onsite/159941/index.html"), "carried-forward quotes still get a page");
  assert.ok(result.files.includes("onsite/161125/index.html"), "D-grade quotes still get an evidence page");
  assert.equal(result.files.some((file) => file.startsWith("onsite/51310/")), false);
  assert.deepEqual(result.warnings, []);
  assert.equal(fs.existsSync(path.join(options.siteDir, "onsite/513100/index.html")), true);

  const onsiteHtml = fs.readFileSync(path.join(options.siteDir, "onsite/513100/index.html"), "utf8");
  assert.match(onsiteHtml, /rel="canonical"/);
  assert.match(onsiteHtml, /场内折溢价/);
  assert.match(onsiteHtml, /校准溢价/);
  assert.match(onsiteHtml, /href="funds\/016532\/"/);
  assert.match(fs.readFileSync(path.join(options.siteDir, "onsite/159941/index.html"), "utf8"), /沿用上次可信值/);
  assert.match(fs.readFileSync(path.join(options.siteDir, "onsite/161125/index.html"), "utf8"), /本次数据为 D 级/);

  const sitemap = fs.readFileSync(path.join(options.siteDir, "sitemap.xml"), "utf8");
  assert.match(sitemap, /onsite\/513100\//);
  assert.match(sitemap, /onsite\/159941\//);
  assert.match(sitemap, /onsite\/161125\//);
  assert.doesNotMatch(sitemap, /onsite\/51310\//);
  assert.equal(fs.readFileSync(path.join(options.siteDir, "index.html"), "utf8"), "<!doctype html><title>monitor</title>");
});

test("buildSite reports onsite pages that could not be rendered", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = writeOnsiteFixture(root, {
    quotes: [onsiteQuote()],
    quotesByCode: { "513100": { code: "not-a-quote" } },
    premiumSummary: null
  });
  const result = buildSite(options);
  assert.deepEqual(result.warnings, ["onsite/513100: renderer returned no page, skipped"]);
  assert.equal(result.files.includes("onsite/513100/index.html"), false);
  assert.doesNotMatch(fs.readFileSync(path.join(options.siteDir, "sitemap.xml"), "utf8"), /onsite\/513100\//);
});
