"use strict";

/**
 * On-exchange quote collection: official exchange quote → Eastmoney public quote
 * fallback, with Eastmoney NAV history for the valuation date and cross-check.
 *
 * One fund's failure is isolated: it becomes a D-grade quote with null premium and a
 * warning, never an exception that would abort the whole run. `closeByDate` keeps the
 * last five trading-day closes per code so the calibrated (same-valuation-day) premium
 * can be computed once the NAV for that day is published.
 */

import type { CollectorContext, ExchangeHealth, OnsiteFund, OnsiteSettings, PremiumSummary, QuoteObservation, RefNavKind } from "../types";

const parse = require("./parse");
const { evaluatePremium, summarizeQuotes } = require("./premium");

const SSE_SELECT = "name,last,preclose,iopv,open,high,low,volume,amount";
const CLOSE_HISTORY_DAYS = 5;
const SSE_HOSTS = ["sse.com.cn"];
const SZSE_HOSTS = ["szse.cn"];
const EASTMONEY_HOSTS = ["eastmoney.com"];
/** The NAV endpoint silently returns ErrCode -999 without this Referer. */
const NAV_HEADERS = { Referer: "https://fundf10.eastmoney.com/" };

const { beijingDateOf, parseEastmoneyNav, parseEastmoneyQuote, parseSseSnapshot, parseSzseQuote } = parse;

interface ParsedQuote {
  name: string | null;
  price: number;
  priceDate: string;
  priceAt: string | null;
  refNav: number | null;
  refNavKind: RefNavKind | null;
  volume: number | null;
  amount: number | null;
}

interface OnsiteCollection {
  quotes: QuoteObservation[];
  closeByDate: Record<string, Record<string, number>>;
  summary: PremiumSummary;
  health: ExchangeHealth;
}

function decodeText(resource: { bytes: Buffer | Uint8Array }): string {
  return new TextDecoder("utf-8").decode(resource.bytes);
}

function emptyHealth(): ExchangeHealth {
  return { officialOk: 0, fallback: 0, failed: 0, degradedCodes: [] };
}

/**
 * SSE `snap` positions are positional, so the request must always use the canonical
 * `select`. We rebuild it from the configured URL instead of trusting a hand-edited
 * query string; SZSE returns a fixed object shape and its URL is used as configured.
 */
function officialQuoteUrl(fund: OnsiteFund): string {
  if (fund.exchange === "SSE") {
    const base = (fund.officialQuoteUrl || `http://yunhq.sse.com.cn:32041/v1/sh1/snap/${fund.code}`).split("?")[0];
    return `${base}?select=${SSE_SELECT}`;
  }
  return fund.officialQuoteUrl || `https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code=${fund.code}`;
}

function eastmoneyQuoteUrl(fund: OnsiteFund, code: string): string {
  const market = fund.exchange === "SSE" ? "1" : "0";
  return `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${code}&fields=f43,f57,f58,f59,f60`;
}

function eastmoneyNavUrl(code: string): string {
  return `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=2`;
}

