"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve("miniapp");
const required = [
  "project.config.json", "app.js", "app.json", "app.wxss", "sitemap.json",
  "pages/index/index.js", "pages/index/index.json", "pages/index/index.wxml", "pages/index/index.wxss",
  "pages/detail/detail.js", "pages/detail/detail.json", "pages/detail/detail.wxml", "pages/detail/detail.wxss",
  "pages/about/about.js", "pages/about/about.json", "pages/about/about.wxml", "pages/about/about.wxss",
  "utils/api.js", "utils/funds.js"
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error("missing miniapp file: " + file);
}

for (const file of required.filter((file) => file.endsWith(".json"))) {
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
for (const page of app.pages || []) {
  for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
    if (!fs.existsSync(path.join(root, page + extension))) throw new Error("incomplete page: " + page + extension);
  }
}

const api = fs.readFileSync(path.join(root, "utils/api.js"), "utf8");
if (!api.includes("https://") && !fs.readFileSync(path.join(root, "app.js"), "utf8").includes("https://")) {
  throw new Error("miniapp data endpoint must use HTTPS");
}

console.log("miniapp structure ok: " + required.length + " required files, " + app.pages.length + " pages");
