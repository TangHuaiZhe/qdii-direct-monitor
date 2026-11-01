"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  amountLabel,
  buildFunds,
  filterAndSortFunds,
  pickBestPurchasable,
  reliabilityReasonLabel
} = require("../miniapp/utils/funds");
const {
  buildOnsiteQuotes,
  filterOnsiteQuotes,
  findOnsiteQuote,
  onsiteReasonLabel,
  onsiteSummary
} = require("../miniapp/utils/onsite");
const { pinyinForms } = require("../miniapp/utils/pinyin");
const config = require("../config/funds.example.json");

function row(overrides = {}) {
  return {
    fundCode: "040046",
    fundName: "华安纳斯达克100ETF联接（QDII）A",
    manager: "华安基金",
    currency: "CNY",
    shareClass: "A",
    channel: { kind: "direct", access: "web" },
    status: "limited",
    limitAmount: 100,
    reliability: { grade: "A", reason: "official" },
    source: { url: "https://example.com/fund" },
    ...overrides
  };
}

test("miniapp ranks one best channel without adding channel limits", () => {
  const direct = row({ limitAmount: 100 });
  const agency = row({ channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, limitAmount: 500, reliability: { grade: "B" } });
  const best = pickBestPurchasable([direct, agency]);
  assert.equal(best, agency);
  assert.equal(amountLabel(best), "500 元");
});

test("miniapp never treats D-grade observations as purchasable", () => {
  const funds = buildFunds({
    rows: [row({ status: "open", limitAmount: null, reliability: { grade: "D" } })],
    fees: []
  });
  assert.equal(funds[0].purchasable, false);
  assert.equal(funds[0].bestAmountLabel, "暂无数据");
});

test("miniapp keeps direct and agency displays separate", () => {
  const funds = buildFunds({ rows: [
    row({ limitAmount: 100 }),
    row({ channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, limitAmount: 10, reliability: { grade: "B" } })
  ], fees: [] });
  assert.equal(funds[0].directAmountLabel, "100 元");
  assert.equal(funds[0].agencyAmountLabel, "10 元");
});

test("miniapp exposes the fund notice page and latest quota document", () => {
  const funds = buildFunds({ rows: [row({ source: { url: "https://example.com/notice.pdf", pageUrl: "https://example.com/notice/123.html" } })],
    fees: [], noticePages: { "040046": "https://example.com/notices/" } });
  assert.equal(funds[0].noticePageUrl, "https://example.com/notice/123.html");
  assert.equal(funds[0].noticePageHost, "example.com");
  assert.equal(funds[0].latestNoticeUrl, "https://example.com/notice.pdf");
});

test("miniapp falls back to the configured fund notice index", () => {
  const funds = buildFunds({ rows: [row()], fees: [], noticePages: { "040046": "https://example.com/notices/" } });
  assert.equal(funds[0].noticePageUrl, "https://example.com/notices/");
  assert.equal(funds[0].latestNoticeUrl, "https://example.com/fund");
});

test("miniapp decorates report-period look-through holdings", () => {
  const funds = buildFunds({ rows: [row()], fees: [], holdings: [{
    fundCode: "040046", sourceCode: "159632", exposure: "look-through", asOf: "2026-06-30",
    items: [{ rank: 1, code: "NVDA", name: "英伟达", market: "美股", weight: 7 }],
    reliability: { grade: "B" }, source: { url: "https://danjuanapp.com/holdings" }
  }] });
  assert.equal(funds[0].holding.scopeLabel, "目标 ETF 159632 穿透持仓");
  assert.equal(funds[0].holding.weightHeading, "占目标ETF净值");
  assert.equal(funds[0].holding.items[0].weightLabel, "7.00%");
});

test("miniapp localizes known reliability explanations", () => {
  assert.equal(
    reliabilityReasonLabel("current public agency sales page; logged-in order submission was not tested"),
    "当前代销公开页面，未验证登录后下单"
  );
});

test("miniapp filters by share class and sorts by fee", () => {
  const payload = {
    rows: [
      row(),
      row({ fundCode: "014978", fundName: "华安纳指 C", shareClass: "C", limitAmount: 10 })
    ],
    fees: [
      { fundCode: "040046", annualRate: 1, managementRate: 0.8, custodyRate: 0.2, reliability: { grade: "B" } },
      { fundCode: "014978", annualRate: 0.8, managementRate: 0.6, custodyRate: 0.2, reliability: { grade: "B" } }
    ]
  };
  const funds = buildFunds(payload);
  assert.deepEqual(filterAndSortFunds(funds, { shareClass: "C" }).map((fund) => fund.code), ["014978"]);
  assert.deepEqual(filterAndSortFunds(funds, { sort: "fee" }).map((fund) => fund.code), ["014978", "040046"]);
});

