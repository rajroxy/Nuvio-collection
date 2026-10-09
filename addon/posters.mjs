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

/**
 * The next TMDB size up.
 *
 * **What the "no better poster" option actually does.** A title the poster service
 * has never catalogued still has TMDB artwork, and TMDB serves it at any width — so
 * an old poster is re-requested at twice the width it was drawn at rather than being
 * left at `w185`, which is what made an untagged title look its age next to a
 * flagged one. `/original/` is left alone: it is already the largest there is.
 */
export const upscaleArt = (url) =>
  String(url || "").replace(/\/w(\d+)\//, (m, w) => {
    const width = Number(w);
    if (!Number.isFinite(width) || width >= 1280) return m;
    return `/w${Math.min(1280, Math.max(500, width * 2))}/`;
  });

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
  // **`enrich.tmdb` is the artwork half of the enrichment, and this is where it
  // lands.** With the switch off, a row keeps the artwork TMDB served it rather than
  // the tagged poster — which is the whole visible effect of the two enrichment
  // switches that used to do nothing on a machine with only a TMDB key.
  if (getSettings().enrich?.tmdb === false) return metas;
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
          // **Keep the artwork we are replacing.** The poster service only has
          // artwork for titles it has catalogued; for the rest its URL 404s, and
          // without the original kept here a failed image left the plate dark (or
          // an initials mark) even though TMDB had a perfectly good poster.
          if (!meta.posterBackup) meta.posterBackup = upscaleArt(meta.poster || "");
          meta.poster = posterUrl(pattern, meta, imdb);
          meta.hasBetterPoster = true;
        } else {
          // **No IMDb id → the service has nothing for this title**, so it is not
          // asked for one: the original artwork stays and is re-requested at the next
          // TMDB size up (`ai.enhanceMissing`). Nothing is ever pointed at a poster
          // the service does not have.
          meta.hasBetterPoster = false;
          const ai = getSettings().ai || {};
          if (ai.enhanceMissing !== false && meta.poster) {
            if (!meta.posterBackup) meta.posterBackup = meta.poster;
            meta.poster = upscaleArt(meta.poster);
          }
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
