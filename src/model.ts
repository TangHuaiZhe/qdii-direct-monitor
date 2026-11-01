"use strict";

import type { Channel, FeeObservation, FundStatus, HoldingObservation, Observation, ObservationInput, QuoteObservation, RefNavKind, ReliabilityGrade, Snapshot, SnapshotChange } from "./types";

const STATUS = new Set<FundStatus>(["open", "limited", "suspended", "unavailable", "unknown"]);
const DIRECT_ACCESS = new Set(["web", "app", "counter", "all"]);
const AGENCY_ACCESS = new Set(["eastmoney", "alipay", "bank", "broker", "all"]);
const GRADES = new Set<ReliabilityGrade>(["A", "B", "C", "D"]);
const STRATEGIES = new Set(["active", "passive", "unknown"]);
const EXCHANGES = new Set(["SSE", "SZSE"]);
const VEHICLES = new Set(["ETF", "LOF"]);
const REF_NAV_KINDS = new Set<RefNavKind>(["iopv", "reference-nav", "previous-nav", "nav"]);
const PRICE_SOURCES = new Set(["official", "eastmoney"]);

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

function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid quote ${field}`);
  return value;
}

function normalizeQuote(input: unknown): QuoteObservation {
  if (!input || typeof input !== "object") throw new Error("quote must be an object");
  const candidate = input as Partial<QuoteObservation>;
  if (!/^\d{6}$/.test(String(candidate.code || ""))) throw new Error("invalid quote code");
  if (!EXCHANGES.has(String(candidate.exchange))) throw new Error(`invalid quote exchange: ${candidate.exchange}`);
  if (!VEHICLES.has(String(candidate.vehicle))) throw new Error(`invalid quote vehicle: ${candidate.vehicle}`);
  if (!candidate.reliability || !GRADES.has(candidate.reliability.grade)) throw new Error("invalid quote reliability grade");
  const price = optionalNumber(candidate.price, "price");
  if (price != null && price <= 0) throw new Error("invalid quote price");
  const refNav = optionalNumber(candidate.refNav, "refNav");
  if (refNav != null && refNav <= 0) throw new Error("invalid quote refNav");
  const nav = optionalNumber(candidate.nav, "nav");
  if (nav != null && nav <= 0) throw new Error("invalid quote nav");
  const turnoverCny = optionalNumber(candidate.turnoverCny, "turnoverCny");
  if (turnoverCny != null && turnoverCny < 0) throw new Error("invalid quote turnoverCny");
  const premiumLivePct = optionalNumber(candidate.premiumLivePct, "premiumLivePct");
  const premiumCalibratedPct = optionalNumber(candidate.premiumCalibratedPct, "premiumCalibratedPct");
  if (candidate.refNavKind != null && !REF_NAV_KINDS.has(candidate.refNavKind)) throw new Error(`invalid quote refNavKind: ${candidate.refNavKind}`);
  if (candidate.premiumLiveBasis != null && !REF_NAV_KINDS.has(candidate.premiumLiveBasis)) throw new Error(`invalid quote premiumLiveBasis: ${candidate.premiumLiveBasis}`);
  if (candidate.priceSource != null && !PRICE_SOURCES.has(candidate.priceSource)) throw new Error(`invalid quote priceSource: ${candidate.priceSource}`);
  return {
    code: String(candidate.code),
    name: String(candidate.name || ""),
    manager: String(candidate.manager || ""),
    index: String(candidate.index || ""),
    exchange: candidate.exchange as QuoteObservation["exchange"],
    vehicle: candidate.vehicle as QuoteObservation["vehicle"],
    currency: String(candidate.currency || "CNY"),
    price,
    priceAt: candidate.priceAt || null,
    priceDate: candidate.priceDate || null,
    priceSource: candidate.priceSource || null,
    refNav,
    refNavKind: candidate.refNavKind || null,
    refNavDate: candidate.refNavDate || null,
    nav,
    navDate: candidate.navDate || null,
    premiumLivePct,
    premiumLiveBasis: candidate.premiumLiveBasis || null,
    premiumCalibratedPct,
    calibratedForDate: candidate.calibratedForDate || null,
    turnoverCny,
    applyStatus: candidate.applyStatus || null,
    linksOtcCode: candidate.linksOtcCode || null,
    reliability: candidate.reliability,
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    observedAt: candidate.observedAt || new Date().toISOString(),
    notes: Array.isArray(candidate.notes) ? candidate.notes : [],
    carriedForward: candidate.carriedForward === true
  };
}

function buildSnapshot(
  observedAt: string,
  rows: unknown[],
  fees: FeeObservation[] = [],
  holdings: HoldingObservation[] = [],
  quotes: unknown[] = [],
  closeByDate: Record<string, Record<string, number>> = {}
): Snapshot {
  const normalized = rows.map(normalizeObservation);
  const normalizedQuotes = quotes.map(normalizeQuote);
  const hasCloses = Object.keys(closeByDate || {}).length > 0;
  return {
    schemaVersion: normalizedQuotes.length ? 4 : (holdings.length ? 3 : (fees.length ? 2 : 1)),
    observedAt,
    rows: normalized,
    byKey: Object.fromEntries(normalized.map((r) => [r.key, r])),
    ...(fees.length ? { fees, feesByFund: Object.fromEntries(fees.map((fee) => [fee.fundCode, fee])) } : {}),
    ...(holdings.length ? { holdings, holdingsByFund: Object.fromEntries(holdings.map((item) => [item.fundCode, item])) } : {}),
    ...(normalizedQuotes.length ? { quotes: normalizedQuotes, quotesByCode: Object.fromEntries(normalizedQuotes.map((quote) => [quote.code, quote])) } : {}),
    ...(hasCloses ? { closeByDate } : {})
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

export { buildSnapshot, channelKey, compareSnapshots, normalizeObservation, normalizeQuote, observationKey };