test("miniapp preserves and filters the explicit active/passive strategy", () => {
  const funds = buildFunds({ rows: [
    row({ strategy: "passive" }),
    row({ fundCode: "001668", fundName: "汇添富全球移动互联混合（QDII）人民币A", strategy: "active" })
  ], fees: [] });
  assert.equal(funds[0].strategyLabel, "被动");
  assert.equal(funds[1].strategyLabel, "主动");
  assert.deepEqual(filterAndSortFunds(funds, { strategy: "active" }).map((fund) => fund.code), ["001668"]);
});

test("miniapp searches fund names and managers by full pinyin or initials", () => {
  const funds = buildFunds({ rows: [
    row(),
    row({ fundCode: "016452", fundName: "南方纳斯达克100指数发起（QDII）A", manager: "南方基金" })
  ], fees: [] });
  assert.deepEqual(filterAndSortFunds(funds, { query: "hua an" }).map((fund) => fund.code), ["040046"]);
  assert.deepEqual(filterAndSortFunds(funds, { query: "hajj" }).map((fund) => fund.code), ["040046"]);
  assert.deepEqual(filterAndSortFunds(funds, { query: "nanfang" }).map((fund) => fund.code), ["016452"]);
  assert.deepEqual(filterAndSortFunds(funds, { query: "nfnsdk" }).map((fund) => fund.code), ["016452"]);
});

test("pinyin search dictionary covers every configured fund name and manager", () => {
  for (const fund of config.funds) {
    const [fullPinyin] = pinyinForms(fund.name + fund.manager);
    assert.doesNotMatch(fullPinyin, /[\u3400-\u9fff]/, fund.code);
  }
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
    priceDate: "2026-10-30",
    refNav: 1.966,
    refNavKind: "iopv",
    refNavDate: "2026-10-29",
    navDate: "2026-10-29",
    premiumLivePct: 13.89,
    premiumCalibratedPct: 2.14,
    calibratedForDate: "2026-10-29",
    turnoverCny: 456043207,
    applyStatus: "暂停申购",
    linksOtcCode: "016532",
    reliability: { grade: "A", reason: "current exchange quote matched with published NAV" },
    sources: [{ url: "http://yunhq.sse.com.cn:32041/v1/sh1/snap/513100", kind: "exchange-quote", adapter: "sse" }],
    observedAt: "2026-10-30T15:05:00+08:00",
    carriedForward: false,
    ...overrides
  };
}

function onsitePayload(overrides = {}) {
  const quotes = [
    onsiteQuote(),
    onsiteQuote({ code: "161125", name: "标普500LOF", manager: "易方达基金", index: "sp500", vehicle: "LOF", premiumCalibratedPct: null, premiumLivePct: 3.68, calibratedForDate: null, carriedForward: true, reliability: { grade: "C", reason: "carried forward: reused last trusted value" } }),
    onsiteQuote({ code: "159941", name: "纳指ETF广发", manager: "广发基金", premiumCalibratedPct: 8.42, premiumLivePct: null, linksOtcCode: null }),
    onsiteQuote({ code: "513500", name: "标普500ETF博时", manager: "博时基金", index: "sp500", price: null, refNav: null, premiumLivePct: null, premiumCalibratedPct: null, calibratedForDate: null, turnoverCny: null, reliability: { grade: "D", reason: "official quote unavailable; nav source unavailable" }, sources: [] })
  ];
  return {
    observedAt: "2026-10-30T15:05:00+08:00",
    rows: [],
    quotes,
    quotesByCode: Object.fromEntries(quotes.map((quote) => [quote.code, quote])),
    premiumSummary: {
      asOf: "2026-10-30T15:05:00+08:00",
      calibratedForDate: "2026-10-29",
      count: 4,
      degraded: 1,
      highPremiumCodes: ["159941", "513100"],
      thresholds: { highPremiumPct: 5, p25: 1.5, p75: 6, p90: 7.5 }
    },
    health: { status: "ok", exchange: { officialOk: 2, fallback: 1, failed: 1, degradedCodes: ["513500"] } },
    ...overrides
  };
}

test("miniapp reads onsite premium fields from latest.json", () => {
  const quotes = buildOnsiteQuotes(onsitePayload());
  assert.equal(quotes.length, 4);
  assert.deepEqual(quotes.map((quote) => quote.code), ["159941", "513100", "161125", "513500"]);
  const quote = findOnsiteQuote(onsitePayload(), "513100");
  assert.equal(quote.calibratedLabel, "+2.14%");
  assert.equal(quote.liveLabel, "+13.89%");
  assert.equal(quote.navDateLabel, "2026-10-29");
  assert.equal(quote.calibratedDateLabel, "校准日 2026-10-29");
  assert.equal(quote.refNavKindLabel, "IOPV参考净值");
  assert.equal(quote.priceLabel, "2.239");
  assert.equal(quote.turnoverLabel, "4.56 亿");
  assert.equal(quote.grade, "A");
  assert.equal(quote.gradeClass, "grade-A");
  assert.equal(quote.trusted, true);
  assert.equal(quote.reliabilityReason, "交易所官方行情与同日参考净值匹配，可校准");
});

