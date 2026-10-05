/**
 * Nuvio Collections — a Stremio/Nuvio catalog addon.
 *
 * Publishes one catalog row per catalog that lives inside each Nuvio card: a
 * card that names its catalogs (Discover → Latest, New Release, Trending,
 * Popular, Top Rated) yields one row per name; a card without names yet yields
 * a single collection-level row. Every row is backed live by TMDB, and only the
 * `catalog` resource is advertised — no search, no discover resource.
 *
 *   GET /manifest.json
 *   GET /catalog/{type}/{id}.json              (type = movie | series)
 *   GET /catalog/{type}/{id}/skip=100.json
 *   GET /addon-status.json                     (diagnostics)
 *
 * The addon is mounted by `serve.mjs`, so the same preview URL serves both the
 * cover gallery and the addon.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRIES, collectionsFor, localServices, title as collectionTitle } from "../scripts/collections.mjs";
import { get, hasKey, toMeta, tmdbPath, setKey } from "./tmdb.mjs";
import { askAI, verifyAI, aiState } from "./ai.mjs";
import {
  STATES,
  STATE_LABEL,
  isState,
  list as watchlistList,
  counts as watchlistCounts,
  pin as watchlistPin,
  unpin as watchlistUnpin,
  metasFor as watchlistMetas,
} from "./watchlist.mjs";
import { catalogSpecs, activeRegion, catalogDefs, CATALOG_ID_PREFIX, findCatalog } from "./catalogs.mjs";
import { activeCountry, activeContentSource, activeLanguage, getSettings, updateSettings, publicSettings, tmdbKey, providerKeys } from "./settings.mjs";
import { enrichRatings, verifyProvider } from "./providers.mjs";
import { applyPosters, postersEnabled, checkPosterService } from "./posters.mjs";
import { applyContentSource, contentSourceActive, contentSourceStats } from "./tvdb.mjs";
import { inspectSource } from "./sources.mjs";
import { calendarMonth } from "./calendar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCHLIST_FILE = path.join(__dirname, "watchlist.json");

export const ADDON_ID = "community.nuvio.collections";
export { CATALOG_ID_PREFIX };

const PAGE_SIZE = 40;

let warnedNoKey = false;

/* --------------------------------------------------------------- settings */

/** Read the request body as JSON (used by POST /settings). */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/* ----------------------------------------------------------------- manifest */

export function buildManifest(base) {
  const root = base.replace(/\/$/, "");
  const s = getSettings();
  return {
    id: ADDON_ID,
    version: "1.1.0",
    name: s.profile || "Nuvio Collections",
    description:
      "Curated Nuvio collection rows — on the board, spotlight, genres, decades, countries, runtimes, moods, themes, OTT charts and your watchlist. One cover per card, live titles from TMDB.",
    logo: `${root}/covers/movies/on-the-board.png`,
    background: `${root}/covers/movies/global-ott.png`,
    resources: ["catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tmdb:"],
    catalogs: catalogDefs().map((d) => ({
      type: d.type,
      id: d.id,
      name: d.name,
      extra: [{ name: "skip" }, { name: "genre", isRequired: false }],
    })),
    behaviorHints: { configurable: false },
  };
}

/* -------------------------------------------------------------- collections */

/**
 * Every card, with its cover and the catalogs it owns, per row. The desktop app
 * reads this to render the home screen — cards that own no catalogs render as
 * cover-only tiles.
 */
function collectionsPayload(root) {
  const byKey = new Map();
  for (const d of catalogDefs()) {
    if (!byKey.has(d.key)) byKey.set(d.key, []);
    byKey.get(d.key).push(d);
  }
  // The card set for the country in Settings — the regional OTT cards name that
  // country's services, so the cards and their rows are always read together.
  return collectionsFor(activeCountry()).map((c) => {
    const defs = byKey.get(c.key) || [];
    const row = (type) => ({
      cover: `${root}/covers/${type === "movie" ? "movies" : "shows"}/${c.key}.png`,
      // `kind`/`state` let the app explain an empty row properly (a watchlist row
      // says how to fill it, a TMDB row says the catalog came back empty).
      catalogs: defs
        .filter((d) => d.type === type)
        .map((d) => ({ id: d.id, name: d.name, kind: d.entry?.kind || "", state: d.entry?.state || "" })),
    });
    // `divider` marks the card that is preceded by a vertical rule in the app.
    return { key: c.key, title: collectionTitle(c), divider: Boolean(c.divider), movie: row("movie"), series: row("series") };
  });
}

