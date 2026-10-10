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
import { getSettings, providerKeys } from "./settings.mjs";
import { get, tmdbPath } from "./tmdb.mjs";

const IMG = "https://image.tmdb.org/t/p";

const MDBLIST = "https://api.mdblist.com";
const TVDB = "https://api4.thetvdb.com/v4";
const TTL_MS = Number(process.env.PROVIDER_CACHE_TTL_MS) || 30 * 60 * 1000;

const cache = new Map();

export const usingMdblist = () => Boolean(providerKeys().mdblist);

/**
 * Ratings are cached, and a rate limit is **remembered**.
 *
 * MDBList's free tier is a *daily* quota, so two things matter: never ask twice for
 * the same title (the cache), and never keep asking after a 429 (the breaker).
 * Retrying a refused key burns nothing but still answers nothing, and it leaves the
 * title page looking like the feature is broken instead of like the quota is spent.
 * With the breaker up, `titleRatings` answers from what it already knows and
 * `ratingsState()` says why — which is the difference between a silent empty row and
 * a user who knows their key's daily limit ran out.
 */
const ratingsCache = new Map();
const RATINGS_TTL_MS = Number(process.env.RATINGS_CACHE_TTL_MS) || 12 * 60 * 60 * 1000;
let limitedUntil = 0;
let limitedText = "";

/** The ratings services Settings offers. `free` needs no key of its own. */
export const RATING_SOURCES = ["none", "free", "mdblist"];

/** Which one the settings file names, with `free` as the fallback. */
export const ratingsSource = () => {
  const src = getSettings().ratings?.source;
  return RATING_SOURCES.includes(src) ? src : "free";
};

/** Whether the extra ratings can be asked for right now, and if not, why. */
export function ratingsState() {
  const source = ratingsSource();
  if (source === "none") {
    return { available: false, reason: "off", text: "Extra ratings are switched off in Settings → Ratings." };
  }
  if (source === "mdblist") {
    if (!providerKeys().mdblist) {
      return { available: false, reason: "no-key", text: "MDBList is chosen but no key is saved — add one in Settings → Ratings." };
    }
    if (Date.now() < limitedUntil) return { available: false, reason: "limited", text: limitedText };
    return { available: true, reason: "", text: "" };
  }
  return { available: true, reason: "", text: "" };
}

const kindOf = (meta) => (meta.type === "movie" ? "movie" : "show");
const tmdbId = (meta) => String(meta.id || "").replace(/^tmdb:/, "");

