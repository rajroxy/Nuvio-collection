#!/usr/bin/env node
/**
 * Incremental keyword probe.
 *
 * `probe-tmdb.mjs` regenerates the whole verified table (platforms, regions,
 * countries *and* keywords), which is slow once the keyword list grows. This
 * script probes **only the labels missing from `tmdb-verified.json`** in
 * `keyword-candidates.mjs` and merges the results in, so the moods/themes cards can
 * grow without re-probing every country.
 *
 * A keyword is accepted only when TMDB's own name for it contains the phrase we
 * searched for, it is not already used by another label, and it actually returns
 * titles for at least one media type. Everything else contributes nothing.
 *
 *   node scripts/probe-keywords.mjs                          # every missing label
 *   PROBE_GROUP=moods-and-vibes node scripts/probe-keywords.mjs
 *   PROBE_LABELS="Asian Drama" node scripts/probe-keywords.mjs   # just these labels
 *   node scripts/probe-keywords.mjs --refresh                # re-probe them all
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, hasKey } from "../addon/tmdb.mjs";
import { KEYWORD_CANDIDATES } from "./keyword-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "tmdb-verified.json");

const REFRESH = process.argv.includes("--refresh") || process.env.PROBE_REFRESH === "1";
const GROUP = process.env.PROBE_GROUP || "";
const LABELS = new Set(
  String(process.env.PROBE_LABELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the probe needs it.");
  process.exit(1);
}

const verified = JSON.parse(fs.readFileSync(FILE, "utf8"));
verified.keywords = verified.keywords ?? {};

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

const filterCount = (tmdbType, params) =>
  get(`/discover/${tmdbType}`, { ...params, sort_by: "popularity.desc" })
    .then((r) => (r.results ?? []).length)
    .catch(() => 0);

/** Every keyword id already spoken for, so no two labels share one. */
const used = new Set(
  Object.values(verified.keywords).flatMap((labels) => Object.values(labels ?? {}).map((v) => v.id)),
);

/** Resolve one label, or null when none of its phrases works. */
async function probeLabel([label, phrases]) {
  let fallback = null;
  for (const name of phrases) {
    const search = await get("/search/keyword", { query: name }).catch(() => ({ results: [] }));
    for (const hit of (search.results ?? []).slice(0, 6)) {
      if (!norm(hit.name).includes(norm(name))) continue;
      if (used.has(hit.id)) continue;
      // Claim the id before awaiting, so a parallel label cannot take it too; give
      // it back if the keyword turns out to return nothing.
      used.add(hit.id);
      const [movieCount, tvCount] = await Promise.all([
        filterCount("movie", { with_keywords: String(hit.id), "vote_count.gte": 10 }),
        filterCount("tv", { with_keywords: String(hit.id), "vote_count.gte": 10 }),
      ]);
      if (movieCount + tvCount === 0) {
        used.delete(hit.id);
        continue;
      }
      const entry = { name, id: hit.id, tmdbName: hit.name, movieCount, tvCount };
      // Prefer a keyword that works for BOTH rows; remember a one-sided one and
      // keep looking for something better.
      if (movieCount > 0 && tvCount > 0) return entry;
      fallback = fallback ?? entry;
    }
    if (fallback) break;
  }
  return fallback;
}

const groups = Object.keys(KEYWORD_CANDIDATES).filter((g) => !GROUP || g === GROUP);
if (!groups.length) {
  console.error(`PROBE_GROUP=${GROUP} is not one of ${Object.keys(KEYWORD_CANDIDATES).join(", ")}`);
  process.exit(1);
}

const jobs = [];
for (const group of groups) {
  const existing = verified.keywords[group] ?? {};
  for (const [label, phrases] of Object.entries(KEYWORD_CANDIDATES[group])) {
    if (!REFRESH && existing[label] && !LABELS.has(label)) continue;
    jobs.push({ group, label, phrases });
  }
}

if (!jobs.length) {
  console.log("nothing to do — every label in the candidate list is already verified.");
  process.exit(0);
}
console.log(`probing ${jobs.length} labels across ${groups.join(", ")}\n`);

const results = await pool(jobs, 5, async ({ group, label, phrases }) => {
  const entry = await probeLabel([label, phrases]);
  if (entry) console.log(`  ${group}/${label.padEnd(22)} → ${entry.tmdbName} (${entry.id}) mv=${entry.movieCount} tv=${entry.tvCount}`);
  else console.log(`  ${group}/${label.padEnd(22)} → no usable keyword`);
  return { group, label, entry };
});

let added = 0;
for (const { group, label, entry } of results) {
  if (!entry) continue;
  verified.keywords[group] = verified.keywords[group] ?? {};
  verified.keywords[group][label] = entry;
  added++;
}
fs.writeFileSync(FILE, JSON.stringify(verified, null, 2) + "\n");

const failed = results.filter((r) => !r.entry).map((r) => `${r.group}/${r.label}`);
console.log(`\nadded ${added} keywords`);
for (const group of groups) {
  const labels = Object.keys(verified.keywords[group] ?? {});
  const both = labels.filter((l) => verified.keywords[group][l].movieCount && verified.keywords[group][l].tvCount);
  console.log(`  ${group}: ${labels.length} labels (${both.length} with both rows)`);
}
console.log(`labels with no usable keyword (${failed.length}): ${failed.join(", ") || "none"}`);
