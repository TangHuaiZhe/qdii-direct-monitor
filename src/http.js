"use strict";

const MAX_BYTES = 8 * 1024 * 1024;

function hostAllowed(hostname, allowedHosts) {
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

async function fetchResource(url, options = {}) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("source URL must be credential-free HTTPS");
  if (!hostAllowed(target.hostname, options.allowedHosts || [])) throw new Error(`source host is not allowed: ${target.hostname}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "qdii-direct-monitor/0.1 (+public-data-monitor)" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalTarget = new URL(response.url);
    if (finalTarget.protocol !== "https:" || !hostAllowed(finalTarget.hostname, options.allowedHosts || [])) {
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

module.exports = { fetchResource, hostAllowed };
