"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { noticePageUrls, preferEvidence, run, stableSnapshot } = require("../src/collector");
const { buildSnapshot, compareSnapshots } = require("../src/model");

test("collector exposes each fund's configured notice index page", () => {
  const pages = noticePageUrls([
    { code: "001668", officialSources: [{ kind: "notice-index", url: "https://www.99fund.com/001668/notices" }] },
    { code: "040046", officialSources: [{ kind: "product", url: "https://www.huaan.com.cn/funds/040046" }] }
  ]);
  assert.deepEqual(pages, { "001668": "https://www.99fund.com/001668/notices" });
});

test("higher-grade evidence wins for the same channel key", () => {
  const base = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "x" };
  const rows = preferEvidence([{ ...base, reliability: { grade: "C", reason: "manual" } }, { ...base, limitAmount: 1000, reliability: { grade: "A", reason: "official" } }]);
  assert.equal(rows[0].limitAmount, 1000);
});

test("newer effective notice wins when evidence grades are equal", () => {
  const base = { fundCode: "019441", fundName: "x", manager: "x", currency: "CNY", shareClass: "A", channel: { kind: "direct", access: "all" }, status: "limited", observedAt: "2026-09-09T00:00:00Z", reliability: { grade: "B", reason: "official" } };
  const rows = preferEvidence([
    { ...base, limitAmount: 10, effectiveDate: "2026-07-09" },
    { ...base, limitAmount: 20000, effectiveDate: "2026-09-09" }
  ]);
  assert.equal(rows[0].limitAmount, 20000);
});

test("dated notice wins over an undated same-grade record", () => {
  const base = { fundCode: "019441", fundName: "x", manager: "x", currency: "CNY", shareClass: "A", channel: { kind: "direct", access: "all" }, status: "limited", observedAt: "2026-09-09T00:00:00Z", reliability: { grade: "B", reason: "official" } };
  const rows = preferEvidence([
    { ...base, limitAmount: 10 },
    { ...base, limitAmount: 20000, effectiveDate: "2026-09-09" }
  ]);
  assert.equal(rows[0].limitAmount, 20000);
});

test("newer official notice wins over an older higher-grade notice", () => {
  const base = { fundCode: "018966", fundName: "x", manager: "x", currency: "CNY", shareClass: "A", channel: { kind: "direct", access: "all" }, status: "limited", observedAt: "2026-09-09T00:00:00Z" };
  const rows = preferEvidence([
    { ...base, limitAmount: 10000, effectiveDate: "2026-09-02", source: { kind: "notice", url: "https://example.com/old.pdf" }, reliability: { grade: "B", reason: "explicit channel" } },
    { ...base, limitAmount: 10, effectiveDate: "2026-09-04", source: { kind: "notice", url: "https://example.com/new.pdf" }, reliability: { grade: "C", reason: "fund-wide notice" } }
  ]);
  assert.equal(rows[0].limitAmount, 10);
});

test("newer D-grade notice never overrides a trusted notice", () => {
  const base = { fundCode: "018966", fundName: "x", manager: "x", currency: "CNY", shareClass: "A", channel: { kind: "direct", access: "all" }, observedAt: "2026-09-09T00:00:00Z", source: { kind: "notice", url: "https://example.com/x.pdf" } };
  const rows = preferEvidence([
    { ...base, status: "limited", limitAmount: 10000, effectiveDate: "2026-09-02", reliability: { grade: "B", reason: "trusted" } },
    { ...base, status: "unknown", limitAmount: null, effectiveDate: "2026-09-04", reliability: { grade: "D", reason: "failed" } }
  ]);
  assert.equal(rows[0].limitAmount, 10000);
  assert.equal(rows[0].reliability.grade, "B");
});

test("D-grade fetch failure does not overwrite a trusted comparison baseline", () => {
  const base = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "a" };
  const before = buildSnapshot("a", [{ ...base, reliability: { grade: "A", reason: "official" } }]);
  const after = stableSnapshot("b", [{ ...base, status: "unknown", limitAmount: null, observedAt: "b", reliability: { grade: "D", reason: "failed" } }], before);
  assert.deepEqual(compareSnapshots(before, after), []);
  assert.equal(after.rows[0].status, "limited");
});