/* ---------------------------------------------------------------- catalog */

const roundRobin = (lists) => {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
};

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

// TMDB answers 20 titles per page. The app asks for 40 at a time and keeps
// scrolling, so a row has to be able to serve *deep* windows — reading page 1
// forever is what made every Explore end after 20 titles.
const MAX_ROUNDS = 15;            // per spec: 15 pages × 20 titles = 300
const POOL_TTL = 10 * 60 * 1000;  // a pool is reused for 10 minutes
const MAX_POOLS = 80;             // distinct catalogs kept in memory
const pools = new Map();

/** Run `worker` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  let next = 0;
  const out = new Array(items.length);
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

function remember(store, key, make) {
  let entry = store.get(key);
  if (!entry || Date.now() - entry.at > POOL_TTL) {
    entry = make();
    store.set(key, entry);
    // Keep the cache bounded — drop the least recently used entries.
    if (store.size > MAX_POOLS) {
      const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, store.size - MAX_POOLS);
      for (const [k] of oldest) store.delete(k);
    }
  }
  entry.at = Date.now();
  return entry;
}

async function fetchRound(entry) {
  const page = entry.rounds + 1;
  entry.rounds = page;
  const got = await Promise.all(
    entry.specs.map(async (spec, i) => {
      const cap = spec.take ?? Infinity;
      if (entry.lists[i].length >= cap) return false;
      try {
        const res = await get(spec.path, { ...spec.params, page });
        const items = res.results ?? [];
        if (!items.length) return false;
        entry.lists[i].push(...items);
        if (cap !== Infinity) entry.lists[i].length = Math.min(entry.lists[i].length, cap);
        entry.items = null;
        return true;
      } catch {
        return false;
      }
    }),
  );
  return got.some(Boolean);
}

/** The raw, de-duplicated pool — this is what gets cached. */
function poolItems(entry) {
  if (!entry.items) {
    const seen = new Set();
    const out = [];
    for (const item of roundRobin(entry.lists)) {
      if (!item || item.id == null || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    entry.items = out;
  }
  return entry.items;
}

/**
 * Metas are built fresh for every request: the route mutates them downstream
 * (better posters, ratings), so a cached object must never be handed out twice.
 */
const metasFor = (entry) => poolItems(entry).map((item) => toMeta(item, entry.media)).filter(Boolean);

/**
 * Grow the pool until it covers `need` titles, or it runs out.
 *
 * Growing is serialised per catalog: several requests arrive together (three
 * shuffle rows plus the grid), and without this they would each ask TMDB for the
 * same page and each append it.
 */
function deepen(entry, need) {
  const grow = async () => {
    const cap = entry.specs.every((s) => s.take) ? entry.specs.reduce((n, s) => n + s.take, 0) : Infinity;
    const wanted = Math.min(need, cap);
    while (entry.rounds < MAX_ROUNDS && poolItems(entry).length < wanted) {
      if (!(await fetchRound(entry))) break;
    }
    return metasFor(entry);
  };
  const next = (entry.chain || Promise.resolve()).then(grow, grow);
  entry.chain = next.then(
    () => {},
    () => {},
  );
  return next;
}

/** A random sample of a catalog — what the Explore shuffle rows draw from. */
export async function catalogShuffle(media, def, count, opts = {}) {
  const specs = def.entry ? await catalogSpecs(def.entry, media, opts) : [];
  const identity = def.id ?? JSON.stringify(def.entry ?? def);
  // The language is part of the pool identity: the cached items are raw TMDB
  // records, so a pool built in one language must never serve another.
  const language = opts.language || activeLanguage();
  const key = `${media}:${identity}:${opts.adult ? "a" : "s"}:${language}`;

  let pool;
  if (specs.length === 1 && specs[0].watchlist) {
    pool = watchlistMetas(specs[0].watchlist, media, 0, 300);
  } else if (specs.length === 1 && specs[0].episodes) {
    pool = await episodeMetas(media, specs[0].episodes, language);
  } else {
    const entry = remember(pools, key, () => ({ at: Date.now(), media, specs, lists: specs.map(() => []), rounds: 0, items: null }));
    // Sample from a pool several times the sample size, so one shuffle is not
    // just the same handful of titles reordered.
    pool = await deepen(entry, Math.max(count * 4, PAGE_SIZE * 3));
  }

  const picked = pool.slice();
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.slice(0, count);
}

/**
 * Episode-count rows: TMDB discover cannot filter by episode count, so build
 * them from a pool of shows and keep those with at most `max` episodes. The pool
 * is cached, so the (expensive) detail lookups happen once per catalog.
 */
// Popular shows are overwhelmingly long-running, so the pool also pulls the
// newest premieres — recent series are the ones with few episodes.
const EPISODE_POOL_PAGES = 4;
const episodePools = new Map();

/** Every episode-cap title for a media type, cached. */
async function episodeMetas(media, max, language = activeLanguage()) {
  const entry = remember(episodePools, `${media}:${max}:${language}`, () => ({ shows: null }));
  if (!entry.shows) {
    const t = tmdbPath(media);
    const requests = [
      ...Array.from({ length: EPISODE_POOL_PAGES }, (_, i) => ({ sort_by: "first_air_date.desc", page: i + 1 })),
      ...Array.from({ length: EPISODE_POOL_PAGES }, (_, i) => ({ sort_by: "popularity.desc", page: i + 1 })),
    ];
    const pages = await Promise.all(
      requests.map((params) => get(`/discover/${t}`, { "vote_count.gte": 1, language, ...params }).catch(() => ({ results: [] }))),
    );
    const pool = dedupe(pages.flatMap((r) => r.results ?? []));
    const details = await mapLimit(pool, 12, (it) => get(`/${t}/${it.id}`, { language }).catch(() => null));
    // Cache the *shows*; the metas are built per request (they get mutated).
    entry.shows = dedupe(details.filter((d) => d && (d.number_of_episodes ?? Infinity) <= max));
  }
  return entry.shows.map((d) => toMeta(d, media)).filter(Boolean);
}

async function episodesMetas(media, max, skip, language) {
  const metas = await episodeMetas(media, max, language);
  return metas.slice(skip, skip + PAGE_SIZE);
}

export async function catalogMetas(media, def, skip, opts = {}) {
  const specs = def.entry ? await catalogSpecs(def.entry, media, opts) : [];
  // Key on the catalog's identity *and* its resolved entry — two definitions
  // must never share a pool just because one of them has no id.
  const identity = def.id ?? JSON.stringify(def.entry ?? def);
  const language = opts.language || activeLanguage();
  const key = `${media}:${identity}:${opts.adult ? "a" : "s"}:${language}`;

  if (specs.length === 1 && specs[0].episodes) {
    return episodesMetas(media, specs[0].episodes, skip, language);
  }

  // The watchlist is served from the stored pins, not from TMDB.
  if (specs.length === 1 && specs[0].watchlist) {
    return watchlistMetas(specs[0].watchlist, media, skip, PAGE_SIZE);
  }

  // A pool that only grows: page 2 continues where page 1 stopped, and repeat
  // requests are served from memory. `take` catalogues (the ◆ Top 10 rows) stop
  // at their length, because a Top 10 really does hold ten titles.
  const entry = remember(pools, key, () => ({ at: Date.now(), media, specs, lists: specs.map(() => []), rounds: 0, items: null }));
  const pool = await deepen(entry, skip + PAGE_SIZE);
  return pool.slice(skip, skip + PAGE_SIZE);
}

function parseCatalogPath(pathname) {
  // `/skip=N` walks the list, `/shuffle=N` takes a random sample of it.
  const m = pathname.match(/^\/catalog\/(movie|series)\/([^/]+?)(?:\/(skip|shuffle)=(\d+))?\.json$/);
  if (!m) return null;
  const [, type, id, kind, value] = m;
  const def = findCatalog(decodeURIComponent(id), type);
  if (!def) return null;
  return {
    type,
    def,
    skip: kind === "skip" ? Number(value) : 0,
    shuffle: kind === "shuffle" ? Math.min(Math.max(Number(value) || 0, 1), 60) : 0,
  };
}

/* ----------------------------------------------------------------- handler */

const json = (res, status, body, maxAge = 0) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    ...(maxAge ? { "cache-control": `max-age=${maxAge}` } : {}),
  });
  res.end(payload);
};