async function mdblistRating(meta, key) {
  const url = `${MDBLIST}/tmdb/${kindOf(meta)}/${encodeURIComponent(tmdbId(meta))}/?apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  // A spent quota is tripped **here** too, not only on the title page: a row of
  // twelve titles would otherwise fire twelve refusals at a key that is already
  // done for the day.
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    limitedText = String(body?.error || "MDBList's daily API limit was reached");
    limitedUntil = Date.now() + 60 * 60 * 1000;
  }
  if (!res.ok) throw new Error(`MDBList ${res.status}`);
  const data = await res.json();
  const r = data?.ratings || {};
  const value = r.imdb ?? r.tmdb ?? r.letterboxd ?? null;
  return typeof value === "number" && value > 0 ? value.toFixed(1) : null;
}

/**
 * **The TMDB half of the enrichment — and it works with only a TMDB key.**
 *
 * "Enrichment" used to mean MDBList ratings and TVDB gap filling, so with no MDBList
 * key and no TVDB key the switch genuinely changed nothing: not the titles, not the
 * artwork, not a single field. This asks TMDB for the titles its own rows left thin —
 * a row built from `/discover` carries no overview and can carry no poster — and
 * fills **only what is empty**: the synopsis, the artwork at `w500` and the year.
 * Bounded to the first `limit` titles of a row and cached for six hours, so a home
 * screen of rows does not become hundreds of lookups.
 */
const detailCache = new Map();
const DETAIL_TTL_MS = Number(process.env.TMDB_DETAIL_TTL_MS) || 6 * 60 * 60 * 1000;

export async function enrichFromTmdb(metas, limit = 10) {
  if (getSettings().enrich?.tmdb === false) return metas;
  if (!Array.isArray(metas) || !metas.length) return metas;
  await Promise.all(
    metas.slice(0, limit).map(async (meta) => {
      // Nothing missing → nothing to ask for.
      if (meta.description && meta.poster && meta.releaseInfo) return;
      const id = String(meta.id || "").replace(/^tmdb:/, "");
      if (!/^\d+$/.test(id)) return;
      const key = `${meta.type}:${id}`;
      const hit = detailCache.get(key);
      let detail = hit && hit.expires > Date.now() ? hit.value : null;
      if (!hit || hit.expires <= Date.now()) {
        try {
          detail = await get(`/${tmdbPath(meta.type === "series" ? "series" : "movie")}/${id}`);
        } catch {
          detail = null;
        }
        detailCache.set(key, { value: detail, expires: Date.now() + DETAIL_TTL_MS });
      }
      if (!detail) return;
      let filled = false;
      if (!meta.description && detail.overview) { meta.description = detail.overview; filled = true; }
      if (!meta.poster && detail.poster_path) { meta.poster = `${IMG}/w500${detail.poster_path}`; filled = true; }
      if (!meta.releaseInfo) {
        const date = detail.release_date || detail.first_air_date || "";
        if (date) { meta.releaseInfo = String(date).slice(0, 4); filled = true; }
      }
      if (filled) meta.enrichedFrom = "tmdb";
    }),
  );
  return metas;
}

/**
 * Replace each title's rating with MDBList's when it is available. Bounded to the
 * first `limit` titles per row so a home screen full of rows stays fast, and
 * cached for `PROVIDER_CACHE_TTL_MS`.
 */
export async function enrichRatings(metas, limit = 12) {
  // The ratings half of `enrich.tmdb`: off, a row keeps the rating it came with.
  if (getSettings().enrich?.tmdb === false) return metas;
  // **Only the aggregate does this.** The keyless scores are read per title on its own
  // page, so a row of twelve asking three public sites each would be a crawl; MDBList
  // answers all of them in one call, which is why this half is keyed.
  if (ratingsSource() !== "mdblist") return metas;
  const { mdblist } = providerKeys();
  if (!mdblist || !Array.isArray(metas) || !metas.length) return metas;
  // The breaker is up: return the rows untouched rather than asking a key that is
  // already over its daily limit.
  if (Date.now() < limitedUntil) return metas;

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

/* ------------------------------------------------- the ratings with no key ----
 *
 * MDBList aggregates IMDb, Rotten Tomatoes, Metacritic and the rest behind an API
 * key. Without one, the same three numbers are still **public**: IMDb publishes a
 * rating on the free Cinemeta metadata service, and Rotten Tomatoes and Metacritic
 * carry their score in the page's own JSON. So the row is not a two-plate row with a
 * note about a key you do not have — it is the ratings, asked for one by one.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** A title name as Rotten Tomatoes and Metacritic spell it in their URLs. */
const slugOf = (name) =>
  String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** One page's text (or `null` when it is missing or moved). */
async function pageText(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(9000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** The score a page carries, one pattern; `null` when the page is not there. */
function scoreOf(html, pattern) {
  const found = String(html || "").match(pattern);
  return found ? found[1] : null;
}

/** IMDb's own rating, from the free Cinemeta service (keyless). */
async function imdbRating(meta) {
  const id = String(meta.imdb || "").trim();
  if (!/^tt\d+$/.test(id)) return null;
  try {
    // Cinemeta spells a show `series`, where MDBList spells it `show`.
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${kindOf(meta) === "movie" ? "movie" : "series"}/${id}.json`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const value = (await res.json())?.meta?.imdbRating;
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num.toFixed(1) : null;
  } catch {
    return null;
  }
}

/**
 * The three keyless scores for one title: IMDb, Rotten Tomatoes (critics and
 * audience) and Metacritic. Each is asked for on its own and a miss simply drops
 * that plate — one site being down must not empty the row.
 */
