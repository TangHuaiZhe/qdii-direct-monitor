"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { amountLabel, analyticsSnippet, feeBand, feeLabel, formatPremium, rankPurchasableFunds, reliabilityReasonLabel, renderFundHtml, renderHtml, renderOnsiteFundHtml, onsiteSectionHtml } = require("../src/report");

function payload(overrides = {}) {
  return { observedAt: "2026-08-29T04:47:59.125Z", gitCommit: "0123456789abcdef0123456789abcdef01234567", warnings: [], changes: [], fees: [{
    fundCode: "040046", managementRate: 0.6, custodyRate: 0.2, salesServiceRate: 0, annualRate: 0.8,
    reliability: { grade: "B", reason: "current public fee page" }, source: { url: "https://fundf10.eastmoney.com/jjfl_040046.html" }
  }], holdings: [{
    fundCode: "040046", portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through", asOf: "2026-06-30",
    items: [{ rank: 1, code: "NVDA", name: "英伟达", market: "美股", weight: 7 }], reliability: { grade: "B" },
    source: { url: "https://danjuanapp.com/djapi/fundx/base/fund/record/asset/percent?fund_code=159632" }
  }], rows: [{
    fundCode: "040046", fundName: "华安纳指", manager: "华安基金", currency: "CNY", shareClass: "A",
    channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100,
    salesUrl: "https://www.huaan.com.cn/funds/040046/index.shtml",
    reliability: { grade: "A", reason: "official" }, source: { url: "https://www.huaan.com.cn/funds/040046/index.shtml", kind: "product", adapter: "huaan" }
  }], ...overrides };
}

