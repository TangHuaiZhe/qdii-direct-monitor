"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
  return { siteDir, files: ["index.html", "latest.html", "latest.json", "og.png", ".nojekyll"] };
}

if (require.main === module) console.log(JSON.stringify(buildSite(), null, 2));

module.exports = { buildSite };
