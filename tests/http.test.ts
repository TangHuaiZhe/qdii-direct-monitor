"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchResource } = require("../src/http");

function response(body, status = 200) {
  const bytes = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://www.example.com/a",
    headers: { get: (name) => (name === "content-type" ? "text/html" : String(bytes.length)) },
    arrayBuffer: async () => bytes
  };
}

function connectionError(code) {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error(`connect ${code}`), { code });
  return error;
}

async function withFetch(implementation, fn) {
  const original = global.fetch;
  global.fetch = implementation;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test("a dropped connection is retried once", async () => {
  let calls = 0;
  const resource = await withFetch(async () => {
    calls += 1;
    if (calls === 1) throw connectionError("ECONNRESET");
    return response("ok");
  }, () => fetchResource("https://www.example.com/a", { allowedHosts: ["example.com"], timeoutMs: 1000 }));
  assert.equal(calls, 2);
  assert.equal(resource.bytes.toString(), "ok");
});

test("a refused connection is not retried and keeps the cause", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    throw connectionError("ECONNREFUSED");
  }, async () => {
    await assert.rejects(
      () => fetchResource("https://www.byfunds.com/fund", { allowedHosts: ["byfunds.com"], timeoutMs: 1000 }),
      /ECONNREFUSED/
    );
  });
  assert.equal(calls, 1);
});

test("an HTTP error is not retried", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return response("no", 503);
  }, async () => {
    await assert.rejects(
      () => fetchResource("https://www.example.com/a", { allowedHosts: ["example.com"], timeoutMs: 1000 }),
      /HTTP 503/
    );
  });
  assert.equal(calls, 1);
});

test("an aborted request reports the timeout", async () => {
  await withFetch(async () => {
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  }, async () => {
    await assert.rejects(
      () => fetchResource("https://www.example.com/a", { allowedHosts: ["example.com"], timeoutMs: 1000, retries: 0 }),
      /timed out after 1000ms/
    );
  });
});
