/**
 * Settings store for the app.
 *
 * The desktop/browser UI keeps its own copy in localStorage for instant, offline
 * feedback; the provider and tracking *keys* are also written here so the addon
 * (the thing that actually talks to upstream providers) can use them. Nothing is
 * committed — `addon/settings.json` is git-ignored and created at runtime.
 *
 * The public view never returns a key verbatim, only whether one is set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable so tests never touch the real settings file.
const FILE = process.env.NUVIO_SETTINGS_FILE || path.join(__dirname, "settings.json");

const DEFAULTS = {
  profile: "Movies & Shows",
  safe: true,
  // The **Custom** card's label. The card holds your own list; what it is called
  // is yours to say, so the name is a setting rather than a constant in the card
  // set (which is shared by the addon and the cover generator).
  customLabel: "Custom",
  // The language every row is served in (TMDB's `language`), and the primary
  // subtitle language the app and a player should prefer — one setting, because
  // you want your subtitles in the language you browse in.
  language: process.env.NUVIO_LANGUAGE || "en-US",
  // Where you are. This is the region the OTT rows are scoped to: the three
  // regional cards show *your* country's services, and the global platform rows
  // report availability for it.
  country: (process.env.NUVIO_REGION || "US").toUpperCase(),
  // How often catalogs and metadata are re-read from TMDB. `minutes` is the
  // refresh interval; 0 means "only when you ask". The addon's own response
  // cache follows it and the app re-reads the screen on the same clock, so one
  // setting drives both halves of "update itself".
  refresh: { minutes: 60 },
  // Providers that can supply catalogs and metadata. Enabling one switches the
  // addon onto it for the parts it supports; catalog names never change.
  providers: {
    tmdb: { enabled: true, key: "" },
    tvdb: { enabled: false, key: "" },
    mdblist: { enabled: false, key: "" },
  },
  // Who supplies the content you see inside a row. TMDB is the only provider that
  // can generate a row (its discover endpoint is what answers "90s action on
  // Netflix"); TVDB can supply a title's name, translation, year and artwork for
  // every row. "tvdb" therefore re-sources the *content* of every catalog from
  // TVDB and needs the TVDB provider enabled with a key, or it falls back.
  content: { source: "tmdb" },
  // Live TV & Sports: where the lineup and the guide come from. "dth" is the
  // **premium/DTH provider catalogue** shipped with the app ("m3u" is your own
  // playlist URL/file, "xtream" is an Xtream Codes login). `providers` is which of
  // the catalogue's operators this profile is drawn from, and `epg` is an XMLTV URL
  // — with it (or a provider's own public feed) the Guide draws real programme
  // blocks; without it the lineup is still there and the Guide says so.
  live: {
    mode: "dth",
    m3u: "",
    host: "",
    username: "",
    password: "",
    epg: "",
    providers: [],
    // 0 → follow the content refresh interval above.
    refreshMinutes: 0,
  },
  // Tracking services (watched history, scrobbling). Stored for the native app.
  // The anime databases track the same shows as the film ones, so they sit in the
  // same group; the drama tracker is its own catalogue and its own group.
  tracking: {
    trakt: { enabled: false, key: "" },
    simkl: { enabled: false, key: "" },
    myanimelist: { enabled: false, key: "" },
    anilist: { enabled: false, key: "" },
    letterboxd: { enabled: false, key: "" },
    mydramalist: { enabled: false, key: "" },
  },
  // Add-ons and plugins the user added. They live **on the server**, not only in the
  // page, because reading a stream needs a server-side request: a browser cannot
  // call another host's `/stream/...` unless that host sends permissive CORS
  // headers, which most add-ons do not. Nothing here is a secret — a source is a
  // URL — so they travel back to the page verbatim.
  sources: [],
  // Poster artwork. BetterPosters (bttr.cc) serves enhanced, tagged posters keyed
  // by IMDb id; the pattern is editable so another service can be dropped in.
  posters: {
    enabled: true,
    source: "bttr",
    pattern: "https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg",
    apiKey: "",
  },
  ai: {
    enabled: true,
    // Which free provider answers the Ask box (`""` = plain text search). The
    // catalogue of providers lives in `addon/ai.mjs`; these are just the user's
    // choice and their keys, kept server-side for the same reason as the rest: a
    // key must never be readable from the page.
    provider: "groq",
    keys: { groq: "", google: "", openrouter: "", cerebras: "" },
    // Optional model override — providers rename models faster than this ships.
    model: "",
    // "Pick for me": which row the Ask box searches. Empty means both, so the
    // box behaves as it always did until you choose a side.
    pickRow: "",
    // "Classic posters & banners" → high-quality modern artwork.
    enhanceArtwork: true,
    // Apply that same treatment to titles the poster service could not cover.
    enhanceMissing: true,
  },
};

let cache = null;

function merge(base, next) {
  for (const [k, v] of Object.entries(next || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") merge(base[k], v);
    else if (v !== undefined) base[k] = v;
  }
  return base;
}

function load() {
  if (cache) return cache;
  try {
    cache = merge(structuredClone(DEFAULTS), JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

export const getSettings = () => load();

export function updateSettings(patch) {
  const next = merge(load(), patch || {});
  cache = next;
  try {
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  } catch {
    /* read-only fs — keep the in-memory copy */
  }
  return next;
}

