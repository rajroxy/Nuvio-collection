#!/usr/bin/env node
/**
 * Catalog audit — asks TMDB for every catalog row and reports the ones that
 * come back empty, grouped by entry kind. Empty rows are the "no titles
 * returned" bug: a wrong provider id, a keyword name TMDB does not know, or a
 * filter combination that matches nothing.
 *
 * Needs TMDB_API_KEY in the environment. Read-only; changes nothing.
 *
 *   node scripts/audit-catalogs.mjs            # every row
 *   node scripts/audit-catalogs.mjs --kind=provider
 *
 * Exit code is 0 even when rows are empty — this is a report, not a gate.
 */
import { catalogDefs } from "../addon/catalogs.mjs";
import { catalogMetas } from "../addon/index.mjs";
import { hasKey } from "../addon/tmdb.mjs";

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const onlyKind = arg("kind");
const concurrency = Number(arg("concurrency")) || 6;

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the audit needs it to query TMDB.");
  process.exit(1);
}

const allDefs = catalogDefs();
const defs = onlyKind ? allDefs.filter((d) => d.entry.kind === onlyKind) : allDefs;
console.error(`auditing ${defs.length} catalogs, ${concurrency} at a time…`);

const rows = new Array(defs.length);
let next = 0;

async function worker() {
  for (;;) {
    const i = next++;
    if (i >= defs.length) return;
    const def = defs[i];
    let count = 0;
    let error = null;
    try {
      count = (await catalogMetas(def.type, def, 0)).length;
    } catch (err) {
      error = err.message;
    }
    rows[i] = { def, count, error };
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

const empty = rows.filter((r) => !r.error && r.count === 0);
const failed = rows.filter((r) => r.error);

const byKind = new Map();
for (const r of empty) {
  const k = r.def.entry.kind;
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push(r);
}

console.log(`\n${rows.length} catalogs checked — ${empty.length} empty, ${failed.length} errored\n`);

if (empty.length) {
  console.log("EMPTY ROWS");
  for (const [kind, list] of [...byKind].sort()) {
    console.log(`\n  ${kind} (${list.length})`);
    for (const r of list.slice(0, 40)) console.log(`    ${r.def.type.padEnd(6)} ${r.def.id}  |  ${r.def.name}`);
    if (list.length > 40) console.log(`    … +${list.length - 40} more`);
  }
}

if (failed.length) {
  console.log("\nERRORED");
  for (const r of failed.slice(0, 20)) console.log(`    ${r.def.id}  ${r.error}`);
}

const byType = rows.reduce((acc, r) => {
  acc[r.def.type] = acc[r.def.type] || { ok: 0, empty: 0 };
  acc[r.def.type][r.count ? "ok" : "empty"]++;
  return acc;
}, {});
console.log(`\nsummary: ${JSON.stringify(byType)}`);
