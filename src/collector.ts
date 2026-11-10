"use strict";

import type { CollectorContext, FeeObservation, Fund, HoldingObservation, MonitorConfig, Observation, ObservationInput, PortfolioPlan, QuoteObservation, Snapshot } from "./types";

const path = require("node:path");
const { adapters: untypedAdapters } = require("./adapters");
const { collectEastmoney, collectManual } = require("./agency");
const { collectOperatingFees } = require("./fees");
const { collectHoldings } = require("./holdings");
const { DEFAULT_TIMEOUT_MS, fetchResource } = require("./http");
const { buildSnapshot, compareSnapshots, normalizeObservation } = require("./model") as typeof import("./model");
const { notify } = require("./notify");
const { emptyNoticeHealth } = require("./notice-events");
const { collectOnsiteQuotes } = require("./onsite/collect");
const { summarizeQuotes } = require("./onsite/premium");
const { readJson, saveRun } = require("./store");

const GRADE = { A: 4, B: 3, C: 2, D: 1 };
const adapters = untypedAdapters as Record<string, { collect: (fund: Fund, context: CollectorContext) => Promise<ObservationInput[]> }>;

function effectiveTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function prefersEvidence(row: Observation, prior: Observation): boolean {
  const gradeDifference = GRADE[row.reliability.grade] - GRADE[prior.reliability.grade];
  const rowTime = effectiveTime(row.effectiveDate);
  const priorTime = effectiveTime(prior.effectiveDate);
  const trustedNotices = row.reliability.grade !== "D" && prior.reliability.grade !== "D" &&
    row.source?.kind === "notice" && prior.source?.kind === "notice";
  if (trustedNotices && rowTime !== priorTime) return rowTime > priorTime;
  return gradeDifference > 0 || (gradeDifference === 0 && rowTime > priorTime);
}

function preferEvidence(rows: unknown[]): Observation[] {
  const selected = new Map<string, Observation>();
  for (const raw of rows) {
    const row = normalizeObservation(raw);
    const prior = selected.get(row.key);
    if (!prior || prefersEvidence(row, prior)) selected.set(row.key, row);
  }
  return [...selected.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const PINNED_NOTICE_CONFLICT_DAYS = 90;
const PINNED_NOTICE_REVIEW_DAYS = 180;

function auditStalePinnedNotices(funds: Fund[], rows: Observation[], observedAt: string, warnings: string[]): void {
  const pinned = new Map<string, { effectiveDate: string | null }>();
  for (const fund of funds) {
    for (const source of fund.officialSources || []) {
      if (source.kind === "notice" && source.url && source.effectiveDate) pinned.set(source.url, { effectiveDate: source.effectiveDate });
    }
  }
  const now = effectiveTime(observedAt);
  for (const row of rows) {
    if (row.channel.kind !== "direct" || row.source?.kind !== "notice" || row.status === "unknown") continue;
    const pin = pinned.get(row.source.url || "");
    if (!pin) continue;
    const pinnedTime = effectiveTime(pin.effectiveDate || row.effectiveDate);
    if (!Number.isFinite(pinnedTime) || pinnedTime === Number.NEGATIVE_INFINITY) continue;
    const ageDays = Math.floor((now - pinnedTime) / 86400000);
    if (ageDays < PINNED_NOTICE_CONFLICT_DAYS) continue;
    const agency = rows.find((item) => item.fundCode === row.fundCode && item.channel.kind === "agency");
    const conflict = Boolean(agency) && (agency!.status !== row.status ||
      (agency!.status === "limited" && row.status === "limited" && Number(agency!.limitAmount) !== Number(row.limitAmount)));
    if (conflict) {
      warnings.push(`${row.fundCode} ${row.channel.kind}/${row.channel.access}: pinned official notice is ${ageDays} days old and conflicts with the current public agency observation; direct amount withheld until official re-verification`);
      row.status = "unknown";
      row.limitAmount = null;
      row.reliability = { grade: "D", reason: "pinned official notice is stale and conflicts with the current public agency status; direct channel needs official re-verification" };
      row.notes = [...(row.notes || []), "Pinned notice is stale; configure latest-notice discovery for this manager."];
    } else if (ageDays >= PINNED_NOTICE_REVIEW_DAYS) {
      warnings.push(`${row.fundCode} ${row.channel.kind}/${row.channel.access}: pinned official notice is ${ageDays} days old; configure a latest-notice discovery source`);
    }
  }
}

function noticePageUrls(funds: Fund[]): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const fund of funds) {
    const source = (fund.officialSources || []).find((item) => item.kind === "notice-index" && item.url);
    if (source?.url) pages[fund.code] = source.url;
  }
  return pages;
}

