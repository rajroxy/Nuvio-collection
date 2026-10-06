/**
 * Extra metadata providers.
 *
 * TMDB backs every catalog row (it is the only source that can answer the
 * discover queries). MDBList is wired as a real *metadata* provider: when it is
 * enabled with a key, a title's rating is replaced with MDBList's aggregated
 * rating, so enabling it visibly changes what the rows contain while the catalog
 * names stay exactly the same. Keys can also be verified against the provider
 * itself, so "enable" is a real connection rather than a stored string.
 */
import { providerKeys } from "./settings.mjs";

const MDBLIST = "https://api.mdblist.com";
const TVDB = "https://api4.thetvdb.com/v4";
const TTL_MS = Number(process.env.PROVIDER_CACHE_TTL_MS) || 30 * 60 * 1000;

const cache = new Map();

export const usingMdblist = () => Boolean(providerKeys().mdblist);

const kindOf = (meta) => (meta.type === "movie" ? "movie" : "show");
const tmdbId = (meta) => String(meta.id || "").replace(/^tmdb:/, "");

async function mdblistRating(meta, key) {
  const url = `${MDBLIST}/tmdb/${kindOf(meta)}/${encodeURIComponent(tmdbId(meta))}/?apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`MDBList ${res.status}`);
  const data = await res.json();
  const r = data?.ratings || {};
  const value = r.imdb ?? r.tmdb ?? r.letterboxd ?? null;
  return typeof value === "number" && value > 0 ? value.toFixed(1) : null;
}

/**
 * Replace each title's rating with MDBList's when it is available. Bounded to the
 * first `limit` titles per row so a home screen full of rows stays fast, and
 * cached for `PROVIDER_CACHE_TTL_MS`.
 */
export async function enrichRatings(metas, limit = 12) {
  const { mdblist } = providerKeys();
  if (!mdblist || !Array.isArray(metas) || !metas.length) return metas;

  await Promise.all(
    metas.slice(0, limit).map(async (meta) => {
      const hit = cache.get(meta.id);
      if (hit && hit.expires > Date.now()) {
        if (hit.value) meta.imdbRating = hit.value;
        return;
      }
      try {
        const value = await mdblistRating(meta, mdblist);
        cache.set(meta.id, { value, expires: Date.now() + TTL_MS });
        if (value) meta.imdbRating = value;
      } catch {
        // One bad lookup must not fail the row.
        cache.set(meta.id, { value: null, expires: Date.now() + 60_000 });
      }
    }),
  );
  return metas;
}

/** The label MDBList's rating keys are shown under on the title page. */
const RATING_LABELS = {
  imdb: "IMDb",
  tmdb: "TMDB",
  trakt: "Trakt",
  letterboxd: "Letterboxd",
  tomatoes: "Rotten Tomatoes",
  tomatoesaudience: "RT Audience",
  metacritic: "Metacritic",
  metacriticuser: "Metacritic Users",
  rogerebert: "Roger Ebert",
  myanimelist: "MyAnimeList",
  anilist: "AniList",
  simkl: "Simkl",
  mdblist: "MDBList",
};

/** `rottenTomatoes` / `myanimelist` → a readable name for a key we do not know. */
const ratingLabel = (key) =>
  RATING_LABELS[String(key).toLowerCase()] ||
  String(key).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * **Ratings, from every service that answered.** MDBList aggregates them, so when
 * its key is set this returns one entry per source it knows — IMDb, TMDB, Trakt,
 * Letterboxd, Rotten Tomatoes, Metacritic and the rest — which is what the title
 * page shows as a row of its own. With no key there is nothing to ask, so the page
 * falls back to the rating TMDB itself carries.
 */
export async function titleRatings(meta) {
  const { mdblist } = providerKeys();
  if (!mdblist) return [];
  try {
    const url = `${MDBLIST}/tmdb/${kindOf(meta)}/${encodeURIComponent(tmdbId(meta))}/?apikey=${encodeURIComponent(mdblist)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    const ratings = data?.ratings || {};
    return Object.entries(ratings)
      .filter(([, value]) => typeof value === "number" && value > 0)
      .map(([source, value]) => ({ source, label: ratingLabel(source), value: value > 10 ? String(Math.round(value)) : value.toFixed(1) }));
  } catch {
    return [];
  }
}

/** Verify a stored provider key by actually calling the provider. */
export async function verifyProvider(name, key) {
  if (!key) return { ok: false, text: "no key saved" };
  try {
    if (name === "tmdb") {
      // v4 read tokens are long JWTs; v3 keys are short hex strings.
      const long = key.length > 60;
      const url = `https://api.themoviedb.org/3/movie/550${long ? "" : `?api_key=${encodeURIComponent(key)}`}`;
      const res = await fetch(url, { headers: long ? { authorization: `Bearer ${key}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, text: "connected" };
    }
    if (name === "mdblist") {
      const res = await fetch(`${MDBLIST}/tmdb/movie/550/?apikey=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sources = Object.keys(data?.ratings || {}).length;
      return { ok: true, text: `connected${sources ? ` · ${sources} rating sources` : ""}` };
    }
    if (name === "tvdb") {
      const res = await fetch(`${TVDB}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apikey: key }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.data?.token ? { ok: true, text: "connected" } : { ok: false, text: "unexpected response" };
    }
  } catch (err) {
    return { ok: false, text: `not reachable — ${err.message}` };
  }
  return { ok: false, text: "no live check for this provider" };
}
