#!/usr/bin/env node
/**
 * Which OTT rows actually return titles?
 *
 * Uses the addon's own TMDB client (so it reads the key from Settings, never
 * from this script) to replay exactly the query each regional/global OTT row
 * makes, and reports the ones that come back empty — plus which filter is to
 * blame, so the fix is data rather than guesswork.
 *
 *   node scripts/probe-ott.mjs            # the empty ones, with diagnosis
 *   node scripts/probe-ott.mjs --all      # every region, every service
 */
import { setKey, get, tmdbPath } from "../addon/tmdb.mjs";
import { tmdbKey } from "../addon/settings.mjs";
import { COLLECTIONS, catalogEntries } from "./collections.mjs";

setKey(tmdbKey());

const ALL = process.argv.includes("--all");
const count = async (media, params) => {
  const res = await get(`/discover/${tmdbPath(media)}`, { ...params, page: 1 });
  return (res.results ?? []).length;
};

/** Every provider entry that the OTT cards publish. */
const rows = [];
for (const c of COLLECTIONS) {
  if (!/ott/i.test(c.key)) continue;
  for (const [type, media] of [["movie", "movie"], ["series", "tv"]]) {
    for (const e of catalogEntries(c, type === "movie" ? "movie" : "show")) {
      if (e.kind !== "provider") continue;
      rows.push({ card: c.key, type, media, entry: e, id: `nuvio-${c.key}--${slug(e.name)}${e.region ? `-${e.region.toLowerCase()}` : ""}` });
    }
  }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

console.log(`probing ${rows.length} OTT provider rows…\n`);

const base = (e) => ({
  with_watch_providers: e.providerId,
  watch_region: e.region || "US",
  sort_by: "popularity.desc",
  "vote_count.gte": 10,
});

const empty = [];
let done = 0;
for (const r of rows) {
  const withFilter = await count(r.media, { ...base(r.entry), with_watch_monetization_types: "flatrate" }).catch(() => -1);
  if (withFilter > 0) {
    done++;
    if (!ALL) continue;
    console.log(`  ok    ${String(withFilter).padStart(3)}  ${r.type} ${r.id}`);
    continue;
  }
  // Diagnose: is it the monetization filter, the provider id, or the region?
  const noMonetization = await count(r.media, base(r.entry)).catch(() => -1);
  const regionOnly = await count(r.media, { watch_region: r.entry.region || "US", sort_by: "popularity.desc" }).catch(() => -1);
  empty.push({ ...r, withFilter, noMonetization, regionOnly });
}

console.log(`\nrows returning titles: ${done} / ${rows.length}`);
console.log(`EMPTY rows: ${empty.length}`);
for (const e of empty) {
  const blame = e.noMonetization > 0
    ? "monetization filter"
    : e.regionOnly > 0
      ? "provider id not in this region"
      : "region has no TMDB data";
  console.log(`  ${e.type.padEnd(6)} ${e.id}`);
  console.log(`         provider ${e.entry.providerId} · region ${e.entry.region || "US"} · flatrate ${e.withFilter} · no-monetization ${e.noMonetization} · region-only ${e.regionOnly}  → ${blame}`);
}
