/**
 * TVDB as a catalog *content* source.
 *
 * TMDB is the only provider that can generate a row: its discover endpoint is
 * what answers "Action films from the 90s on Netflix", and TVDB has no
 * equivalent filter engine at all. What TVDB has is authoritative per-title
 * content — name, translations, year, artwork — keyed by IMDb id, which is the id
 * every row already resolves for its poster.
 *
 * So the **content source** setting decides who supplies what you actually see in
 * a row:
 *
 *   tmdb (default) — TMDB's translated name, year and poster
 *   tvdb           — TVDB's name (in the Settings language where TVDB has a
 *                    translation), year and artwork
 *
 * Row *membership* is always TMDB's, because that is the part TVDB cannot answer.
 * The title's id stays `tmdb:` too, so the watchlist pins and the title modal keep
 * working across a source switch.
 *
 * Every lookup is bounded (the first `TVDB_PER_ROW` titles of a row), cached, and
 * fails soft: a title TVDB cannot answer for keeps its TMDB content rather than
 * disappearing from the row. `/addon-status.json` reports how many upgrades
 * actually landed, so "is TVDB really supplying this?" is answerable.
 */
import { activeContentSource, activeLanguage, providerKeys } from "./settings.mjs";
import { imdbId } from "./posters.mjs";

const API = "https://api4.thetvdb.com/v4";
const BANNERS = "https://artworks.thetvdb.com/banners";
const TOKEN_TTL_MS = Number(process.env.TVDB_TOKEN_TTL_MS) || 12 * 60 * 60 * 1000;
const HIT_TTL_MS = Number(process.env.TVDB_CACHE_TTL_MS) || 24 * 60 * 60 * 1000;
const MISS_TTL_MS = Number(process.env.TVDB_MISS_TTL_MS) || 10 * 60 * 1000;
// A home screen of rows must not turn into hundreds of third-party lookups.
const PER_ROW = Number(process.env.TVDB_PER_ROW) || 8;

const cache = new Map();
const stats = { applied: 0, missed: 0, failed: 0 };

/** TVDB is only usable once a key is saved and the provider is enabled. */
export const tvdbEnabled = () => Boolean(providerKeys().tvdb);

/**
 * What is actually in force: asking for TVDB without a usable key falls back to
 * TMDB rather than serving nothing.
 */
export const contentSourceActive = () => (activeContentSource() === "tvdb" && tvdbEnabled() ? "tvdb" : "tmdb");

export const contentSourceStats = () => ({ ...stats, source: contentSourceActive() });

/** TVDB keys translations by a three-letter code. */
const LANG = {
  en: "eng", hi: "hin", bn: "ben", ta: "tam", te: "tel", ml: "mal", kn: "kan",
  mr: "mar", pa: "pan", ur: "urd", es: "spa", pt: "por", fr: "fra", de: "deu",
  it: "ita", nl: "nld", pl: "pol", ru: "rus", uk: "ukr", cs: "ces", ro: "ron",
  hu: "hun", el: "ell", sv: "swe", da: "dan", no: "nor", fi: "fin", tr: "tur",
  ar: "ara", he: "heb", fa: "fas", id: "ind", ms: "msa", th: "tha", vi: "vie",
  fil: "fil", ja: "jpn", ko: "kor", zh: "zho",
};
const tvdbLanguage = () => LANG[String(activeLanguage()).slice(0, 2).toLowerCase()] || "";

let token = null;
let tokenKey = "";

async function auth(key) {
  if (token && tokenKey === key && token.expires > Date.now()) return token.value;
  const res = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: key }),
  });
  if (!res.ok) throw new Error(`TVDB login ${res.status}`);
  const value = (await res.json())?.data?.token;
  if (!value) throw new Error("TVDB login returned no token");
  token = { value, expires: Date.now() + TOKEN_TTL_MS };
  tokenKey = key;
  return value;
}

async function api(path, key) {
  const bearer = await auth(key);
  const res = await fetch(`${API}${path}`, {
    headers: { accept: "application/json", authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) throw new Error(`TVDB ${res.status} for ${path}`);
  return res.json();
}

/** The banner url, whether TVDB answered with a path or a full url. */
const artUrl = (art) =>
  !art ? "" : /^https?:/.test(art) ? art : `${BANNERS}/${String(art).replace(/^\/+/, "")}`;

/** One title's TVDB content, or null when TVDB has nothing usable for it. */
async function lookup(meta, key) {
  const imdb = await imdbId(meta);
  if (!imdb) return null;
  const wanted = meta.type === "movie" ? "movie" : "series";
  const results = (await api(`/search/remoteid/${encodeURIComponent(imdb)}`, key))?.data || [];
  const hit = results.find((r) => r?.type === wanted) || results[0];
  if (!hit) return null;
  // Search returns ids like "series-123"; the extended routes want the number.
  const id = String(hit.id ?? "").replace(/^[a-z]+-/, "");
  if (!id) return null;
  const record = (await api(`/${wanted === "movie" ? "movies" : "series"}/${id}/extended`, key))?.data;
  if (!record) return null;

  const code = tvdbLanguage();
  const translated = code ? record.translations?.[code] : null;
  const name = translated?.name || record.name || hit.name || "";
  const overview = translated?.overview || record.overview || "";
  const year = String(record.year || hit.year || record.firstAired || "").slice(0, 4);
  return { name, overview, year, art: artUrl(record.image || hit.image_url) };
}

/**
 * Override the visible content of each meta with TVDB's, in place.
 *
 * Called next to the poster and rating steps, so a row is assembled as: TMDB
 * decides which titles are in it → the poster service upgrades the artwork →
 * TVDB supplies its content (when it is the chosen source) → MDBList supplies the
 * rating. It runs *after* the poster service on purpose: when TVDB is the chosen
 * source, the source that owns the content owns the artwork too, and the poster
 * pattern only stands for titles TVDB had no artwork for.
 */
export async function applyContentSource(metas, limit = PER_ROW) {
  if (contentSourceActive() !== "tvdb" || !Array.isArray(metas) || !metas.length) return metas;
  const key = providerKeys().tvdb;

  await Promise.all(
    metas.slice(0, limit).map(async (meta) => {
      const cached = cache.get(meta.id);
      if (cached && cached.expires > Date.now()) {
        if (cached.value) assign(meta, cached.value);
        return;
      }
      try {
        const hit = await lookup(meta, key);
        cache.set(meta.id, { value: hit, expires: Date.now() + (hit ? HIT_TTL_MS : MISS_TTL_MS) });
        if (!hit) {
          stats.missed++;
          return;
        }
        stats.applied++;
        assign(meta, hit);
      } catch {
        // Soft failure on purpose: the TMDB content already on the meta stands.
        stats.failed++;
        cache.set(meta.id, { value: null, expires: Date.now() + MISS_TTL_MS });
      }
    }),
  );
  return metas;
}

function assign(meta, hit) {
  if (hit.name) meta.name = hit.name;
  if (hit.year) meta.releaseInfo = hit.year;
  if (hit.overview) meta.description = hit.overview;
  if (hit.art) meta.poster = hit.art;
  meta.contentSource = "tvdb";
}
