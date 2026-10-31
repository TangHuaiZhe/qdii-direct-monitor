"use strict";
const { createAdapter } = require("./base");
const { extractPdfLinks, htmlToText, normalizeExtractedText, parseAmount: parseGenericAmount, resourceToHtml } = require("../parser");
const { readEventCache, updateNoticeTimeline } = require("../notice-events");

function noticeListUrl(fund) {
  return `https://fund.chinaamc.com/product/publishGgList.do?fundcode=${fund.code}`;
}

function discoverNoticeCandidates(html, baseUrl) {
  const candidates = [];
  const pattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,240}?<div class="item">(20\d{2}-\d{2}-\d{2})<\/div>/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    const title = htmlToText(match[2]).replace(/\s+/g, " ").trim();
    if (!/(调整申购|限制申购|暂停申购|恢复申购|申购.*上限)/.test(title)) continue;
    if (/(节假日|非港股通|境外主要投资场所)/.test(title)) continue;
    const url = new URL(match[1], baseUrl).toString();
    candidates.push({ manager: "华夏基金", title, url, cacheKey: `${url}#pdf-attachment-v1`, publishedAt: match[3], fundCodes: [],
      currencyScope: /美元/.test(title) ? "USD" : (/人民币/.test(title) ? "CNY" : "all"), shareClasses: [],
      eventHint: /恢复申购/.test(title) ? "resume" : (/暂停申购/.test(title) && !/大额/.test(title) ? "suspend-all" : "unknown") });
  }
  return candidates.slice(0, 12);
}

function parseFundAmount(text, fund) {
  if (fund.code === "005698") {
    const value = normalizeExtractedText(text);
    if (fund.currency === "USD") {
      const usd = value.match(/本公司直销机构[\s\S]{0,800}?不超过\s*([\d,.]+)\s*美元/);
      if (usd) {
        const amount = Number(usd[1].replace(/,/g, ""));
        if (Number.isFinite(amount) && amount > 0) return { amount, currency: "USD" };
      }
    } else {
      const cny = value.match(/本公司直销机构[\s\S]{0,500}?不超过人民币\s*([\d,.]+)\s*(万)?\s*元/);
      if (cny) {
        const amount = Number(cny[1].replace(/,/g, "")) * (cny[2] ? 10000 : 1);
        if (Number.isFinite(amount) && amount > 0) return { amount, currency: "CNY" };
      }
    }
  }
  return parseGenericAmount(text);
}

const adapter = createAdapter({ id: "chinaamc", manager: "华夏基金", allowedHosts: ["chinaamc.com"], defaultSource: (fund) => `https://fund.chinaamc.com/fund/${fund.code}/index.shtml`, detailSource: (fund) => `https://fund.chinaamc.com/fund/${fund.code}/index.shtml`, parseAmount: parseFundAmount });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const safeFund = { ...fund, officialSources: fund.officialSources?.map((source) => ({ ...source, followLinks: false })) };
  const rows = await collectBase(safeFund, context);
  try {
    const listUrl = noticeListUrl(fund);
    const index = await context.fetchResource(listUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const html = new TextDecoder("utf-8").decode(index.bytes);
    const candidates = discoverNoticeCandidates(html, listUrl);
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates, fetchCandidate: async (candidate) => {
      const article = await context.fetchResource(candidate.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
      const pdfUrl = extractPdfLinks(resourceToHtml(article), article.finalUrl)[0];
      if (!pdfUrl) return article;
      candidate.url = pdfUrl;
      return context.fetchResource(pdfUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    } });
    if (timeline) rows.push(timeline);
  } catch (error) {
    context.warnings.push(`${fund.code} chinaamc notices: ${error.message}`);
    if (readEventCache(context.eventCacheDir, this.id, fund.code).length && context.noticeHealth) context.noticeHealth.cacheFallbacks += 1;
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates: [], indexChecked: false });
    if (timeline) rows.push(timeline);
  }
  return rows;
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
module.exports.parseFundAmount = parseFundAmount;
