#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./collector");

function argumentsOf(argv) {
  const args = { command: argv[0] || "run", config: "config/funds.example.json" };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--config") args.config = argv[++i];
    else if (argv[i] === "--no-save") args.save = false;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

async function once(args) {
  const configPath = path.resolve(args.config);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const result = await run(config, { baseDir: path.dirname(configPath), save: args.save });
  const outputDir = path.resolve(path.dirname(configPath), config.outputDir || "data");
  const outputs = args.save === false ? null : {
    html: path.join(outputDir, "latest.html"),
    json: path.join(outputDir, "latest.json"),
    history: path.join(outputDir, "history")
  };
  console.log(JSON.stringify({ observedAt: result.observedAt, rows: result.rows.length, changes: result.changes.length, warnings: result.warnings, health: result.health, notification: result.notification, outputs }, null, 2));
  return config;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.command === "run") return once(args);
  if (args.command !== "watch") throw new Error("command must be run or watch");
  const config = await once(args);
  const minutes = Number(config.schedule?.intervalMinutes || 30);
  if (!Number.isFinite(minutes) || minutes < 5) throw new Error("schedule.intervalMinutes must be at least 5");
  setInterval(() => once(args).catch((error) => console.error(error.stack || error.message)), minutes * 60 * 1000);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
