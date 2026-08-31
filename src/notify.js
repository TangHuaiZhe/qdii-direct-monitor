"use strict";

function formatChange(change) {
  const row = change.after || change.before;
  const amount = change.after?.limitAmount == null ? change.after?.status || "removed" : `${change.after.limitAmount} ${change.after.currency}`;
  return `${row.fundCode} ${row.fundName} [${row.channel.kind}/${row.channel.access}] ${change.type}: ${amount}`;
}

function notificationText(payload) {
  return ["QDII 申购额度变化", `时间：${payload.observedAt}`, ...payload.changes.slice(0, 30).map(formatChange)].join("\n");
}

async function notify(payload, config = {}) {
  if (!payload.changes.length && config.mode !== "always") return { sent: false, reason: "no-changes" };
  const url = config.url || (config.urlEnv ? process.env[config.urlEnv] : "");
  if (!url) return { sent: false, reason: "missing-webhook" };
  const target = new URL(url);
  const local = target.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
  if (target.protocol !== "https:" && !local) throw new Error("webhook must use HTTPS (localhost may use HTTP)");
  const text = notificationText(payload);
  const body = config.type === "feishu" ? { msg_type: "text", content: { text } } : { title: "QDII purchase-limit changes", text, changes: payload.changes };
  const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`webhook HTTP ${response.status}`);
  if (config.type === "feishu") {
    const result = await response.json();
    if (Number(result.code ?? result.StatusCode ?? 0) !== 0) throw new Error(`Feishu webhook business error: ${result.code ?? result.StatusCode}`);
  }
  return { sent: true, status: response.status };
}

module.exports = { formatChange, notificationText, notify };
