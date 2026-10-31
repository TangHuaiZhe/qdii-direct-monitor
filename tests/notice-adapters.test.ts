"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const gf = require("../src/adapters/gf");
const wanjia = require("../src/adapters/wanjia");

test("Gf marks continued suspension notices as restriction confirmations", () => {
  const text = `var FundPost4 = {"RECORDS":[
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）继续暂停申购业务的提示性公告","DOCPUBURL":"http://www.gffunds.com.cn/confirm.pdf","DOCRELTIME":"2026.10.29 08:44:00"}
  ]};`;
  const candidate = gf.discoverNoticeCandidates(text, { code: "270042", currency: "CNY" })[0];
  assert.equal(candidate.eventHint, "confirm-restriction");
  assert.equal(candidate.cacheKey, "https://www.gffunds.com.cn/confirm.pdf#events-v4");
});

test("Wanjia parses a direct limit that remains unchanged", async () => {
  const text = "公告送出日期：2026年10月21日 下属分级基金的交易代码 019441 019442 下属分级基金的限制申购金额（单位：人民币元）5 5 代销渠道累计金额限制调整为5元；直销渠道单日单个基金账户累计金额限制仍为100元（A类、C类份额分别计算）。";
  const context = { observedAt: "2026-10-21T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  for (const code of ["019441", "019442"]) {
    const rows = await wanjia.collect({ code, name: "万家纳指", manager: "万家基金", currency: "CNY", shareClass: code === "019441" ? "A" : "C",
      officialSources: [{ url: "https://www.wjasset.com/x", kind: "notice", channel: { kind: "direct", access: "all" } }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 100);
  }
});
