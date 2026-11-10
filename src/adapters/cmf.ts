"use strict";
const { createAdapter } = require("./base");
const { htmlToText, resourceToHtml } = require("../parser");
const { updateNoticeTimeline } = require("../notice-events");

function discoverNoticeCandidates(html, baseUrl) {
  const candidates = [];
  const item = /<a\b[^>]*class=["']item["'][^>]*href=["']([^"']+)["'][^>]*>\s*<p>([\s\S]*?)<\/p>\s*<span class=["']date["']>(20\d{2}-\d{2}-\d{2})<\/span>/gi;
  let match;
  while ((match = item.exec(String(html || "")))) {
    const title = htmlToText(match[2]).replace(/\s+/g, " ").trim();
    if (!/纳斯达克100/.test(title)) continue;
    if (!/(申购|限额)/.test(title) || !/(调整|暂停|恢复|限制)/.test(title)) continue;
    if (/节假日|非交易日/.test(title)) continue;
    if (/代销渠道/.test(title) && !/直销/.test(title)) continue;
    let url;
    try { url = new URL(match[1], baseUrl).toString(); } catch { continue; }
    candidates.push({ manager: "招商基金", title, url, publishedAt: match[3], fundCodes: [], currencyScope: "CNY", shareClasses: [],
      eventHint: /恢复申购/.test(title) ? "resume" : (/暂停申购/.test(title) && !/大额/.test(title) ? "suspend-all" : "unknown") });
  }
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12);
}

const adapter = createAdapter({
  id: "cmf",
  manager: "招商基金",
  allowedHosts: ["cmfchina.com"],
  defaultSource: (fund) => `https://www.cmfchina.com/web/fundDetail/${fund.code}/index.html`,
  detailSource: (fund) => `https://static.cmfchina.com/web/fundDetail/${fund.code}/index.html`
});

adapter.collect = async function collect(fund, context) {
  const productUrl = this.defaultSource(fund);
  try {
    const index = await context.fetchResource(productUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const candidates = discoverNoticeCandidates(resourceToHtml(index), index.finalUrl);
    if (!candidates.length) throw new Error("no applicable official subscription notice found");
    const timeline = await updateNoticeTimeline({ adapter: this, fund, context, candidates });
    if (timeline) return [timeline];
    throw new Error("latest official subscription notice was not safely parsed");
  } catch (error) {
    context.warnings.push(`${fund.code} cmf notices: ${error.message}`);
    return [this.unknownRow(fund, context.observedAt, productUrl)];
  }
};

module.exports = adapter;
module.exports.discoverNoticeCandidates = discoverNoticeCandidates;
