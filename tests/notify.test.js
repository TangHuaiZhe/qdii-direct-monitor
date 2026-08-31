"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { notify } = require("../src/notify");

const payload = { observedAt: "2026-08-31T00:00:00Z", changes: [{ type: "limit-increased", after: { fundCode: "040046", fundName: "华安纳指", channel: { kind: "direct", access: "web" }, limitAmount: 1000, currency: "CNY" } }] };

test("email notification sends only after a change", async () => {
  let message;
  const result = await notify(payload, {
    type: "email", host: "smtp.example.com", user: "sender@example.com", password: "secret", from: "sender@example.com", to: "tanghuaizhe@me.com",
    _transportFactory: (options) => ({ sendMail: async (mail) => { message = { options, mail }; } })
  });
  assert.equal(result.sent, true);
  assert.equal(result.channel, "email");
  assert.equal(message.mail.to, "tanghuaizhe@me.com");
  assert.match(message.mail.text, /040046/);
});

test("email notification reports missing credentials without sending", async () => {
  const result = await notify(payload, { type: "email", to: "tanghuaizhe@me.com" });
  assert.deepEqual(result, { sent: false, reason: "missing-email-config" });
});
