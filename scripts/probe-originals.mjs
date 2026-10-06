#!/usr/bin/env node
/**
 * Probe each Global OTT platform's *own* studio, so a "Netflix Originals" row is
 * backed by the real thing rather than a guess.
 *
 * An "original" is not a catalog, it is a production company: a platform's
 * originals are the films (and shows) its studio made, which TMDB answers with
 * `with_companies`. TMDB has no network search endpoint, so companies are the one
 * handle that works for both row types, and every candidate is *verified* — a
 * candidate is only written down when a discover query with it really returns
 * titles. Canonical ids are tried alongside TMDB's own company search results and
 * the one with the most real titles wins.
 *
 * Writes `originals` into `scripts/tmdb-verified.json`, merged with whatever is
 * already there (the rest of the file is left untouched).
 *
 *   node scripts/probe-originals.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, hasKey } from "../addon/tmdb.mjs";
import { GLOBAL_PLATFORMS } from "./collections.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "tmdb-verified.json");

if (!hasKey()) {
  console.error("TMDB_API_KEY is not set — the probe needs it.");
  process.exit(1);
}

/**
 * The studio behind each platform's originals: the canonical TMDB company ids
 * first, then the names TMDB spells them with. A platform without a studio row is
 * built from whatever of these verifies.
 */
const CANDIDATES = {
  Netflix: [
    { id: 213, name: "Netflix" },
    { name: "Netflix Studios" },
    { name: "Netflix International" },
  ],
  "Prime Video": [
    { id: 20580, name: "Amazon Studios" },
    { name: "Amazon MGM Studios" },
    { name: "Amazon Prime Video" },
  ],
  "Disney+": [
    { id: 2, name: "Walt Disney Pictures" },
    { id: 3475, name: "Walt Disney Television" },
    { name: "Disney+" },
    { name: "Lucasfilm Ltd." },
    { name: "Marvel Studios" },
    { name: "Pixar" },
  ],
  Max: [
    { id: 3268, name: "HBO" },
    { id: 9993, name: "HBO Films" },
    { name: "Home Box Office (HBO)" },
  ],
  "Apple TV+": [
    { id: 194232, name: "Apple Studios" },
    { id: 1583, name: "Apple" },
    { name: "Apple TV+" },
  ],
  "Paramount+": [
    { id: 4, name: "Paramount Pictures" },
    { id: 18372, name: "Paramount Television" },
    { name: "Paramount+" },
    { name: "CBS Studios" },
  ],
};

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

/** TMDB's own company search — the discovery half of the probe. */
async function searchCompanies(query) {
  const res = await get("/search/company", { query }).catch(() => ({ results: [] }));
  return (res.results ?? []).map((r) => ({ id: r.id, name: r.name }));
}

/** How many titles a company really has, for one row type (the verification). */
async function count(companyId, tmdbType) {
  const res = await get(`/discover/${tmdbType}`, {
    with_companies: companyId,
    sort_by: "popularity.desc",
    "vote_count.gte": 5,
  }).catch(() => ({ results: [] }));
  return (res.results ?? []).length;
}

const verified = JSON.parse(fs.readFileSync(OUT, "utf8"));
const originals = {};

for (const platform of GLOBAL_PLATFORMS) {
  // Canonical ids and search hits together, deduped by id.
  const found = new Map();
  for (const candidate of CANDIDATES[platform] ?? [{ name: platform }]) {
    if (candidate.id) found.set(candidate.id, candidate.name);
  }
  for (const candidate of CANDIDATES[platform] ?? []) {
    for (const hit of await searchCompanies(candidate.name)) {
      if (!found.has(hit.id)) found.set(hit.id, hit.name);
    }
  }
  const tested = await pool([...found].map(([id, name]) => ({ id, name })), 6, async (c) => ({
    ...c,
    movieCount: await count(c.id, "movie"),
    tvCount: await count(c.id, "tv"),
  }));
  const bestMovie = tested.filter((c) => c.movieCount).sort((a, b) => b.movieCount - a.movieCount)[0];
  const bestTv = tested.filter((c) => c.tvCount).sort((a, b) => b.tvCount - a.tvCount)[0];
  if (!bestMovie && !bestTv) {
    console.warn(`${platform}: no studio found — no Originals row.`);
    continue;
  }
  originals[platform] = {
    ...(bestMovie ? { company: { id: bestMovie.id, name: bestMovie.name, movieCount: bestMovie.movieCount } } : {}),
    ...(bestTv ? { tv: { id: bestTv.id, name: bestTv.name, tvCount: bestTv.tvCount } } : {}),
  };
  console.log(
    `${platform}: movies ← ${bestMovie ? `${bestMovie.name} (${bestMovie.id}) → ${bestMovie.movieCount}` : "—"} · shows ← ${
      bestTv ? `${bestTv.name} (${bestTv.id}) → ${bestTv.tvCount}` : "—"
    }`,
  );
}

verified.originals = originals;
fs.writeFileSync(OUT, `${JSON.stringify(verified, null, 2)}\n`);
console.log(`\nWrote ${Object.keys(originals).length} platform studios to scripts/tmdb-verified.json`);
