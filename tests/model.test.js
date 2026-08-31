"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSnapshot, compareSnapshots, normalizeObservation, observationKey } = require("../src/model");

function row(overrides = {}) {
  return { fundCode: "040046", fundName: "华安纳指", manager: "华安", currency: "CNY", shareClass: "A",
    channel: { kind: "direct", access: "web" }, status: "limited", limitAmount: 100, observedAt: "2026-08-29T00:00:00Z",
    reliability: { grade: "A", reason: "test" }, ...overrides };
}

test("snapshot key separates direct web from direct counter", () => {
  assert.notEqual(observationKey(normalizeObservation(row())), observationKey(normalizeObservation(row({ channel: { kind: "direct", access: "counter" } }))));
});

test("snapshot key separates Eastmoney from bank agency", () => {
  const a = normalizeObservation(row({ channel: { kind: "agency", access: "eastmoney", name: "天天基金" } }));
  const b = normalizeObservation(row({ channel: { kind: "agency", access: "bank", name: "招商银行" } }));
  assert.notEqual(a.key, b.key);
});

test("limited status requires amount", () => {
  assert.throws(() => normalizeObservation(row({ limitAmount: null })), /positive/);
});

test("compare detects increase and status changes", () => {
  const before = buildSnapshot("a", [row()]);
  const after = buildSnapshot("b", [row({ limitAmount: 1000 })]);
  assert.equal(compareSnapshots(before, after)[0].type, "amount-increased");
  const suspended = buildSnapshot("c", [row({ status: "suspended", limitAmount: null })]);
  assert.equal(compareSnapshots(after, suspended)[0].type, "status-changed");
});
