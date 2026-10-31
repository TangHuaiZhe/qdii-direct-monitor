"use strict";

import type { CollectorContext, Fund, LimitEvent, NoticeCandidate, NoticeHealth, ObservationInput, Resource } from "./types";

const path = require("node:path");
const { readJson, writeAtomic } = require("./store");

function emptyNoticeHealth(): NoticeHealth {
  return { candidatesDiscovered: 0, newNotices: 0, parsedNotices: 0, rejectedNotices: 0, conflicts: 0, cacheFallbacks: 0 };
}

function eventKey(event: LimitEvent): string {
  return [event.fundCode, event.shareClass || "", event.currency, event.channel.kind, event.channel.access, event.channel.name || "", event.sourceUrl].join("|");
}

function validateEvent(event: unknown): event is LimitEvent {
  if (!event || typeof event !== "object") return false;
  const item = event as LimitEvent;
  if (!/^\d{6}$/.test(item.fundCode) || !/^20\d{2}-\d{2}-\d{2}$/.test(item.effectiveAt || "")) return false;
  if (!item.channel || item.channel.kind !== "direct" || !["web", "app", "counter", "all"].includes(item.channel.access)) return false;
  if (!["set-limit", "suspend-all", "resume", "confirm-restriction"].includes(item.action)) return false;
  return item.action !== "set-limit" || Boolean(Number.isFinite(item.amount) && Number(item.amount) > 0);
}

function normalizeEvent(event: LimitEvent): LimitEvent {
  return event.action === "set-limit" ? event : { ...event, amount: null };
}

function reduceLimitEvents(events: LimitEvent[]) {
  const valid = events.filter(validateEvent).sort((a, b) =>
    a.effectiveAt.localeCompare(b.effectiveAt) || String(a.publishedAt || "").localeCompare(String(b.publishedAt || "")) || a.sourceUrl.localeCompare(b.sourceUrl));
  if (!valid.length) return { state: null, conflict: null };
  for (const date of new Set(valid.map((event) => event.effectiveAt))) {
    const sameDayLimits = valid.filter((event) => event.effectiveAt === date && event.action === "set-limit");
    const amounts = new Set(sameDayLimits.map((event) => event.amount));
    if (amounts.size > 1) return { state: null, conflict: `conflicting limits effective ${date}: ${[...amounts].join(", ")}` };
  }
  let state: any = null;
  for (const event of valid) {
    if (event.action === "set-limit") state = { status: "limited", limitAmount: event.amount, event };
    else if (event.action === "suspend-all") state = { status: "suspended", limitAmount: null, event };
    else if (event.action === "resume") state = { status: "open", limitAmount: null, event };
    else if (state) state = { ...state, event };
    else state = { status: "unknown", limitAmount: null, event };
  }
  return { state, conflict: null };
}

function cacheFile(cacheDir: string, adapter: string, fundCode: string): string {
  return path.join(cacheDir, adapter, `${fundCode}.json`);
}

function readEventCache(cacheDir: string | null | undefined, adapter: string, fundCode: string): LimitEvent[] {
  if (!cacheDir) return [];
  const value = readJson(cacheFile(cacheDir, adapter, fundCode), { events: [] });
  return Array.isArray(value?.events) ? value.events.filter(validateEvent) : [];
}