function stableSnapshot(
  observedAt: string,
  rows: Observation[],
  before: Snapshot | null,
  fees: FeeObservation[] = [],
  holdings: HoldingObservation[] = [],
  quotes: QuoteObservation[] = [],
  closeByDate: Record<string, Record<string, number>> = {}
): Snapshot {
  const fresh = buildSnapshot(observedAt, rows, fees, holdings, quotes, closeByDate);
  if (!before?.byKey) return fresh;
  const stableRows = fresh.rows.map((row) => {
    const prior = before.byKey[row.key];
    return row.reliability.grade === "D" && prior && prior.reliability?.grade !== "D" ? prior : row;
  });
  const stableFees = fees.map((fee) => {
    const prior = before.feesByFund?.[fee.fundCode];
    return fee.reliability?.grade === "D" && prior && prior.reliability?.grade !== "D" ? prior : fee;
  });
  const stableHoldings = holdings.map((item) => {
    const prior = before.holdingsByFund?.[item.fundCode];
    return item.reliability?.grade === "D" && prior && prior.reliability?.grade !== "D" ? prior : item;
  });
  // A failed on-exchange fetch must not overwrite the last trusted A-C quote: keep the
  // prior value, mark it carriedForward and keep its original observedAt so the payload
  // never passes an old number off as a current one.
  const stableQuotes = quotes.map((quote) => {
    const prior = before.quotesByCode?.[quote.code];
    if (quote.reliability?.grade === "D" && prior && prior.reliability?.grade !== "D") {
      return {
        ...prior,
        linksOtcCode: quote.linksOtcCode,
        carriedForward: true,
        notes: [...(prior.notes || []), "Onsite data fetch failed this run; carried forward the last trusted value."]
      };
    }
    return quote;
  });
  return buildSnapshot(observedAt, stableRows, stableFees, stableHoldings, stableQuotes, closeByDate);
}

async function mapLimit<T, R>(items: T[], concurrency: number, iterator: (item: T, index: number) => Promise<R> | R): Promise<R[]> {
  const result = new Array<R>(items.length); let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await iterator(items[index], index); }
  });
  await Promise.all(workers); return result;
}

function shareFetches(fetchResource: CollectorContext["fetchResource"]): CollectorContext["fetchResource"] {
  const succeeded = new Map<string, Awaited<ReturnType<CollectorContext["fetchResource"]>>>();
  const inflight = new Map<string, ReturnType<CollectorContext["fetchResource"]>>();
  return (url, options) => {
    const key = `${options?.method || "GET"}\n${url}\n${options?.body || ""}\n${[...(options?.allowedHosts || [])].sort().join(",")}`;
    const cached = succeeded.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending;
    const task = Promise.resolve()
      .then(() => fetchResource(url, options))
      .then((resource) => {
        succeeded.set(key, resource);
        return resource;
      })
      .finally(() => {
        if (inflight.get(key) === task) inflight.delete(key);
      });
    inflight.set(key, task);
    return task;
  };
}

