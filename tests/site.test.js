"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSite } = require("../src/site");

test("buildSite publishes only the current dashboard and machine-readable result", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const siteDir = path.join(root, "site");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "latest.html"), "<!doctype html><title>monitor</title>");
  fs.writeFileSync(path.join(dataDir, "latest.json"), "{\"rows\":[]}");
  fs.writeFileSync(path.join(dataDir, "state.json"), "private runtime state");
  const socialImage = path.join(root, "og.png");
  fs.writeFileSync(socialImage, "image");

  const result = buildSite({ dataDir, siteDir, socialImage });

  assert.deepEqual(result.files, ["index.html", "latest.html", "latest.json", "og.png", ".nojekyll"]);
  assert.equal(fs.readFileSync(path.join(siteDir, "index.html"), "utf8"), "<!doctype html><title>monitor</title>");
  assert.equal(fs.existsSync(path.join(siteDir, "state.json")), false);
});

test("buildSite fails instead of deploying an empty dashboard", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qdii-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => buildSite({ dataDir: root, siteDir: path.join(root, "site") }), /missing generated monitor output/);
});
