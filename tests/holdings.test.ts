"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectHoldings, marketLabel, parseHoldingsPayload } = require("../src/holdings");
const config = require("../config/funds.example.json");

function response(items = [{ name: "英伟达", code: "NVDA", percent: 7, xq_symbol: "NVDA", amarket: false }]) {
  return { result_code: 0, data: { source: "2026-06-30", stock_list: items } };
}

test("parses and limits a public holdings snapshot", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ name: "股票" + index, code: "US" + index, percent: index + 1 }));
  const parsed = parseHoldingsPayload(response(items));
  assert.equal(parsed.asOf, "2026-06-30");
  assert.equal(parsed.items.length, 10);
  assert.deepEqual(parsed.items[0], { rank: 1, code: "US0", name: "股票0", market: "美股", weight: 1 });
});

test("rejects empty, malformed, or unsafe holdings values", () => {
  assert.equal(parseHoldingsPayload(response([])), null);
  assert.equal(parseHoldingsPayload({ result_code: 0, data: { source: "June", stock_list: [] } }), null);
  assert.equal(parseHoldingsPayload(response([{ name: "苹果", code: "AAPL", percent: 101 }])), null);
});

test("labels supported stock markets without relying on the name", () => {
  assert.equal(marketLabel({ xq_symbol: "HK00700" }), "港股");
  assert.equal(marketLabel({ xq_symbol: "SH600519" }), "A股");
  assert.equal(marketLabel({ xq_symbol: "AAPL" }), "美股");
});

test("every configured fund has one explicit direct or look-through portfolio mapping", () => {
  for (const fund of config.funds.filter((item) => item.enabled !== false)) {
    const mapping = config.portfolioMappings[fund.code];
    assert.ok(mapping, fund.code);
    assert.match(mapping.sourceCode, /^\d{6}$/);
    assert.ok(["direct", "look-through"].includes(mapping.exposure), fund.code);
  }
});

test("collector emits a B-grade report-period snapshot", async () => {
  const context = { observedAt: "2026-09-06T00:00:00Z", timeoutMs: 10, warnings: [], fetchResource: async (url) => ({
    bytes: Buffer.from(JSON.stringify(response())), contentType: "application/json", finalUrl: url
  }) };
  const result = await collectHoldings({ portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through" }, context);
  assert.equal(result.reliability.grade, "B");
  assert.equal(result.asOf, "2026-06-30");
  assert.equal(result.items[0].code, "NVDA");
  assert.match(result.source.url, /^https:\/\/danjuanapp\.com\//);
});

test("collector uses only the declared credential-free HTTPS holdings endpoint", async () => {
  let options;
  const context = { observedAt: "2026-09-06T00:00:00Z", timeoutMs: 10, warnings: [], fetchResource: async (url, received) => {
    options = received;
    return { bytes: Buffer.from(JSON.stringify(response())), contentType: "application/json", finalUrl: url };
  } };
  await collectHoldings({ portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through" }, context);
  assert.deepEqual(options.allowedHosts, ["danjuanapp.com", "danjuanfunds.com"]);
});

test("collector fails closed when the payload shape changes", async () => {
  const context = { observedAt: "2026-09-06T00:00:00Z", timeoutMs: 10, warnings: [], fetchResource: async (url) => ({
    bytes: Buffer.from("{}"), contentType: "application/json", finalUrl: url
  }) };
  const result = await collectHoldings({ portfolioCode: "华安纳指ETF", sourceCode: "159632", exposure: "look-through" }, context);
  assert.equal(result.reliability.grade, "D");
  assert.deepEqual(result.items, []);
  assert.equal(context.warnings.length, 1);
});