async function freeRatings(meta) {
  const kind = kindOf(meta);
  const slug = slugOf(meta.name);
  const year = String(meta.releaseInfo || "").match(/\d{4}/)?.[0] || "";
  // **Rotten Tomatoes spells its slugs with underscores**, films and shows alike
  // (`/m/fight_club`, `/tv/the_last_of_us`); Metacritic spells them with dashes and
  // may want the year when a remake shares the name.
  const rtPath = `${kind === "movie" ? "m" : "tv"}/${slug.replace(/-/g, "_")}`;
  const mcBase = `https://www.metacritic.com/${kind === "movie" ? "movie" : "tv"}/${slug}/`;
  // One read per site — the critics' score and the audience score are two patterns
  // over the **same** Rotten Tomatoes page, not two requests for it.
  const [imdb, rtPage, mcPage] = await Promise.all([
    imdbRating(meta),
    pageText(`https://www.rottentomatoes.com/${rtPath}`),
    pageText(mcBase),
  ]);
  const RT_SCORE = /"ratingValue"\s*:\s*"?(\d+(?:\.\d+)?)"?/;
  const MC_SCORE = /"ratingValue"\s*:\s*"?(\d+(?:\.\d+)?)"?/;
  const rt = scoreOf(rtPage, RT_SCORE);
  const rtAud = scoreOf(rtPage, /audienceScore":\{[^}]*?"score":"?(\d+)/);
  // Metacritic lists a remake under `-<year>` when the plain slug is another film.
  const mc = scoreOf(mcPage, MC_SCORE) || (year ? scoreOf(await pageText(`${mcBase.replace(/\/$/, `-${year}/`)}`), MC_SCORE) : null);
  const round = (v) => (v == null ? null : Number(v) > 10 ? String(Math.round(Number(v))) : String(v));
  // A ten-point figure (IMDb) and a hundred-point one (Rotten Tomatoes, Metacritic)
  // are different scales, so the hundred-point ones say **%** and the ten-point ones
  // do not — otherwise "86" beside "8.3" reads as a number nothing can be compared to.
  const pct = (v) => (v == null ? null : `${round(v)}%`);
  return [
    imdb ? { source: "imdb", label: "IMDb", value: imdb } : null,
    rt ? { source: "tomatoes", label: "Rotten Tomatoes", value: pct(rt) } : null,
    rtAud ? { source: "tomatoesaudience", label: "RT Audience", value: pct(rtAud) } : null,
    mc ? { source: "metacritic", label: "Metacritic", value: pct(mc) } : null,
  ].filter(Boolean);
}

/**
 * **Ratings, from the service Settings names.**
 *
 * - `none` — the row is not built at all (TMDB's own score still arrives with the title).
 * - `free` — **no key**: IMDb, Rotten Tomatoes and Metacritic are read from their own
 *   public pages, so the row is real with nothing to configure.
 * - `mdblist` — one key, every source the aggregate knows (IMDb, TMDB, Trakt,
 *   Letterboxd, Rotten Tomatoes, Metacritic and the rest).
 *
 * Chosen with no key saved, `mdblist` answers nothing rather than quietly falling back
 * to the public pages — a setting that silently does something else is worse than no
 * setting at all, and `ratingsState()` says what is missing.
 */
export async function titleRatings(meta) {
  const source = ratingsSource();
  if (source === "none") return [];
  const { mdblist } = providerKeys();
  if (source === "free") {
    const freeKey = `free:${kindOf(meta)}:${tmdbId(meta)}`;
    const hit = ratingsCache.get(freeKey);
    if (hit && Date.now() - hit.at < RATINGS_TTL_MS) return hit.value;
    const value = await freeRatings(meta).catch(() => []);
    ratingsCache.set(freeKey, { at: Date.now(), value });
    if (ratingsCache.size > 500) ratingsCache.delete(ratingsCache.keys().next().value);
    return value;
  }
  if (!mdblist) return [];
  const key = `${kindOf(meta)}:${tmdbId(meta)}`;
  const cached = ratingsCache.get(key);
  if (cached && Date.now() - cached.at < RATINGS_TTL_MS) return cached.value;
  // The quota is spent: answer from the cache rather than asking again, and let the
  // page explain itself (see `ratingsState`).
  if (Date.now() < limitedUntil) return cached?.value || [];
  try {
    const url = `${MDBLIST}/tmdb/${kindOf(meta)}/${encodeURIComponent(tmdbId(meta))}/?apikey=${encodeURIComponent(mdblist)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      // MDBList answers a spent quota with 429 and a plain reason of its own.
      const body = await res.json().catch(() => ({}));
      limitedText = String(body?.error || "MDBList's daily API limit was reached");
      limitedUntil = Date.now() + 60 * 60 * 1000;
      return cached?.value || [];
    }
    if (!res.ok) return cached?.value || [];
    const data = await res.json();
    const ratings = data?.ratings || {};
    const value = Object.entries(ratings)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([source, v]) => ({ source, label: ratingLabel(source), value: v > 10 ? String(Math.round(v)) : v.toFixed(1) }));
    ratingsCache.set(key, { at: Date.now(), value });
    if (ratingsCache.size > 500) ratingsCache.delete(ratingsCache.keys().next().value);
    return value;
  } catch {
    return cached?.value || [];
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