test("renders a self-contained Chinese HTML report", () => {
  const source = payload({ rows: [
    { ...payload().rows[0], strategy: "passive" },
    { ...payload().rows[0], fundCode: "001668", fundName: "主动示例基金", strategy: "active" }
  ] });
  const html = renderHtml(source);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /QDII 申购额度与费率/);
  assert.match(html, /网上直销/);
  assert.match(html, /100<small>元<\/small>/);
  assert.match(html, /来源与证据见各基金详情页/);
  assert.match(html, /0\.80%/);
  assert.match(html, /仅看可购买/);
  assert.match(html, /综合费率从低到高/);
  assert.match(html, /og:image/);
  assert.match(html, /qdii-direct-monitor\/og\.png/);
  assert.match(html, /--primary:#b4232f/);
  assert.match(html, /--primary-deep:#781322/);
  assert.match(html, /class="masthead"/);
  assert.match(html, /class="snapshot" aria-label="最新快照"/);
  assert.match(html, /<a class="skip-link" href="#fund-list">/);
  assert.match(html, /<caption class="sr-only">/);
  assert.match(html, /<th scope="col" aria-sort="none">/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /id="clear-filters"/);
  assert.match(html, /thead th\{position:sticky;top:0;/);
  assert.match(html, /id="refresh-page"/);
  assert.match(html, /commit <code>0123456<\/code>/);
  assert.match(html, /href="https:\/\/github\.com\/TangHuaiZhe\/qdii-direct-monitor\/commit\/0123456789abcdef0123456789abcdef01234567"/);
  assert.match(html, /class="github-link" href="https:\/\/github\.com\/TangHuaiZhe\/qdii-direct-monitor"/);
  assert.match(html, /aria-label="在 GitHub 查看本项目"/);
  assert.match(html, /window\.location\.reload\(\)/);
  assert.match(html, /data-column-sort="agency"/);
  assert.match(html, /data-column-sort="direct"/);
  assert.match(html, /data-column-sort="fee"/);
  assert.doesNotMatch(html, /reset-table-sort/);
  assert.match(html, /data-agency-amount=""/);
  assert.match(html, /data-direct-amount="100"/);
  assert.match(html, /columnSort\.direction === 1/);
  assert.match(html, /columnSort = null; sort\.value = "amount"/);
  assert.match(html, /placeholder="搜索名称、代码、公司或拼音"/);
  assert.match(html, /data-strategy-filter="passive"/);
  assert.match(html, /data-strategy-filter="active"/);
  assert.match(html, /strategy === "全部"/);
  assert.match(html, /strategy-badge strategy-passive/);
  assert.match(html, /\.strategy-active\{background:#fff0d6/);
  assert.match(html, /\.strategy-passive\{background:#e5f0ff/);
  assert.match(html, /data-search="[^"]*huaan[^"]*hajj/);
  assert.match(html, /class="index-chip manager-tone-\d" aria-hidden="true">华<\/span>/);
  assert.match(html, /\.manager-tone-5\{background:#f7e6df;color:#8a4933\}/);
});

test("renders the compact snapshot header and mobile card layout", () => {
  const html = renderHtml(payload());
  assert.match(html, /NASDAQ 100 · 场外份额监控/);
  assert.match(html, /class="masthead"/);
  assert.match(html, /class="snapshot" aria-label="最新快照"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /@media\(max-width:360px\)/);
  assert.doesNotMatch(html, /class="market-rail"/);
  assert.doesNotMatch(html, /class="hero-code"/);
  assert.doesNotMatch(html, />NDX</);
  assert.doesNotMatch(html, /linear-gradient/);
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

test("renders status and amount changes as readable before and after values", () => {
  const base = payload().rows[0];
  const html = renderHtml(payload({ changes: [{
    type: "status-changed",
    before: { ...base, status: "unknown", limitAmount: null },
    after: { ...base, status: "limited", limitAmount: 100 }
  }, {
    type: "amount-decreased",
    before: { ...base, status: "limited", limitAmount: 1000 },
    after: { ...base, status: "limited", limitAmount: 100 }
  }] }));
  assert.match(html, /本次申购状态与额度变化（2）/);
  assert.match(html, /网上直销：状态未知 → 限额申购 100 元/);
  assert.match(html, /网上直销：限额申购 1,000 元 → 限额申购 100 元/);
  assert.doesNotMatch(html, /status-changed|amount-decreased/);
});

test("renders an indexable fund detail page", () => {
  const html = renderFundHtml(payload(), "040046");
  assert.match(html, /华安纳指 040046/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /最高可信直销额度/);
  assert.match(html, /--primary:#b4232f/);
  assert.match(html, /class="fee-metric"/);
  assert.match(html, /十大持仓股/);
  assert.match(html, /目标 ETF 159632 穿透持仓/);
  assert.match(html, /英伟达/);
  assert.match(html, /NVDA/);
  assert.match(html, /7\.00%/);
  assert.match(html, /占目标 ETF 净值/);
  assert.match(html, /未经联接基金 ETF 仓位折算/);
  assert.match(html, /报告期 2026-06-30/);
  assert.match(html, /class="holdings-table"/);
  assert.match(html, /nth-child\(4\).*display:none/);
  assert.match(html, /\.metric \.fee-metric\{[^}]*background:#fff/);
  assert.match(html, /\.metric span\{color:#f6dfe2/);
});

test("renders fund notice page and latest quota document links on detail pages", () => {
  const source = payload({ noticePages: { "040046": "https://www.huaan.com.cn/notices/" }, rows: [{
    ...payload().rows[0],
    source: { url: "https://www.huaan.com.cn/notice.pdf", pageUrl: "https://www.huaan.com.cn/notice/123.shtml", kind: "notice", adapter: "huaan" }
  }] });
  const html = renderFundHtml(source, "040046");
  assert.match(html, /<h2>公告与额度来源<\/h2>/);
  assert.match(html, /href="https:\/\/www\.huaan\.com\.cn\/notice\/123\.shtml"[^>]*>基金公告页<\/a>/);
  assert.match(html, /class="evidence-url" href="https:\/\/www\.huaan\.com\.cn\/notice\/123\.shtml"[^>]*>https:\/\/www\.huaan\.com\.cn\/notice\/123\.shtml<\/a>/);
  assert.match(html, /href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"[^>]*>最新额度公告<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/www\.huaan\.com\.cn\/notices\/" target="_blank"[^>]*>基金公告页/);
});

test("falls back to the configured fund notice index when no notice page is recorded", () => {
  const source = payload({ noticePages: { "040046": "https://www.huaan.com.cn/notices/" } });
  const html = renderFundHtml(source, "040046");
  assert.match(html, /href="https:\/\/www\.huaan\.com\.cn\/notices\/"[^>]*>基金公告页<\/a>/);
});

test("renders explicit direct and agency detail links on list and detail pages", () => {
  const source = payload();
  source.rows.push({
    ...source.rows[0],
    channel: { kind: "agency", access: "eastmoney", name: "天天基金" },
    reliability: { grade: "B", reason: "current public agency sales page; logged-in order submission was not tested" },
    source: { url: "https://fund.eastmoney.com/040046.html", kind: "public-sales-page", adapter: "eastmoney" }
  });

  const listHtml = renderHtml(source);
  assert.match(listHtml, /前往直销官网/);
  assert.match(listHtml, /查看代销详情/);
  assert.match(listHtml, /href="https:\/\/www\.huaan\.com\.cn\/funds\/040046\/index\.shtml"/);
  assert.match(listHtml, /href="https:\/\/fund\.eastmoney\.com\/040046\.html"/);

  const detailHtml = renderFundHtml(source, "040046");
  assert.match(detailHtml, /class="sales-actions" aria-label="基金销售网站入口"/);
  assert.match(detailHtml, /class="sales-button"[^>]+>前往直销官网/);
  assert.match(detailHtml, /class="sales-button"[^>]+>查看代销详情/);
});

test("keeps notice evidence separate from the official direct sales link", () => {
  const source = payload({ rows: [{
    ...payload().rows[0],
    source: { url: "https://www.huaan.com.cn/notice.pdf", kind: "notice", adapter: "huaan" }
  }] });
  const listHtml = renderHtml(source);
  assert.match(listHtml, /前往直销官网/);
  assert.match(listHtml, /href="https:\/\/www\.huaan\.com\.cn\/funds\/040046\/index\.shtml"/);
  assert.doesNotMatch(listHtml, /href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"/);
  const detailHtml = renderFundHtml(source, "040046");
  assert.match(detailHtml, /href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"[^>]*>证据<\/a>/);
});

test("shows direct quota evidence URLs on the fund detail page instead of the dashboard", () => {
  const source = payload({ rows: [
    { ...payload().rows[0], source: { url: "https://www.huaan.com.cn/notice.pdf", kind: "notice", adapter: "huaan" } },
    { ...payload().rows[0], channel: { kind: "direct", access: "app" }, source: { url: "https://www.huaan.com.cn/app-notice.pdf", kind: "notice", adapter: "huaan" } }
  ] });
  const listHtml = renderHtml(source);
  assert.doesNotMatch(listHtml, /class="evidence-url"/);
  assert.doesNotMatch(listHtml, /href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"/);
  const detailHtml = renderFundHtml(source, "040046");
  assert.match(detailHtml, /class="evidence-url" href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf" target="_blank" rel="noopener noreferrer">https:\/\/www\.huaan\.com\.cn\/notice\.pdf<\/a>/);
  assert.match(detailHtml, /class="evidence-url" href="https:\/\/www\.huaan\.com\.cn\/app-notice\.pdf" target="_blank" rel="noopener noreferrer">https:\/\/www\.huaan\.com\.cn\/app-notice\.pdf<\/a>/);
});

test("keeps the dashboard list focused on status and sales entries", () => {
  const source = payload({ rows: [
    { ...payload().rows[0], source: { url: "https://www.huaan.com.cn/notice.pdf", kind: "notice", adapter: "huaan" } },
    { ...payload().rows[0], channel: { kind: "agency", access: "eastmoney", name: "天天基金" },
      reliability: { grade: "B", reason: "current public agency sales page; logged-in order submission was not tested" },
      source: { url: "https://fund.eastmoney.com/040046.html", kind: "public-sales-page", adapter: "eastmoney" } }
  ] });
  const listHtml = renderHtml(source);
  assert.doesNotMatch(listHtml, /class="evidence-url"/);
  assert.doesNotMatch(listHtml, /href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"/);
  assert.match(listHtml, /来源与证据见各基金详情页/);
  assert.match(listHtml, /href="funds\/040046\/"/);
  assert.match(renderFundHtml(source, "040046"), /class="evidence-url" href="https:\/\/www\.huaan\.com\.cn\/notice\.pdf"/);
});

test("shows the direct source URL on the fund detail page even when it matches the sales entry", () => {
  const detailHtml = renderFundHtml(payload(), "040046");
  assert.match(detailHtml, /class="evidence-url" href="https:\/\/www\.huaan\.com\.cn\/funds\/040046\/index\.shtml" target="_blank" rel="noopener noreferrer">https:\/\/www\.huaan\.com\.cn\/funds\/040046\/index\.shtml<\/a>/);
  assert.doesNotMatch(renderHtml(payload()), /class="evidence-url"/);
});

test("does not render insecure sales links", () => {
  const source = payload({ rows: [{
    ...payload().rows[0],
    salesUrl: "http://www.huaan.com.cn/funds/040046/index.shtml",
    source: { url: "https://www.huaan.com.cn/notice.pdf", kind: "notice", adapter: "huaan" }
  }, {
    ...payload().rows[0],
    channel: { kind: "agency", access: "eastmoney", name: "天天基金" },
    source: { url: "http://fund.eastmoney.com/040046.html", kind: "public-sales-page", adapter: "eastmoney" }
  }] });
  const html = renderHtml(source);
  assert.doesNotMatch(html, /前往直销官网/);
  assert.doesNotMatch(html, /查看代销详情/);
  assert.doesNotMatch(html, /class="evidence-url"|href="http:\/\//);
  assert.doesNotMatch(renderFundHtml(source, "040046"), /href="http:\/\//);
});

test("renders the configured non-Nasdaq-100 index label", () => {
  const source = payload();
  source.rows = source.rows.map((row) => ({ ...row, fundCode: "017091", fundName: "景顺长城纳斯达克科技ETF联接（QDII）A人民币", manager: "景顺长城基金", index: "nasdaqTechnology" }));
  const html = renderFundHtml(source, "017091");
  assert.match(html, /QDII Monitor \/ 纳斯达克科技 \/ 017091/);
  assert.doesNotMatch(html, /QDII Monitor \/ 纳斯达克100 \/ 017091/);
});

test("renders the global mobile internet index label", () => {
  const source = payload();
  source.rows = source.rows.map((row) => ({ ...row, fundCode: "001668", fundName: "汇添富全球移动互联混合（QDII）人民币A", manager: "汇添富基金", index: "globalMobileInternet" }));
  const html = renderFundHtml(source, "001668");
  assert.match(html, /QDII Monitor \/ 全球移动互联 \/ 001668/);
  assert.doesNotMatch(html, /QDII Monitor \/ 纳斯达克100 \/ 001668/);
});

test("renders the global technology index label", () => {
  const source = payload();
  source.rows = source.rows.map((row) => ({ ...row, fundCode: "005698", fundName: "华夏全球科技先锋混合（QDII）A人民币", manager: "华夏基金", index: "globalTechnology" }));
  const html = renderFundHtml(source, "005698");
  assert.match(html, /QDII Monitor \/ 全球科技先锋 \/ 005698/);
  assert.doesNotMatch(html, /QDII Monitor \/ 纳斯达克100 \/ 005698/);
});

test("surfaces stale notice discovery health", () => {
  const html = renderHtml(payload({ noticeHealth: { staleTimelines: 1, timelines: [
    { adapter: "cmf", fundCode: "019547", latestRelevantNotice: "2026-10-14", latestParsedEvent: "2026-07-27", checkedAt: "2026-10-31T00:00:00Z", status: "stale" }
  ] } }));
  assert.match(html, /id="notice-health"/);
  assert.match(html, /公告发现异常（1）/);
  assert.match(html, /019547/);
  assert.match(html, /2026-10-14/);
});

test("lists funds without a trusted direct observation in a collapsible footer section", () => {
  assert.doesNotMatch(renderHtml(payload()), /直销数据未抓取到的基金/);
  const base = payload().rows[0];
  const html = renderHtml(payload({ rows: [
    { ...base, fundCode: "000055", fundName: "广发纳指100ETF联接（QDII）美元A", manager: "广发基金", channel: { kind: "direct", access: "all" }, status: "unknown", limitAmount: null,
      salesUrl: "https://gfwx.gffunds.com.cn/funds/?fundcode=000055",
      reliability: { grade: "D", reason: "page fetched but current channel limit was not safely parsed" },
      source: { url: "https://www.gffunds.com.cn/funds/?fundcode=000055", kind: "product", adapter: "gf" } },
    { ...base, fundCode: "000055", fundName: "广发纳指100ETF联接（QDII）美元A", manager: "广发基金", channel: { kind: "agency", access: "eastmoney", name: "天天基金" }, status: "suspended", limitAmount: null,
      reliability: { grade: "B", reason: "current public agency sales page; logged-in order submission was not tested" },
      source: { url: "https://fund.eastmoney.com/000055.html", kind: "public-sales-page", adapter: "eastmoney" } }
  ] }));
  assert.match(html, /<details class="missing-section" id="missing-data">/);
  assert.match(html, /<summary>直销数据未抓取到的基金（1 只）<\/summary>/);
  assert.match(html, /1 只/);
  assert.match(html, /000055/);
  assert.match(html, /页面已抓取，但无法安全解析当前渠道额度/);
  assert.match(html, /href="https:\/\/gfwx\.gffunds\.com\.cn\/funds\/\?fundcode=000055"/);
  assert.match(html, /href="https:\/\/www\.gffunds\.com\.cn\/funds\/\?fundcode=000055"[^>]*>证据<\/a>/);
  assert.ok(html.indexOf('id="missing-data"') > html.indexOf('class="method"'), "missing section follows the main list");
  assert.ok(html.indexOf('id="missing-data"') < html.indexOf('class="footer"'), "missing section stays before the footer");
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
    linksOtcCode: null,
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

function normalOnsiteQuotes() {
  const specs = [
    ["159501", "纳指ETF嘉实", "嘉实基金", "nasdaq100", "SZSE", "ETF", 8.42, 16.84, "A"],
    ["159513", "纳斯达克100ETF大成", "大成基金", "nasdaq100", "SZSE", "ETF", 6.13, 8.73, "A"],
    ["159632", "纳斯达克ETF华安", "华安基金", "nasdaq100", "SZSE", "ETF", 5.77, 8.95, "B"],
    ["159659", "纳斯达克100ETF招商", "招商基金", "nasdaq100", "SZSE", "ETF", 7.21, 10.87, "A"],
    ["159660", "纳指ETF汇添富", "汇添富基金", "nasdaq100", "SZSE", "ETF", 6.68, 9.73, "A"],
    ["159696", "纳指ETF易方达", "易方达基金", "nasdaq100", "SZSE", "ETF", 7.95, 13.16, "A"],
    ["159941", "纳指ETF广发", "广发基金", "nasdaq100", "SZSE", "ETF", 5.42, 12.10, "C"],
    ["513100", "纳指ETF国泰", "国泰基金", "nasdaq100", "SSE", "ETF", 2.14, 13.89, "A"],
    ["513110", "纳指100ETF华泰柏瑞", "华泰柏瑞基金", "nasdaq100", "SSE", "ETF", 4.05, 8.75, "A"],
    ["513300", "纳斯达克ETF华夏", "华夏基金", "nasdaq100", "SSE", "ETF", 4.88, 9.74, "B"],
    ["513390", "纳指100ETF博时", "博时基金", "nasdaq100", "SSE", "ETF", 4.21, 9.67, "A"],
    ["513870", "纳指ETF富国", "富国基金", "nasdaq100", "SSE", "ETF", 5.12, 10.37, "A"],
    ["159612", "标普500ETF国泰", "国泰基金", "sp500", "SZSE", "ETF", 3.31, 6.45, "A"],
    ["159655", "标普500ETF华夏", "华夏基金", "sp500", "SZSE", "ETF", 2.87, 5.98, "B"],
    ["161125", "标普500LOF", "易方达基金", "sp500", "SZSE", "LOF", 1.02, 3.68, "B"],
    ["161130", "纳斯达克100LOF", "易方达基金", "nasdaq100", "SZSE", "LOF", 1.74, 5.34, "B"]
  ];
  return specs.map(([code, name, manager, index, exchange, vehicle, calibrated, live, grade]) => onsiteQuote({
    code,
    name,
    manager,
    index,
    exchange,
    vehicle,
    premiumCalibratedPct: calibrated,
    premiumLivePct: live,
    price: code === "513100" ? 2.239 : Number((calibrated + 1.5).toFixed(3)),
    refNav: 1.966,
    nav: 1.9663,
    navDate: "2026-10-29",
    refNavDate: "2026-10-29",
    calibratedForDate: "2026-10-29",
    turnoverCny: 456043207,
    reliability: { grade, reason: "current exchange quote matched with published NAV" },
    ...(code === "159941" ? {
      carriedForward: true,
      reliability: { grade: "C", reason: "carried forward: reused last trusted value" },
      observedAt: "2026-10-29T15:05:00+08:00"
    } : {}),
    ...(code === "513100" ? { linksOtcCode: "016532" } : {})
  }));
}

function degradedOnsiteQuotes() {
  return [
    onsiteQuote({
      code: "513500", name: "标普500ETF博时", manager: "博时基金", index: "sp500", exchange: "SSE", vehicle: "ETF",
      price: null, priceAt: null, priceDate: null, refNav: null, refNavKind: null, refNavDate: null, nav: null, navDate: null,
      premiumLivePct: null, premiumLiveBasis: null, premiumCalibratedPct: null, calibratedForDate: null, turnoverCny: null,
      reliability: { grade: "D", reason: "official quote unavailable; nav source unavailable" }, sources: []
    }),
    onsiteQuote({
      code: "513650", name: "标普500ETF南方", manager: "南方基金", index: "sp500", exchange: "SSE", vehicle: "ETF",
      price: null, priceAt: null, priceDate: null, refNav: null, refNavKind: null, refNavDate: null, nav: null, navDate: null,
      premiumLivePct: null, premiumLiveBasis: null, premiumCalibratedPct: null, calibratedForDate: null, turnoverCny: null,
      reliability: { grade: "D", reason: "no trading or trading suspended" }, sources: []
    })
  ];
}

function onsitePayload(overrides = {}) {
  const quotes = [...normalOnsiteQuotes(), ...degradedOnsiteQuotes()];
  return payload({
    quotes,
    quotesByCode: Object.fromEntries(quotes.map((quote) => [quote.code, quote])),
    premiumSummary: {
      asOf: "2026-10-30T15:05:00+08:00",
      calibratedForDate: "2026-10-29",
      count: 18,
      degraded: 2,
      highPremiumCodes: ["159501", "159696", "159659", "159660", "159513", "159632", "159941", "513870"],
      thresholds: { highPremiumPct: 5, p25: 1.5, p75: 6, p90: 7.5 }
    },
    health: { status: "ok", exchange: { officialOk: 15, fallback: 1, failed: 2, degradedCodes: ["513500", "513650"] } },
    ...overrides
  });
}

test("renders the onsite premium section after the purchase summary", () => {
  const html = renderHtml(onsitePayload());
  assert.match(html, /id="onsite-premium"/);
  assert.match(html, /<h2>场内折溢价<\/h2>/);
  assert.match(html, /场内折溢价 · 校准日 2026-10-29 · 18 只 · 抓取时间/);
  assert.match(html, /最高校准溢价/);
  assert.match(html, /校准溢价中位数/);
  assert.match(html, /高溢价只数/);
  assert.match(html, /\+8\.42%/);
  assert.match(html, /\+5\.00%/);
  assert.match(html, /8<small> \/ 16<\/small>/);
  assert.match(html, /校准溢价 = 同日收盘价 ÷ 同日单位净值 − 1/);
  assert.match(html, /不代表真实溢价，也不代表套利空间/);
  assert.match(html, /id="onsite-table"/);
  assert.match(html, /data-onsite-index-filter="nasdaq100"/);
  assert.match(html, /data-onsite-index-filter="sp500"/);
  assert.match(html, /data-onsite-vehicle-filter="ETF"/);
  assert.match(html, /data-onsite-vehicle-filter="LOF"/);
  assert.match(html, /href="onsite\/513100\/"/);
  assert.match(html, /官方可用 15 只 · 第三方降级 1 只 · 失败 2 只/);
  assert.ok(html.indexOf('data-onsite-code="161125"') < html.indexOf('data-onsite-code="159501"'), "onsite rows default to the lowest premium first");
  const collapsed = html.match(/<div class="onsite-top3">([\s\S]*?)<\/div><div class="onsite-all"/);
  assert.ok(collapsed, "onsite section starts collapsed with a top-3 list");
  assert.ok(collapsed[1].indexOf("161125") < collapsed[1].indexOf("161130"), "top-3 is ordered by ascending premium");
  assert.ok(collapsed[1].indexOf("161130") < collapsed[1].indexOf("513100"), "top-3 keeps the three lowest premiums");
  assert.match(collapsed[1], /查看全部 18 只/);
  assert.match(collapsed[1], /aria-expanded="false"/);
  assert.match(html, /<div class="onsite-all" id="onsite-all" hidden>/);
  assert.match(html, /getElementById\("onsite-toggle-all"\)/);
  assert.ok(html.indexOf("当前更方便购买") < html.indexOf('id="onsite-premium"'), "onsite section follows the purchase summary");
  assert.ok(html.indexOf('id="onsite-premium"') < html.indexOf('id="fund-list"'), "onsite section stays above the fund list");
  assert.match(html, /沿用上次可信值 · 原始时间/);
  assert.match(html, /2026年10月29日 15:05:00/);
  assert.match(html, /class="grade grade-D"/);
  assert.match(html, /待核验/);
  assert.match(html, /getElementById\("onsite-table"\)/);
  assert.match(html, /getElementById\("fund-body"\)/);
  assert.doesNotMatch(html, /href="http:\/\//);
});

test("onsite section shows the full list when nothing is eligible for the top-3", () => {
  const quotes = normalOnsiteQuotes().map((quote) => ({ ...quote, carriedForward: true }));
  const html = renderHtml(onsitePayload({
    quotes,
    quotesByCode: Object.fromEntries(quotes.map((quote) => [quote.code, quote]))
  }));
  assert.doesNotMatch(html, /class="onsite-top3"/);
  assert.match(html, /<div class="onsite-all" id="onsite-all">/);
  assert.doesNotMatch(html, /id="onsite-all" hidden/);
  assert.match(html, /data-onsite-code="161125"/);
});

test("onsite section refuses to fall back to old values without a trusted quote", () => {
  const emptyHtml = renderHtml(onsitePayload({ quotes: [], quotesByCode: {}, premiumSummary: null }));
  assert.match(emptyHtml, /暂无可信场内数据/);
  assert.match(emptyHtml, /本次数据没有场内行情记录，不显示历史值/);
  assert.doesNotMatch(emptyHtml, /id="onsite-table"/);
  assert.doesNotMatch(emptyHtml, /\+8\.42%/);

  const allDegraded = renderHtml(onsitePayload({
    quotes: degradedOnsiteQuotes(),
    quotesByCode: Object.fromEntries(degradedOnsiteQuotes().map((quote) => [quote.code, quote])),
    premiumSummary: { asOf: "2026-10-30T15:05:00+08:00", calibratedForDate: null, count: 2, degraded: 2, highPremiumCodes: [], thresholds: { highPremiumPct: 5, p25: null, p75: null, p90: null } }
  }));
  assert.match(allDegraded, /暂无可信场内数据/);
  assert.match(allDegraded, /本次抓取 2 只均为 D 级/);
  assert.match(allDegraded, /交易所官方行情不可用，已降级到第三方公开行情/);
  assert.match(allDegraded, /当日无成交或停牌/);
  assert.doesNotMatch(allDegraded, /id="onsite-table"/);
  assert.doesNotMatch(allDegraded, /\+8\.42%|13\.89%/);
});

test("renders an onsite detail page with metrics, evidence and the OTC link", () => {
  const html = renderOnsiteFundHtml(onsitePayload(), "513100");
  assert.match(html, /纳指ETF国泰 513100｜场内折溢价与参考净值/);
  assert.match(html, /rel="canonical" href="https:\/\/tanghuaizhe\.github\.io\/qdii-direct-monitor\/onsite\/513100\/"/);
  assert.match(html, /class="metric"/);
  assert.match(html, /\+2\.14%/);
  assert.match(html, /\+13\.89%/);
  assert.match(html, /校准溢价/);
  assert.match(html, /实时溢价/);
  assert.match(html, /2\.239/);
  assert.match(html, /1\.9660/);
  assert.match(html, /IOPV 参考净值/);
  assert.match(html, /4\.56 亿/);
  assert.match(html, /class="grade grade-A"/);
  assert.match(html, /http:\/\/yunhq\.sse\.com\.cn:32041\/v1\/sh1\/snap\/513100/);
  assert.match(html, /https:\/\/api\.fund\.eastmoney\.com\/f10\/lsjz\?fundCode=513100/);
  assert.match(html, /href="funds\/016532\/"/);
  assert.match(html, /查看场外份额 016532 的申购额度/);
  assert.match(html, /历史溢价不代表未来/);
  assert.match(html, /数据仅供核验，不构成投资建议/);
  assert.match(html, /--primary:#b4232f/);
  assert.match(html, /application\/ld\+json/);
});

test("onsite detail page marks carried-forward values with their original time", () => {
  const html = renderOnsiteFundHtml(onsitePayload(), "159941");
  assert.match(html, /沿用上次可信值 · 原始时间/);
  assert.match(html, /2026年10月29日 15:05:00/);
  assert.match(html, /不代表最新行情/);
});

test("onsite detail page renders D grades as 待核验 without inventing premiums", () => {
  const html = renderOnsiteFundHtml(onsitePayload(), "513500");
  assert.match(html, /class="grade grade-D"/);
  assert.match(html, /本次数据为 D 级/);
  assert.match(html, /交易所官方行情不可用/);
  assert.match(html, /待核验/);
  assert.doesNotMatch(html, /\+\d+\.\d\d%/);
});

test("onsite detail page rejects unknown codes and insecure external sources", () => {
  assert.equal(renderOnsiteFundHtml(onsitePayload(), "000000"), null);
  const malicious = onsiteQuote({ sources: [{ url: "http://evil.example.com/quote", kind: "exchange-quote", adapter: "evil" }] });
  const html = renderOnsiteFundHtml(onsitePayload({ quotes: [malicious], quotesByCode: { "513100": malicious } }), "513100");
  assert.doesNotMatch(html, /evil\.example\.com/);
  assert.match(html, /本次没有可公开展示的来源链接/);
});

test("localizes onsite reliability explanations", () => {
  assert.equal(reliabilityReasonLabel("current exchange quote matched with published NAV"), "交易所官方行情与同日参考净值匹配，可校准");
  assert.equal(reliabilityReasonLabel("official quote unavailable; used eastmoney quote"), "交易所官方行情不可用，已降级到第三方公开行情");
  assert.equal(reliabilityReasonLabel("carried forward: reused last trusted value"), "沿用上一次可信值，非本次抓取结果");
  assert.equal(reliabilityReasonLabel("official exchange reference NAV cross-checked against the published unit NAV"), "交易所官方行情与已公布净值交叉校验一致");
  assert.equal(reliabilityReasonLabel("official reference NAV unavailable; the published unit NAV is used as the premium denominator"), "交易所参考净值不可用，改用已公布单位净值作为分母");
  assert.equal(reliabilityReasonLabel("published NAV lags the price date by 2 trading day(s) (> 1); the live premium is indicative only"), "净值日期滞后，实时口径仅作参考，校准口径等待净值公布");
  assert.equal(reliabilityReasonLabel("no trading volume for this listing (possible suspension); premium withheld"), "当日无成交或停牌，不使用该价格");
  assert.equal(reliabilityReasonLabel("premium unavailable"), "本次无法计算可信溢价，暂不展示数值");
  assert.equal(reliabilityReasonLabel("premium unverified: some new agent reason"), "premium unverified: some new agent reason");
  assert.equal(formatPremium(2.14), "+2.14%");
  assert.equal(formatPremium(-1.2), "-1.20%");
  assert.equal(formatPremium(null), "待核验");
  assert.match(onsiteSectionHtml(onsitePayload()), /场内折溢价/);
});

test("injects Umami analytics only when a website id is configured", () => {
  const saved = { id: process.env.UMAMI_WEBSITE_ID, src: process.env.UMAMI_SCRIPT_URL };
  try {
    delete process.env.UMAMI_WEBSITE_ID;
    delete process.env.UMAMI_SCRIPT_URL;
    assert.equal(analyticsSnippet(), "");
    assert.doesNotMatch(renderHtml(payload()), /cloud\.umami\.is/);
    assert.doesNotMatch(renderFundHtml(payload(), "040046"), /cloud\.umami\.is/);

    process.env.UMAMI_WEBSITE_ID = "f4d3363b-69a2-4185-a565-c6b603b386e9";
    const snippet = analyticsSnippet();
    assert.match(snippet, /<script defer src="https:\/\/cloud\.umami\.is\/script\.js"/);
    assert.match(snippet, /data-website-id="f4d3363b-69a2-4185-a565-c6b603b386e9"/);
    assert.match(renderHtml(payload()), /data-website-id="f4d3363b-69a2-4185-a565-c6b603b386e9"><\/script><\/head>/);
    assert.match(renderFundHtml(payload(), "040046"), /data-website-id="f4d3363b-69a2-4185-a565-c6b603b386e9"><\/script><\/head>/);

    process.env.UMAMI_SCRIPT_URL = "http://insecure.example.com/script.js";
    assert.equal(analyticsSnippet(), "");
  } finally {
    if (saved.id === undefined) delete process.env.UMAMI_WEBSITE_ID; else process.env.UMAMI_WEBSITE_ID = saved.id;
    if (saved.src === undefined) delete process.env.UMAMI_SCRIPT_URL; else process.env.UMAMI_SCRIPT_URL = saved.src;
  }
});
