"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mergeEventCache, readEventCache, readProcessedSources, reduceLimitEvents, updateNoticeTimeline } = require("../src/notice-events");

function event(overrides = {}) {
  return { fundCode: "270042", shareClass: "A", currency: "CNY", channel: { kind: "direct", access: "all" },
    action: "set-limit", amount: 50, effectiveAt: "2026-09-01", publishedAt: "2026-08-30",
    sourceUrl: "https://www.gffunds.com.cn/notice.pdf", sourceAdapter: "gf", ...overrides };
}

test("reduces a chronological notice event timeline", () => {
  const result = reduceLimitEvents([
    event(),
    event({ action: "suspend-all", amount: null, effectiveAt: "2026-09-02", sourceUrl: "https://www.gffunds.com.cn/suspend.pdf" }),
    event({ action: "resume", amount: null, effectiveAt: "2026-09-03", sourceUrl: "https://www.gffunds.com.cn/resume.pdf" }),
    event({ amount: 10, effectiveAt: "2026-09-04", sourceUrl: "https://www.gffunds.com.cn/latest.pdf" })
  ]);
  assert.equal(result.conflict, null);
  assert.equal(result.state.status, "limited");
  assert.equal(result.state.limitAmount, 10);
});

test("rejects conflicting limits with the same effective date", () => {
  const result = reduceLimitEvents([event(), event({ amount: 10, sourceUrl: "https://www.gffunds.com.cn/other.pdf" })]);
  assert.match(result.conflict, /conflicting limits/);
  assert.equal(result.state, null);
});

test("event cache persists history and replaces a re-parsed source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-events-"));
  try {
    mergeEventCache(root, "gf", "270042", [event()], "2026-09-01T00:00:00Z");
    mergeEventCache(root, "gf", "270042", [event({ amount: 10, effectiveAt: "2026-09-02" })], "2026-09-02T00:00:00Z");
    const cached = readEventCache(root, "gf", "270042");
    assert.equal(cached.length, 1);
    assert.equal(cached[0].amount, 10);
    assert.equal(cached[0].effectiveAt, "2026-09-02");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resume events do not inherit the prior numeric limit", () => {
  const result = reduceLimitEvents([event(), event({ action: "resume", amount: null, effectiveAt: "2026-09-02", sourceUrl: "https://www.gffunds.com.cn/resume.pdf" })]);
  assert.equal(result.state.status, "open");
  assert.equal(result.state.limitAmount, null);
});

test("event cache remembers rejected sources without creating events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-rejected-"));
  try {
    const rejected = "https://www.gffunds.com.cn/rejected.pdf";
    mergeEventCache(root, "gf", "270042", [], "2026-09-01T00:00:00Z", () => true, [rejected]);
    assert.deepEqual(readEventCache(root, "gf", "270042"), []);
    assert.deepEqual(readProcessedSources(root, "gf", "270042"), [rejected]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("timeline refuses an old event when the newest relevant notice failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-stale-"));
  try {
    mergeEventCache(root, "gf", "270042", [event()], "2026-09-01T00:00:00Z");
    const context = { observedAt: "2026-10-01T00:00:00Z", warnings: [], timeoutMs: 10, eventCacheDir: root,
      noticeHealth: { candidatesDiscovered: 0, newNotices: 0, parsedNotices: 0, rejectedNotices: 0, conflicts: 0, cacheFallbacks: 0 },
      fetchResource: async () => { throw new Error("unparseable"); } };
    const adapter = { id: "gf", allowedHosts: ["gffunds.com.cn"], salesUrl: () => "https://www.gffunds.com.cn/fund",
      parseResource: async () => [] };
    const fund = { code: "270042", name: "广发纳指", manager: "广发基金", adapter: "gf", currency: "CNY", shareClass: "A" };
    const result = await updateNoticeTimeline({ adapter, fund, context, candidates: [{ manager: "广发基金", title: "新公告", url: "https://www.gffunds.com.cn/new.pdf", publishedAt: "2026-09-02", fundCodes: [], currencyScope: "CNY", shareClasses: [], eventHint: "unknown" }] });
    assert.equal(result, null);
    assert.ok(context.warnings.some((warning) => warning.includes("latest relevant notice")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
