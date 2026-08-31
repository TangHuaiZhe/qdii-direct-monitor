"use strict";

const STATUS = new Set(["open", "limited", "suspended", "unavailable", "unknown"]);
const DIRECT_ACCESS = new Set(["web", "app", "counter", "all"]);
const AGENCY_ACCESS = new Set(["eastmoney", "alipay", "bank", "broker", "all"]);
const GRADES = new Set(["A", "B", "C", "D"]);

function channelKey(channel) {
  return `${channel.kind}/${channel.access}${channel.name ? `/${channel.name}` : ""}`;
}

function observationKey(row) {
  return [row.fundCode, row.currency, row.shareClass || "", channelKey(row.channel), row.accountBasis].join("|");
}

function normalizeObservation(input) {
  if (!input || typeof input !== "object") throw new Error("observation must be an object");
  if (!/^\d{6}$/.test(String(input.fundCode || ""))) throw new Error("invalid fundCode");
  if (!STATUS.has(input.status)) throw new Error(`invalid status: ${input.status}`);
  if (!input.channel || !["direct", "agency"].includes(input.channel.kind)) throw new Error("invalid channel kind");
  const allowed = input.channel.kind === "direct" ? DIRECT_ACCESS : AGENCY_ACCESS;
  if (!allowed.has(input.channel.access)) throw new Error(`invalid channel access: ${input.channel.access}`);
  if (!input.reliability || !GRADES.has(input.reliability.grade)) throw new Error("invalid reliability grade");
  if (input.status === "limited" && !(Number.isFinite(input.limitAmount) && input.limitAmount > 0)) {
    throw new Error("limited observation requires a positive limitAmount");
  }
  const row = {
    fundCode: String(input.fundCode),
    fundName: String(input.fundName || ""),
    manager: String(input.manager || ""),
    index: input.index || "nasdaq100",
    currency: input.currency || "CNY",
    shareClass: input.shareClass || "",
    channel: { kind: input.channel.kind, access: input.channel.access, ...(input.channel.name ? { name: input.channel.name } : {}) },
    status: input.status,
    limitAmount: input.status === "limited" ? Number(input.limitAmount) : null,
    accountBasis: input.accountBasis || "single-fund-account-daily-cumulative",
    observedAt: input.observedAt || new Date().toISOString(),
    effectiveDate: input.effectiveDate || null,
    source: input.source || null,
    reliability: input.reliability,
    notes: input.notes || []
  };
  row.key = observationKey(row);
  return row;
}

function buildSnapshot(observedAt, rows, fees = []) {
  const normalized = rows.map(normalizeObservation);
  return {
    schemaVersion: fees.length ? 2 : 1,
    observedAt,
    rows: normalized,
    byKey: Object.fromEntries(normalized.map((r) => [r.key, r])),
    ...(fees.length ? { fees, feesByFund: Object.fromEntries(fees.map((fee) => [fee.fundCode, fee])) } : {})
  };
}

function compareSnapshots(before, after) {
  if (!before || !before.byKey) return [];
  const changes = [];
  for (const [key, next] of Object.entries(after.byKey || {})) {
    const prior = before.byKey[key];
    if (!prior) { changes.push({ type: "channel-added", key, before: null, after: next }); continue; }
    if (prior.status !== next.status) { changes.push({ type: "status-changed", key, before: prior, after: next }); continue; }
    if ((prior.limitAmount ?? null) !== (next.limitAmount ?? null)) {
      const type = prior.limitAmount == null || next.limitAmount == null ? "amount-changed" :
        (next.limitAmount > prior.limitAmount ? "amount-increased" : "amount-decreased");
      changes.push({ type, key, before: prior, after: next });
    }
  }
  for (const [key, prior] of Object.entries(before.byKey || {})) {
    if (!after.byKey[key]) changes.push({ type: "channel-removed", key, before: prior, after: null });
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key));
}

module.exports = { buildSnapshot, channelKey, compareSnapshots, normalizeObservation, observationKey };