async function mapLimit<T, R>(items: T[], concurrency: number, iterator: (item: T, index: number) => Promise<R> | R): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await iterator(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

function degradedQuote(fund: OnsiteFund, observedAt: string, reason: string): QuoteObservation {
  return {
    code: fund.code,
    name: fund.name || fund.code,
    manager: fund.manager || "",
    index: fund.index || "",
    exchange: fund.exchange,
    vehicle: fund.vehicle,
    currency: fund.currency || "CNY",
    price: null,
    priceAt: null,
    priceDate: null,
    priceSource: null,
    refNav: null,
    refNavKind: null,
    refNavDate: null,
    nav: null,
    navDate: null,
    premiumLivePct: null,
    premiumLiveBasis: null,
    premiumCalibratedPct: null,
    calibratedForDate: null,
    turnoverCny: null,
    applyStatus: null,
    linksOtcCode: fund.linkFundCode || null,
    reliability: { grade: "D", reason },
    sources: [],
    observedAt,
    notes: [reason],
    carriedForward: false
  };
}

interface FundCollection {
  quote: QuoteObservation;
  priceSource: "official" | "eastmoney" | null;
}

async function collectOne(fund: OnsiteFund, settings: OnsiteSettings, context: CollectorContext, closeByDate: Record<string, Record<string, number>>): Promise<FundCollection> {
  const warnings = context.warnings;
  const sources: { url: string; kind: string; adapter: string }[] = [];
  let priceSource: "official" | "eastmoney" | null = null;
  let price: number | null = null;
  let priceAt: string | null = null;
  let priceDate: string | null = null;
  let volume: number | null = null;
  let turnoverCny: number | null = null;
  let officialRefNav: number | null = null;
  let officialRefNavKind: RefNavKind | null = null;

  // 1. Official exchange quote (A-grade price).
  if (settings.sources?.exchangeOfficial !== false) {
    try {
      const url = officialQuoteUrl(fund);
      const resource = await context.fetchResource(url, {
        allowedHosts: fund.exchange === "SSE" ? SSE_HOSTS : SZSE_HOSTS,
        timeoutMs: context.timeoutMs
      });
      const parsed: ParsedQuote | null = fund.exchange === "SSE"
        ? parseSseSnapshot(decodeText(resource), fund.code)
        : parseSzseQuote(decodeText(resource), fund.code, fund.vehicle);
      if (!parsed) throw new Error("response was not safely parsed");
      priceSource = "official";
      price = parsed.price;
      priceAt = parsed.priceAt ?? null;
      priceDate = parsed.priceDate;
      volume = parsed.volume ?? null;
      turnoverCny = parsed.amount ?? null;
      officialRefNav = parsed.refNav ?? null;
      officialRefNavKind = parsed.refNavKind ?? null;
      sources.push({ url: resource.finalUrl || url, kind: "exchange-quote", adapter: fund.exchange === "SSE" ? "sse" : "szse" });
    } catch (error) {
      warnings.push(`${fund.code} onsite official quote: ${error.message}`);
    }
  }

  // 2. Eastmoney public quote fallback (B-grade price; no reference NAV available).
  if (price == null && settings.sources?.eastmoney !== false) {
    try {
      const url = eastmoneyQuoteUrl(fund, fund.code);
      const resource = await context.fetchResource(url, { allowedHosts: EASTMONEY_HOSTS, timeoutMs: context.timeoutMs });
      const parsed = parseEastmoneyQuote(decodeText(resource), fund.code);
      if (!parsed) throw new Error("response was not safely parsed");
      priceSource = "eastmoney";
      price = parsed.price;
      priceDate = beijingDateOf(context.observedAt);
      priceAt = priceDate ? context.observedAt : null;
      if (!priceDate) warnings.push(`${fund.code} onsite fallback quote: observation time is not a valid timestamp; price date unavailable`);
      sources.push({ url: resource.finalUrl || url, kind: "third-party-quote", adapter: "eastmoney" });
    } catch (error) {
      warnings.push(`${fund.code} onsite fallback quote: ${error.message}`);
    }
  }

  // 3. Eastmoney NAV history: valuation date, apply status and cross-check source.
  let nav: number | null = null;
  let navDate: string | null = null;
  let applyStatus: string | null = null;
  if (settings.sources?.eastmoney !== false) {
    try {
      const url = eastmoneyNavUrl(fund.code);
      const resource = await context.fetchResource(url, {
        allowedHosts: EASTMONEY_HOSTS,
        timeoutMs: context.timeoutMs,
        headers: NAV_HEADERS
      });
      const parsed = parseEastmoneyNav(decodeText(resource), fund.code);
      if (!parsed) throw new Error("response was not safely parsed");
      nav = parsed.nav;
      navDate = parsed.navDate;
      applyStatus = parsed.applyStatus ?? null;
      sources.push({ url: resource.finalUrl || url, kind: "nav", adapter: "eastmoney" });
    } catch (error) {
      warnings.push(`${fund.code} onsite NAV: ${error.message}`);
    }
  }

  const evaluation = evaluatePremium({
    code: fund.code,
    price,
    priceDate,
    priceSource,
    officialRefNav,
    officialRefNavKind,
    nav,
    navDate,
    volume,
    turnoverCny,
    closeByDate,
    settings
  });
  const notes: string[] = [...evaluation.notes];
  if (priceSource === "eastmoney") notes.push("Price timestamp is the observation time, not an exchange tick; the source is a third-party public quote.");

  const quote: QuoteObservation = {
    code: fund.code,
    name: fund.name || fund.code,
    manager: fund.manager || "",
    index: fund.index || "",
    exchange: fund.exchange,
    vehicle: fund.vehicle,
    currency: fund.currency || "CNY",
    price,
    priceAt,
    priceDate,
    priceSource,
    refNav: evaluation.refNav,
    refNavKind: evaluation.refNavKind,
    refNavDate: evaluation.refNavDate,
    nav,
    navDate,
    premiumLivePct: evaluation.premiumLivePct,
    premiumLiveBasis: evaluation.premiumLiveBasis,
    premiumCalibratedPct: evaluation.premiumCalibratedPct,
    calibratedForDate: evaluation.calibratedForDate,
    turnoverCny,
    applyStatus,
    linksOtcCode: fund.linkFundCode || null,
    reliability: evaluation.reliability,
    sources,
    observedAt: context.observedAt,
    notes,
    carriedForward: false
  };
  return { quote, priceSource };
}

/**
 * Merge the fresh closes into the persisted close history. Only entries from the most
 * recent CLOSE_HISTORY_DAYS dates are kept (string sort works for YYYY-MM-DD), which is
 * enough to calibrate premiums once the matching valuation-day NAV appears.
 *
 * Only official exchange closes are stored: an Eastmoney fallback price must never leak
 * into the calibration numerator, otherwise a B-grade third-party quote would silently
 * turn into an A-grade calibrated premium later.
 */
function mergeCloseByDate(existing: Record<string, Record<string, number>> = {}, quotes: QuoteObservation[] = []): Record<string, Record<string, number>> {
  const merged: Record<string, Record<string, number>> = {};
  for (const [date, byCode] of Object.entries(existing || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !byCode || typeof byCode !== "object") continue;
    const clean: Record<string, number> = {};
    for (const [code, close] of Object.entries(byCode)) {
      if (/^\d{6}$/.test(code) && typeof close === "number" && Number.isFinite(close) && close > 0) clean[code] = close;
    }
    if (Object.keys(clean).length) merged[date] = clean;
  }
  for (const quote of quotes) {
    if (quote.priceSource !== "official") continue;
    if (quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0 || !quote.priceDate) continue;
    const bucket = merged[quote.priceDate] || (merged[quote.priceDate] = {});
    bucket[quote.code] = quote.price;
  }
  const dates = Object.keys(merged).sort().slice(-CLOSE_HISTORY_DAYS);
  return Object.fromEntries(dates.map((date) => [date, merged[date]]));
}

async function collectOnsiteQuotes(
  funds: OnsiteFund[],
  settings: OnsiteSettings = {},
  context: CollectorContext,
  closeByDate: Record<string, Record<string, number>> = {}
): Promise<OnsiteCollection> {
  const active = (funds || []).filter((fund) => fund && fund.enabled !== false);
  const concurrency = Math.max(1, Number(settings.concurrency) || 2);
  const results = await mapLimit(active, concurrency, async (fund): Promise<FundCollection> => {
    try {
      return await collectOne(fund, settings, context, closeByDate);
    } catch (error) {
      context.warnings.push(`${fund.code} onsite: ${error.message}`);
      return { quote: degradedQuote(fund, context.observedAt, `onsite collection failed: ${error.message}`), priceSource: null };
    }
  });
  const quotes = results.map((result) => result.quote);
  const health: ExchangeHealth = {
    officialOk: results.filter((result) => result.priceSource === "official").length,
    fallback: results.filter((result) => result.priceSource === "eastmoney").length,
    failed: results.filter((result) => result.priceSource === null).length,
    degradedCodes: quotes.filter((quote) => quote.reliability.grade === "D").map((quote) => quote.code).sort()
  };
  return {
    quotes,
    closeByDate: mergeCloseByDate(closeByDate, quotes),
    summary: summarizeQuotes(quotes, settings, context.observedAt),
    health
  };
}

module.exports = {
  CLOSE_HISTORY_DAYS,
  NAV_HEADERS,
  SSE_SELECT,
  collectOnsiteQuotes,
  emptyHealth,
  mergeCloseByDate,
  officialQuoteUrl
};
