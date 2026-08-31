"use strict";

const path = require("node:path");
const { adapters } = require("./adapters");
const { collectEastmoney, collectManual } = require("./agency");
const { collectOperatingFees } = require("./fees");
const { fetchResource } = require("./http");
const { buildSnapshot, compareSnapshots, normalizeObservation } = require("./model");
const { notify } = require("./notify");
const { readJson, saveRun } = require("./store");

const GRADE = { A: 4, B: 3, C: 2, D: 1 };

function preferEvidence(rows) {
  const selected = new Map();
  for (const raw of rows) {
    const row = normalizeObservation(raw);
    const prior = selected.get(row.key);
    if (!prior || GRADE[row.reliability.grade] > GRADE[prior.reliability.grade]) selected.set(row.key, row);
  }
  return [...selected.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function stableSnapshot(observedAt, rows, before, fees = []) {
  const fresh = buildSnapshot(observedAt, rows, fees);
  if (!before?.byKey) return fresh;
  const stableRows = fresh.rows.map((row) => {
    const prior = before.byKey[row.key];
    return row.reliability.grade === "D" && prior && prior.reliability?.grade !== "D" ? prior : row;
  });
  const stableFees = fees.map((fee) => {
    const prior = before.feesByFund?.[fee.fundCode];
    return fee.reliability?.grade === "D" && prior?.reliability?.grade !== "D" ? prior : fee;
  });
  return buildSnapshot(observedAt, stableRows, stableFees);
}

async function mapLimit(items, concurrency, iterator) {
  const result = new Array(items.length); let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await iterator(items[index], index); }
  });
  await Promise.all(workers); return result;
}

async function run(config, options = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const warnings = [];
  const context = { observedAt, warnings, timeoutMs: config.fetch?.timeoutMs || 20000, fetchResource: options.fetchResource || fetchResource };
  const enabledFunds = config.funds.filter((f) => f.enabled !== false);
  const batches = await mapLimit(enabledFunds, config.fetch?.concurrency || 3, async (fund) => {
    const adapter = adapters[fund.adapter];
    if (!adapter) throw new Error(`unknown adapter for ${fund.code}: ${fund.adapter}`);
    const [direct, agency] = await Promise.all([
      adapter.collect(fund, context),
      fund.agency?.eastmoney === false ? Promise.resolve([]) : collectEastmoney(fund, context).then((row) => [row])
    ]);
    return [...direct, ...agency, ...collectManual(fund, observedAt, warnings)];
  });
  const rows = preferEvidence(batches.flat());
  const fetchedFees = (await mapLimit(enabledFunds, config.fetch?.feeConcurrency || 1, (fund) => collectOperatingFees(fund, context)))
    .sort((a, b) => a.fundCode.localeCompare(b.fundCode));
  const outputDir = path.resolve(options.baseDir || process.cwd(), config.outputDir || "data");
  const before = readJson(path.join(outputDir, "state.json"), null);
  const snapshot = stableSnapshot(observedAt, rows, before, fetchedFees);
  const fees = snapshot.fees || fetchedFees;
  const changes = compareSnapshots(before, snapshot);
  const payload = { schemaVersion: 2, observedAt, rows, fees, changes, warnings, health: { status: rows.some((r) => r.reliability.grade !== "D") ? "ok" : "degraded" }, snapshot };
  const held = rows.filter((row) => {
    const prior = before?.byKey?.[row.key];
    return row.reliability.grade === "D" && prior && prior.reliability?.grade !== "D";
  }).length;
  if (held) warnings.push(`${held} degraded observation(s) did not overwrite the last trusted comparison baseline`);
  const heldFees = fetchedFees.filter((fee) => fee.reliability?.grade === "D" && before?.feesByFund?.[fee.fundCode]?.reliability?.grade !== "D").length;
  if (heldFees) warnings.push(`${heldFees} degraded fee record(s) reused the last trusted fee snapshot`);
  try { payload.notification = await notify(payload, config.notifications || {}); }
  catch (error) { payload.notification = { sent: false, reason: "webhook-error", message: error.message }; warnings.push(`notification failed: ${error.message}`); }
  if (options.save !== false) saveRun(outputDir, payload, config.historyLimit || 180);
  return payload;
}

module.exports = { mapLimit, preferEvidence, run, stableSnapshot };
