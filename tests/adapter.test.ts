"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const huaan = require("../src/adapters/huaan");
const huitianfu = require("../src/adapters/huitianfu");
const southern = require("../src/adapters/southern");
const tianhong = require("../src/adapters/tianhong");
const igwfmc = require("../src/adapters/igwfmc");
const chinaamc = require("../src/adapters/chinaamc");
const gf = require("../src/adapters/gf");
const baoying = require("../src/adapters/baoying");
const guotai = require("../src/adapters/guotai");
const wanjia = require("../src/adapters/wanjia");
const { adapters } = require("../src/adapters");

test("official adapter produces a direct observation with evidence", async () => {
  const html = "<html><body>040046 交易状态 单日单账户限额直销100元 代销10元限额申购</body></html>";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(html), contentType: "text/html", finalUrl: url }) };
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", currency: "CNY", shareClass: "A", officialSources: [{ url: "https://www.huaan.com.cn/funds/040046/index.shtml", kind: "product" }] }, context);
  assert.equal(rows[0].channel.kind, "direct");
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 100);
  assert.equal(rows[0].reliability.grade, "A");
  assert.equal(rows[0].salesUrl, "https://www.huaan.com.cn/funds/040046/index.shtml");
});

test("unparseable official page is unknown, never open", async () => {
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("<html>layout changed</html>"), contentType: "text/html", finalUrl: url }) };
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "product" }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].reliability.grade, "D");
});

test("a notice for another explicit fund code cannot change the requested fund", async () => {
  const context = { observedAt: "2026-10-31T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("019442 暂停申购，自2026年10月31日起执行"), contentType: "text/html", finalUrl: url }) };
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "notice" }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].reliability.grade, "D");
});

test("one notice can explicitly cover web, app, and counter direct channels", async () => {
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("040046 限制申购金额（单位：人民币元） 100.00 暂停大额申购"), contentType: "text/html", finalUrl: url }) };
  const channels = ["web", "app", "counter"].map((access) => ({ kind: "direct", access }));
  const rows = await huaan.collect({ code: "040046", name: "华安纳指", manager: "华安基金", officialSources: [{ url: "https://www.huaan.com.cn/x", kind: "notice", channels }] }, context);
  assert.deepEqual(rows.map((row) => row.channel.access), ["web", "app", "counter"]);
  assert.ok(rows.every((row) => row.limitAmount === 100 && row.reliability.grade === "B"));
});

