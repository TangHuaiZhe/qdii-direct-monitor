"use strict";

const nodemailer = require("nodemailer");

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
  if (config.type === "email") return sendEmail(payload, config);
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

async function sendEmail(payload, config = {}) {
  const host = config.host || process.env[config.hostEnv || "QDII_SMTP_HOST"];
  const port = Number(config.port || process.env[config.portEnv || "QDII_SMTP_PORT"] || 587);
  const user = config.user || process.env[config.userEnv || "QDII_SMTP_USER"];
  const pass = config.password || process.env[config.passwordEnv || "QDII_SMTP_PASSWORD"];
  const to = config.to || process.env[config.toEnv || "QDII_EMAIL_TO"] || "tanghuaizhe@me.com";
  const from = config.from || process.env[config.fromEnv || "QDII_EMAIL_FROM"] || user;
  if (!host || !user || !pass || !from || !to) return { sent: false, reason: "missing-email-config" };
  const transport = (config._transportFactory || nodemailer.createTransport)({
    host,
    port,
    secure: config.secure ?? port === 465,
    auth: { user, pass }
  });
  const text = notificationText(payload);
  await transport.sendMail({
    from,
    to,
    subject: "QDII 申购额度变化（" + payload.changes.length + " 条）",
    text
  });
  return { sent: true, channel: "email", to };
}

module.exports = { formatChange, notificationText, notify, sendEmail };
