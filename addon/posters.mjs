/**
 * Better posters.
 *
 * [BetterPosters](https://btttr.cc/) serves enhanced, tagged artwork keyed by
 * **IMDb id** — the URL pattern is
 * `https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg`. A TMDB list item
 * has no IMDb id, so one is resolved from TMDB's `external_ids` endpoint and
 * cached. A title with no IMDb id keeps its original poster (which is exactly
 * what the upstream Nuvio addon does), and the app can still upgrade that one by
 * requesting a larger TMDB size — the "apply it to the ones without a better
 * poster" option.
 *
 * The pattern and the API key are settings, so another poster service can be
 * used by changing the pattern without touching code.
 */
import { get, tmdbPath } from "./tmdb.mjs";
import { getSettings } from "./settings.mjs";

export const DEFAULT_PATTERN = "https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg";

const ID_TTL_MS = Number(process.env.POSTER_ID_TTL_MS) || 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const imdbCache = new Map();

export const posterSettings = () => getSettings().posters || {};
export const postersEnabled = () => posterSettings().enabled !== false;

/** IMDb id for a meta, from TMDB's external ids (cached). */
export async function imdbId(meta) {
  if (meta.imdb) return meta.imdb;
  const hit = imdbCache.get(meta.id);
  if (hit && hit.expires > Date.now()) return hit.value;
  const id = String(meta.id || "").replace(/^tmdb:/, "");
  try {
    const res = await get(`/${tmdbPath(meta.type)}/${id}/external_ids`);
    const value = res?.imdb_id || null;
    imdbCache.set(meta.id, { value, expires: Date.now() + (value ? ID_TTL_MS : MISS_TTL_MS) });
    return value;
  } catch {
    imdbCache.set(meta.id, { value: null, expires: Date.now() + MISS_TTL_MS });
    return null;
  }
}

/** Build the poster URL for a title from the configured pattern. */
export function posterUrl(pattern, meta, imdb) {
  return pattern
    .replaceAll("{imdb_id}", imdb || "")
    .replaceAll("{tmdb_id}", String(meta.id || "").replace(/^tmdb:/, ""))
    .replaceAll("{type}", meta.type === "movie" ? "movie" : "series");
}

/**
 * Point each meta at the better poster. `meta.hasBetterPoster` records whether
 * the service could serve one, so the UI knows which titles still need the
 * fallback treatment. Concurrency-bounded and cached.
 */
export async function applyPosters(metas, { concurrency = 14 } = {}) {
  if (!postersEnabled() || !Array.isArray(metas) || !metas.length) return metas;
  const pattern = posterSettings().pattern || DEFAULT_PATTERN;

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, metas.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= metas.length) return;
        const meta = metas[i];
        const imdb = await imdbId(meta);
        if (imdb) {
          meta.imdb = imdb;
          meta.poster = posterUrl(pattern, meta, imdb);
          meta.hasBetterPoster = true;
        } else {
          // No IMDb id → keep the original artwork; the UI upgrades this one.
          meta.hasBetterPoster = false;
        }
      }
    }),
  );
  return metas;
}

/** Live check for the settings screen: can this pattern serve a poster? */
export async function checkPosterService() {
  const pattern = posterSettings().pattern || DEFAULT_PATTERN;
  const sample = posterUrl(pattern, { id: "tmdb:550", type: "movie" }, "tt0137523");
  try {
    const res = await fetch(sample, { method: "GET" });
    return { ok: res.ok, text: res.ok ? `posters ok (HTTP ${res.status})` : `HTTP ${res.status}`, sample };
  } catch (err) {
    return { ok: false, text: `not reachable — ${err.message}`, sample };
  }
}
