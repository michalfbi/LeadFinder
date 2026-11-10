#!/usr/bin/env node
// Wirtualny świat: sprawdzian obiegu wysyłka → odpowiedź → skrzynka bez prawdziwej poczty i sieci.
// Użycie: node scripts/simulate.mjs [--worlds 5] [--seed 1] [--companies 150] [--days 14] [--no-ai]
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const {
  runSimulation,
  formatReport,
  SABOTAGES,
} = require("../electron/simulation.cjs");

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const worlds = value("worlds", 5);
const first = value("seed", 1);
const base = {
  companies: value("companies", 150),
  days: value("days", 14),
  ai: !args.includes("--no-ai"),
};

const out = ["## Wirtualny świat LeadFindera", ""];
let failed = 0;
for (let seed = first; seed < first + worlds; seed++) {
  const report = await runSimulation({ ...base, seed });
  if (!report.ok) failed++;
  out.push(formatReport(report), "");
}

// Tester testera: celowo zepsute światy muszą zostać wykryte.
out.push(
  "### Czy tester wykrywa usterki",
  "",
  "| Celowe zepsucie | Wykryte |",
  "| --- | --- |",
);
for (const sabotage of SABOTAGES) {
  const report = await runSimulation({ ...base, seed: first, sabotage });
  if (report.ok) failed++;
  out.push(`| ${sabotage} | ${report.ok ? "❌ nie" : "✅ tak"} |`);
}
out.push(
  "",
  failed
    ? `**Wynik: ${failed} problem(ów).**`
    : "**Wynik: wszystkie zasady dotrzymane, wszystkie usterki wykryte.**",
);

const text = out.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
process.exit(failed ? 1 : 0);