/**
 * The languages the app can run in, as TMDB language codes. One setting covers
 * both jobs: the language every row is served in, and the primary subtitle
 * language a player should prefer.
 */
const LANGUAGES = [
  ["en-US", "English (US)"], ["en-GB", "English (UK)"],
  ["hi-IN", "Hindi"], ["bn-IN", "Bengali"], ["ta-IN", "Tamil"], ["te-IN", "Telugu"],
  ["ml-IN", "Malayalam"], ["kn-IN", "Kannada"], ["mr-IN", "Marathi"], ["pa-IN", "Punjabi"], ["ur-PK", "Urdu"],
  ["es-ES", "Spanish"], ["es-MX", "Spanish (Latin America)"], ["pt-BR", "Portuguese (Brazil)"], ["pt-PT", "Portuguese (Portugal)"],
  ["fr-FR", "French"], ["de-DE", "German"], ["it-IT", "Italian"], ["nl-NL", "Dutch"],
  ["pl-PL", "Polish"], ["ru-RU", "Russian"], ["uk-UA", "Ukrainian"], ["cs-CZ", "Czech"],
  ["ro-RO", "Romanian"], ["hu-HU", "Hungarian"], ["el-GR", "Greek"], ["sv-SE", "Swedish"],
  ["da-DK", "Danish"], ["no-NO", "Norwegian"], ["fi-FI", "Finnish"],
  ["tr-TR", "Turkish"], ["ar-SA", "Arabic"], ["he-IL", "Hebrew"], ["fa-IR", "Persian"],
  ["id-ID", "Indonesian"], ["ms-MY", "Malay"], ["th-TH", "Thai"], ["vi-VN", "Vietnamese"], ["fil-PH", "Filipino"],
  ["ja-JP", "Japanese"], ["ko-KR", "Korean"], ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"],
];

