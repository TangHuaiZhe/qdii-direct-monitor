"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { focusText, inferChannels, parseAmount, parseShareAmount, parseStatus, resourceToText } = require("../src/parser");

test("parses Chinese ten-thousand amount", () => assert.equal(parseAmount("单日单个基金账户累计申购金额不超过 1 万元").amount, 10000));
test("parses direct product-page wording", () => {
  const text = "交易状态 单日单账户限额直销100元 代销10元限额申购 开放赎回";
  assert.equal(parseStatus(text), "limited");
  assert.equal(parseAmount(text).amount, 100);
});
test("parses current Eastmoney limit wording", () => {
  const text = "交易状态：限大额 (单日累计购买上限10.00元) 开放赎回";
  assert.equal(parseStatus(text), "limited");
  assert.equal(parseAmount(text).amount, 10);
});
test("parses official notice when currency unit precedes the amount", () => {
  assert.deepEqual(parseAmount("限制申购金额（单位：人民币元） 2,000.00"), { amount: 2000, currency: "CNY" });
});
test("parses spaced PDF text around a unit-before amount", () => {
  const text = "限制申购 （ 含定期定 额投资 ） 金额 （ 单位 ： 人民币元） 1 0 .00";
  assert.deepEqual(parseAmount(text), { amount: 10, currency: "CNY" });
  assert.equal(parseStatus("限制 大额申购"), "limited");
});
test("maps distinct share-class amounts by fund code", () => {
  const text = "暂停大额申购 下属分级基金的交易代码 019736 019737 该分级基金是否暂停大额申购 是 是 下属分级基金的限制申购金额（单位：人民币元） 10 25 2. 其他需要提示的事项";
  assert.deepEqual(parseShareAmount(text, { code: "019736", currency: "CNY" }), { amount: 10, currency: "CNY" });
  assert.deepEqual(parseShareAmount(text, { code: "019737", currency: "CNY" }), { amount: 25, currency: "CNY" });
});
test("parses a PDF sentence using the RMB-yuan unit", () => {
  assert.deepEqual(parseAmount("单日单 个基金账户的申购金额不应超过 10 人民币元"), { amount: 10, currency: "CNY" });
});
test("decodes GBK official pages according to the response charset", async () => {
  const bytes = Buffer.concat([Buffer.from("<p>"), Buffer.from([0xc9, 0xea, 0xb9, 0xba]), Buffer.from("</p>")]);
  assert.equal(await resourceToText({ bytes, contentType: "text/html; charset=GBK", finalUrl: "https://example.test" }), "申购");
});
test("infers distinct direct and agency scopes", () => {
  const channels = inferChannels("线上直销系统限额100元，其他销售渠道暂停");
  assert.deepEqual(channels, [{ kind: "direct", access: "web" }, { kind: "agency", access: "all" }]);
});
test("focuses a multi-fund page around requested code", () => {
  const text = `000001 ${"x".repeat(1000)} 040046 单日单账户限额直销100元 ${"y".repeat(1000)}`;
  assert.match(focusText(text, { code: "040046", name: "华安" }, 80), /直销100元/);
});
