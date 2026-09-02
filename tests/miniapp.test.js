"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  amountLabel,
  buildFunds,
  filterAndSortFunds,
  pickBestPurchasable,
  reliabilityReasonLabel
} = require("../miniapp/utils/funds");
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