/**
 * The choices Settings offers: your language, and the country whose services the
 * three regional OTT cards show. `services` says how many rows that country will
 * actually fill, so a country with none is not a silent empty card.
 */
function appOptions() {
  return {
    languages: LANGUAGES.map(([code, label]) => ({ code, label })),
    countries: COUNTRIES.map(([name, code]) => ({
      code,
      name,
      services: localServices(code, "movie").length + localServices(code, "tv").length,
    })),
  };
}

/** The watchlist as the app reads it: every pin, plus the per-state counts. */
function watchlistPayload() {
  return {
    items: watchlistList(),
    counts: watchlistCounts(),
    states: STATES.map((id) => ({ id, label: STATE_LABEL[id] || id })),
  };
}

/**
 * Handle an addon request. Returns true when the request was answered, false
 * when it is not an addon route (so the caller can fall through to static
 * file serving).
 */
export async function handleAddon(req, res, pathname, origin) {
  // Settings are read/written by the app's Settings screen. The keys live on the
  // server so the addon can use them; the response only says whether one is set.
  if (pathname === "/settings" || pathname === "/settings.json") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }
    if (req.method === "POST") {
      try {
        const patch = await readBody(req);
        updateSettings(patch);
        setKey(tmdbKey());
        json(res, 200, { ...publicSettings(), options: appOptions() });
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
      }
      return true;
    }
    json(res, 200, { ...publicSettings(), options: appOptions() });
    return true;
  }

  // Live check for the poster service configured in Settings.
  if (pathname === "/posters/check") {
    json(res, 200, await checkPosterService());
    return true;
  }

  // Inspect an add-on / plugin / repository **server-side**. This is what makes
  // third-party sources work in the app: the browser cannot read a foreign
  // host's manifest.json (CORS), and a repo lives on raw.githubusercontent.com.
  if (pathname === "/api/source") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }
    try {
      const { type, url } = await readBody(req);
      json(res, 200, await inspectSource(String(type || "stremio"), String(url || "")));
    } catch (err) {
      json(res, 400, { ok: false, message: String(err?.message || err) });
    }
    return true;
  }

  // A real release calendar: everything landing in a given month.
  {
    const m = pathname.match(/^\/calendar\/(movie|series)\/(\d{4}-\d{2})\.json$/);
    if (m) {
      const [, type, month] = m;
      const adult = new URL(req.url ?? "/", "http://localhost").searchParams.get("adult") === "1";
      try {
        const data = await calendarMonth(type, month, { adult });
        if (!data) {
          json(res, 400, { error: "month must be YYYY-MM" });
          return true;
        }
        await applyPosters(data.metas);
        await enrichRatings(data.metas);
        json(res, 200, data, 900);
      } catch (err) {
        console.error(`[addon] calendar ${type}/${month} failed:`, err.message);
        json(res, 200, { month, type, days: 0, metas: [] });
      }
      return true;
    }
  }

  // Verify a stored provider key by calling the provider.
  if (pathname === "/providers/verify") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }
    try {
      const { name } = await readBody(req);
      const s = getSettings();
      const key = s.providers?.[name]?.key || (name === "tmdb" ? tmdbKey() : "");
      json(res, 200, await verifyProvider(name, key));
    } catch (err) {
      json(res, 400, { ok: false, text: String(err?.message || err) });
    }
    return true;
  }

  // Provider state, for the Settings screen and diagnostics.
  if (pathname === "/providers.json") {
    const s = getSettings();
    json(res, 200, {
      ...publicSettings(),
      activeKey: tmdbKey() ? "tmdb" : null,
      envKey: Boolean(process.env.TMDB_API_KEY),
    });
    return true;
  }

  if (pathname === "/addon-status.json") {
    const keys = providerKeys();
    json(res, 200, {
      addon: buildManifest(origin).name,
      profile: getSettings().profile,
      tmdbKey: hasKey(),
      tvdbKey: Boolean(keys.tvdb),
      mdblistKey: Boolean(keys.mdblist),
      mdblistEnriching: Boolean(keys.mdblist),
      posters: postersEnabled(),
      safe: getSettings().safe,
      region: activeRegion(),
      language: activeLanguage(),
      // The content source is reported twice on purpose: what was asked for, and
      // what is actually in force (TVDB without a key falls back to TMDB), plus
      // how many titles it upgraded — so "is TVDB really supplying this?" is a
      // question the status route can answer.
      contentSource: activeContentSource(),
      contentSourceActive: contentSourceActive(),
      contentSourceStats: contentSourceStats(),
      catalogs: catalogDefs().length,
      regionalServices: localServices(activeCountry(), "movie").length + localServices(activeCountry(), "tv").length,
      watchlistFile: fs.existsSync(WATCHLIST_FILE),
      watchlist: watchlistCounts(),
      aiProvider: aiState().provider,
      aiReady: aiState().ready,
    });
    return true;
  }

  // The watchlist: the titles the user pinned, and how far they are with them.
  // It is stored here so the addon can publish the same rows the app shows.
  if (pathname === "/watchlist.json" || pathname === "/watchlist") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        const item = body.item || {};
        const state = body.state;
        if (body.remove || state === null) json(res, 200, { ...watchlistUnpin(item), ...watchlistPayload() });
        else if (!isState(state)) json(res, 400, { ok: false, text: `unknown state ${state}`, ...watchlistPayload() });
        else json(res, 200, { ...watchlistPin(item, state), ...watchlistPayload() });
      } catch (err) {
        json(res, 400, { ok: false, text: String(err?.message || err) });
      }
      return true;
    }
    json(res, 200, watchlistPayload());
    return true;
  }

  // The AI provider state (never the keys) and its two live calls.
  if (pathname === "/ai.json") {
    json(res, 200, aiState());
    return true;
  }

  if (pathname === "/ai/ask" || pathname === "/ai/verify") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return true;
    }
    try {
      const body = await readBody(req);
      const result = pathname === "/ai/ask"
        ? await askAI(String(body.prompt || ""))
        : await verifyAI(String(body.provider || ""), body.key ? String(body.key) : undefined);
      json(res, 200, result);
    } catch (err) {
      json(res, 400, { ok: false, text: String(err?.message || err) });
    }
    return true;
  }

  // Title search, backing the search screen and the AI box. The addon
  // advertises only the `catalog` resource, so this is a plain server route
  // rather than a Stremio `search` resource.
  if (pathname === "/search.json") {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const query = (params.get("q") || "").trim();
    const adult = params.get("adult") === "1";
    setKey(tmdbKey());
    if (!query || !hasKey()) {
      json(res, 200, { query, metas: [] });
      return true;
    }
    try {
      const only = params.get("type");
      const types = only === "movie" || only === "series" ? [only] : ["movie", "series"];
      const lists = await Promise.all(
        types.map(async (type) => {
          const data = await get(`/search/${tmdbPath(type)}`, { query, ...(adult ? { include_adult: true } : {}) }).catch(() => ({ results: [] }));
          return (data.results ?? []).slice(0, 12).map((item) => toMeta(item, type)).filter(Boolean);
        }),
      );
      const metas = lists.flat();
      await applyPosters(metas);
      await applyContentSource(metas);
      await enrichRatings(metas);
      json(res, 200, { query, metas }, 300);
    } catch (err) {
      console.error(`[addon] search ${query} failed:`, err.message);
      json(res, 200, { query, metas: [] });
    }
    return true;
  }

  if (pathname === "/manifest.json") {
    json(res, 200, buildManifest(origin));
    return true;
  }

  if (pathname === "/collections.json") {
    json(res, 200, collectionsPayload(origin.replace(/\/$/, "")));
    return true;
  }

  // Keep the TMDB client on the key configured in Settings (falls back to env).
  setKey(tmdbKey());

  const parsed = parseCatalogPath(pathname);
  if (!parsed) return pathname.startsWith("/catalog/") ? (json(res, 404, { metas: [] }), true) : false;

  if (!hasKey()) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        "[addon] TMDB_API_KEY is not set — catalogs will be empty. Add it in Settings → Environment.",
      );
    }
    json(res, 200, { metas: [] });
    return true;
  }

  // The app's SFW/NSFW setting rides along as ?adult=1 on the catalog request,
  // and its language as ?lang= — which also means a language switch is a
  // different URL, so the browser can never answer it from the previous one.
  const params = new URL(req.url ?? "/", "http://localhost").searchParams;
  const adult = params.get("adult") === "1";
  const language = params.get("lang") || activeLanguage();

  try {
    const metas = parsed.shuffle
      ? await catalogShuffle(parsed.type, parsed.def, parsed.shuffle, { adult, language })
      : await catalogMetas(parsed.type, parsed.def, parsed.skip, { adult, language });
    // Better posters first (it may replace `poster`), then the chosen content
    // source (which owns the poster when it is TVDB), then extra metadata.
    await applyPosters(metas);
    await applyContentSource(metas);
    await enrichRatings(metas);
    json(res, 200, { metas }, 900);
  } catch (err) {
    console.error(`[addon] catalog ${parsed.type}/${parsed.def.id} failed:`, err.message);
    json(res, 200, { metas: [] });
  }
  return true;
}
