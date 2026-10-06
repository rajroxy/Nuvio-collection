/**
 * Streams — the playable sources for one title, read from the add-ons you added.
 *
 * This runs **on the server** for the same reason `/api/source` does: a Stremio
 * add-on's stream endpoint is a plain HTTP call (`/stream/<type>/<id>.json`) but the
 * browser cannot make it unless that host sends permissive CORS headers, which most
 * do not. Fetching here has no such restriction, and it is also the only place the
 * add-on list is actually available — the sources live in the server's settings, so
 * they exist for the addon, the desktop app and Nuvio itself.
 *
 * Stremio keys a stream request by **IMDb id** (`tt0137523`), which a TMDB title
 * does not carry, so one is resolved from TMDB's `external_ids` first.
 *
 * Only add-ons that declare the `stream` resource are asked. An add-on that declares
 * no `resources` at all is asked too — the field is optional and plenty of working
 * add-ons omit it, and asking a catalog-only add-on costs one 404.
 */
import { get, toMeta } from "./tmdb.mjs";
import { getSettings, activeLanguage } from "./settings.mjs";
import { imdbId } from "./posters.mjs";

const STREAM_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const MAX_SOURCES = 12;
const TIMEOUT_MS = 15000;

/** Every source the user added, as stored. */
export const listSources = () => (Array.isArray(getSettings().sources) ? getSettings().sources : []);

/** Add-ons that can answer a stream request. */
const streamSources = (type) =>
  listSources()
    .filter((s) => s && s.url)
    .filter((s) => (s.type === "stremio" || s.kind === "addon" || s.kind === "plugin"))
    .filter((s) => {
      const resources = Array.isArray(s.resources) ? s.resources : [];
      // No declared resources → ask anyway (the field is optional). Declared but
      // without `stream` → this add-on serves catalogs, not video.
      return !resources.length || resources.includes("stream");
    })
    .slice(0, MAX_SOURCES);

/** `<base>/stream/<type>/<id>.json`, tolerating the URL shapes an add-on is added by. */
function streamUrl(sourceUrl, type, imdb) {
  const base = String(sourceUrl || "")
    .replace(/^stremio:\/\//i, "https://")
    .replace(/\/+$/, "")
    .replace(/\/(manifest|configure)\.json$/i, "");
  return `${base}/stream/${type}/${encodeURIComponent(imdb)}.json`;
}

/**
 * One title's streams, merged from every configured add-on.
 *
 * A source that fails is reported rather than swallowed: "no streams" and "your
 * add-on is down" are different answers, and the player has to say which one it is.
 */
export async function streamsFor(type, tmdbId, { name = "", force = false } = {}) {
  const media = type === "series" || type === "tv" || type === "show" ? "series" : "movie";
  const key = `${media}:${tmdbId}`;
  if (!force) {
    const hit = cache.get(key);
    if (hit && hit.at + STREAM_TTL_MS > Date.now()) return hit.value;
  }

  const sources = streamSources("stremio");
  const meta = { id: String(tmdbId).replace(/^tmdb:/, ""), type: media, name };
  const imdb = await imdbId(meta);

  if (!sources.length) {
    const value = { ok: false, reason: "no-sources", imdb, streams: [], sources: [] };
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  if (!imdb) {
    // Without an IMDb id an add-on cannot be asked for streams at all.
    const value = { ok: false, reason: "no-imdb", imdb: null, streams: [], sources: sources.map((s) => s.name || s.url) };
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      const label = source.name || source.url;
      const url = streamUrl(source.url, media, imdb);
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "NuvioCollections/1.0" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { label, ok: false, message: `HTTP ${res.status}`, streams: [] };
        const data = await res.json();
        const raw = Array.isArray(data?.streams) ? data.streams : [];
        const streams = raw
          .map((s) => ({
            url: String(s.url || s.externalUrl || ""),
            // `name` is the quality/group line and `title` the detail line in the
            // Stremio spec; a stream that only carries one is shown by that one.
            name: String(s.name || ""),
            title: String(s.title || s.description || ""),
            quality: String(s.behaviorHints?.videoQuality || ""),
            source: label,
          }))
          .filter((s) => s.url);
        return { label, ok: true, message: streams.length ? `${streams.length} streams` : "no streams", streams };
      } catch (err) {
        return { label, ok: false, message: String(err?.message || err), streams: [] };
      }
    }),
  );

  const streams = results.flatMap((r) => r.streams);
  const value = {
    ok: streams.length > 0,
    imdb,
    count: streams.length,
    streams,
    // One line per add-on: which answered, with how many, and which did not.
    sources: results.map((r) => ({ name: r.label, ok: r.ok, message: r.message })),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Used by the addon's own meta handler: the resolved IMDb id for a title. */
export async function imdbFor(type, id) {
  return imdbId({ id: String(id).replace(/^tmdb:/, ""), type: type === "series" ? "series" : "movie" });
}

/** A TMDB record with its IMDb id attached — the shape `toMeta` is happy with. */
export async function metaWithImdb(record, media) {
  const meta = toMeta(record, media);
  if (!meta) return null;
  const imdb = await imdbId(meta);
  if (imdb) meta.imdb = imdb;
  return meta;
}

export { activeLanguage };
