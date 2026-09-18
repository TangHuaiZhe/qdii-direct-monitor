"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderHtml } = require("./report");

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function saveRun(outputDir, payload, historyLimit = 180) {
  writeAtomic(path.join(outputDir, "latest.json"), payload);
  writeTextAtomic(path.join(outputDir, "latest.html"), renderHtml(payload));
  writeAtomic(path.join(outputDir, "state.json"), payload.snapshot);
  const historyDir = path.join(outputDir, "history");
  const name = payload.observedAt.replace(/[:.]/g, "-") + ".json";
  writeAtomic(path.join(historyDir, name), payload);
  const files = fs.readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const file of files.slice(historyLimit)) fs.unlinkSync(path.join(historyDir, file));
}

module.exports = { readJson, saveRun, writeAtomic, writeTextAtomic };
