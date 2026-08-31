"use strict";

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }

function htmlToText(html) {
  return clean(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
}

function resourceToHtml(resource) {
  const charset = String(resource.contentType || "").match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g, "").toLowerCase();
  const encoding = charset === "gb2312" || charset === "gbk" || charset === "gb18030" ? "gb18030" : "utf-8";
  return new TextDecoder(encoding).decode(resource.bytes);
}

async function resourceToText(resource) {
  const isPdf = /pdf/i.test(resource.contentType) || /\.pdf(?:$|\?)/i.test(resource.finalUrl);
  if (!isPdf) return htmlToText(resourceToHtml(resource));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(resource.bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 12); i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return clean(pages.join(" "));
}

function parseAmount(text) {
  const patterns = [
    /(?:限制(?:申购|大额申购)?金额|单日累计(?:购买|申购)上限|单日(?:单个基金账户)?(?:累计)?(?:申购|购买)(?:及[^，。；]{0,20})?(?:金额)?(?:应)?不超过|单日单账户限额|直销)\D{0,30}([\d,]+(?:\.\d+)?)\s*(万|人民币元|元|美元)/,
    /([\d,]+(?:\.\d+)?)\s*(万|人民币元|元|美元)\s*(?:限额申购|限购|上限)/,
    /(?:单日[^，。；]{0,120}(?:不应超过|应不超过|业务限额为|金额超过)|申请金额大于)\s*([\d,\s]+(?:\.\d+)?)\s*(万|人民币元|元|美元)/
  ];
  for (const pattern of patterns) {
    const match = clean(text).match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(/[,\s]/g, ""));
    if (Number.isFinite(value) && value > 0) return { amount: match[2] === "万" ? value * 10000 : value, currency: match[2] === "美元" ? "USD" : "CNY" };
  }
  const unitBefore = clean(text).match(/(?:限制申购金额|下属基金份额的限制金额)\s*[（(][^）)]*(人民币元|美元)[）)]\s*([\d,\s]+(?:\.\d+)?)/);
  if (unitBefore) {
    const value = Number(unitBefore[2].replace(/[,\s]/g, ""));
    if (Number.isFinite(value) && value > 0) return { amount: value, currency: unitBefore[1] === "美元" ? "USD" : "CNY" };
  }
  return null;
}

function parseStatus(text) {
  const value = clean(text);
  if (/(暂停申购|停止申购|暂不开放购买|不可购买)/.test(value)) return "suspended";
  if (/(限制大额申购|暂停大额申购|限大额|限额申购|限购|单日单账户限额)/.test(value)) return "limited";
  if (/(恢复申购|开放申购|开放购买|立即申购)/.test(value)) return "open";
  return "unknown";
}

function focusText(text, fund, radius = 900) {
  const value = clean(text);
  let index = value.indexOf(fund.code);
  if (index < 0) {
    const token = String(fund.name || "").replace(/[（(].*$/, "").slice(0, 16);
    if (token) index = value.indexOf(token);
  }
  return index < 0 ? value.slice(0, radius * 2) : value.slice(Math.max(0, index - radius), index + radius);
}

function inferChannels(text) {
  const result = [];
  if (/(线上直销|网上直销)/.test(text)) result.push({ kind: "direct", access: "web" });
  if (/(直销柜台|直销中心)/.test(text)) result.push({ kind: "direct", access: "counter" });
  if (/(基金公司APP|本公司APP|APP直销)/i.test(text)) result.push({ kind: "direct", access: "app" });
  if (/(直销机构|本公司直销|直销\s*[\d,]+(?:\.\d+)?\s*(?:万|元|美元))/.test(text) && !result.some((c) => c.kind === "direct")) result.push({ kind: "direct", access: "all" });
  if (/(天天基金|东方财富)/.test(text)) result.push({ kind: "agency", access: "eastmoney", name: "天天基金" });
  if (/(其他销售渠道|非直销销售机构|代销机构|非直销)/.test(text)) result.push({ kind: "agency", access: "all" });
  return result;
}

function extractRelevantLinks(html, baseUrl, fund) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const label = htmlToText(match[2]);
    if (!/(申购|限额|暂停|恢复)/.test(label)) continue;
    if (!(label.includes(fund.code) || label.includes("纳斯达克") || label.includes("纳指"))) continue;
    try { links.push({ url: new URL(match[1], baseUrl).toString(), label }); } catch { /* malformed link */ }
  }
  return links.slice(0, 3);
}

function extractPdfLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    try { links.push(new URL(match[1], baseUrl).toString()); } catch { /* malformed link */ }
  }
  return [...new Set(links)].slice(0, 2);
}

module.exports = { clean, extractPdfLinks, extractRelevantLinks, focusText, htmlToText, inferChannels, parseAmount, parseStatus, resourceToHtml, resourceToText };
