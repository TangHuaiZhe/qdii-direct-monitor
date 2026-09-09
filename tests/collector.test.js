"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { preferEvidence, run, stableSnapshot } = require("../src/collector");
const { buildSnapshot, compareSnapshots } = require("../src/model");

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
});
