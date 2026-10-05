#!/usr/bin/env node
/**
 * Probe TMDB for the facts the catalog set depends on, and *verify* each one
 * returns titles before writing it down. Guessing any of this is what produced
 * empty rows before:
 *
 *   1. the real provider id for each global OTT brand — TMDB renames services
 *      (HBO Max → Max, Paramount+ US → "Paramount Plus Premium"), so ids drift
 *   2. the local OTT services that actually operate in each region, so
 *      "Regional OTT" can be named by service (Zee5, JioHotstar) not by country
 *   3. keyword names that resolve AND return titles
 *
 * Writes `scripts/tmdb-verified.json`, consumed by `collections.mjs`.
 *
 *   node scripts/probe-tmdb.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, hasKey } from "../addon/tmdb.mjs";
import { COUNTRIES, PLATFORMS } from "./collections.mjs";
import { REGIONAL_CANDIDATES } from "./regional-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "tmdb-verified.json");
const REGION = process.env.NUVIO_REGION || "US";
const LOCAL_LIMIT = Number(process.env.PROBE_LOCAL_LIMIT) || 3;

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the probe needs it.");
  process.exit(1);
}

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

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Providers available in one region, deduped, best display-priority first. */
async function regionProviders(region, tmdbType) {
  const res = await get(`/watch/providers/${tmdbType}`, { watch_region: region }).catch(() => ({ results: [] }));
  const seen = new Map();
  for (const p of res.results ?? []) {
    const id = p.provider_id;
    if (seen.has(id)) continue;
    seen.set(id, { id, name: p.provider_name, rank: p.display_priority ?? 999 });
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank);
}

/** How many titles this provider actually returns in this region/type. */
async function providerCount(id, region, tmdbType) {
  const res = await get(`/discover/${tmdbType}`, {
    with_watch_providers: id,
    watch_region: region,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    "vote_count.gte": 10,
  }).catch(() => ({ results: [] }));
  return (res.results ?? []).length;
}

/** How many titles one discover filter returns, for one media type. */
async function filterCount(tmdbType, params) {
  const res = await get(`/discover/${tmdbType}`, { ...params, sort_by: "popularity.desc" }).catch(() => ({ results: [] }));
  return (res.results ?? []).length;
}

/**
 * Resolve a wanted brand against a region's provider list.
 *
 * TMDB's own region lists are noisy: they advertise services that do not
 * actually operate in the region (Sun Nxt appears under the US and Germany) and
 * they list stores and aggregators alongside real streaming services. So the
 * region's services come from a curated candidate list per country
 * (`regional-candidates.mjs`) matched against the live list — never from
 * display priority alone.
 */
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

const BRAND_NAMES = {
  "Netflix": ["Netflix"],
  "Prime Video": ["Amazon Prime Video", "Prime Video"],
  "Disney+": ["Disney Plus", "Disney+"],
  "Max": ["Max", "HBO Max"],
  "Apple TV+": ["Apple TV Plus", "Apple TV+", "Apple TV"],
  "Paramount+": ["Paramount Plus", "Paramount+", "Paramount Plus Premium"],
  "Hulu": ["Hulu"],
};

console.error("probing TMDB…");

// 1. global platform ids, verified to return titles in this region.
const usMovie = await regionProviders(REGION, "movie");
const usTv = await regionProviders(REGION, "tv");
const platforms = await pool(PLATFORMS, 3, async ([label]) => {
  const accepted = BRAND_NAMES[label] ?? [label];
  const hitMovie = findBrand(usMovie, accepted);
  const hitTv = findBrand(usTv, accepted) ?? hitMovie;
  const id = hitMovie?.id ?? hitTv?.id ?? null;
  const movieCount = id ? await providerCount(id, REGION, "movie") : 0;
  const tvCount = hitTv ? await providerCount(hitTv.id, REGION, "tv") : 0;
  return {
    label,
    accepted,
    id,
    tmdbMovieName: hitMovie?.name ?? null,
    tmdbTvName: hitTv?.name ?? null,
    movieCount,
    tvCount,
  };
});

