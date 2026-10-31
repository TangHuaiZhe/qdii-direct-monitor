"use strict";
const { createAdapter } = require("./base");
const { normalizeExtractedText, parseAmount, parseShareAmount, resourceToHtml } = require("../parser");
const { readEventCache, updateNoticeTimeline } = require("../notice-events");

function parseDirectAmount(text, fund) {
  const value = normalizeExtractedText(text);
  const match = value.match(/(?:本公司)?直销渠道[^。；]{0,220}?累计金额限制(?:调整)?(?:仍)?为?\s*([\d][\d,\s]*)元/);
  if (match) {
    const amount = Number(match[1].replace(/[,\s]/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, currency: fund.currency || "CNY" };
  }
  if (/代销渠道/.test(value) && /直销渠道/.test(value)) return null;
  return parseShareAmount(value, fund) || parseAmount(value);
}

function discoverNoticeCandidates(html, baseUrl) {
  const candidates = [];
  const itemPattern = /<a\b[^>]*href="([^"]+)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]{0,300}?m-advisory-wj-news-item-time">(20\d{2}-\d{2}-\d{2})/gi;
  let item;
  while ((item = itemPattern.exec(String(html || "")))) {
    if (!/纳斯达克100/.test(item[2]) || !/(申购|限额|暂停|恢复)/.test(item[2])) continue;
    const url = new URL(item[1], baseUrl).toString();
    candidates.push({ manager: "万家基金", title: item[2], url, cacheKey: `${url}#events-v2`, publishedAt: item[3], fundCodes: [],
      currencyScope: "CNY", shareClasses: [], eventHint: /恢复申购/.test(item[2]) ? "resume" : "unknown" });
  }
  return candidates.slice(0, 12);
}

const adapter = createAdapter({ id: "wanjia", manager: "万家基金", allowedHosts: ["wjasset.com"], parseAmount: parseDirectAmount, defaultSource: (f) => `https://www.wjasset.com/products/qdii/${f.code}/news/report/index.html`, detailSource: (f) => `https://www.wjasset.com/products/qdii/${f.code}/index.html` });
const collectBase = adapter.collect.bind(adapter);

adapter.collect = async function collect(fund, context) {
  const safeFund = { ...fund, officialSources: fund.officialSources?.map((source) => ({ ...source, followLinks: false })) };
  const rows = await collectBase(safeFund, context);
  try {
    const indexUrl = fund.officialSources?.[0]?.url || this.defaultSource(fund);
    const index = await context.fetchResource(indexUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const candidates = discoverNoticeCandidates(resourceToHtml(index), index.finalUrl);
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates });
    if (timeline) rows.push(timeline);
  } catch (error) {
    context.warnings.push(`${fund.code} wanjia notices: ${error.message}`);
    if (readEventCache(context.eventCacheDir, this.id, fund.code).length && context.noticeHealth) context.noticeHealth.cacheFallbacks += 1;
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates: [] });
    if (timeline) rows.push(timeline);
  }
  return rows;
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