async function run(config: MonitorConfig, options: { observedAt?: string; fetchResource?: CollectorContext["fetchResource"]; baseDir?: string; save?: boolean } = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const warnings: string[] = [];
  const outputDir = path.resolve(options.baseDir || process.cwd(), config.outputDir || "data");
  const noticeHealth = emptyNoticeHealth();
  const context: CollectorContext = {
    observedAt,
    warnings,
    timeoutMs: config.fetch?.timeoutMs || DEFAULT_TIMEOUT_MS,
    fetchResource: shareFetches(options.fetchResource || fetchResource),
    eventCacheDir: options.save === false ? null : path.join(outputDir, "events"),
    noticeHealth
  };
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
  auditStalePinnedNotices(enabledFunds, rows, observedAt, warnings);
  const fetchedFees = ((await mapLimit(enabledFunds, config.fetch?.feeConcurrency || 1, (fund) => collectOperatingFees(fund, context))) as FeeObservation[])
    .sort((a, b) => a.fundCode.localeCompare(b.fundCode));
  const mappings = config.portfolioMappings || {};
  const plans = [...new Map<string, PortfolioPlan | null>(enabledFunds.map((fund) => {
    const mapping = mappings[fund.code];
    const plan = mapping ? { portfolioCode: mapping.portfolioCode, sourceCode: mapping.sourceCode, exposure: mapping.exposure } : null;
    return [plan ? `${plan.portfolioCode}|${plan.sourceCode}|${plan.exposure}` : `missing|${fund.code}`, plan];
  })).values()].filter((plan): plan is PortfolioPlan => plan !== null);
  const portfolioResults = await mapLimit(plans, config.fetch?.holdingsConcurrency || 3, (plan) => collectHoldings(plan, context));
  const portfolioByCode = new Map(portfolioResults.map((item) => [item.portfolioCode, item]));
  const fetchedHoldings: HoldingObservation[] = enabledFunds.map((fund) => {
    const mapping = mappings[fund.code];
    const item = mapping && portfolioByCode.get(mapping.portfolioCode);
    if (item) return { ...item, fundCode: fund.code };
    warnings.push(`${fund.code} holdings: portfolio source is not configured`);
    return { fundCode: fund.code, portfolioCode: fund.code, sourceCode: null, exposure: "unknown", asOf: null, items: [], observedAt,
      source: null, reliability: { grade: "D", reason: "holdings source is not configured" } };
  }).sort((a, b) => a.fundCode.localeCompare(b.fundCode));
  const before = readJson(path.join(outputDir, "state.json"), null) as Snapshot | null;
  const onsiteFunds = (config.onsiteFunds || []).filter((fund) => fund.enabled !== false);
  const onsiteEnabled = config.onsite?.enabled !== false && onsiteFunds.length > 0;
  let onsite: Awaited<ReturnType<typeof collectOnsiteQuotes>> | null = null;
  if (onsiteEnabled) {
    try {
      onsite = await collectOnsiteQuotes(onsiteFunds, config.onsite || {}, context, before?.closeByDate || {});
    } catch (error) {
      // On-exchange collection must never block the direct/agency quota part of the run.
      warnings.push(`onsite quotes: ${error.message}`);
    }
  }
  let fetchedQuotes: QuoteObservation[] = onsite?.quotes || [];
  let closeByDate = onsite?.closeByDate || before?.closeByDate || {};
  if (onsiteEnabled && !onsite && before?.quotes?.length) {
    fetchedQuotes = before.quotes.map((quote) => ({
      ...quote,
      carriedForward: true,
      notes: [...(quote.notes || []), "Onsite collection failed this run; carried forward the last trusted value."]
    }));
    warnings.push(`onsite collection failed; carried forward ${fetchedQuotes.length} last trusted quote(s)`);
  }
  const snapshot = stableSnapshot(observedAt, rows, before, fetchedFees, fetchedHoldings, fetchedQuotes, closeByDate);
  const fees = snapshot.fees || fetchedFees;
  const holdings = snapshot.holdings || fetchedHoldings;
  const quotes = snapshot.quotes || [];
  const finalCloseByDate = snapshot.closeByDate || closeByDate;
  const premiumSummary = summarizeQuotes(quotes, config.onsite || {}, observedAt);
  const exchangeHealth = onsite?.health || { officialOk: 0, fallback: 0, failed: 0, degradedCodes: [] };
  const changes = compareSnapshots(before, snapshot);
  const payload: any = {
    schemaVersion: 4,
    observedAt,
    rows,
    fees,
    holdings,
    quotes,
    quotesByCode: snapshot.quotesByCode || Object.fromEntries(quotes.map((quote) => [quote.code, quote])),
    premiumSummary,
    closeByDate: finalCloseByDate,
    changes,
    warnings,
    noticePages: noticePageUrls(enabledFunds),
    health: {
      status: rows.some((r) => r.reliability.grade !== "D") && noticeHealth.staleTimelines === 0 ? "ok" : "degraded",
      staleNoticeTimelines: noticeHealth.staleTimelines,
      exchange: exchangeHealth
    },
    noticeHealth,
    snapshot
  };
  const held = rows.filter((row) => {
    const prior = before?.byKey?.[row.key];
    return row.reliability.grade === "D" && prior && prior.reliability?.grade !== "D";
  }).length;
  if (held) warnings.push(`${held} degraded observation(s) did not overwrite the last trusted comparison baseline`);
  const heldFees = fetchedFees.filter((fee) => fee.reliability?.grade === "D" && before?.feesByFund?.[fee.fundCode]?.reliability?.grade !== "D").length;
  if (heldFees) warnings.push(`${heldFees} degraded fee record(s) reused the last trusted fee snapshot`);
  const heldHoldings = fetchedHoldings.filter((item) => item.reliability?.grade === "D" && before?.holdingsByFund?.[item.fundCode]?.reliability?.grade !== "D").length;
  if (heldHoldings) warnings.push(`${heldHoldings} degraded holdings record(s) reused the last trusted holdings snapshot`);
  const carriedQuotes = (snapshot.quotes || []).filter((quote) => quote.carriedForward === true).length;
  if (carriedQuotes) warnings.push(`${carriedQuotes} onsite quote(s) failed this run and the last trusted values were carried forward`);
  try { payload.notification = await notify(payload, config.notifications || {}); }
  catch (error) { payload.notification = { sent: false, reason: "webhook-error", message: error.message }; warnings.push(`notification failed: ${error.message}`); }
  if (options.save !== false) saveRun(outputDir, payload, config.historyLimit || 180);
  return payload;
}

export { auditStalePinnedNotices, mapLimit, noticePageUrls, preferEvidence, run, shareFetches, stableSnapshot };
