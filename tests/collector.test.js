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

test("collector runs with an injected official source and no persistence", async () => {
  const config = { notifications: {}, funds: [{ code: "040046", name: "华安纳指", manager: "华安基金", adapter: "huaan", currency: "CNY", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "product" }], agency: { eastmoney: false } }] };
  const fetchResource = async (url) => ({ bytes: Buffer.from("040046 单日单账户限额直销100元 限额申购"), contentType: "text/html", finalUrl: url });
  const result = await run(config, { observedAt: "2026-08-29T00:00:00Z", fetchResource, save: false, baseDir: path.join(os.tmpdir(), `qdii-test-${process.pid}`) });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].limitAmount, 100);
  assert.equal(result.notification.reason, "no-changes");
});
