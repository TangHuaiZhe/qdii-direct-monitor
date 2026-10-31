"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractRelevantLinks, focusText, inferChannels, parseAmount, parseEffectiveDate, parseLimitEvent, parseShareAmount, parseStatus, pdfItemsToText, resourceToText } = require("../src/parser");

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
test("parses official product pages that label a closed subscription status", () => {
  assert.equal(parseStatus("申购状态：关闭 赎回状态：开放"), "suspended");
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
test("uses the newest business date when a notice cites the prior limit", () => {
  const text = "公告送出日期：2026 年 09 月 04 日 自 2026 年 09 月 03 日起限制金额为2000元；自 2026 年 09 月 04 日起调整限制金额为10元";
  assert.equal(parseEffectiveDate(text), "2026-09-04");
});
test("binds the newest effective date to its own amount instead of an earlier amount", () => {
  const text = "自2026年9月3日起限制申购金额为50元；自2026年9月4日起调整限制申购金额为10元";
  assert.deepEqual(parseLimitEvent(text, { code: "019441", currency: "CNY" }), { amount: 10, currency: "CNY", effectiveDate: "2026-09-04" });
});
test("does not carry an old amount into a newer amount-free restriction clause", () => {
  const text = "自2026年9月3日起限制申购金额为50元；自2026年9月4日起继续暂停大额申购";
  assert.equal(parseLimitEvent(text, { code: "019441", currency: "CNY" }), null);
});
test("reconstructs PDF rows by coordinates before flattening text", () => {
  const items = [
    { str: "50", transform: [1, 0, 0, 1, 200, 90] },
    { str: "018044", transform: [1, 0, 0, 1, 200, 100] },
    { str: "基金代码", transform: [1, 0, 0, 1, 10, 100] },
    { str: "018043", transform: [1, 0, 0, 1, 100, 100] },
    { str: "限制金额", transform: [1, 0, 0, 1, 10, 90] },
    { str: "10", transform: [1, 0, 0, 1, 100, 90] }
  ];
  assert.equal(pdfItemsToText(items), "基金代码 018043 018044\n限制金额 10 50");
});
test("ranks exact and newer notice links instead of taking page order", () => {
  const html = [
    '<a href="old.html">纳斯达克基金暂停大额申购 2026-01-01</a>',
    '<a href="other.html">纳指基金恢复申购 2026-10-30</a>',
    '<a href="exact.html">019441 暂停大额申购 2026-09-09</a>',
    '<a href="new.html">纳斯达克基金调整限额 2026-10-20</a>'
  ].join("");
  const links = extractRelevantLinks(html, "https://www.example.com/notices/", { code: "019441", name: "万家纳斯达克100指数" });
  assert.equal(links[0].url, "https://www.example.com/notices/exact.html");
  assert.equal(links[1].url, "https://www.example.com/notices/other.html");
  assert.equal(links[0].publishedAt, "2026-09-09");
});
test("decodes GBK official pages according to the response charset", async () => {
  const bytes = Buffer.concat([Buffer.from("<p>"), Buffer.from([0xc9, 0xea, 0xb9, 0xba]), Buffer.from("</p>")]);
  assert.equal(await resourceToText({ bytes, contentType: "text/html; charset=GBK", finalUrl: "https://example.test" }), "申购");
});
test("detects GBK official pages from their HTML meta charset", async () => {
  const bytes = Buffer.concat([Buffer.from('<meta charset="GBK"><p>'), Buffer.from([0xc9, 0xea, 0xb9, 0xba]), Buffer.from("</p>")]);
  assert.equal(await resourceToText({ bytes, contentType: "text/html", finalUrl: "https://example.test" }), "申购");
});

test("PDF parsing does not detach shared response bytes", async () => {
  const bytes = Buffer.from("not a pdf");
  await assert.rejects(resourceToText({ bytes, contentType: "application/pdf", finalUrl: "https://example.test/x.pdf" }));
  assert.equal(bytes.toString(), "not a pdf");
});
test("infers distinct direct and agency scopes", () => {
  const channels = inferChannels("线上直销系统限额100元，其他销售渠道暂停");
  assert.deepEqual(channels, [{ kind: "direct", access: "web" }, { kind: "agency", access: "all" }]);
});
test("focuses a multi-fund page around requested code", () => {
  const text = `000001 ${"x".repeat(1000)} 040046 单日单账户限额直销100元 ${"y".repeat(1000)}`;
  assert.match(focusText(text, { code: "040046", name: "华安" }, 80), /直销100元/);
});