test("a first-seen D-grade channel remains in the baseline as unknown", () => {
  const row = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "app" }, status: "unknown", limitAmount: null, observedAt: "b", reliability: { grade: "D", reason: "failed" } };
  const after = stableSnapshot("b", [row], buildSnapshot("a", []));
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0].status, "unknown");
});

test("D-grade fee failure reuses the last trusted fee snapshot", () => {
  const baseRow = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "a", reliability: { grade: "A", reason: "official" } };
  const trustedFee = { fundCode: "040046", annualRate: 0.8, reliability: { grade: "B", reason: "public" } };
  const failedFee = { fundCode: "040046", annualRate: null, reliability: { grade: "D", reason: "failed" } };
  const before = buildSnapshot("a", [baseRow], [trustedFee]);
  const after = stableSnapshot("b", [baseRow], before, [failedFee]);
  assert.equal(after.fees[0].annualRate, 0.8);
});

test("D-grade holdings failure reuses the last trusted holdings snapshot", () => {
  const baseRow = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "a", reliability: { grade: "A", reason: "official" } };
  const trusted = { fundCode: "040046", portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through", asOf: "2026-06-30", items: [{ rank: 1, code: "NVDA", name: "英伟达", market: "美股", weight: 7 }], reliability: { grade: "B" } };
  const failed = { ...trusted, asOf: null, items: [], reliability: { grade: "D" } };
  const before = buildSnapshot("a", [baseRow], [], [trusted]);
  const after = stableSnapshot("b", [baseRow], before, [], [failed]);
  assert.equal(after.holdings[0].asOf, "2026-06-30");
  assert.equal(after.holdings[0].items[0].code, "NVDA");
});

test("first-seen D-grade fee and holdings records remain explicit unknowns", () => {
  const baseRow = { fundCode: "040046", fundName: "x", manager: "x", currency: "CNY", channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "a", reliability: { grade: "A", reason: "official" } };
  const failedFee = { fundCode: "040046", annualRate: null, reliability: { grade: "D" } };
  const failedHolding = { fundCode: "040046", portfolioCode: "040046", items: [], reliability: { grade: "D" } };
  const after = stableSnapshot("b", [baseRow], buildSnapshot("a", [baseRow]), [failedFee], [failedHolding]);
  assert.equal(after.fees[0], failedFee);
  assert.equal(after.holdings[0], failedHolding);
});

test("collector runs with injected sources and no persistence", async () => {
  const config = { notifications: {}, portfolioMappings: { "040046": { portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through" } }, funds: [{ code: "040046", name: "华安纳指", manager: "华安基金", adapter: "huaan", currency: "CNY", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "product" }], agency: { eastmoney: false } }] };
  const fetchResource = async (url) => ({ bytes: Buffer.from(url.includes("jjfl_") ? "管理费率 0.60% 托管费率 0.20% 销售服务费率 0.00%" : url.includes("danjuanapp.com") ? JSON.stringify({ result_code: 0, data: { source: "2026-06-30", stock_list: [{ name: "英伟达", code: "NVDA", percent: 7 }] } }) : "040046 单日单账户限额直销100元 限额申购"), contentType: url.includes("danjuanapp.com") ? "application/json" : "text/html", finalUrl: url });
  const result = await run(config, { observedAt: "2026-08-29T00:00:00Z", fetchResource, save: false, baseDir: path.join(os.tmpdir(), `qdii-test-${process.pid}`) });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].limitAmount, 100);
  assert.equal(result.fees[0].annualRate, 0.8);
  assert.equal(result.holdings[0].items[0].code, "NVDA");
  assert.equal(result.notification.reason, "no-changes");
  assert.deepEqual(result.noticeHealth, { candidatesDiscovered: 0, newNotices: 0, parsedNotices: 0, rejectedNotices: 0, conflicts: 0, cacheFallbacks: 0, staleTimelines: 0, timelines: [] });
  // Payload shape stays backward compatible while gaining the v4 onsite fields.
  assert.equal(result.schemaVersion, 4);
  assert.deepEqual(result.quotes, []);
  assert.deepEqual(result.quotesByCode, {});
  assert.deepEqual(result.closeByDate, {});
  assert.deepEqual(result.health.exchange, { officialOk: 0, fallback: 0, failed: 0, degradedCodes: [] });
  assert.equal(result.premiumSummary.count, 0);
});

test("one run fetches a shared official URL once", async () => {
  let hits = 0;
  const config = {
    notifications: {},
    portfolioMappings: {},
    fetch: { concurrency: 2 },
    funds: ["019524", "019525"].map((code) => ({
      code,
      name: "华泰柏瑞纳指",
      manager: "华泰柏瑞基金",
      adapter: "huataipb",
      currency: "CNY",
      officialSources: [{ url: "https://www.huatai-pb.com/same", kind: "notice", channel: { kind: "direct", access: "all" } }],
      agency: { eastmoney: false }
    }))
  };
  const fetchResource = async (url) => {
    if (String(url).includes("/same")) {
      hits += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return { bytes: Buffer.from("019524 暂停大额申购 限额 10 元"), contentType: "text/html", finalUrl: url };
  };
  const result = await run(config, { observedAt: "2026-08-29T00:00:00Z", fetchResource, save: false, baseDir: path.join(os.tmpdir(), `qdii-share-${process.pid}`) });
  assert.equal(hits, 1);
  assert.equal(result.rows.length, 2);
  assert.equal(result.warnings.some((warning) => warning.includes("huataipb")), false);
});

function onsiteFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", "onsite", name), "utf8");
}

const OTC_FUND = { code: "040046", name: "华安纳指", manager: "华安基金", adapter: "huaan", currency: "CNY",
  officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "product" }], agency: { eastmoney: false } };

