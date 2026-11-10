"use strict";
const { createAdapter } = require("./base");
const { htmlToText, resourceToHtml } = require("../parser");
const { recordTimelineHealth } = require("../notice-events");

const SEARCH_URL = "https://www.cifm.com/web/search?channelid=207436";
const SEARCH_KEYWORD = "摩根纳斯达克100 申购";

function pickLatestNotice(html, baseUrl = SEARCH_URL) {
  const results = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<p class="title">([\s\S]*?)<\/p>[\s\S]*?<p class="category">([\s\S]*?)<\/p>/gi;
  for (const match of String(html || "").matchAll(re)) {
    const title = htmlToText(match[2]).replace(/\s+/g, " ").trim();
    const category = htmlToText(match[3]);
    const publishedAt = category.match(/(20\d{2})-(\d{2})-(\d{2})/)?.[0] || null;
    if (!publishedAt || /节假日|非交易日/.test(title)) continue;
    if (!/摩根纳斯达克100/.test(title)) continue;
    if (!/(调整|暂停|限制).{0,20}(申购|限额)|(?:申购|限额).{0,20}(调整|暂停|限制)/.test(title)) continue;
    let url;
    try { url = new URL(match[1], baseUrl).toString(); } catch { continue; }
    if (!/^https:\/\/www\.cifm\.com\//.test(url)) continue;
    results.push({ url, title, publishedAt });
  }
  return [...new Map(results.map((item) => [item.url, item])).values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0] || null;
}

const adapter = createAdapter({ id: "jpmorgan", manager: "摩根基金", allowedHosts: ["cifm.com"], defaultSource: (f) => `https://www.cifm.com/fund/${f.code}/` });
adapter.collect = async function collect(fund, context) {
  try {
    const search = await context.fetchResource(SEARCH_URL, {
      allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs,
      method: "POST", body: new URLSearchParams({ searchword: SEARCH_KEYWORD }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
    const notice = pickLatestNotice(resourceToHtml(search), search.finalUrl || SEARCH_URL);
    if (!notice) throw new Error("latest subscription-limit notice not found");
    const resource = await context.fetchResource(notice.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
    const rows = await this.parseResource(resource, fund, {
      kind: "notice", channel: { kind: "direct", access: "all" }
    }, context.observedAt);
    const parsed = rows.find((row) => row.status !== "unknown");
    recordTimelineHealth(context, this.id, fund.code, notice.publishedAt, parsed?.effectiveDate || null);
    return rows;
  } catch (error) {
    context.warnings.push(`${fund.code} jpmorgan notices: ${error.message}`);
  }
  return [this.unknownRow(fund, context.observedAt, SEARCH_URL)];
};

module.exports = adapter;
module.exports.pickLatestNotice = pickLatestNotice;
