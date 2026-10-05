#!/usr/bin/env node
/**
 * Which `<Genre> ◆ 1950 → Present` rows actually have titles?
 *
 * The Genre from ◆ Decades card was movies-only. Publishing the same rows for
 * shows needs verification first: TMDB's TV genre set is different (no
 * "Science Fiction", but "Sci-Fi & Fantasy"; no "Action", but "Action &
 * Adventure"), and several combinations are genuinely empty.
 *
 * Writes the result into `scripts/tmdb-verified.json` under `genreDecades`, so
 * `collections.mjs` can publish only the combinations that return titles.
 *
 *   node scripts/probe-genre-decades.mjs          # report + write
 *   node scripts/probe-genre-decades.mjs --dry    # report only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setKey, get, tmdbPath, resolveGenre } from "../addon/tmdb.mjs";
import { tmdbKey } from "../addon/settings.mjs";
import { MOVIE_GENRES, SHOW_GENRES } from "./collections.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "tmdb-verified.json");
const DRY = process.argv.includes("--dry");

setKey(tmdbKey());

const FLOOR = 20;

async function countFor(media, genreName) {
  const id = await resolveGenre(media, genreName);
  if (!id) return { id: null, count: 0 };
  const dateField = media === "movie" ? "primary_release_date" : "first_air_date";
  const res = await get(`/discover/${tmdbPath(media)}`, {
    with_genres: id,
    [`${dateField}.gte`]: "1950-01-01",
    sort_by: "popularity.desc",
    "vote_count.gte": FLOOR,
    page: 1,
  });
  return { id, count: (res.results ?? []).length };
}

const out = { movie: {}, tv: {} };
for (const [type, media, names] of [["movie", "movie", MOVIE_GENRES], ["tv", "tv", SHOW_GENRES]]) {
  for (const name of names) {
    const { id, count } = await countFor(media, name);
    out[type][name] = { id, count, floor: FLOOR };
    console.log(`  ${type === "movie" ? "movie" : "show "}  ${String(count).padStart(3)}  ${name}${id ? "" : "  (no such genre)"}`);
  }
}

const kept = (type) => Object.entries(out[type]).filter(([, v]) => v.count > 0).map(([k]) => k);
console.log(`\nmovies with titles: ${kept("movie").length}/${MOVIE_GENRES.length}`);
console.log(`shows with titles:  ${kept("tv").length}/${SHOW_GENRES.length}`);
console.log(`shows dropped (empty): ${SHOW_GENRES.filter((g) => !kept("tv").includes(g)).join(", ") || "none"}`);

if (DRY) process.exit(0);

const verified = JSON.parse(fs.readFileSync(FILE, "utf8"));
verified.genreDecades = {
  note: `Discovered per genre from 1950 to now, vote_count >= ${FLOOR}. Only combinations with titles are published.`,
  from: 1950,
  floor: FLOOR,
  movie: out.movie,
  tv: out.tv,
};
fs.writeFileSync(FILE, JSON.stringify(verified, null, 2) + "\n");
console.log(`\nwrote genreDecades into ${path.relative(process.cwd(), FILE)}`);