test("Huitianfu uses the current A/C/E share-table values instead of an older amount mentioned later", async () => {
  const text = "基金主代码 018966 下属基金份额的交易代码 018966 018967 018969 018968 021773 下属基金份额的限制申购金额 10,000.00 10,000.00 1,500.00 1,500.00 10,000.00 注：此前限制金额为10人民币元 暂停大额申购";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  for (const [code, shareClass] of [["018966", "A"], ["018967", "C"], ["021773", "E"]]) {
    const rows = await huitianfu.collect({ code, name: `汇添富纳指${shareClass}`, manager: "汇添富基金", currency: "CNY", shareClass,
      officialSources: [{ url: "https://www.99fund.com/x", kind: "notice", channel: { kind: "direct", access: "all" } }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 10000);
  }
});

test("funds with official notice indexes do not also pin stale notice PDFs", () => {
  const config = require("../config/funds.example.json");
  for (const fund of config.funds) {
    const indexes = fund.officialSources.filter((source) => source.kind === "notice-index");
    if (!indexes.length) continue;
    assert.ok(indexes.every((source) => source.followLinks === true), fund.code);
    assert.equal(fund.officialSources.filter((source) => source.kind === "notice").length, 0, fund.code);
  }
});

test("adapters with stable notice indexes never pin historical notice attachments", () => {
  const config = require("../config/funds.example.json");
  for (const fund of config.funds.filter((item) => ["ccb", "huitianfu", "wanjia"].includes(item.adapter))) {
    assert.ok(fund.officialSources.some((source) => source.kind === "notice-index"), fund.code);
    assert.equal(fund.officialSources.some((source) => source.kind === "notice" || /\.(?:pdf|docx?)(?:$|\?)/i.test(source.url)), false, fund.code);
  }
});

test("Huitianfu parses 001668 suspension notices instead of a stale status list", async () => {
  const text = "关于汇添富全球移动互联灵活配置混合型证券投资基金暂停申购、定期定额投资业务的公告 公告送出日期：2026年10月23日 下属基金份额的交易代码 001668 015202 015203 006426 该基金份额是否暂停上述业务 是 是 是 否 暂停申购起始日 2026年10月23日";
  const rows = await huitianfu.parseResource({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: "https://www.99fund.com/notice.html" },
    { code: "001668", name: "汇添富全球移动互联混合（QDII）人民币A", manager: "汇添富基金", index: "globalMobileInternet", currency: "CNY", shareClass: "A" },
    { kind: "notice", channel: { kind: "direct", access: "all" } }, "2026-10-31T00:00:00Z");
  assert.equal(rows[0].status, "suspended");
  assert.equal(rows[0].index, "globalMobileInternet");
  assert.equal(rows[0].reliability.grade, "B");
});

test("Huitianfu discovers 001668 global mobile internet purchase notices", () => {
  const html = `<table>
    <tr><td><a href="/main/a/20261023/12868100.shtml">关于汇添富全球移动互联灵活配置混合型证券投资基金暂停申购、定期定额投资业务的公告</a></td><td>2026-10-23</td></tr>
    <tr><td><a href="/main/a/20261027/report.shtml">汇添富全球移动互联混合2026年第三季度报告</a></td><td>2026-10-27</td></tr>
  </table>`;
  const candidates = huitianfu.discoverNoticeCandidates(html, "https://www.99fund.com/cgi-bin/news/Article", { code: "001668", index: "globalMobileInternet" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://www.99fund.com/main/a/20261023/12868100.shtml");
  assert.equal(candidates[0].eventHint, "suspend-all");
});

test("Southern parses the latest A-share purchase limit notice", async () => {
  const text = "基金主代码 016452 暂停大额申购起始日 2025年11月20日 下属基金份额的代码 016452 016453 021000 该基金份额的限制金额 100元 100元 2万元 自2025年11月20日起，如个人投资者单日单个基金账户单笔申购本基金A类基金份额超过100元，则仅对100元确认成功";
  const context = { observedAt: "2026-08-29T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  const rows = await southern.collect({ code: "016452", name: "南方纳指", manager: "南方基金", currency: "CNY", officialSources: [{ url: "https://www.nffund.com/x", kind: "notice", channel: { kind: "direct", access: "all" } }] }, context);
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 100);
});

test("Tianhong parses the official A/C share limit notice", async () => {
  const text = "基金主代码 018043 暂停大额申购起始日 2026年04月08日 限制申购金额（单位：人民币元） 100.00 下属分级基金的交易代码 018043 018044 022525 该分级基金是否暂停大额申购 是 是 是";
  const context = { observedAt: "2026-09-01T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  for (const [code, shareClass] of [["018043", "A"], ["018044", "C"]]) {
    const rows = await tianhong.collect({ code, name: `天弘纳指${shareClass}`, manager: "天弘基金", currency: "CNY", shareClass,
      officialSources: [{ url: "https://cdn-thweb.tianhongjijin.com.cn/fundnotice/x", kind: "notice", channel: { kind: "direct", access: "all" }, effectiveDate: "2026-04-08" }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 100);
    assert.equal(rows[0].effectiveDate, "2026-04-08");
    assert.equal(rows[0].reliability.grade, "B");
  }
});

test("Tianhong page shape changes fail closed", async () => {
  const context = { observedAt: "2026-09-01T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("018043 页面升级中"), contentType: "text/html", finalUrl: url }) };
  const rows = await tianhong.collect({ code: "018043", name: "天弘纳指A", manager: "天弘基金", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.thfund.com.cn/fund/018043", kind: "product", channel: { kind: "direct", access: "web" } }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].limitAmount, null);
  assert.equal(rows[0].reliability.grade, "D");
});

test("Wanjia separates the current direct limit from the agency limit", async () => {
  const text = "公告送出日期：2026年9月9日 暂停大额申购起始日 2026年9月9日 下属分级基金的交易代码 019441 019442 下属分级基金的限制申购金额（单位：人民币元）5,000 5,000 万家纳斯达克100指数发起式（QDII）A类份额和C类份额代销渠道单日单个基金账户累计金额限制调整为5,000元；本公司直销渠道单日单个基金账户累计金额限制为2 0,000元（A类、C类份额分别计算）。";
  const context = { observedAt: "2026-09-09T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  for (const [code, shareClass] of [["019441", "A"], ["019442", "C"]]) {
    const rows = await wanjia.collect({ code, name: `万家纳指${shareClass}`, manager: "万家基金", currency: "CNY", shareClass,
      officialSources: [{ url: "https://www.wjasset.com/x", kind: "notice" }] }, context);
    assert.equal(rows[0].status, "limited");
    assert.equal(rows[0].limitAmount, 20000);
    assert.equal(rows[0].effectiveDate, "2026-09-09");
    assert.equal(rows[0].channel.kind, "direct");
  }
});

test("Wanjia channel-split notice shape changes fail closed", async () => {
  const text = "019441 019442 下属分级基金的限制申购金额（单位：人民币元）5,000 5,000 暂停大额申购 代销渠道累计金额限制为5,000元；直销渠道额度请见销售页面。";
  const context = { observedAt: "2026-09-09T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from(text), contentType: "text/html", finalUrl: url }) };
  const rows = await wanjia.collect({ code: "019441", name: "万家纳指A", manager: "万家基金", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.wjasset.com/x", kind: "notice" }] }, context);
  assert.equal(rows[0].status, "unknown");
  assert.equal(rows[0].limitAmount, null);
  assert.equal(rows[0].reliability.grade, "D");
});

test("Wanjia config follows the official notice index instead of pinning an old PDF", () => {
  const config = require("../config/funds.example.json");
  for (const code of ["019441", "019442"]) {
    const fund = config.funds.find((item) => item.code === code);
    assert.equal(fund.officialSources.length, 1);
    assert.equal(fund.officialSources[0].kind, "notice-index");
    assert.equal(fund.officialSources[0].followLinks, true);
    assert.doesNotMatch(fund.officialSources[0].url, /\.pdf$/i);
  }
});

test("new manager adapters are registered", () => {
  for (const id of ["guotai", "baoying", "huataipb", "ccb", "jpmorgan", "wanjia", "tianhong", "igwfmc", "chinaamc"]) assert.ok(adapters[id], id);
});

test("every configured fund has a secure official direct website entry", () => {
  const config = require("../config/funds.example.json");
  for (const fund of config.funds) {
    const adapter = adapters[fund.adapter];
    const salesUrl = adapter.salesUrl(fund);
    const parsed = new URL(salesUrl);
    assert.equal(parsed.protocol, fund.adapter === "baoying" ? "http:" : "https:", fund.code);
    assert.ok(adapter.allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)), `${fund.code} ${parsed.hostname}`);
    assert.doesNotMatch(parsed.pathname, /\.pdf$/i, fund.code);
  }
});

test("every configured fund has an explicit active/passive strategy", () => {
  const config = require("../config/funds.example.json");
  assert.ok(config.funds.every((fund) => ["active", "passive"].includes(fund.strategy)));
  assert.deepEqual(config.funds.filter((fund) => fund.strategy === "active").map((fund) => fund.code), ["001668", "005698"]);
});

test("华夏 adapter parses an open official subscription status", async () => {
  const context = { observedAt: "2026-09-06T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("005698 华夏全球科技先锋混合(QDII)A(人民币) 交易状态 开放申购"), contentType: "text/html", finalUrl: url }) };
  const rows = await chinaamc.collect({ code: "005698", name: "华夏全球科技先锋混合（QDII）A人民币", manager: "华夏基金", index: "globalTechnology", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://fund.chinaamc.com/fund/005698/index.shtml", kind: "product", channel: { kind: "direct", access: "web" } }] }, context);
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].index, "globalTechnology");
  assert.equal(rows[0].reliability.grade, "A");
});

test("config tracks 广发美元A Nasdaq-100 share 000055", () => {
  const config = require("../config/funds.example.json");
  const fund = config.funds.find((item) => item.code === "000055");
  assert.deepEqual(fund && {
    name: fund.name,
    manager: fund.manager,
    adapter: fund.adapter,
    currency: fund.currency,
    shareClass: fund.shareClass,
    source: fund.officialSources[0]
  }, {
    name: "广发纳指100ETF联接（QDII）美元A",
    manager: "广发基金",
    adapter: "gf",
    currency: "USD",
    shareClass: "A",
    source: {
      url: "https://www.gffunds.com.cn/funds/?fundcode=000055",
      kind: "product",
      channel: { kind: "direct", access: "all" }
    }
  });
});

test("景顺长城 adapter parses a closed official subscription status", async () => {
  const context = { observedAt: "2026-09-06T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => ({ bytes: Buffer.from("017091 申购状态：关闭 赎回状态：开放"), contentType: "text/html", finalUrl: url }) };
  const rows = await igwfmc.collect({ code: "017091", name: "景顺长城纳斯达克科技ETF联接（QDII）A人民币", manager: "景顺长城基金", index: "nasdaqTechnology", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.igwfmc.com/main/jjcp/product/017091/detail.html", kind: "product", channel: { kind: "direct", access: "all" } }] }, context);
  assert.equal(rows[0].status, "suspended");
  assert.equal(rows[0].index, "nasdaqTechnology");
  assert.equal(rows[0].currency, "CNY");
  assert.equal(rows[0].reliability.grade, "A");
});

test("config tracks 景顺长城 Nasdaq technology A/C/E RMB shares", () => {
  const config = require("../config/funds.example.json");
  const shares = [["017091", "A"], ["017093", "C"], ["019118", "E"]];
  for (const [code, shareClass] of shares) {
    const fund = config.funds.find((item) => item.code === code);
    assert.deepEqual(fund && {
      name: fund.name,
      manager: fund.manager,
      adapter: fund.adapter,
      index: fund.index,
      currency: fund.currency,
      shareClass: fund.shareClass,
      source: fund.officialSources[0]
    }, {
      name: `景顺长城纳斯达克科技ETF联接（QDII）${shareClass}人民币`,
      manager: "景顺长城基金",
      adapter: "igwfmc",
      index: "nasdaqTechnology",
      currency: "CNY",
      shareClass,
      source: {
        url: `https://www.igwfmc.com/main/jjcp/product/${code}/detail.html`,
        kind: "product",
        channel: { kind: "direct", access: "all" }
      }
    }, code);
    assert.deepEqual(config.portfolioMappings[code], { portfolioCode: "景顺长城纳指科技ETF", sourceCode: "159509", exposure: "look-through" }, code);
  }
});

test("config tracks 汇添富全球移动互联人民币A share 001668", () => {
  const config = require("../config/funds.example.json");
  const fund = config.funds.find((item) => item.code === "001668");
  assert.deepEqual(fund && {
    name: fund.name,
    manager: fund.manager,
    adapter: fund.adapter,
    index: fund.index,
    currency: fund.currency,
    shareClass: fund.shareClass,
    source: fund.officialSources[0]
  }, {
    name: "汇添富全球移动互联混合（QDII）人民币A",
    manager: "汇添富基金",
    adapter: "huitianfu",
    index: "globalMobileInternet",
    currency: "CNY",
    shareClass: "A",
    source: {
      url: "https://www.99fund.com/main/products/pofund/001668/fundgg.shtml",
      kind: "notice-index",
      followLinks: true
    }
  });
});

test("config tracks 华夏全球科技先锋人民币A share 005698", () => {
  const config = require("../config/funds.example.json");
  const fund = config.funds.find((item) => item.code === "005698");
  assert.deepEqual(fund && {
    name: fund.name,
    manager: fund.manager,
    adapter: fund.adapter,
    index: fund.index,
    currency: fund.currency,
    shareClass: fund.shareClass,
    source: fund.officialSources[0]
  }, {
    name: "华夏全球科技先锋混合（QDII）A人民币",
    manager: "华夏基金",
    adapter: "chinaamc",
    index: "globalTechnology",
    currency: "CNY",
    shareClass: "A",
    source: {
      url: "https://fund.chinaamc.com/fund/005698/index.shtml",
      kind: "product",
      channel: { kind: "direct", access: "web" }
    }
  });
});

test("Ccb reads the direct-channel limit from the attached Word notice", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { resourceToText } = require("../src/parser");
  const ccb = require("../src/adapters/ccb");
  const bytes = fs.readFileSync(path.join(__dirname, "fixtures", "ccb-notice.doc"));
  const text = await resourceToText({ bytes, contentType: "application/msword", finalUrl: "https://www.ccbfund.cn/notice.doc" });
  assert.match(text, /下属分级基金的交易代码/);
  assert.deepEqual(ccb.parseAmount(text, { code: "539001", currency: "CNY" }), { amount: 10000, currency: "CNY" });
  assert.deepEqual(ccb.parseAmount(text, { code: "012752", currency: "CNY" }), { amount: 10000, currency: "CNY" });
  const currentText = `${text} 公告送出日期：2026年8月19日 暂停大额申购起始日 2026年8月20日 其他需要提示的事项 （2）针对在建信基金直销渠道投资建信纳斯达克100指数型证券投资基金（QDII）人民币份额（基金代码：539001（A类）、012752（C类））的情况，如投资者单日单个基金账户单笔或多笔累计申购、定投金额高于50元（不同份额分别计算），本基金管理人有权拒绝高于50元的部分金额。`;
  assert.deepEqual(ccb.parseAmount(currentText, { code: "012752", currency: "CNY" }), { amount: 50, currency: "CNY" });
  const context = { observedAt: "2026-10-31T00:00:00Z", warnings: [], timeoutMs: 10,
    fetchResource: async (url) => {
      if (url.includes("/website/v1/api/fund/notice")) return { bytes: Buffer.from(JSON.stringify({ data: { content: [
        { date: "2026-08-12", cntId: 303418, title: "建信纳斯达克100指数型证券投资基金（QDII）在直销渠道暂停大额申购、定期定额投资公告" },
        { date: "2026-08-19", cntId: 303658, title: "建信纳斯达克100指数型证券投资基金（QDII）暂停大额申购、定期定额投资公告" }
      ] } })), contentType: "application/json", finalUrl: url };
      if (url.includes("303658.html")) return { bytes: Buffer.from('<a href="/notice/current.doc">附件</a>'), contentType: "text/html", finalUrl: url };
      return { bytes: Buffer.from(currentText), contentType: "text/html", finalUrl: `${url}.html` };
    } };
  const rows = await ccb.collect({ code: "012752", name: "建信纳指C", manager: "建信基金", currency: "CNY", shareClass: "C",
    officialSources: [{ url: "https://www.ccbfund.cn/website/v1/api/fund/notice?fundCode=012752", kind: "notice-index" }] }, context);
  assert.equal(rows[0].status, "limited");
  assert.equal(rows[0].limitAmount, 50);
  assert.equal(rows[0].effectiveDate, "2026-08-20");
  assert.equal(rows[0].reliability.grade, "B");
  const aRows = await ccb.collect({ code: "539001", name: "建信纳指A", manager: "建信基金", currency: "CNY", shareClass: "A",
    officialSources: [{ url: "https://www.ccbfund.cn/website/v1/api/fund/notice?fundCode=539001", kind: "notice-index" }] }, context);
  assert.equal(aRows[0].status, "limited");
  assert.equal(aRows[0].limitAmount, 50);
  assert.equal(aRows[0].effectiveDate, "2026-08-20");
});

test("Ccb selects the newest applicable limit notice and ignores later sales notices", () => {
  const ccb = require("../src/adapters/ccb");
  const resource = { bytes: Buffer.from(JSON.stringify({ data: { content: [
    { date: "2026-10-28", cntId: 306846, title: "关于新增证券公司为建信纳斯达克100指数型证券投资基金（QDII）销售机构的公告" },
    { date: "2026-08-12", cntId: 303418, title: "建信纳斯达克100指数型证券投资基金（QDII）在直销渠道暂停大额申购、定期定额投资公告" },
    { date: "2026-08-19", cntId: 303658, title: "建信纳斯达克100指数型证券投资基金（QDII）暂停大额申购、定期定额投资公告" }
  ] } })) };
  assert.deepEqual(ccb.latestLimitNotice(resource), { date: "2026-08-19", cntId: 303658, title: "建信纳斯达克100指数型证券投资基金（QDII）暂停大额申购、定期定额投资公告" });
  const candidates = ccb.discoverNoticeCandidates(resource);
  assert.deepEqual(candidates.map((item) => item.publishedAt), ["2026-08-12", "2026-08-19"]);
});


test("Gf picks the latest applicable official notice for the share class", () => {
  const notices = `var FundPost4 = {"RECORDS":[
    {"DOCTITLE":"广发基金管理有限公司关于旗下基金2026年第3季度报告提示性公告","DOCPUBURL":"http://www.gffunds.com.cn/q3.pdf","DOCRELTIME":"2026.10.27 08:45:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）继续暂停申购（包含转换转入、定期定额及不定额投资）业务的提示性公告","DOCPUBURL":"http://www.gffunds.com.cn/jjgg/zdsj/202610/P020261029315000918826.pdf","DOCRELTIME":"2026.10.29 08:44:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）人民币份额暂停申购（含转换转入、定期定额和不定额投资）业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/jjgg/zdsj/202610/P020261014313441350967.pdf","DOCRELTIME":"2026.10.14 08:42:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）人民币份额恢复申购（含转换转入、定期定额和不定额投资）业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/jjgg/zdsj/202610/P020261012571415396720.pdf","DOCRELTIME":"2026.10.12 15:52:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）美元份额暂停申购（含定期定额和不定额投资）业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/jjgg/zdsj/202609/P020260910307983942745.pdf","DOCRELTIME":"2026.09.10 08:33:00"}
  ]};`;
  for (const currency of ["USD", "CNY"]) {
    const notice = gf.pickLatestNotice(notices, { code: currency === "USD" ? "000055" : "270042", currency });
    assert.equal(notice.url, "http://www.gffunds.com.cn/jjgg/zdsj/202610/P020261029315000918826.pdf");
    assert.equal(notice.date, "2026-10-29");
  }
  const scoped = `var FundPost4 = {"RECORDS":[
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）人民币份额恢复申购（含转换转入、定期定额和不定额投资）业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/resume-rmb.pdf","DOCRELTIME":"2026.10.12 15:52:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）美元份额暂停申购（含定期定额和不定额投资）业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/suspend-usd.pdf","DOCRELTIME":"2026.09.10 08:33:00"}
  ]};`;
  assert.equal(gf.pickLatestNotice(scoped, { code: "000055", currency: "USD" }).url, "http://www.gffunds.com.cn/suspend-usd.pdf");
  assert.equal(gf.pickLatestNotice(scoped, { code: "270042", currency: "CNY" }).url, "http://www.gffunds.com.cn/resume-rmb.pdf");
});

test("Gf discovers normalized notice candidates for the event pipeline", () => {
  const notices = `var FundPost4 = {"RECORDS":[
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）人民币份额恢复申购业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/resume.pdf","DOCRELTIME":"2026.10.12 15:52:00"},
    {"DOCTITLE":"关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）美元份额暂停申购业务的公告","DOCPUBURL":"http://www.gffunds.com.cn/usd.pdf","DOCRELTIME":"2026.09.10 08:33:00"}
  ]};`;
  const candidates = gf.discoverNoticeCandidates(notices, { code: "270042", currency: "CNY" });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    manager: "广发基金",
    title: "关于广发纳斯达克100交易型开放式指数证券投资基金联接基金（QDII）人民币份额恢复申购业务的公告",
    url: "https://www.gffunds.com.cn/resume.pdf",
    publishedAt: "2026-10-12",
    fundCodes: [],
    currencyScope: "CNY",
    shareClasses: [],
    eventHint: "resume"
  });
});

test("Huitianfu discovers purchase notices from its public POST response", () => {
  const html = `<table><tr><td><a href="/main/a/20260924/12867748.shtml?v=1">关于汇添富纳斯达克100ETF发起式联接（QDII）暂停申购业务的公告</a></td><td>2026-09-24</td><td><a href="/cgi-bin/fundproduct/FundProductAction?function=DownLoad&amp;downId=12867748">下载</a></td></tr>
    <tr><td><a href="/main/a/report.shtml">汇添富纳斯达克100ETF联接2026年季度报告</a></td><td>2026-10-27</td><td><a href="/download-report">下载</a></td></tr></table>`;
  const candidates = huitianfu.discoverNoticeCandidates(html, "https://www.99fund.com/cgi-bin/news/Article");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://www.99fund.com/main/a/20260924/12867748.shtml?v=1");
  assert.equal(candidates[0].publishedAt, "2026-09-24");
  assert.equal(candidates[0].eventHint, "suspend-all");
});

test("Wanjia associates each purchase notice with its adjacent date", () => {
  const html = `<div class="m-advisory-wj-news-item clearfix"><div class="fn-left"><a href="/upload/pdf/latest.pdf" title="关于万家纳斯达克100指数型发起式证券投资基金（QDII）调整大额申购业务金额限制的公告">公告</a></div><div class="fn-right m-advisory-wj-news-item-time">2026-10-21</div></div>
    <div class="m-advisory-wj-news-item clearfix"><div><a href="/upload/pdf/report.pdf" title="万家纳斯达克100指数基金季度报告">报告</a></div><div class="fn-right m-advisory-wj-news-item-time">2026-10-27</div></div>`;
  const candidates = wanjia.discoverNoticeCandidates(html, "https://www.wjasset.com/products/x/index.html");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "https://www.wjasset.com/upload/pdf/latest.pdf");
  assert.equal(candidates[0].publishedAt, "2026-10-21");
});


test("Baoying picks the latest fund-level limit notice and ignores holiday notices", () => {
  const payload = { data: { list: [
    { title: "宝盈纳斯达克100指数型发起式证券投资基金（QDII）2026年第3季度报告", pubDate: "2026-10-27 08:30:01", attachmentUrl: "/q3.pdf" },
    { title: "宝盈纳斯达克100指数型发起式证券投资基金（QDII）2027年境外主要市场节假日及非交易日暂停申购、赎回等交易类业务的公告", pubDate: "2026-12-01 08:00:00", attachmentUrl: "/holiday.pdf" },
    { title: "宝盈纳斯达克100指数型发起式证券投资基金（QDII）调整大额申购、定期定额投资业务限制金额的公告", pubDate: "2026-09-24 08:49:58", attachmentUrl: "/limit.pdf" },
    { title: "宝盈纳斯达克100指数型发起式证券投资基金（QDII）暂停申购、定期定额投资业务的公告", pubDate: "2026-01-12 08:44:14", attachmentUrl: "/suspend.pdf" }
  ] } };
  const notice = baoying.pickLatestNotice(payload);
  assert.equal(notice.attachmentUrl, "/limit.pdf");
  assert.equal(notice.pubDate, "2026-09-24 08:49:58");
});


test("Guotai reads the official inline daily purchase limit", () => {
  const html = `<script>var gtOptions = { fundcode: '160213', limits: {"buy":{"high":100,"low":1,"add":null,"ccn":"申购","application":99999,"accumulation":100},"sell":{"mps":0.01}}, flags: {"subscribe_state":false,"closed":false} };</script>`;
  assert.equal(guotai.parseInlineLimit(html), 100);
  assert.equal(guotai.parseInlineLimit("<html>layout changed</html>"), null);
  assert.equal(guotai.parseInlineLimit("limits: {\"buy\":{\"high\":null,\"accumulation\":null}}, flags: {}"), null);
});
