"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config/funds.example.json");
const chinaamc = require("../src/adapters/chinaamc");
const { stableSnapshot } = require("../src/collector");
const { buildSnapshot } = require("../src/model");

test("S&P 500 OTC shares have explicit sources, portfolio mappings and onsite links", () => {
  const codes = ["050025", "006075", "018738", "161125", "012860", "018064", "018065"];
  for (const code of codes) {
    const fund = config.funds.find((item) => item.code === code);
    assert.equal(fund?.index, "sp500", code);
    assert.equal(fund?.strategy, "passive", code);
    assert.equal(fund?.currency, "CNY", code);
    assert.ok(fund?.shareClass && fund.officialSources?.length, code);
    assert.ok(config.portfolioMappings[code], code);
  }
  for (const [code, linked] of [["513500", "050025"], ["159655", "018064"], ["161125", "161125"]]) {
    assert.equal(config.onsiteFunds.find((fund) => fund.code === code)?.linkFundCode, linked);
  }
});

test("ChinaAMC S&P 500 ignores old index titles when the newest notice cannot be parsed", async () => {
  const fund = config.funds.find((item) => item.code === "018064");
  const listUrl = fund.officialSources[0].url;
  const list = '<div class="item"><a href="/c/2026-11-09/notice.shtml">华夏标普500ETF发起式联接（QDII）暂停申购公告</a></div><div class="item">2026-11-09</div>';
  const context = {
    observedAt: "2026-11-10T00:00:00Z", warnings: [], timeoutMs: 10, eventCacheDir: null,
    fetchResource: async (url) => ({ bytes: Buffer.from(url === listUrl ? list : "unrelated content"), contentType: "text/html", finalUrl: url })
  };
  const rows = await chinaamc.collect(fund, context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].reliability.grade, "D");
  assert.equal(rows[0].limitAmount, null);
});

test("carried-forward onsite quote picks up a new OTC link without refreshing its price", () => {
  const base = { code: "513500", name: "标普500ETF博时", manager: "博时基金", index: "sp500", exchange: "SSE", vehicle: "ETF", reliability: { grade: "A", reason: "prior official price" }, observedAt: "2026-11-09T07:00:00Z", price: 2, linksOtcCode: null };
  const before = buildSnapshot("2026-11-09T07:00:00Z", [], [], [], [base]);
  const failed = { ...base, reliability: { grade: "D", reason: "fetch failed" }, observedAt: "2026-11-10T07:00:00Z", price: null, linksOtcCode: "050025" };
  const after = stableSnapshot("2026-11-10T07:00:00Z", [], before, [], [], [failed]);
  assert.equal(after.quotes[0].linksOtcCode, "050025");
  assert.equal(after.quotes[0].price, 2);
  assert.equal(after.quotes[0].observedAt, "2026-11-09T07:00:00Z");
  assert.equal(after.quotes[0].carriedForward, true);
});
