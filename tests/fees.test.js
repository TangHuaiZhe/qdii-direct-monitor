"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { collectOperatingFees, parseOperatingFees } = require("../src/fees");

test("parses and sums annual operating fees", () => {
  assert.deepEqual(parseOperatingFees("管理费率 0.60%（每年） 托管费率 0.20%（每年） 销售服务费率 0.10%（每年）"), {
    managementRate: 0.6,
    custodyRate: 0.2,
    salesServiceRate: 0.1,
    annualRate: 0.9
  });
});

test("fee parser fails closed when one component is missing", () => {
  assert.equal(parseOperatingFees("管理费率 0.60% 托管费率 0.20%"), null);
});

test("treats an explicit no-sales-service marker as zero", () => {
  assert.equal(parseOperatingFees("管理费率 0.80% 托管费率 0.20% 销售服务费率 ---").annualRate, 1);
});

test("fee collector binds evidence to the fund", async () => {
  const context = {
    observedAt: "2026-08-31T00:00:00Z",
    timeoutMs: 1000,
    warnings: [],
    fetchResource: async (url) => ({ bytes: Buffer.from("管理费率 0.50% 托管费率 0.10% 销售服务费率 0.20%"), contentType: "text/html", finalUrl: url })
  };
  const result = await collectOperatingFees({ code: "019737" }, context);
  assert.equal(result.annualRate, 0.8);
  assert.equal(result.reliability.grade, "B");
  assert.match(result.source.url, /019737/);
});
