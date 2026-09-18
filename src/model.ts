"use strict";

import type { Channel, FeeObservation, FundStatus, HoldingObservation, Observation, ObservationInput, ReliabilityGrade, Snapshot, SnapshotChange } from "./types";

const STATUS = new Set<FundStatus>(["open", "limited", "suspended", "unavailable", "unknown"]);
const DIRECT_ACCESS = new Set(["web", "app", "counter", "all"]);
const AGENCY_ACCESS = new Set(["eastmoney", "alipay", "bank", "broker", "all"]);
const GRADES = new Set<ReliabilityGrade>(["A", "B", "C", "D"]);
const STRATEGIES = new Set(["active", "passive", "unknown"]);

function channelKey(channel: Channel) {
  return `${channel.kind}/${channel.access}${channel.name ? `/${channel.name}` : ""}`;
}

function observationKey(row: Pick<Observation, "fundCode" | "currency" | "shareClass" | "channel" | "accountBasis">) {
  return [row.fundCode, row.currency, row.shareClass || "", channelKey(row.channel), row.accountBasis].join("|");
}

function normalizeObservation(input: unknown): Observation {
  if (!input || typeof input !== "object") throw new Error("observation must be an object");
  const candidate = input as Partial<ObservationInput>;
  if (!/^\d{6}$/.test(String(candidate.fundCode || ""))) throw new Error("invalid fundCode");
  if (!STATUS.has(candidate.status as FundStatus)) throw new Error(`invalid status: ${candidate.status}`);
  if (!candidate.channel || !["direct", "agency"].includes(candidate.channel.kind)) throw new Error("invalid channel kind");
  if (!STRATEGIES.has(candidate.strategy || "unknown")) throw new Error(`invalid strategy: ${candidate.strategy}`);
  const allowed = candidate.channel.kind === "direct" ? DIRECT_ACCESS : AGENCY_ACCESS;
  if (!allowed.has(candidate.channel.access as never)) throw new Error(`invalid channel access: ${candidate.channel.access}`);
  if (!candidate.reliability || !GRADES.has(candidate.reliability.grade)) throw new Error("invalid reliability grade");
  if (candidate.status === "limited" && !(Number.isFinite(candidate.limitAmount) && candidate.limitAmount > 0)) {
    throw new Error("limited observation requires a positive limitAmount");
  }
  const row: Observation = {
    key: "",
    fundCode: String(candidate.fundCode), fundName: String(candidate.fundName || ""), manager: String(candidate.manager || ""),
    index: candidate.index || "nasdaq100", strategy: candidate.strategy || "unknown", currency: candidate.currency || "CNY", shareClass: candidate.shareClass || "",
    channel: candidate.channel, status: candidate.status as FundStatus, limitAmount: candidate.status === "limited" ? Number(candidate.limitAmount) : null,
    accountBasis: candidate.accountBasis || "single-fund-account-daily-cumulative", observedAt: candidate.observedAt || new Date().toISOString(),
    effectiveDate: candidate.effectiveDate || null, salesUrl: candidate.salesUrl || null, source: candidate.source || null,
    reliability: candidate.reliability, notes: candidate.notes || []
  };
  row.key = observationKey(row);
  return row;
}

function buildSnapshot(observedAt: string, rows: unknown[], fees: FeeObservation[] = [], holdings: HoldingObservation[] = []): Snapshot {
  const normalized = rows.map(normalizeObservation);
  return {
    schemaVersion: holdings.length ? 3 : (fees.length ? 2 : 1),
    observedAt,
    rows: normalized,
    byKey: Object.fromEntries(normalized.map((r) => [r.key, r])),
    ...(fees.length ? { fees, feesByFund: Object.fromEntries(fees.map((fee) => [fee.fundCode, fee])) } : {}),
    ...(holdings.length ? { holdings, holdingsByFund: Object.fromEntries(holdings.map((item) => [item.fundCode, item])) } : {})
  };
}

function compareSnapshots(before: Snapshot | null, after: Snapshot): SnapshotChange[] {
  if (!before || !before.byKey) return [];
  const changes: SnapshotChange[] = [];
  for (const [key, next] of Object.entries(after.byKey)) {
    const prior = before.byKey[key];
    if (!prior) { changes.push({ type: "channel-added", key, before: null, after: next }); continue; }
    if (prior.status !== next.status) { changes.push({ type: "status-changed", key, before: prior, after: next }); continue; }
    if ((prior.limitAmount ?? null) !== (next.limitAmount ?? null)) {
      const type = prior.limitAmount == null || next.limitAmount == null ? "amount-changed" :
        (next.limitAmount > prior.limitAmount ? "amount-increased" : "amount-decreased");
      changes.push({ type, key, before: prior, after: next });
    }
  }
  for (const [key, prior] of Object.entries(before.byKey)) {
    if (!after.byKey[key]) changes.push({ type: "channel-removed", key, before: prior, after: null });
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key));
}

export { buildSnapshot, channelKey, compareSnapshots, normalizeObservation, observationKey };