const ONSITE_FUND = { code: "159941", name: "纳指ETF广发", manager: "广发基金", exchange: "SZSE", vehicle: "ETF",
  index: "nasdaq100", currency: "CNY", linkFundCode: "270042",
  officialQuoteUrl: "https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code=159941" };

const ONSITE_SETTINGS = { enabled: true, highPremiumPct: 5, navMismatchPct: 0.5, maxNavLagTradingDays: 1, concurrency: 2,
  sources: { exchangeOfficial: true, eastmoney: true } };

function textResource(body, url, contentType = "text/html") {
  return { bytes: Buffer.from(body), contentType, finalUrl: url };
}

function quote(overrides = {}) {
  return { code: "159941", name: "纳指ETF广发", manager: "广发基金", index: "nasdaq100", exchange: "SZSE", vehicle: "ETF",
    currency: "CNY", price: 1.649, priceAt: "2026-10-29T15:05:00+08:00", priceDate: "2026-10-29",
    refNav: 1.471, refNavKind: "reference-nav", refNavDate: "2026-10-29", nav: 1.471, navDate: "2026-10-29",
    premiumLivePct: 12.1, premiumLiveBasis: "reference-nav", premiumCalibratedPct: null, calibratedForDate: null,
    turnoverCny: 1225154601.647, applyStatus: "暂停申购", linksOtcCode: "270042",
    reliability: { grade: "A", reason: "trusted prior run" }, sources: [], observedAt: "2026-10-29T15:05:00+08:00",
    notes: [], ...overrides };
}

