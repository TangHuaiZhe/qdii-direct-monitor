"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderFundHtml } = require("./report");

const SITE_URL = "https://tanghuaizhe.github.io/qdii-direct-monitor/";

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  }[character]));
}

function buildSite(options = {}) {
  const dataDir = path.resolve(options.dataDir || "data");
  const siteDir = path.resolve(options.siteDir || "site");
  const socialImage = path.resolve(options.socialImage || "assets/og.png");
  const htmlSource = path.join(dataDir, "latest.html");
  const jsonSource = path.join(dataDir, "latest.json");
  for (const source of [htmlSource, jsonSource]) {
    if (!fs.existsSync(source)) throw new Error(`missing generated monitor output: ${source}`);
  }
  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(htmlSource, path.join(siteDir, "index.html"));
  fs.copyFileSync(htmlSource, path.join(siteDir, "latest.html"));
  fs.copyFileSync(jsonSource, path.join(siteDir, "latest.json"));
  if (!fs.existsSync(socialImage)) throw new Error(`missing social preview image: ${socialImage}`);
  fs.copyFileSync(socialImage, path.join(siteDir, "og.png"));
  fs.writeFileSync(path.join(siteDir, ".nojekyll"), "", "utf8");
  const payload = JSON.parse(fs.readFileSync(jsonSource, "utf8"));
  const fundCodes = [...new Set((payload.rows || [])
    .map((row) => String(row.fundCode || ""))
    .filter((code) => /^\d{6}$/.test(code)))]
    .sort();
  for (const code of fundCodes) {
    const html = renderFundHtml(payload, code, SITE_URL);
    if (!html) continue;
    const detailPath = path.join(siteDir, "funds", code, "index.html");
    fs.mkdirSync(path.dirname(detailPath), { recursive: true });
    fs.writeFileSync(detailPath, html, "utf8");
  }

  const lastmod = payload.observedAt
    ? new Date(payload.observedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const urls = [SITE_URL, ...fundCodes.map((code) => SITE_URL + "funds/" + code + "/")];
  fs.writeFileSync(
    path.join(siteDir, "robots.txt"),
    "User-agent: *\nAllow: /\n\nSitemap: " + SITE_URL + "sitemap.xml\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(siteDir, "sitemap.xml"),
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
      + urls.map((url) => "  <url><loc>" + escapeXml(url) + "</loc><lastmod>" + lastmod + "</lastmod></url>").join("\n")
      + "\n</urlset>\n",
    "utf8"
  );

  return {
    siteDir,
    files: [
      "index.html",
      "latest.html",
      "latest.json",
      "og.png",
      ".nojekyll",
      "robots.txt",
      "sitemap.xml",
      ...fundCodes.map((code) => "funds/" + code + "/index.html")
    ]
  };
}

if (require.main === module) console.log(JSON.stringify(buildSite(), null, 2));

module.exports = { buildSite };
