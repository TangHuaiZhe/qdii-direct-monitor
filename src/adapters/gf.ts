"use strict";
const { createAdapter } = require("./base");
const { resourceToText } = require("../parser");
const { readEventCache, updateNoticeTimeline } = require("../notice-events");

function decodeNoticeRecords(text) {
  const match = String(text || "").match(/var FundPost\d+\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return [];
  const records = [];
  const pattern = /"DOCTITLE":"((?:\\.|[^"\\])*)","DOCPUBURL":"((?:\\.|[^"\\])*)"(?:\.replace\([^)]*\))?,"DOCRELTIME":"([^"]*)"/g;
  let item;
  while ((item = pattern.exec(match[1]))) {
    if (!item[1] || !item[2]) continue;
    records.push({ title: item[1], url: item[2], date: item[3].slice(0, 10).replace(/\./g, "-") });
  }
  return records;
}

function noticeAppliesToFund(title, fund) {
  if (/美元份额/.test(title)) return fund.currency === "USD";
  if (/人民币份额/.test(title)) return fund.currency === "CNY";
  if (/人民币/.test(title)) return fund.currency === "CNY";
  if (/美元/.test(title)) return fund.currency === "USD";
  return true;
}

function pickLatestNotice(text, fund) {
  return decodeNoticeRecords(text).find((notice) =>
    noticeAppliesToFund(notice.title, fund) &&
    /纳斯达克100.*联接基金|纳指100ETF联接/.test(notice.title) &&
    /(暂停申购|恢复申购|限制申购|限额|调整大额申购)/.test(notice.title)
  ) || null;
}

function discoverNoticeCandidates(text, fund) {
  return decodeNoticeRecords(text).filter((notice) =>
    noticeAppliesToFund(notice.title, fund) &&
    /纳斯达克100.*联接基金|纳指100ETF联接/.test(notice.title) &&
    /(暂停申购|恢复申购|限制申购|限额|调整大额申购)/.test(notice.title)
  ).map((notice) => {
    const url = notice.url.replace(/^http:/, "https:");
    const eventHint = /继续暂停申购/.test(notice.title) ? "confirm-restriction" : (/恢复申购/.test(notice.title) ? "resume" : (/暂停申购/.test(notice.title) && !/大额/.test(notice.title) ? "suspend-all" : "unknown"));
    return {
      manager: "广发基金", title: notice.title, url,
      ...(eventHint === "confirm-restriction" ? { cacheKey: `${url}#events-v4` } : {}),
      publishedAt: notice.date || null, fundCodes: [],
      currencyScope: /美元/.test(notice.title) ? "USD" : (/人民币/.test(notice.title) ? "CNY" : "all"),
      shareClasses: [], eventHint
    };
  }).slice(0, 12);
}

const adapter = createAdapter({ id: "gf", manager: "广发基金", allowedHosts: ["gffunds.com.cn"], defaultSource: (f) => `https://gfwx.gffunds.com.cn/funds/?fundcode=${f.code}` });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const rows = await collectBase(fund, context);
  try {
    const searchUrl = `https://www.gffunds.com.cn/was5/web/search?channelid=228364&page=1&searchword=${encodeURIComponent(fund.code)}`;
    const search = await context.fetchResource(searchUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const candidates = discoverNoticeCandidates(await resourceToText(search), fund);
    const timeline = await updateNoticeTimeline({
      adapter: this,
      fund,
      context,
      candidates,
      fetchCandidate: async (candidate) => {
        if (candidate.eventHint === "confirm-restriction") {
          return { bytes: Buffer.from(`${fund.code} ${candidate.title}`), contentType: "text/html", finalUrl: `${candidate.url}#title` };
        }
        return context.fetchResource(candidate.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
      }
    });
    if (timeline) rows.push(timeline);
  } catch (error) {
    context.warnings.push(`${fund.code} gf notices: ${error.message}`);
    const cached = readEventCache(context.eventCacheDir, this.id, fund.code);
    if (cached.length && context.noticeHealth) context.noticeHealth.cacheFallbacks += 1;
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates: [], indexChecked: false });
    if (timeline) rows.push(timeline);
  }
  return rows;
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
module.exports.pickLatestNotice = pickLatestNotice;