test("collector integrates onsite quotes, premium summary and exchange health", async () => {
  const config = { notifications: {}, portfolioMappings: {}, funds: [OTC_FUND], onsite: ONSITE_SETTINGS, onsiteFunds: [ONSITE_FUND] };
  const fetchResource = async (url) => {
    const target = String(url);
    if (target.includes("szse.cn/api/market")) return textResource(onsiteFixture("szse-quote-159941-etf.json"), url, "application/json");
    if (target.includes("f10/lsjz")) {
      return textResource(JSON.stringify({ Data: { LSJZList: [{ FSRQ: "2026-10-29", DWJZ: "1.471", SGZT: "暂停申购", SHZT: "场内卖出" }] }, ErrCode: 0 }), url, "application/json");
    }
    if (target.includes("jjfl_")) return textResource("管理费率 0.60% 托管费率 0.20% 销售服务费率 0.00%", url);
    return textResource("040046 单日单账户限额直销100元 限额申购", url);
  };
  const result = await run(config, { observedAt: "2026-10-30T15:05:00+08:00", fetchResource, save: false, baseDir: path.join(os.tmpdir(), `qdii-onsite-${process.pid}`) });
  assert.equal(result.rows.length, 1);
  assert.equal(result.schemaVersion, 4);
  assert.equal(result.quotes.length, 1);
  const onsite = result.quotes[0];
  assert.equal(onsite.code, "159941");
  assert.equal(onsite.reliability.grade, "A");
  assert.equal(onsite.premiumLivePct, 12.1);
  assert.equal(onsite.navDate, "2026-10-29");
  assert.equal(result.quotesByCode["159941"].code, "159941");
  assert.equal(result.premiumSummary.count, 1);
  assert.equal(result.premiumSummary.degraded, 0);
  assert.deepEqual(result.health.exchange, { officialOk: 1, fallback: 0, failed: 0, degradedCodes: [] });
  assert.deepEqual(result.closeByDate, { "2026-10-30": { "159941": 1.649 } });
  assert.equal(result.snapshot.quotes.length, 1);
  assert.deepEqual(result.snapshot.closeByDate, { "2026-10-30": { "159941": 1.649 } });
});

test("a failed onsite fetch carries forward the last trusted quote and never blocks OTC rows", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-onsite-carry-"));
  const dataDir = path.join(baseDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const trusted = quote();
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(buildSnapshot("2026-10-29T15:05:00+08:00", [], [], [], [trusted], { "2026-10-29": { "159941": 1.6 } })));
  const config = { notifications: {}, portfolioMappings: {}, funds: [OTC_FUND], onsite: ONSITE_SETTINGS, onsiteFunds: [ONSITE_FUND] };
  const fetchResource = async (url) => {
    const target = String(url);
    if (target.includes("szse.cn/api/market") || target.includes("f10/lsjz")) throw new Error("upstream unavailable");
    if (target.includes("jjfl_")) return textResource("管理费率 0.60% 托管费率 0.20% 销售服务费率 0.00%", url);
    return textResource("040046 单日单账户限额直销100元 限额申购", url);
  };
  const result = await run(config, { observedAt: "2026-10-30T15:05:00+08:00", fetchResource, save: false, baseDir });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].limitAmount, 100);
  assert.equal(result.quotes.length, 1);
  const onsite = result.quotes[0];
  assert.equal(onsite.carriedForward, true);
  assert.equal(onsite.reliability.grade, "A");
  assert.equal(onsite.observedAt, "2026-10-29T15:05:00+08:00");
  assert.equal(onsite.premiumLivePct, 12.1);
  assert.equal(result.snapshot.quotes[0].carriedForward, true);
  assert.equal(result.premiumSummary.count, 1);
  // A carried-forward quote is a degraded display: it counts as degraded but is excluded
  // from the high-premium list / calibrated stats (lead review decision C).
  assert.equal(result.premiumSummary.degraded, 1);
  assert.deepEqual(result.premiumSummary.highPremiumCodes, []);
  assert.deepEqual(result.health.exchange.degradedCodes, ["159941"]);
  assert.ok(result.warnings.some((warning) => /onsite quote\(s\) failed/.test(warning)));
});

test("a D-grade quote with no prior baseline stays an explicit unknown", async () => {
  const config = { notifications: {}, portfolioMappings: {}, funds: [], onsite: ONSITE_SETTINGS, onsiteFunds: [ONSITE_FUND] };
  const fetchResource = async (url) => {
    throw new Error(`upstream unavailable: ${url}`);
  };
  const result = await run(config, { observedAt: "2026-10-30T15:05:00+08:00", fetchResource, save: false, baseDir: path.join(os.tmpdir(), `qdii-onsite-d-${process.pid}`) });
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].reliability.grade, "D");
  assert.equal(result.quotes[0].premiumLivePct, null);
  assert.equal(result.quotes[0].carriedForward, false);
  assert.deepEqual(result.health.exchange, { officialOk: 0, fallback: 0, failed: 1, degradedCodes: ["159941"] });
  assert.equal(result.premiumSummary.degraded, 1);
  assert.equal(result.schemaVersion, 4);
  assert.deepEqual(result.closeByDate, {});
});