// 2. each region's own OTT services, from the curated candidates and verified
//    per media type — only a service that really returns titles is kept.
const regions = await pool(COUNTRIES, 4, async ([name, code]) => {
  const candidates = REGIONAL_CANDIDATES[code] ?? [];
  const [movieList, tvList] = await Promise.all([regionProviders(code, "movie"), regionProviders(code, "tv")]);
  const pick = async (list, tmdbType) => {
    const out = [];
    for (const cand of candidates) {
      if (out.length >= LOCAL_LIMIT) break;
      const hit = findBrand(list, [cand]);
      if (!hit) continue;
      if (out.some((o) => o.id === hit.id)) continue;
      if ((await providerCount(hit.id, code, tmdbType)) === 0) continue;
      out.push({ id: hit.id, name: String(hit.name).trim(), as: cand });
    }
    return out;
  };
  const [movie, tv] = await Promise.all([pick(movieList, "movie"), pick(tvList, "tv")]);
  return [name, { code, movie, tv }];
});

// 2b. which countries have titles at all, per media type (Ghana has films but no
//     series, so the shows row for Ghana would come back empty).
const countries = await pool(COUNTRIES, 6, async ([name, code]) => {
  const [movieCount, tvCount] = await Promise.all([
    filterCount("movie", { with_origin_country: code, "vote_count.gte": 5 }),
    filterCount("tv", { with_origin_country: code, "vote_count.gte": 5 }),
  ]);
  return [name, { code, movieCount, tvCount }];
});

// 3. keywords: first candidate that resolves AND returns titles.
const KEYWORD_CANDIDATES = {
  "based-on-the": {
    Books: ["based on book", "based on novel"],
    Comics: ["based on comic", "comic book"],
    "Graphic Novels": ["graphic novel", "based on graphic novel"],
    "Video Games": ["based on video game"],
    "True Stories": ["based on true story"],
    Plays: ["based on play"],
    "Short Stories": ["based on short story"],
    Musicals: ["musical", "broadway musical"],
    "TV Adaptations": ["based on tv series", "remake"],
  },
  "moods-and-vibes": {
    "Adrenaline Rush": ["adrenaline rush", "high octane", "pursuit"],
    "Mind Bending": ["mind bending", "twist ending", "psychological", "surreal", "nonlinear"],
    "Cozy & Comforting": ["cozy", "heartwarming", "feel good", "small town", "friendship"],
    "Epic & Sweeping": ["epic", "sweeping", "ensemble cast"],
    "Feel Good": ["feel good", "feel-good", "uplifting", "cheerful"],
    "Slow Burn": ["slow burn", "slow-burn"],
    Tearjerkers: ["tearjerker", "tear jerker", "grief"],
    "Dark & Gritty": ["dark", "gritty", "neo-noir"],
    Nostalgic: ["nostalgia", "nostalgic", "coming of age"],
    Suspenseful: ["suspense", "suspenseful", "tense"],
    Whimsical: ["whimsical", "quirky", "magical realism"],
    Romantic: ["romantic", "romance", "love story"],
  },
  "themes-and-tags": {
    Detective: ["detective", "investigation", "police detective"],
    Gangster: ["gangster", "mafia", "yakuza"],
    Superhero: ["superhero", "super hero", "based on comic"],
    "Time Loop": ["time loop", "time travel"],
    "Animal Attack": ["animal attack", "shark attack"],
    Slasher: ["slasher", "serial killer"],
    Possession: ["possession", "exorcism", "demonic possession"],
    Zombie: ["zombie", "undead", "zombie apocalypse"],
    Heist: ["heist", "robbery", "caper"],
    Spy: ["spy", "espionage", "secret agent"],
    Dystopia: ["dystopia", "dystopian", "post-apocalyptic"],
    "Artificial Intelligence": ["artificial intelligence", "android", "robot"],
    Vampire: ["vampire", "vampires"],
    Werewolf: ["werewolf", "lycanthrope"],
    Witch: ["witch", "witchcraft", "sorcery"],
    Alien: ["alien", "aliens", "extraterrestrial"],
    Amnesia: ["amnesia", "memory loss"],
    Courtroom: ["courtroom", "trial", "lawyer"],
    Sports: ["sport", "sports", "boxing"],
    Survival: ["survival", "stranded", "wilderness"],
    Revenge: ["revenge", "revenge story"],
    Cursed: ["curse", "cursed", "haunted house"],
    "Road Trip": ["road trip", "road movie"],
    Documentary: ["documentary footage", "mockumentary"],
  },
};