function readProcessedSources(cacheDir: string | null | undefined, adapter: string, fundCode: string): string[] {
  if (!cacheDir) return [];
  const value = readJson(cacheFile(cacheDir, adapter, fundCode), { events: [], processedSources: [] });
  const fromEvents = Array.isArray(value?.events) ? value.events.map((event) => event?.sourceUrl) : [];
  const recorded = Array.isArray(value?.processedSources) ? value.processedSources : [];
  return [...new Set([...recorded, ...fromEvents].filter((url) => typeof url === "string" && /^https:\/\//.test(url)))];
}

function mergeEventCache(cacheDir: string | null | undefined, adapter: string, fundCode: string, events: LimitEvent[], observedAt: string, applies: (event: LimitEvent) => boolean = () => true, processedSources: string[] = []): LimitEvent[] {
  const merged = new Map(readEventCache(cacheDir, adapter, fundCode).filter(applies).map((event) => {
    const normalized = normalizeEvent(event);
    return [eventKey(normalized), normalized];
  }));
  for (const event of events.filter(validateEvent)) {
    const normalized = normalizeEvent(event);
    merged.set(eventKey(normalized), normalized);
  }
  const result = [...merged.values()].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  if (cacheDir) {
    const processed = [...new Set([...readProcessedSources(cacheDir, adapter, fundCode), ...processedSources])].sort();
    writeAtomic(cacheFile(cacheDir, adapter, fundCode), { schemaVersion: 1, updatedAt: observedAt, processedSources: processed, events: result });
  }
  return result;
}

async function updateNoticeTimeline(options: {
  adapter: any;
  fund: Fund;
  context: CollectorContext;
  candidates: NoticeCandidate[];
  fetchCandidate?: (candidate: NoticeCandidate) => Promise<Resource>;
}): Promise<ObservationInput | null> {
  const { adapter, fund, context, candidates } = options;
  if (context.noticeHealth) context.noticeHealth.candidatesDiscovered += candidates.length;
  const cachedUrls = new Set(readProcessedSources(context.eventCacheDir, adapter.id, fund.code));
  const freshEvents: LimitEvent[] = [];
  const processedSources: string[] = [];
  for (const candidate of candidates) {
    const cacheKey = candidate.cacheKey || candidate.url;
    if (cachedUrls.has(cacheKey)) continue;
    if (context.noticeHealth) context.noticeHealth.newNotices += 1;
    processedSources.push(cacheKey);
    try {
      const resource = options.fetchCandidate ? await options.fetchCandidate(candidate) : await context.fetchResource(candidate.url, { allowedHosts: adapter.allowedHosts, timeoutMs: context.timeoutMs });
      const parsed = await adapter.parseResource(resource, fund, { kind: "notice", channel: { kind: "direct", access: "all" } }, context.observedAt);
      const row = parsed.find((item) => item.status !== "unknown" && item.currency === (fund.currency || "CNY"));
      const action = candidate.eventHint === "confirm-restriction" ? "confirm-restriction" :
        (row?.status === "limited" ? "set-limit" : (row?.status === "suspended" ? "suspend-all" : (row?.status === "open" ? "resume" : null)));
      const effectiveAt = action === "confirm-restriction" ? candidate.publishedAt : row?.effectiveDate;
      if (!row || !action || !effectiveAt) {
        if (context.noticeHealth) context.noticeHealth.rejectedNotices += 1;
        continue;
      }
      freshEvents.push({ fundCode: fund.code, shareClass: fund.shareClass || null, currency: row.currency, channel: row.channel as any,
        action, amount: action === "set-limit" ? (row.limitAmount ?? null) : null, effectiveAt,
        publishedAt: candidate.publishedAt, sourceUrl: candidate.url, sourceAdapter: adapter.id });
      if (context.noticeHealth) context.noticeHealth.parsedNotices += 1;
    } catch (error) {
      if (context.noticeHealth) context.noticeHealth.rejectedNotices += 1;
      context.warnings.push(`${fund.code} ${adapter.id} notice failed: ${error.message}`);
    }
  }
  const applies = (event: LimitEvent) => event.currency === (fund.currency || "CNY") && (!event.shareClass || event.shareClass === (fund.shareClass || null));
  const cached = mergeEventCache(context.eventCacheDir, adapter.id, fund.code, freshEvents, context.observedAt, applies, processedSources);
  const { state, conflict } = reduceLimitEvents(cached);
  if (conflict) {
    if (context.noticeHealth) context.noticeHealth.conflicts += 1;
    context.warnings.push(`${fund.code} ${adapter.id} events: ${conflict}`);
    return null;
  }
  if (!state) return null;
  const latestCandidateDate = candidates.map((candidate) => candidate.publishedAt).filter(Boolean).sort().at(-1);
  if (latestCandidateDate && String(state.event.publishedAt || "") < latestCandidateDate) {
    context.warnings.push(`${fund.code} ${adapter.id} events: latest relevant notice ${latestCandidateDate} was not safely parsed`);
    return null;
  }
  const event = state.event;
  return { fundCode: fund.code, fundName: fund.name, manager: fund.manager, index: fund.index || "nasdaq100", strategy: fund.strategy || "unknown",
    currency: event.currency, shareClass: fund.shareClass || "", channel: event.channel, status: state.status, limitAmount: state.limitAmount,
    accountBasis: "single-fund-account-daily-cumulative", observedAt: context.observedAt, effectiveDate: event.effectiveAt,
    salesUrl: adapter.salesUrl(fund), source: { url: event.sourceUrl, kind: "notice", adapter: adapter.id },
    reliability: { grade: "B", reason: "official notice event timeline; actual logged-in transaction was not tested" }, notes: [] };
}

export { emptyNoticeHealth, eventKey, mergeEventCache, readEventCache, readProcessedSources, reduceLimitEvents, updateNoticeTimeline, validateEvent };
