#!/usr/bin/env node
/**
 * Incremental country probe.
 *
 * `probe-tmdb.mjs` regenerates the whole verified table, which is slow once the
 * country list grows. This script probes **only the countries missing from
 * `tmdb-verified.json`** and merges the results in, so the fact table can grow
 * without paying for a full re-probe.
 *
 * For each new country it records:
 *   - how many titles TMDB has with that origin country, per media type
 *   - the region's own OTT services that actually resolve AND return titles
 *
 *   node scripts/probe-countries.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, hasKey } from "../addon/tmdb.mjs";
import { COUNTRIES } from "./collections.mjs";
import { REGIONAL_CANDIDATES } from "./regional-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "tmdb-verified.json");
const LOCAL_LIMIT = Number(process.env.PROBE_LOCAL_LIMIT) || 3;

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the probe needs it.");
  process.exit(1);
}

const verified = JSON.parse(fs.readFileSync(FILE, "utf8"));
const known = new Set(Object.keys(verified.countries ?? {}));
const pending = COUNTRIES.filter(([name]) => !known.has(name));

if (!pending.length) {
  console.log("nothing to do — every country in collections.mjs is already verified.");
  process.exit(0);
}
console.log(`probing ${pending.length} new countries: ${pending.map(([n]) => n).join(", ")}`);

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
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

const regionProviders = async (region, tmdbType) => {
  const res = await get(`/watch/providers/${tmdbType}`, { watch_region: region }).catch(() => ({ results: [] }));
  const seen = new Map();
  for (const p of res.results ?? []) if (!seen.has(p.provider_id)) seen.set(p.provider_id, { id: p.provider_id, name: p.provider_name });
  return [...seen.values()];
};

const providerCount = (id, region, tmdbType) =>
  get(`/discover/${tmdbType}`, {
    with_watch_providers: id,
    watch_region: region,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    "vote_count.gte": 10,
  })
    .then((r) => (r.results ?? []).length)
    .catch(() => 0);

const filterCount = (tmdbType, params) =>
  get(`/discover/${tmdbType}`, { ...params, sort_by: "popularity.desc" })
    .then((r) => (r.results ?? []).length)
    .catch(() => 0);

function findBrand(list, accepted) {
  const wanted = accepted.map(norm);
  for (const w of wanted) {
    const exact = list.find((p) => norm(p.name) === w);
    if (exact) return exact;
  }
  for (const w of wanted) {
    const loose = list.find((p) => norm(p.name).includes(w) || w.includes(norm(p.name)));
    if (loose) return loose;
  }
  return null;
}

const results = await pool(pending, 4, async ([name, code]) => {
  const candidates = REGIONAL_CANDIDATES[code] ?? [];
  const [movieList, tvList, movieCount, tvCount] = await Promise.all([
    regionProviders(code, "movie"),
    regionProviders(code, "tv"),
    filterCount("movie", { with_origin_country: code, "vote_count.gte": 5 }),
    filterCount("tv", { with_origin_country: code, "vote_count.gte": 5 }),
  ]);

  const pick = async (list, tmdbType) => {
    const out = [];
    for (const cand of candidates) {
      if (out.length >= LOCAL_LIMIT) break;
      const hit = findBrand(list, [cand]);
      if (!hit || out.some((o) => o.id === hit.id)) continue;
      if ((await providerCount(hit.id, code, tmdbType)) === 0) continue;
      out.push({ id: hit.id, name: String(hit.name).trim(), as: cand });
    }
    return out;
  };
  const [movie, tv] = await Promise.all([pick(movieList, "movie"), pick(tvList, "tv")]);
  return [name, { code, movie, tv, movieCount, tvCount }];
});

for (const [name, data] of results) {
  verified.countries[name] = { code: data.code, movieCount: data.movieCount, tvCount: data.tvCount };
  verified.regions[name] = { code: data.code, movie: data.movie, tv: data.tv };
}

fs.writeFileSync(FILE, JSON.stringify(verified, null, 2) + "\n");

console.log("\ncountry                     mv    tv    regional services");
for (const [name, d] of results) {
  const svc = [...d.movie, ...d.tv].map((s) => `${s.name}(${s.id})`).join(", ") || "—";
  console.log(`  ${name.padEnd(24)} ${String(d.movieCount).padEnd(5)} ${String(d.tvCount).padEnd(5)} ${svc}`);
}
const thin = results.filter(([, d]) => !d.movieCount && !d.tvCount).map(([n]) => n);
const noSvc = results.filter(([, d]) => !d.movie.length && !d.tv.length).map(([n]) => n);
console.log(`\ncountries with no titles at all (${thin.length}): ${thin.join(", ") || "none"}`);
console.log(`countries with no regional service found (${noSvc.length}): ${noSvc.join(", ") || "none"}`);
