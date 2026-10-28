"use strict";

const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 35000;
const NO_RETRY_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT"
]);

function hostAllowed(hostname, allowedHosts) {
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function isTransientFetchError(error) {
  if (!error || error.name === "AbortError") return false;
  const message = String(error.message || "");
  if (/^(HTTP \d+|source URL must be credential-free HTTP or HTTPS|source host is not allowed:|redirected source host is not allowed:|response exceeds size limit)/.test(message)) return false;
  const code = error.cause?.code || error.code;
  if (code && NO_RETRY_CODES.has(code)) return false;
  if (error.name === "TypeError" && /fetch failed/i.test(message)) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code);
}

function describeFetchError(error, timeoutMs) {
  if (error?.name === "AbortError") return new Error(`timed out after ${timeoutMs}ms`);
  const code = error?.cause?.code || error?.code;
  const detail = error?.cause?.message || error?.message || "fetch failed";
  if (code && !String(detail).includes(code)) return new Error(`${detail} (${code})`);
  if (error?.cause?.message) return new Error(error.cause.message);
  return error instanceof Error && error.message ? error : new Error(String(detail));
}

async function fetchOnce(target, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "qdii-direct-monitor/0.1 (+public-data-monitor)" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalTarget = new URL(response.url);
    const finalProtocols = target.protocol === "http:" ? ["http:", "https:"] : ["https:"];
    if (!finalProtocols.includes(finalTarget.protocol) || !hostAllowed(finalTarget.hostname, options.allowedHosts || [])) {
      throw new Error(`redirected source host is not allowed: ${finalTarget.hostname}`);
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > (options.maxBytes || MAX_BYTES)) throw new Error("response exceeds size limit");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > (options.maxBytes || MAX_BYTES)) throw new Error("response exceeds size limit");
    return { bytes, contentType: response.headers.get("content-type") || "", finalUrl: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchResource(url, options: any = {}) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("source URL must be credential-free HTTP or HTTPS");
  }
  if (!hostAllowed(target.hostname, options.allowedHosts || [])) throw new Error(`source host is not allowed: ${target.hostname}`);
  const retries = Number.isInteger(options.retries) ? options.retries : 1;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchOnce(target, options);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientFetchError(error)) break;
    }
  }
  throw describeFetchError(lastError, timeoutMs);
}

module.exports = { DEFAULT_TIMEOUT_MS, fetchResource, hostAllowed };
