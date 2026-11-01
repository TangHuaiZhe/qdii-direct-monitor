"use strict";

/**
 * Premium (折溢价) calculation and reliability grading.
 *
 * Two measures, never mixed:
 *   premiumLivePct       = latest price / latest reference NAV − 1
 *   premiumCalibratedPct = close of valuation day D / NAV of valuation day D − 1
 *
 * Values are stored as percentage points (13.89 means +13.89%), rounded to 2 decimals
 * to match the display precision in the plan. Failing closed: a D-grade quote always
 * has null premium fields and an explicit note/reason; no number is ever invented.
 */

import type { OnsiteSettings, PremiumSummary, QuoteObservation, RefNavKind, Reliability, ReliabilityGrade } from "../types";

const DEFAULT_HIGH_PREMIUM_PCT = 5;
const DEFAULT_NAV_MISMATCH_PCT = 0.5;
const DEFAULT_MAX_NAV_LAG_TRADING_DAYS = 1;
/** Quantiles need at least one sample per quartile before they mean anything. */
const MIN_QUANTILE_SAMPLE = 4;

const REF_NAV_KINDS = new Set(["iopv", "reference-nav", "previous-nav", "nav"]);

interface PremiumInput {
  code: string;
  price: number | null;
  priceDate: string | null;
  priceSource: "official" | "eastmoney" | null;
  officialRefNav: number | null;
  officialRefNavKind: RefNavKind | null;
  nav: number | null;
  navDate: string | null;
  volume: number | null;
  turnoverCny?: number | null;
  closeByDate?: Record<string, Record<string, number>>;
  settings?: OnsiteSettings;
}

interface PremiumResult {
  refNav: number | null;
  refNavKind: RefNavKind | null;
  refNavDate: string | null;
  premiumLivePct: number | null;
  premiumLiveBasis: RefNavKind | null;
  premiumCalibratedPct: number | null;
  calibratedForDate: string | null;
  reliability: Reliability;
  notes: string[];
}

function settingNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function usable(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function premiumPercent(numerator: number, denominator: number): number {
  return roundPercent((numerator / denominator - 1) * 100);
}

/**
 * Number of weekdays strictly after `fromDate` up to and including `toDate`.
 * Weekdays are a deliberate approximation of trading days: CN/US holidays are not
 * modelled yet, so around holidays the computed lag can be overstated by one or two
 * days. That is acceptable for the >maxNavLagTradingDays downgrade because the rule
 * only ever annotates the live premium, never the calibrated one.
 */
function tradingDaysBetween(fromDate: string, toDate: string): number {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.NaN;
  let days = 0;
  for (let cursor = start + 86400000; cursor <= end; cursor += 86400000) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

function evaluatePremium(input: PremiumInput): PremiumResult {
  const settings = input.settings || {};
  const maxNavLag = settingNumber(settings.maxNavLagTradingDays, DEFAULT_MAX_NAV_LAG_TRADING_DAYS);
  const navMismatchPct = settingNumber(settings.navMismatchPct, DEFAULT_NAV_MISMATCH_PCT);
  const notes: string[] = [];
  const empty: PremiumResult = {
    refNav: null,
    refNavKind: null,
    refNavDate: null,
    premiumLivePct: null,
    premiumLiveBasis: null,
    premiumCalibratedPct: null,
    calibratedForDate: null,
    reliability: { grade: "D", reason: "premium unavailable" },
    notes
  };

  const price = usable(input.price);
  if (price == null || !input.priceDate) {
    notes.push("No usable exchange price for this listing; the premium is withheld.");
    return { ...empty, reliability: { grade: "D", reason: "price unavailable or invalid; premium withheld" } };
  }
  if (input.volume != null && Number.isFinite(input.volume) && input.volume <= 0) {
    notes.push("Trading volume is 0 (possible suspension); the quote is not executable and the premium is withheld.");
    return { ...empty, reliability: { grade: "D", reason: "no trading volume for this listing (possible suspension); premium withheld" } };
  }

  // SZSE reports a `prevNetValue` for LOF listings, but its valuation date is not
  // guaranteed to match the published NAV date (observed one day apart), and LOFs have
  // no IOPV. Using it as the denominator would produce a false source mismatch, so the
  // published unit NAV is the denominator for LOFs instead.
  const officialRefNav = input.officialRefNavKind === "previous-nav" ? null : usable(input.officialRefNav);
  const publishedNav = usable(input.nav);
  if (!officialRefNav && !publishedNav) {
    notes.push("Neither the official reference NAV nor the published unit NAV is available.");
    return { ...empty, reliability: { grade: "D", reason: "reference NAV and published NAV are both unavailable; premium withheld" } };
  }
  if (publishedNav != null && !input.navDate) {
    notes.push("The published NAV has no valuation date; premium timing cannot be verified.");
    return { ...empty, reliability: { grade: "D", reason: "published NAV date unavailable; premium withheld" } };
  }
  if (officialRefNav != null && publishedNav == null) {
    // Lead review decision A: the official reference NAV alone is enough to publish an
    // indicative live premium (B-grade). Only the cross-check and the calibrated measure
    // are unavailable. The valuation date cannot be confirmed without the published NAV,
    // so refNavDate stays null.
    const officialKind: RefNavKind = input.officialRefNavKind && REF_NAV_KINDS.has(input.officialRefNavKind) ? input.officialRefNavKind : "reference-nav";
    notes.push("The published unit NAV is unavailable; the official reference NAV could not be cross-checked against it, so the live premium stays indicative (B) and no calibrated premium is shown.");
    return {
      refNav: officialRefNav,
      refNavKind: officialKind,
      refNavDate: null,
      premiumLivePct: premiumPercent(price, officialRefNav),
      premiumLiveBasis: officialKind,
      premiumCalibratedPct: null,
      calibratedForDate: null,
      reliability: { grade: "B", reason: "official exchange reference NAV available; the published NAV cross-check is unavailable" },
      notes
    };
  }

  if (officialRefNav != null && publishedNav != null) {
    const deviationPct = Math.abs(officialRefNav - publishedNav) / publishedNav * 100;
    if (deviationPct > navMismatchPct) {
      notes.push(`Official reference NAV deviates from the published NAV by ${deviationPct.toFixed(2)}% (> ${navMismatchPct}%); the two sources disagree and no premium is shown.`);
      return { ...empty, reliability: { grade: "D", reason: `official reference NAV deviates from the published NAV by ${deviationPct.toFixed(2)}% (> ${navMismatchPct}%)` } };
    }
  }

  let refNav: number | null = null;
  let refNavKind: RefNavKind | null = null;
  let refNavDate: string | null = null;
  let grade: ReliabilityGrade = "A";
  let reason = "";

  if (officialRefNav != null) {
    refNav = officialRefNav;
    refNavKind = input.officialRefNavKind && REF_NAV_KINDS.has(input.officialRefNavKind) ? input.officialRefNavKind : "reference-nav";
    // The cross-check above proved the official reference NAV matches the published
    // NAV, so the published valuation date is the reference-NAV date as well.
    refNavDate = input.navDate;
    reason = "official exchange reference NAV cross-checked against the published unit NAV";
  } else {
    refNav = publishedNav;
    refNavKind = "nav";
    refNavDate = input.navDate;
    grade = "B";
    reason = "official reference NAV unavailable; the published unit NAV is used as the premium denominator";
    notes.push("Official reference NAV is unavailable; the published unit NAV is used as the live premium denominator.");
  }

  if (input.priceSource !== "official") {
    grade = "B";
    reason = "official exchange quote unavailable; using a third-party public quote with the published NAV";
    notes.push("Official exchange quote is unavailable; this quote comes from a third-party public source.");
  }

  const lagDays = input.navDate && input.priceDate ? tradingDaysBetween(input.navDate, input.priceDate) : Number.NaN;
  if (Number.isFinite(lagDays) && lagDays > maxNavLag) {
    grade = "C";
    reason = `published NAV lags the price date by ${lagDays} trading day(s) (> ${maxNavLag}); the live premium is indicative only`;
    notes.push(`Published NAV lags the price date by ${lagDays} trading day(s) (max ${maxNavLag}); the live premium includes the QDII time lag.`);
  }

  let premiumLivePct: number | null = null;
  let premiumLiveBasis: RefNavKind | null = null;
  if (refNav != null && refNav > 0) {
    premiumLivePct = premiumPercent(price, refNav);
    premiumLiveBasis = refNavKind;
  }

  let premiumCalibratedPct: number | null = null;
  let calibratedForDate: string | null = null;
  const valuationDate = input.navDate;
  const close = valuationDate ? input.closeByDate?.[valuationDate]?.[input.code] : null;
  if (valuationDate && publishedNav != null && typeof close === "number" && Number.isFinite(close) && close > 0) {
    premiumCalibratedPct = premiumPercent(close, publishedNav);
    calibratedForDate = valuationDate;
  }

  const minTurnover = settingNumber(settings.minTurnoverCny, 0);
  if (minTurnover > 0 && input.turnoverCny != null && Number.isFinite(input.turnoverCny) && input.turnoverCny < minTurnover) {
    notes.push(`Turnover ${input.turnoverCny} CNY is below minTurnoverCny ${minTurnover}; liquidity may not support arbitrage.`);
  }

  return {
    refNav,
    refNavKind,
    refNavDate,
    premiumLivePct,
    premiumLiveBasis,
    premiumCalibratedPct,
    calibratedForDate,
    reliability: { grade, reason },
    notes
  };
}

function quantile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return roundPercent(sorted[base] + rest * (next - sorted[base]));
}

/**
 * Cross-sectional summary for the dashboard.
 *
 * Statistics exclude `carriedForward` quotes: a value carried forward from a previous
 * run is a degraded display value, not a current observation, so it must not skew the
 * quantiles, the high-premium list or the calibrated date. It is still counted in
 * `degraded` (alongside D-grade quotes) and in the overall `count`.
 * Quantiles use available calibrated premiums only (the calibrated measure is the
 * primary one); when fewer than MIN_QUANTILE_SAMPLE calibrated values exist they stay
 * null instead of pretending to describe a distribution.
 */
function summarizeQuotes(quotes: QuoteObservation[] = [], settings: OnsiteSettings = {}, observedAt: string): PremiumSummary {
  const highPremiumPct = settingNumber(settings.highPremiumPct, DEFAULT_HIGH_PREMIUM_PCT);
  const active = quotes.filter((quote) => quote.carriedForward !== true);
  const calibrated = active
    .map((quote) => quote.premiumCalibratedPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sufficient = calibrated.length >= MIN_QUANTILE_SAMPLE;
  const thresholds = {
    highPremiumPct,
    p25: sufficient ? quantile(calibrated, 0.25) : null,
    p75: sufficient ? quantile(calibrated, 0.75) : null,
    p90: sufficient ? quantile(calibrated, 0.9) : null
  };
  const highPremiumCodes = active
    .filter((quote) => {
      const value = quote.premiumCalibratedPct ?? quote.premiumLivePct;
      return typeof value === "number" && Number.isFinite(value) && value >= highPremiumPct;
    })
    .map((quote) => quote.code)
    .sort();
  const calibratedForDate = active
    .map((quote) => quote.calibratedForDate)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) || null;
  return {
    asOf: observedAt,
    calibratedForDate,
    count: quotes.length,
    degraded: quotes.filter((quote) => quote.reliability?.grade === "D" || quote.carriedForward === true).length,
    highPremiumCodes,
    thresholds
  };
}

module.exports = {
  DEFAULT_HIGH_PREMIUM_PCT,
  DEFAULT_MAX_NAV_LAG_TRADING_DAYS,
  DEFAULT_NAV_MISMATCH_PCT,
  MIN_QUANTILE_SAMPLE,
  evaluatePremium,
  premiumPercent,
  summarizeQuotes,
  tradingDaysBetween
};
