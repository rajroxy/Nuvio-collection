#!/usr/bin/env node
/**
 * Incremental platform probe.
 *
 * `probe-tmdb.mjs` regenerates the whole verified table. This script probes
 * **only the platforms missing from `tmdb-verified.json`** and merges them in, so
 * the platform list can grow without a full re-probe.
 *
 * It exists because the list had a hole: the six global platforms were all
 * general-purpose streamers, so the anime and Asian-drama services people
 * actually watch — Crunchyroll, HIDIVE, iQIYI, Viki — were in no row at all.
 * Anime was reachable only through the Countries and Genres cards.
 *
 * A platform is only recorded when TMDB has the brand **and** it returns titles
 * in the configured region, so a row can never be permanently empty.
 *
 *   node scripts/probe-platforms.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, hasKey } from "../addon/tmdb.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "tmdb-verified.json");
const REGION = (process.env.NUVIO_REGION || "US").toUpperCase();

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the probe needs it.");
  process.exit(1);
}

/**
 * The brands worth checking, and the names TMDB files them under.
 *
 * The label is what the row is called (and what `PLATFORMS` looks up), so it has
 * to match what a viewer recognises on the card.
 */
const CANDIDATES = {
  // Anime and Asian drama — the hole this script exists to fill.
  Crunchyroll: ["Crunchyroll"],
  HIDIVE: ["HiDive", "HIDIVE"],
  "iQIYI": ["iQIYI"],
  Viki: ["Rakuten Viki"],
  // Arthouse and the free ad-supported ones, which are their own catalogues.
  MUBI: ["MUBI"],
  "Google Play": ["Google Play Movies"],
  Plex: ["Plex"],
  Tubi: ["Tubi TV"],
  Shudder: ["Shudder"],
  "Rakuten TV": ["Rakuten TV"],
};

// The regional services (JioHotstar, Zee5, Sony LIV, …) are deliberately NOT
// here: the three Regional OTT cards publish them per country, already verified,
// and a global copy would name one country's service for everybody.

const verified = JSON.parse(fs.readFileSync(FILE, "utf8"));
const known = new Set((verified.platforms ?? []).map((p) => p.label));
const pending = Object.keys(CANDIDATES).filter((label) => !known.has(label));

if (!pending.length) {
  console.log("nothing to do — every candidate platform is already in the fact table.");
  process.exit(0);
}
console.log(`probing ${pending.length} platforms in ${REGION}: ${pending.join(", ")}`);

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Every provider TMDB lists for one region and media type. */
const regionProviders = async (region, tmdbType) => {
  const res = await get(`/watch/providers/${tmdbType}`, { watch_region: region }).catch(() => ({ results: [] }));
  const seen = new Map();
  for (const p of res.results ?? []) {
    if (!seen.has(p.provider_id)) seen.set(p.provider_id, { id: p.provider_id, name: p.provider_name });
  }
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

/**
 * The provider TMDB files under one of these names — **exactly**.
 *
 * Loose matching was a trap: "Disney+ Hotstar" normalises to "disney plus
 * hotstar", which loose-match hits TMDB's "Disney Plus" record, so a JioHotstar
 * row would have been a second Disney+ row. A brand only counts when TMDB names it
 * that, and a brand whose id is already in the fact table is the *same service*
 * under another label (Apple TV vs Apple TV+), so it is skipped too.
 */
function findBrand(list, accepted) {
  const wanted = accepted.map(norm);
  return list.find((p) => wanted.includes(norm(p.name))) || null;
}

const [movieList, tvList] = [await regionProviders(REGION, "movie"), await regionProviders(REGION, "tv")];
// Ids already published: a candidate that resolves to one of these is a duplicate.
const usedIds = new Set((verified.platforms ?? []).map((p) => p.id));

const results = [];
for (const label of pending) {
  const accepted = CANDIDATES[label];
  const hitMovie = findBrand(movieList, accepted);
  const hitTv = findBrand(tvList, accepted) ?? hitMovie;
  const id = hitMovie?.id ?? hitTv?.id ?? null;
  if (id && usedIds.has(id)) {
    results.push({ label, accepted, id, duplicateOf: usedIds.has(id), movieCount: 0, tvCount: 0 });
    continue;
  }
  if (id) usedIds.add(id);
  // Verified per media type: a service that has films but no shows is recorded
  // with a zero for the row it cannot fill, and `PLATFORMS` still publishes it
  // (the series row will simply come back empty for it).
  const movieCount = id ? await providerCount(id, REGION, "movie") : 0;
  const tvCount = hitTv ? await providerCount(hitTv.id, REGION, "tv") : 0;
  results.push({
    label,
    accepted,
    id,
    tmdbMovieName: hitMovie?.name ?? null,
    tmdbTvName: hitTv?.name ?? null,
    movieCount,
    tvCount,
  });
}

// Merge: a platform with no id, or with no titles in either row, is dropped —
// publishing it would create a card row that is permanently empty.
const good = results.filter((p) => p.id && p.movieCount + p.tvCount > 0 && !p.duplicateOf);
verified.platforms = [...(verified.platforms ?? []).filter((p) => !CANDIDATES[p.label] || p.id), ...good];
fs.writeFileSync(FILE, JSON.stringify(verified, null, 2) + "\n");

console.log("\nplatform        id      mv    tv    tmdb name");
for (const p of results) {
  console.log(
    `  ${p.label.padEnd(14)} ${String(p.id ?? "—").padEnd(7)} ${String(p.movieCount).padEnd(5)} ${String(p.tvCount).padEnd(5)} ${p.duplicateOf ? "(id already published — skipped)" : p.tmdbMovieName ?? p.tmdbTvName ?? ""}`,
  );
}
const dropped = results.filter((p) => !good.includes(p));
console.log(`\nadded ${good.length} · dropped ${dropped.length}${dropped.length ? `: ${dropped.map((p) => p.label).join(", ")}` : ""}`);
