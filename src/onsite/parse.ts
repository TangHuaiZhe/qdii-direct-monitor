"use strict";

/**
 * Pure parsers for on-exchange QDII quote/NAV sources.
 *
 * Every parser fails closed: malformed JSON, a mismatched fund code, a missing or
 * non-finite required field or a non-positive NAV/price returns `null`. No default
 * value (0, guess, previous value) is ever substituted here — callers must degrade
 * to reliability D instead of inventing a number.
 */

import type { RefNavKind } from "../types";

const SSE_SELECT_FIELDS = ["name", "last", "preclose", "iopv", "open", "high", "low", "volume", "amount"] as const;
const FUND_CODE = /^\d{6}$/;

function isFundCode(value: unknown): boolean {
  return FUND_CODE.test(String(value || ""));
}

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Nullable numeric field. Missing/empty values become null; anything that is present
 * but not finite is treated as a parse failure (throws, caught by the caller).
 */
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number)) throw new Error("non-finite numeric field");
  return number;
}

function optionalPositive(value: unknown): number | null {
  const number = optionalNumber(value);
  return number != null && number > 0 ? number : null;
}

function optionalNonNegative(value: unknown): number | null {
  const number = optionalNumber(value);
  return number != null && number >= 0 ? number : null;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

function buildDate(year: number, month: number, day: number): string | null {
  if (![year, month, day].every(Number.isInteger)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `20261030` (SSE compact date) → `2026-10-30`. */
function parseCompactDate(value: unknown): string | null {
  const raw = String(value ?? "");
  if (!/^\d{8}$/.test(raw)) return null;
  return buildDate(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8)));
}

/** `162902` / `93002` (SSE compact time) → `16:29:02` / `09:30:02`. */
function parseCompactTime(value: unknown): string | null {
  const raw = String(value ?? "");
  if (!/^\d{5,6}$/.test(raw)) return null;
  const padded = raw.padStart(6, "0");
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  const second = Number(padded.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** `2026-10-30 15:30[:00]` / `2026-10-30` → { date, time }. */
function parseDateTime(value: unknown): { date: string; time: string | null } | null {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const date = buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!date) return null;
  if (match[4] == null) return { date, time: null };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { date, time: `${pad(hour)}:${pad(minute)}:${pad(second)}` };
}

function beijingIso(date: string, time: string | null): string | null {
  return time ? `${date}T${time}+08:00` : null;
}

/**
 * Shanghai Stock Exchange snapshot:
 *   {"code":"513100","date":20261030,"time":162902,
 *    "snap":["纳指ETF",2.2390,null,1.9660,2.2410,2.2580,2.2340,202945148,456043207]}
 * `snap` order is fixed by the `select` query: name,last,preclose,iopv,open,high,low,volume,amount.
 */
function parseSseSnapshot(input: string, expectedCode: string): any | null {
  try {
    if (!isFundCode(expectedCode)) return null;
    const payload = JSON.parse(String(input || ""));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (String(payload.code ?? "") !== String(expectedCode)) return null;
    const snap = payload.snap;
    if (!Array.isArray(snap) || snap.length < SSE_SELECT_FIELDS.length) return null;
    const name = text(snap[0]) || null;
    const last = optionalPositive(snap[1]);
    if (!name || last == null) return null;
    const preclose = optionalPositive(snap[2]);
    const iopv = optionalPositive(snap[3]);
    const open = optionalPositive(snap[4]);
    const high = optionalPositive(snap[5]);
    const low = optionalPositive(snap[6]);
    const volume = optionalNonNegative(snap[7]);
    const amount = optionalNonNegative(snap[8]);
    const priceDate = parseCompactDate(payload.date);
    const priceTime = parseCompactTime(payload.time);
    if (!priceDate || !priceTime) return null;
    const priceAt = beijingIso(priceDate, priceTime);
    return {
      source: "sse",
      code: String(payload.code),
      name,
      // Contract field names for the raw SSE shape.
      last,
      preclose,
      iopv,
      open,
      high,
      low,
      volume,
      amount,
      date: String(payload.date),
      time: priceTime,
      priceDate,
      priceAt,
      // Canonical aliases consumed by the collector / premium evaluator.
      price: last,
      refNav: iopv,
      refNavKind: (iopv != null ? "iopv" : null) as RefNavKind | null
    };
  } catch {
    return null;
  }
}

/**
 * Shenzhen Stock Exchange quote:
 *   {"datetime":"2026-10-30 15:30","data":{"code":"159941","name":"纳指ETF广发",
 *    "now":"1.649","close":"1.690","netValue":"1.471","prevNetValue":null,
 *    "amount":1225154601.647,"volume":7393403,"marketTime":"2026-10-30 15:30:00"}}
 * ETF: `netValue` is the reference NAV. LOF: `netValue` is empty and `prevNetValue`
 * carries the previous valuation-day NAV. `now` is the latest price (the close after 15:30).
 */
function parseSzseQuote(input: string, expectedCode: string, vehicle: "ETF" | "LOF" = "ETF"): any | null {
  try {
    if (!isFundCode(expectedCode)) return null;
    const payload = JSON.parse(String(input || ""));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const data = payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (String(data.code ?? "") !== String(expectedCode)) return null;
    const name = text(data.name) || null;
    const now = optionalPositive(data.now);
    if (!name || now == null) return null;
    const close = optionalPositive(data.close);
    const netValue = optionalPositive(data.netValue);
    const prevNetValue = optionalPositive(data.prevNetValue);
    const volume = optionalNonNegative(data.volume);
    const amount = optionalNonNegative(data.amount);
    const isLof = vehicle === "LOF";
    const refNav = isLof ? prevNetValue : netValue;
    const refNavKind = refNav != null ? (isLof ? "previous-nav" : "reference-nav") : null;
    const marketStamp = parseDateTime(data.marketTime) || parseDateTime(payload.datetime) || parseDateTime(data.datetime);
    if (!marketStamp) return null;
    const priceAt = beijingIso(marketStamp.date, marketStamp.time);
    return {
      source: "szse",
      code: String(data.code),
      name,
      // Contract field names for the raw SZSE shape.
      now,
      close,
      netValue,
      prevNetValue,
      datetime: text(payload.datetime || data.marketTime) || null,
      volume,
      amount,
      priceDate: marketStamp.date,
      priceAt,
      // Canonical aliases consumed by the collector / premium evaluator.
      price: now,
      refNav,
      refNavKind: refNavKind as RefNavKind | null
    };
  } catch {
    return null;
  }
}

/**
 * Eastmoney open-end fund NAV history:
 *   {"Data":{"LSJZList":[{"FSRQ":"2026-10-29","DWJZ":"1.9663","SGZT":"暂停申购","SHZT":"场内卖出"}]},"ErrCode":0}
 * Returns the latest valuation-day NAV. `ErrCode !== 0` or a non-positive DWJZ is a failure.
 */
function parseEastmoneyNav(input: string, expectedCode: string): any | null {
  try {
    if (!isFundCode(expectedCode)) return null;
    const payload = JSON.parse(String(input || ""));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (Number(payload.ErrCode) !== 0) return null;
    const data = payload.Data ?? payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    for (const field of ["fundcode", "fundCode", "FundCode", "FCODE", "code"]) {
      if (data[field] != null && String(data[field]) !== String(expectedCode)) return null;
    }
    const list = data.LSJZList;
    if (!Array.isArray(list) || !list.length) return null;
    let latest: { date: string; item: any } | null = null;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const date = parseDateTime(item.FSRQ)?.date ?? null;
      if (!date) continue;
      if (!latest || date > latest.date) latest = { date, item };
    }
    if (!latest) return null;
    const nav = optionalPositive(latest.item.DWJZ);
    if (nav == null) return null;
    return {
      code: String(expectedCode),
      nav,
      navDate: latest.date,
      applyStatus: text(latest.item.SGZT) || null,
      redemptionStatus: text(latest.item.SHZT) || null
    };
  } catch {
    return null;
  }
}

/**
 * Eastmoney push2 fallback quote:
 *   {"data":{"f43":2239,"f57":"513100","f58":"纳指ETF","f59":3,"f60":2289}}
 * `f43` is the latest price scaled by `10^f59` (f59=3 → /1000). `f57` must match the code.
 */
function parseEastmoneyQuote(input: string, expectedCode: string): any | null {
  try {
    if (!isFundCode(expectedCode)) return null;
    const payload = JSON.parse(String(input || ""));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const data = payload.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (String(data.f57 ?? "") !== String(expectedCode)) return null;
    const decimals = Number(data.f59);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return null;
    const scale = 10 ** decimals;
    const rawPrice = optionalNumber(data.f43);
    if (rawPrice == null || rawPrice <= 0) return null;
    const price = rawPrice / scale;
    if (!Number.isFinite(price) || price <= 0) return null;
    const rawPreclose = optionalNumber(data.f60);
    const preclose = rawPreclose != null && rawPreclose > 0 ? rawPreclose / scale : null;
    // f86 is the last-trade timestamp in seconds. Without it a fallback quote would be
    // dated with the observation time, which is wrong on weekends/holidays and would
    // pollute the persisted close history used for the calibrated premium.
    const rawTimestamp = optionalNumber(data.f86);
    const priceAt = rawTimestamp != null && rawTimestamp > 0 ? new Date(rawTimestamp * 1000).toISOString() : null;
    const priceDate = priceAt ? beijingDateOf(priceAt) : null;
    return { code: String(data.f57), name: text(data.f58) || null, price, preclose, priceAt, priceDate };
  } catch {
    return null;
  }
}

/** Beijing (UTC+08:00) calendar date of an ISO timestamp, e.g. `2026-10-30`. */
function beijingDateOf(value: string): string | null {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000);
  return buildDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

module.exports = {
  beijingDateOf,
  parseEastmoneyNav,
  parseEastmoneyQuote,
  parseSseSnapshot,
  parseSzseQuote
};