// A keyword only counts when TMDB's name actually contains what we searched for
// ("/search/keyword" for "based on novel" happily returns "based on visual
// novel"), and no two labels may share one keyword.
const keywords = {};
const usedKeywordIds = new Set();
for (const [group, labels] of Object.entries(KEYWORD_CANDIDATES)) {
  keywords[group] = {};
  for (const [label, candidates] of Object.entries(labels)) {
  for (const name of candidates) {
    const search = await get("/search/keyword", { query: name }).catch(() => ({ results: [] }));
    // Scan the matches rather than trusting the first: searching "based on book"
    // returns "based on picture book" first and "based on novel or book" third.
    for (const hit of (search.results ?? []).slice(0, 6)) {
      if (!norm(hit.name).includes(norm(name))) continue;
      if (usedKeywordIds.has(hit.id)) continue;
      // Verified per media type: a keyword that only has films must not publish a
      // shows row ("uplifting" has movies but no series).
      const [movieCount, tvCount] = await Promise.all([
        filterCount("movie", { with_keywords: String(hit.id), "vote_count.gte": 10 }),
        filterCount("tv", { with_keywords: String(hit.id), "vote_count.gte": 10 }),
      ]);
      if (movieCount + tvCount === 0) continue;
      // Prefer a keyword that works for BOTH rows; remember a one-sided one as a
      // fallback and keep looking for something better.
      if (movieCount > 0 && tvCount > 0) {
        keywords[group][label] = { name, id: hit.id, tmdbName: hit.name, movieCount, tvCount };
        usedKeywordIds.add(hit.id);
        break;
      }
      if (!keywords[group][label]) {
        keywords[group][label] = { name, id: hit.id, tmdbName: hit.name, movieCount, tvCount };
        usedKeywordIds.add(hit.id);
      }
    }
    if (keywords[group][label]?.movieCount && keywords[group][label]?.tvCount) break;
  }
  }
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      note: "Generated by scripts/probe-tmdb.mjs against the live TMDB API. Do not hand-edit.",
      region: REGION,
      platforms,
      regions: Object.fromEntries(regions),
      countries: Object.fromEntries(countries),
      keywords,
    },
    null,
    2,
  ) + "\n",
);

const badPlatforms = platforms.filter((p) => !p.id || p.movieCount + p.tvCount === 0);
const thinRegions = regions.filter(([, v]) => v.movie.length + v.tv.length === 0).map(([k]) => k);
const unresolvedCandidates = regions.flatMap(([, v]) => {
  const got = new Set([...v.movie, ...v.tv].map((p) => norm(p.name)));
  return (REGIONAL_CANDIDATES[v.code] ?? []).filter((c) => !got.has(norm(c))).map((c) => `${v.code}:${c}`);
});
const badKeywords = Object.entries(KEYWORD_CANDIDATES).flatMap(([g, labels]) =>
  Object.keys(labels).filter((k) => !keywords[g]?.[k]).map((k) => `${g}/${k}`),
);

console.log(`wrote ${path.relative(process.cwd(), OUT)}  (region ${REGION})`);
console.log("\nplatforms (id, movie titles, tv titles):");
for (const p of platforms) console.log(`  ${p.label.padEnd(12)} ${String(p.id).padEnd(6)} mv=${String(p.movieCount).padEnd(3)} tv=${String(p.tvCount).padEnd(3)} ${p.tmdbMovieName ?? ""}`);
console.log(`\nregions with no local service found (${thinRegions.length}): ${thinRegions.join(", ") || "none"}`);
console.log(`candidates that did not resolve (${unresolvedCandidates.length}): ${unresolvedCandidates.slice(0, 30).join(", ")}${unresolvedCandidates.length > 30 ? " …" : ""}`);
for (const [name, v] of regions) {
  console.log(`  ${name.padEnd(22)} mv: ${v.movie.map((p) => `${p.name}(${p.id})`).join(", ") || "—"}`);
  console.log(`  ${"".padEnd(22)} tv: ${v.tv.map((p) => `${p.name}(${p.id})`).join(", ") || "—"}`);
}
console.log(`\nkeywords with no working candidate (${badKeywords.length}): ${badKeywords.join(", ") || "none"}`);
const oneSided = Object.entries(keywords).flatMap(([g, labels]) =>
  Object.entries(labels).filter(([, v]) => !v.movieCount || !v.tvCount).map(([k, v]) => `${g}/${k}(${v.movieCount}/${v.tvCount})`),
);
console.log(`keywords available for only one media type (${oneSided.length}): ${oneSided.join(", ") || "none"}`);
const oneSidedCountries = countries.filter(([, v]) => !v.movieCount || !v.tvCount).map(([n, v]) => `${n}(${v.movieCount}/${v.tvCount})`);
console.log(`countries with only one media type (${oneSidedCountries.length}): ${oneSidedCountries.join(", ") || "none"}`);
if (badPlatforms.length) console.log(`PLATFORMS WITH NO TITLES: ${badPlatforms.map((p) => p.label).join(", ")}`);
