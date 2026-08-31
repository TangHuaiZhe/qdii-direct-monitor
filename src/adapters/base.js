"use strict";

const { fetchResource } = require("../http");
const { extractPdfLinks, extractRelevantLinks, focusText, inferChannels, parseAmount, parseStatus, resourceToHtml, resourceToText } = require("../parser");

class OfficialDirectAdapter {
  constructor(spec) { Object.assign(this, spec); }

  async parseResource(resource, fund, source, observedAt) {
    const fullText = await resourceToText(resource);
    const text = this.focus ? this.focus(fullText, fund) : focusText(fullText, fund);
    const amount = this.parseAmount ? this.parseAmount(text, fund) : parseAmount(text);
    const inferredChannels = inferChannels(text);
    let channels = source.channels || (source.channel ? [source.channel] : inferredChannels.filter((channel) => channel.kind === "direct"));
    if (!channels.length) channels = [{ kind: "direct", access: "all" }];
    let status = parseStatus(text);
    if (status === "unknown" && amount) status = "limited";
    if (status === "limited" && !amount) status = "unknown";
    const explicitChannel = Boolean(source.channels || source.channel || inferredChannels.some((channel) => channel.kind === "direct"));
    const grade = ["product", "current-status"].includes(source.kind) && explicitChannel ? "A" : (explicitChannel ? "B" : "C");
    return channels.filter((channel) => channel.kind === "direct").map((channel) => ({
      fundCode: fund.code, fundName: fund.name, manager: fund.manager, currency: amount?.currency || fund.currency || "CNY",
      shareClass: fund.shareClass || "", channel, status, limitAmount: amount?.amount || null,
      observedAt, effectiveDate: source.effectiveDate || null,
      source: { url: resource.finalUrl, kind: source.kind || "notice", adapter: this.id },
      reliability: { grade: status === "unknown" ? "D" : grade, reason: status === "unknown" ? "page fetched but current channel limit was not safely parsed" : this.reliabilityReason(source, explicitChannel) },
      notes: status === "unknown" ? ["No current, channel-specific amount could be established; do not treat as purchasable."] : []
    }));
  }

  reliabilityReason(source, explicitChannel) {
    if (source.kind === "product" && explicitChannel) return "current official product page explicitly identifies the channel";
    if (explicitChannel) return "official notice/page explicitly identifies the channel; actual logged-in transaction was not tested";
    return "official text implies a limit but channel scope is not explicit";
  }

  async collect(fund, context) {
    const sources = fund.officialSources?.length ? fund.officialSources : [{ url: this.defaultSource(fund), kind: "product", followLinks: true }];
    const rows = [];
    for (const source of sources.filter((s) => s.url)) {
      try {
        const resource = await context.fetchResource(source.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
        rows.push(...await this.parseResource(resource, fund, source, context.observedAt));
        if (source.followLinks && /html/i.test(resource.contentType)) {
          const links = extractRelevantLinks(resourceToHtml(resource), resource.finalUrl, fund);
          for (const link of links) {
            try {
              const child = await context.fetchResource(link.url, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
              rows.push(...await this.parseResource(child, fund, { kind: "notice" }, context.observedAt));
              if (/html/i.test(child.contentType)) {
                for (const pdfUrl of extractPdfLinks(resourceToHtml(child), child.finalUrl)) {
                  try {
                    const pdf = await context.fetchResource(pdfUrl, { allowedHosts: this.allowedHosts, timeoutMs: context.timeoutMs });
                    rows.push(...await this.parseResource(pdf, fund, { kind: "notice" }, context.observedAt));
                  } catch (error) { context.warnings.push(`${fund.code} linked PDF failed: ${error.message}`); }
                }
              }
            } catch (error) { context.warnings.push(`${fund.code} linked notice failed: ${error.message}`); }
          }
        }
      } catch (error) {
        context.warnings.push(`${fund.code} ${this.id}: ${error.message}`);
      }
    }
    if (rows.length) return rows;
    return [this.unknownRow(fund, context.observedAt, sources[0]?.url || null)];
  }

  unknownRow(fund, observedAt, url) {
    return { fundCode: fund.code, fundName: fund.name, manager: fund.manager, currency: fund.currency || "CNY", shareClass: fund.shareClass || "",
      channel: { kind: "direct", access: "all" }, status: "unknown", limitAmount: null, observedAt,
      source: url ? { url, kind: "fallback", adapter: this.id } : null,
      reliability: { grade: "D", reason: "official source unavailable or not parseable" }, notes: ["Manual confirmation in the manager app/site may be required."] };
  }
}

function createAdapter(spec) { return new OfficialDirectAdapter(spec); }
module.exports = { OfficialDirectAdapter, createAdapter, fetchResource };
