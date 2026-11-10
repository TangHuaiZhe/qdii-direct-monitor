"use strict";
const { createAdapter } = require("./base");
const { updateNoticeTimeline } = require("../notice-events");

const API_URL = "https://www.dcfund.com.cn/servlet/json";
const PRODUCT_URL = (code) => `https://download.dcfund.com.cn/main/fund/productdetail/index.shtml?product_code=${code}`;
const REFERER_URL = (code) => `https://www.dcfund.com.cn/main/fund/productdetail/index.shtml?product_code=${code}`;

function decodeNotices(payload) {
  const records = payload?.results?.[0]?.data;
  if (!Array.isArray(records)) throw new Error("official notice list shape changed");
  return records;
}

function discoverNoticeCandidates(payload, baseUrl) {
  const candidates = [];
  for (const record of decodeNotices(payload)) {
    const title = String(record?.title || "").replace(/\s+/g, " ").trim();
    if (!/大成纳斯达克100/.test(title)) continue;
    if (!/(申购|限额)/.test(title) || !/(调整|暂停|恢复|限制)/.test(title)) continue;
    if (/节假日|非交易日/.test(title)) continue;
    if (!record.attachment_url || !/^20\d{2}-\d{2}-\d{2}/.test(record.pub_date || "")) continue;
    let url;
    try { url = new URL(record.attachment_url, baseUrl).toString(); } catch { continue; }
    candidates.push({ manager: "大成基金", title, url, publishedAt: record.pub_date.slice(0, 10), fundCodes: [], currencyScope: "CNY", shareClasses: [],
      eventHint: /恢复申购/.test(title) ? "resume" : (/暂停申购/.test(title) && !/大额/.test(title) ? "suspend-all" : "unknown") });
  }
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12);
}

const adapter = createAdapter({
  id: "dacheng",
  manager: "大成基金",
  allowedHosts: ["dcfund.com.cn"],
  defaultSource: PRODUCT_URL,
  detailSource: PRODUCT_URL
});

adapter.collect = async function collect(fund, context) {
  const productUrl = PRODUCT_URL(fund.code);
  try {
    const resource = await context.fetchResource(API_URL, {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs,
      method: "POST", body: new URLSearchParams({ funcNo: "742003", product_code: fund.code, curtPageNo: "1", numPerPage: "50", _tksendtype: "post" }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://www.dcfund.com.cn",
        referer: REFERER_URL(fund.code),
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      }
    });
    const payload = JSON.parse(new TextDecoder("utf-8").decode(resource.bytes));
    const candidates = discoverNoticeCandidates(payload, "https://www.dcfund.com.cn");
    if (!candidates.length) throw new Error("no applicable official subscription notice found");
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates });
    if (timeline) return [timeline];
    throw new Error("latest official subscription notice was not safely parsed");
  } catch (error) {
    context.warnings.push(`${fund.code} dacheng notices: ${error.message}`);
    return [this.unknownRow(fund, context.observedAt, productUrl)];
  }
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
