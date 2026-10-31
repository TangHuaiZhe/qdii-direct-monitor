"use strict";
const { createAdapter } = require("./base");
const { extractPdfLinks, focusText, parseAmount, parseStatus, resourceToHtml } = require("../parser");
const { readEventCache, updateNoticeTimeline } = require("../notice-events");

function focusCurrentStatus(text, fund) {
  const matches = [...text.matchAll(new RegExp(`(?:^|\\s)${fund.code}(?=\\s|$)`, "g"))];
  const index = matches.at(-1)?.index ?? text.indexOf(fund.code);
  return index < 0 ? text : text.slice(Math.max(0, index - 220), index + 620);
}

function focusFundText(text, fund) {
  return fund.code === "001668" ? focusCurrentStatus(text, fund) : focusText(text, fund);
}

function parseCurrentStatus(text, fund) {
  if (fund.code === "001668" && /正常\s+申购(?:\s+定投)?/.test(text)) return "open";
  return parseStatus(text);
}

function parseCurrentShareAmount(text, fund) {
  const compact = text.replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1");
  const codes = compact.match(/下属基金份额的交易代码\s+((?:\d{6}\s+){1,8})/)?.[1]?.match(/\d{6}/g) || [];
  const values = compact.match(/下属基金份额的限制申购金额\s+((?:[\d,.]+\s+){1,8})/)?.[1]?.match(/[\d,]+(?:\.\d+)?/g) || [];
  const index = codes.indexOf(fund.code);
  if (index >= 0 && values[index]) {
    const amount = Number(values[index].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, currency: fund.currency || "CNY" };
  }
  return parseAmount(text);
}

function discoverNoticeCandidates(html, baseUrl, fund) {
  const candidates = [];
  const titleKeyword = fund?.index === "globalMobileInternet" ? /全球移动互联/ : /纳斯达克100/;
  const rowPattern = /<tr>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(String(html || "")))) {
    const link = row[1].match(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    const date = row[1].match(/(20\d{2}-\d{2}-\d{2})/);
    if (!link || !date) continue;
    const title = link[2].replace(/\s+/g, " ").trim();
    if (!titleKeyword.test(title) || !/(申购|限额|暂停|恢复)/.test(title)) continue;
    const url = new URL(link[1], baseUrl).toString();
    candidates.push({ manager: "汇添富基金", title, url, cacheKey: `${url}#pdf-attachment-v1`, publishedAt: date[1], fundCodes: [],
      currencyScope: /美元/.test(title) ? "USD" : (/人民币/.test(title) ? "CNY" : "all"), shareClasses: [],
      eventHint: /恢复申购/.test(title) ? "resume" : (/暂停申购/.test(title) && !/大额/.test(title) ? "suspend-all" : "unknown") });
  }
  return candidates.slice(0, 12);
}

const adapter = createAdapter({ id: "huitianfu", manager: "汇添富基金", allowedHosts: ["99fund.com"], focus: focusFundText, parseAmount: parseCurrentShareAmount, parseStatus: parseCurrentStatus, defaultSource: (f) => `https://www.99fund.com/main/products/pofund/${f.code}/fundgg.shtml`, detailSource: (f) => `https://www.99fund.com/main/products/pofund/${f.code}/fundnav.shtml` });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const safeFund = { ...fund, officialSources: fund.officialSources?.map((source) => ({ ...source, followLinks: false })) };
  const rows = await collectBase(safeFund, context);
  try {
    const endpoint = `https://www.99fund.com/cgi-bin/news/Article?function=ajaxXxplList&func=fndgg&fundId=${fund.code}`;
    const body = new URLSearchParams({ curPage: "1", numPerPage: "20", fundId: fund.code, parentId: "2971", func: "fndgg", catalogId: "" }).toString();
    const index = await context.fetchResource(endpoint, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs, method: "POST", body,
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } });
    const html = new TextDecoder("gb18030").decode(index.bytes);
    const candidates = discoverNoticeCandidates(html, endpoint, fund);
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates, fetchCandidate: async (candidate) => {
      const article = await context.fetchResource(candidate.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
      const pdfUrl = extractPdfLinks(resourceToHtml(article), article.finalUrl)[0];
      if (!pdfUrl) throw new Error("official notice article has no PDF attachment");
      candidate.url = pdfUrl;
      return context.fetchResource(pdfUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    } });
    if (timeline) rows.push(timeline);
  } catch (error) {
    context.warnings.push(`${fund.code} huitianfu notices: ${error.message}`);
    if (readEventCache(context.eventCacheDir, this.id, fund.code).length && context.noticeHealth) context.noticeHealth.cacheFallbacks += 1;
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates: [], indexChecked: false });
    if (timeline) rows.push(timeline);
  }
  return rows;
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
