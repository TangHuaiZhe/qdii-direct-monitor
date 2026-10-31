"use strict";
const { createAdapter } = require("./base");

const API_HOST = "www.byfunds.com";
const API_ROOT = `http://${API_HOST}/ws-business-server/fund`;

function decodeJson(resource) {
  return JSON.parse(new TextDecoder("utf-8").decode(resource.bytes));
}

function pickLatestNotice(payload) {
  const records = payload?.data?.list || [];
  return records.find((record) =>
    record.title &&
    record.pubDate &&
    /宝盈纳斯达克100/.test(record.title) &&
    /(调整大额申购|限制.*申购|暂停申购|恢复申购|限额)/.test(record.title) &&
    !/节假日|非交易日/.test(record.title)
  ) || null;
}

const adapter = createAdapter({ id: "baoying", manager: "宝盈基金", allowedHosts: ["byfunds.com"], defaultSource: (f) => `http://www.byfunds.com/fundDetail/${f.code}/index.html` });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const rows = await collectBase(fund, context);
  try {
    const info = await context.fetchResource(`${API_ROOT}/getFundInfo?productCode=${encodeURIComponent(fund.code)}`, {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs
    });
    const productId = decodeJson(info)?.data?.productId;
    if (!productId) return rows;
    const announcements = await context.fetchResource(`${API_ROOT}/productAnn?productId=${encodeURIComponent(productId)}&pageNum=1&pageSize=100&isPreview=&keyword=&selectTime=&type=&oldType=0`, {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs
    });
    const notice = pickLatestNotice(decodeJson(announcements));
    if (!notice) return rows;
    const path = notice.attachmentUrl || notice.url;
    if (!path) return rows;
    const pdf = await context.fetchResource(new URL(path, `http://${API_HOST}/`).toString(), {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs
    });
    rows.push(...await this.parseResource(pdf, fund, {
      kind: "notice",
      channel: { kind: "direct", access: "web" }
    }, context.observedAt));
  } catch (error) {
    context.warnings.push(`${fund.code} baoying notices: ${error.message}`);
  }
  return rows;
};

module.exports = adapter;
module.exports.pickLatestNotice = pickLatestNotice;