/** Keys are never returned verbatim — only whether they are set. */
export function publicSettings() {
  const s = load();
  // Only the services this build offers — an old settings file that still holds
  // a retired tracker (AniList) must not put it back in the UI.
  const mask = (group) =>
    Object.fromEntries(
      Object.keys(DEFAULTS[group] || {}).map((k) => [k, { enabled: Boolean(s[group]?.[k]?.enabled), hasKey: Boolean(s[group]?.[k]?.key) }]),
    );
  return {
    profile: s.profile,
    safe: s.safe,
    customLabel: String(s.customLabel ?? DEFAULTS.customLabel).slice(0, 40),
    refresh: { minutes: activeRefreshMinutes() },
    language: s.language || DEFAULTS.language,
    country: String(s.country || DEFAULTS.country).toUpperCase(),
    content: { source: s.content?.source === "tvdb" ? "tvdb" : "tmdb" },
    // The live source is reported as *what is set*, never as the values: a
    // playlist URL can carry a token and a password is a password.
    live: {
      mode: ["dth", "m3u", "xtream"].includes(s.live?.mode) ? s.live.mode : "dth",
      providers: Array.isArray(s.live?.providers) ? s.live.providers : [],
      hasM3u: Boolean(s.live?.m3u),
      hasLogin: Boolean(s.live?.host && s.live?.username),
      hasEpg: Boolean(s.live?.epg),
      refreshMinutes: Number(s.live?.refreshMinutes) || 0,
    },
    providers: mask("providers"),
    tracking: mask("tracking"),
    sources: Array.isArray(s.sources) ? s.sources : [],
    posters: {
      enabled: s.posters?.enabled !== false,
      source: s.posters?.source || "bttr",
      pattern: s.posters?.pattern || DEFAULT_POSTER_PATTERN,
      hasKey: Boolean(s.posters?.apiKey),
    },
    // The AI keys are masked into a `hasKey` map as well — returning `s.ai`
    // verbatim (as this used to) would have shipped every pasted AI key to the
    // browser.
    ai: {
      enabled: s.ai?.enabled !== false,
      provider: s.ai?.provider || "",
      model: s.ai?.model || "",
      pickRow: s.ai?.pickRow === "movie" || s.ai?.pickRow === "series" ? s.ai.pickRow : "",
      hasKey: Object.fromEntries(
        Object.keys(DEFAULTS.ai.keys).map((k) => [k, Boolean(s.ai?.keys?.[k])]),
      ),
      enhanceArtwork: s.ai?.enhanceArtwork !== false,
      enhanceMissing: s.ai?.enhanceMissing !== false,
    },
  };
}

const DEFAULT_POSTER_PATTERN = "https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg";

/** The content language every row is served in. */
export const activeLanguage = () => load().language || process.env.NUVIO_LANGUAGE || "en-US";

/**
 * How often catalogs and metadata are allowed to come back new, in minutes.
 *
 * The known choices are 15 / 30 / 60 / 180, and 0 for "only when you ask" (the
 * app's manual refresh). Anything else falls back to the default, so a hand-edited
 * settings file cannot leave the cache with a nonsense lifetime.
 */
export const activeRefreshMinutes = () => {
  const n = Number(load().refresh?.minutes);
  if (!Number.isFinite(n) || n < 0) return 60;
  return n;
};

/** The country whose services the OTT rows show. */
export const activeCountry = () => String(load().country || process.env.NUVIO_REGION || "US").toUpperCase();

/** The provider asked to supply catalog content ("tmdb" unless TVDB is chosen). */
export const activeContentSource = () => (load().content?.source === "tvdb" ? "tvdb" : "tmdb");

/** The effective TMDB key: the one set in Settings first, then the environment. */
export const tmdbKey = () => load().providers?.tmdb?.key || process.env.TMDB_API_KEY || "";

/** Effective keys for the optional metadata providers (empty when not enabled). */
export const providerKeys = () => {
  const p = load().providers || {};
  const pick = (name) => (p[name]?.enabled ? p[name].key || "" : "");
  return { tvdb: pick("tvdb"), mdblist: pick("mdblist") };
};
