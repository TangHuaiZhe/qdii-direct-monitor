"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSite } = require("../src/site");

test("buildSite publishes dashboard, SEO discovery files, and fund pages", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const siteDir = path.join(root, "site");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "latest.html"), "<!doctype html><title>monitor</title>");
  fs.writeFileSync(path.join(dataDir, "latest.json"), JSON.stringify({
    observedAt: "2026-08-31T00:00:00Z",
    rows: [{
      fundCode: "040046",
      fundName: "华安纳指",
      manager: "华安基金",
      currency: "CNY",
      shareClass: "A",
      channel: { kind: "direct", access: "web" },
      status: "limited",
      limitAmount: 100,
      reliability: { grade: "A", reason: "official" },
      source: { url: "https://example.com/fund/040046" }
    }],
    fees: [{
      fundCode: "040046",
      annualRate: 0.8,
      managementRate: 0.6,
      custodyRate: 0.2,
      salesServiceRate: 0,
      reliability: { grade: "B", reason: "public" },
      source: { url: "https://example.com/fee/040046" }
    }]
  }));
  fs.writeFileSync(path.join(dataDir, "state.json"), "private runtime state");
  const socialImage = path.join(root, "og.png");
  fs.writeFileSync(socialImage, "image");

  const result = buildSite({ dataDir, siteDir, socialImage });

  assert.deepEqual(result.files, [
    "index.html", "latest.html", "latest.json", "og.png", ".nojekyll",
    "robots.txt", "sitemap.xml", "funds/040046/index.html"
  ]);
  assert.equal(fs.readFileSync(path.join(siteDir, "index.html"), "utf8"), "<!doctype html><title>monitor</title>");
  assert.equal(fs.existsSync(path.join(siteDir, "state.json")), false);
  assert.match(fs.readFileSync(path.join(siteDir, "robots.txt"), "utf8"), /Sitemap: .*sitemap\.xml/);
  assert.match(fs.readFileSync(path.join(siteDir, "sitemap.xml"), "utf8"), /funds\/040046\//);
  assert.match(fs.readFileSync(path.join(siteDir, "funds/040046/index.html"), "utf8"), /rel="canonical"/);
});

test("buildSite fails instead of deploying an empty dashboard", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildSite({ dataDir: root, siteDir: path.join(root, "site") }), /missing generated monitor output/);
});