test("miniapp marks onsite values as 待核验 instead of inventing numbers", () => {
  const quote = findOnsiteQuote(onsitePayload(), "513500");
  assert.equal(quote.calibratedLabel, "待核验");
  assert.equal(quote.liveLabel, "待核验");
  assert.equal(quote.calibratedBand, "unknown");
  assert.equal(quote.trusted, false);
  assert.equal(quote.priceLabel, "—");
  assert.equal(quote.reliabilityReason, "交易所官方行情不可用，已降级到第三方公开行情");
  assert.equal(onsiteReasonLabel("official exchange reference NAV cross-checked against the published unit NAV"), "交易所官方行情与已公布净值交叉校验一致");
  assert.equal(onsiteReasonLabel("no trading volume for this listing (possible suspension); premium withheld"), "当日无成交或停牌，不使用该价格");
  assert.equal(onsiteReasonLabel("premium unavailable"), "本次无法计算可信溢价，暂不展示数值");
  const empty = buildOnsiteQuotes({ rows: [] });
  assert.deepEqual(empty, []);
  const emptySummary = onsiteSummary({ rows: [] });
  assert.equal(emptySummary.hasData, false);
  assert.equal(emptySummary.highestLabel, "—");
});

test("miniapp keeps the original time on carried-forward onsite quotes", () => {
  const quote = findOnsiteQuote(onsitePayload(), "161125");
  assert.equal(quote.carriedForward, true);
  assert.equal(quote.carriedForwardLabel, "沿用上次可信值");
  assert.match(quote.originalTimeLabel, /原始时间 2026-10-30/);
  assert.equal(quote.calibratedLabel, "待核验");
  assert.equal(quote.liveLabel, "+3.68%");
});

test("miniapp onsite summary exposes calibrated date, highest premium and high count", () => {
  const summary = onsiteSummary(onsitePayload());
  assert.equal(summary.calibratedForDateLabel, "2026-10-29");
  assert.equal(summary.highestLabel, "+8.42%");
  assert.equal(summary.highestNote, "159941 纳指ETF广发");
  assert.equal(summary.medianLabel, "+5.28%");
  assert.equal(summary.highCount, 2);
  assert.equal(summary.count, 4);
  assert.equal(summary.trustedCount, 3);
  assert.equal(summary.hasData, true);
  assert.equal(summary.asOfLabel, "2026-10-30 15:05");
  assert.match(summary.healthLabel, /官方行情可用 2 只 · 降级 1 只 · 失败 1 只/);
});

test("miniapp filters onsite quotes by index and search", () => {
  const quotes = buildOnsiteQuotes(onsitePayload());
  assert.deepEqual(filterOnsiteQuotes(quotes, { index: "sp500" }).map((quote) => quote.code), ["161125", "513500"]);
  assert.deepEqual(filterOnsiteQuotes(quotes, { query: "513100" }).map((quote) => quote.code), ["513100"]);
  assert.deepEqual(filterOnsiteQuotes(quotes, { query: "guotai" }).map((quote) => quote.code), ["513100"].sort());
});

test("miniapp registers onsite pages and renders their key fields", () => {
  const root = path.resolve(__dirname, "..", "miniapp");
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  for (const page of ["pages/onsite/onsite", "pages/onsite-detail/onsite-detail"]) {
    assert.ok(app.pages.includes(page), page + " must be registered in app.json");
    for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
      assert.ok(fs.existsSync(path.join(root, page + extension)), page + extension + " must exist");
    }
  }
  const listWxml = fs.readFileSync(path.join(root, "pages/onsite/onsite.wxml"), "utf8");
  assert.match(listWxml, /\{\{item\.calibratedLabel\}\}/);
  assert.match(listWxml, /\{\{item\.liveLabel\}\}/);
  assert.match(listWxml, /\{\{item\.navDateLabel\}\}/);
  assert.match(listWxml, /沿用上次可信值/);
  assert.match(listWxml, /暂无可信场内数据/);
  const detailWxml = fs.readFileSync(path.join(root, "pages/onsite-detail/onsite-detail.wxml"), "utf8");
  assert.match(detailWxml, /\{\{quote\.calibratedLabel\}\}/);
  assert.match(detailWxml, /\{\{quote\.reliabilityReason\}\}/);
  assert.match(detailWxml, /关联场外份额/);
  const indexWxml = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
  assert.match(indexWxml, /openOnsite/);
});
