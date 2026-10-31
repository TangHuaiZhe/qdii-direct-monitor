"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText, resourceToHtml } = require("../parser");
const { readEventCache, updateNoticeTimeline } = require("../notice-events");

function decodeNoticeList(resource) {
  const payload = JSON.parse(new TextDecoder().decode(resource.bytes));
  const notices = payload?.data?.content;
  if (!Array.isArray(notices)) throw new Error("official notice list shape changed");
  return notices.filter((notice) => Number.isInteger(notice?.cntId) && /^20\d{2}-\d{2}-\d{2}$/.test(notice?.date || "") &&
    /建信纳斯达克100指数型证券投资基金（QDII）/.test(notice?.title || "") && /(暂停|恢复|申购|限额)/.test(notice.title));
}

function latestLimitNotice(resource) {
  return decodeNoticeList(resource).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function discoverNoticeCandidates(resource) {
  return decodeNoticeList(resource).map((notice) => ({
    manager: "建信基金",
    title: notice.title,
    url: `https://www.ccbfund.cn/resource/static/content/${notice.cntId}.html`,
    publishedAt: notice.date,
    fundCodes: [],
    currencyScope: "all",
    shareClasses: [],
    eventHint: /恢复申购/.test(notice.title) ? "resume" : "unknown",
    cacheKey: `https://www.ccbfund.cn/resource/static/content/${notice.cntId}.html#attachment-v1`
  })).slice(0, 12);
}

function extractDocumentUrl(html, baseUrl) {
  const match = String(html || "").match(/<a\b[^>]*href=["']([^"']+\.(?:docx?|pdf)(?:\?[^"']*)?)["']/i);
  return match ? new URL(match[1], baseUrl).toString() : null;
}

function parseDirectAmount(text, fund) {
  const value = normalizeExtractedText(text);
  const directClause = value.match(/针对在建信基金直销渠道[^。；]{0,500}/)?.[0];
  if (directClause && directClause.includes(String(fund.code))) {
    const directAmount = directClause.match(/高于\s*([\d,]+(?:\.\d+)?)\s*(元|美元)/);
    if (directAmount) {
      const amount = Number(directAmount[1].replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) return { amount, currency: directAmount[2] === "美元" ? "USD" : "CNY" };
    }
  }
  const codesMatch = value.match(/下属分级基金的交易代码\s+((?:\d{6}\s+){1,7}\d{6})/);
  if (!codesMatch) return null;
  const codes = codesMatch[1].match(/\d{6}/g) || [];
  const index = codes.indexOf(String(fund.code));
  if (index < 0) return null;
  const tail = value.slice(codesMatch.index + codesMatch[0].length);
  const label = tail.match(/下属分级基金的限制申购金额（单位：(人民币元|美元)）\s*/);
  if (!label) return null;
  const segment = tail.slice(label.index + label[0].length).split(/下属分级基金的限制定期|其他需要提示/)[0];
  const values = segment.match(/[-—]|[\d,]+(?:\.\d+)?/g) || [];
  const raw = values[index];
  if (!raw || /^[-—]$/.test(raw)) return null;
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: label[1] === "美元" ? "USD" : (fund.currency || "CNY") };
}

const adapter = createAdapter({ id: "ccb", manager: "建信基金", allowedHosts: ["ccbfund.cn"], parseAmount: parseDirectAmount,
  focus: (text) => text,
  defaultSource: (fund) => `https://www.ccbfund.cn/website/v1/api/fund/notice?fundCode=${fund.code}&categoryId=&keyword=&start=&end=&page=1`,
  detailSource: (fund) => `https://www.ccbfund.cn/#/fund?fundCode=${fund.code}` });

adapter.collect = async function collect(fund, context) {
  const listUrl = this.defaultSource(fund);
  try {
    const list = await context.fetchResource(listUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const candidates = discoverNoticeCandidates(list);
    if (!candidates.length) throw new Error("no applicable official limit notice found");
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates, fetchCandidate: async (candidate) => {
      const article = await context.fetchResource(candidate.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
      const documentUrl = extractDocumentUrl(resourceToHtml(article), article.finalUrl);
      if (!documentUrl) throw new Error("official notice has no supported attachment");
      candidate.url = documentUrl;
      return context.fetchResource(documentUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    } });
    return timeline ? [timeline] : [this.unknownRow(fund, context.observedAt, listUrl)];
  } catch (error) {
    context.warnings.push(`${fund.code} ccb notices: ${error.message}`);
    if (readEventCache(context.eventCacheDir, this.id, fund.code).length && context.noticeHealth) context.noticeHealth.cacheFallbacks += 1;
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates: [], indexChecked: false });
    if (timeline) return [timeline];
    return [this.unknownRow(fund, context.observedAt, listUrl)];
  }
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
module.exports.extractDocumentUrl = extractDocumentUrl;
module.exports.latestLimitNotice = latestLimitNotice;
