// Nuvio Collections — renderer. Plain web code (no Node APIs), so this exact
// file runs under Electron, a browser, and a Capacitor Android TV build.
//
//   #/profiles                 switch profile — the screen the app starts on
//   #/                         home — hero, then Movies/Shows, then the cards
//   #/c/<key>                  one collection → its catalogs as rows
//   #/x/<key>/<catalogId>      Explore — one catalog, endless scroll + shuffle
//   #/s/<id>/<name>            Sources — providers linked to their source
//   #/calendar                 a real month calendar of releases
//   #/search                   search collections and catalogs
//   #/settings                 settings, organised in sections
//
// Everything the page needs comes from the server:
//   /collections.json                 cards + the catalogs they own
//   /catalog/{type}/{id}.json         a row of titles (better posters + TMDB)
//   /calendar/{type}/{YYYY-MM}.json   a month of releases
//   /api/source                       server-side add-on / plugin lookup
//   /settings (GET/POST)              profile, providers, posters, AI

const API = new URLSearchParams(location.search).get("api") || window.NUVIO_API || "";

// The top bar has no Movies/Shows labels any more — those are buttons on Home.
const TABS = [["home", "Home"]];

const KEY = {
  tab: "nuvio.tab",
  row: "nuvio.row",
  layout: "nuvio.layout",
  safe: "nuvio.safe",
  refresh: "nuvio.refresh",
  sources: "nuvio.sources",
  profile: "nuvio.profile",
  providers: "nuvio.providers",
  tracking: "nuvio.tracking",
  posters: "nuvio.posters",
  ai: "nuvio.ai",
  language: "nuvio.language",
  country: "nuvio.country",
  contentSource: "nuvio.contentSource",
  section: "nuvio.settingsSection",
  accent: "nuvio.accent",
  motion: "nuvio.motion",
  // The resolved accent colours, written for the boot script in `index.html`.
  theme: "nuvio.theme",
  pickCards: "nuvio.pickCards",
  visibility: "nuvio.visibility",
  liveRow: "nuvio.liveRow",
  liveSource: "nuvio.liveSource",
};

const PINNED = /◆ Top 10|◆ Top 25|Airing Today|Airing This Week|On the Air|Now Playing|^Latest|^Newest|^Trending|^Plan to Watch$|^Watching$|^Watched$/;

// The watchlist rows are states, in the order a title moves through them.
const WATCH_STATES = [
  ["planned", "Plan to Watch"],
  ["watching", "Watching"],
  ["watched", "Watched"],
];

// The profiles you can switch between. `Live TV & Sports` is the second one, and
// it is a different app: its own two buttons, its own cards, its own settings.
const LIVE_PROFILE = "Live TV & Sports";
const PROFILES = ["Movies & Shows", LIVE_PROFILE];

// How much of a playlist Live TV & Sports draws: rows for a playlist's biggest
// categories, a cap on the channels inside one row, and the guide's own window.
/** How many channels one read of the channel list asks for. */
const LIVE_CHANNEL_LIMIT = 1500;
const LIVE_GUIDE_CHANNELS = 40;
const LIVE_GUIDE_HOURS = 6;

const LAYOUTS = [
  ["grid", "Icon grid", "Collections as a grid of tiles — best for a TV remote."],
  ["rows", "Single row", "Collections in one horizontal row you scroll."],
];

/**
 * The accent the whole app is painted in.
 *
 * `rgb` is what every translucent gold tint is built from (`rgba(var(--accent-rgb), …)`),
 * so changing one pick re-tints buttons, chips, borders and highlights together
 * instead of leaving half the UI gold. Gold stays the default — it is the app's
 * own colour — but it is no longer the only one.
 */
const ACCENTS = [
  ["gold", "Gold", "200, 169, 106", "#c8a96a", "#a3873f"],
  ["amber", "Amber", "224, 160, 84", "#e0a054", "#b3762c"],
  ["violet", "Violet", "157, 137, 232", "#9d89e8", "#6f5bbf"],
  ["blue", "Blue", "112, 166, 232", "#70a6e8", "#3f74bd"],
  ["teal", "Teal", "90, 200, 186", "#5ac8ba", "#2f978a"],
  ["green", "Green", "123, 200, 132", "#7bc884", "#4e9a58"],
  ["rose", "Rose", "228, 120, 152", "#e47898", "#b04d6b"],
  ["slate", "Slate", "160, 172, 190", "#a0acbe", "#6f7c8e"],
];

const accentOf = (id) => ACCENTS.find(([key]) => key === id) || ACCENTS[0];

/**
 * How much the app moves.
 *
 * "auto" follows the system's reduced-motion preference, "full" always animates,
 * "off" never does. It is one switch, and it covers every transition the app has
 * (view changes, hover lifts, row flashes) so the setting is not a half-truth.
 */
const MOTIONS = [
  ["auto", "Follow system", "Animate, unless this device asks for reduced motion."],
  ["full", "Always animate", "Smooth view transitions and hover motion, whatever the system prefers."],
  ["off", "No animation", "Nothing moves — for slow devices and for people who do not want it."],
];

const PROVIDERS = [
  ["tmdb", "TMDB", "Powers every catalog row and title metadata — pasting a key and enabling it changes the live contents immediately, with the same catalog names."],
  ["tvdb", "TVDB", "Extra series metadata (episode art, air dates)."],
  ["mdblist", "MDBList", "Aggregated ratings — enabling it replaces each title's rating with MDBList's."],
];

/**
 * Tracking services, in two groups.
 *
 * Film & TV first (including the two anime databases, because they track the same
 * shows), then a divider, then the drama trackers — a different catalogue of
 * titles entirely, so it reads as its own group rather than one long list.
 */
/**
 * The trackers, in three groups and in this order.
 *
 * **Movies & TV** first — Trakt, then SIMKL, then Letterboxd — then **Anime**
 * (MyAnimeList, AniList) and then **Asian drama** (MyDramaList), each on its own
 * side of a rule. They were one flat list, which put the anime databases between
 * the film trackers and made "which of these is for what?" a question the screen
 * never answered.
 */
const TRACKER_GROUPS = [
  {
    title: "Movies & TV",
    hint: "Watched history, scrobbling and lists for films and shows.",
    services: [
      ["trakt", "Trakt", "Scrobbling and watched history for films and shows."],
      ["simkl", "SIMKL", "Watched history across films, shows and anime."],
      ["letterboxd", "Letterboxd", "Film diary and lists."],
    ],
  },
  {
    title: "Anime",
    hint: "Anime lists and watched episodes.",
    divider: true,
    services: [
      ["myanimelist", "MyAnimeList", "Anime lists and watched episodes — MAL."],
      ["anilist", "AniList", "Anime and manga lists, with airing progress."],
    ],
  },
  {
    title: "Asian drama",
    hint: "Drama trackers, where the titles are its own catalogue.",
    divider: true,
    services: [
      ["mydramalist", "MyDramaList", "Asian drama lists, ratings and watched episodes — MDL."],
    ],
  },
];

/**
 * Poster services. Each entry is a URL **pattern** — `{imdb_id}` and `{tmdb_id}` are
 * filled in per title.
 *
 * BetterPosters (bttr.cc) needs **no key at all**, which is why the old API-key box
 * is gone: a service whose key really is required carries it *inside its URL*, so
 * the pattern box is the only input this pane needs.
 */
const POSTER_SERVICES = [
  [
    "bttr",
    "BetterPosters · IMDb id",
    "https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg",
    "No key needed. Keyed by IMDb id, so a TMDB title has its IMDb id resolved first — one extra lookup per title.",
  ],
  [
    "rpdb",
    "RPDB (ratingposterdb.com)",
    "https://api.ratingposterdb.com/«your-key»/imdb/poster-default/{imdb_id}.jpg",
    "Put your RPDB key where «your-key» sits — the key belongs in the URL, so there is no separate key box. Save the pattern after editing it.",
  ],
];

const TRACKERS = TRACKER_GROUPS.flatMap((group) => group.services);

// The AI providers whose free tier can back the Ask box. Each one is called by
// the server with the key pasted here — the browser never talks to a provider
// directly, so the key is not readable from the page.
const AI_PROVIDERS = [
  ["groq", "Groq Cloud", "https://console.groq.com/keys", "Free tier with the most generous limits — this is the default."],
  ["google", "Google AI Studio", "https://aistudio.google.com/app/apikey", "Free tier with a daily quota; Gemini models."],
  ["openrouter", "OpenRouter", "https://openrouter.ai/keys", "Free tier — one key reaching many models, including the free ones."],
  ["cerebras", "Cerebras Cloud", "https://cloud.cerebras.ai", "Free tier on wafer-scale hardware."],
];

// Only two kinds of source: a Stremio add-on (one URL, manifests everything) and
// a Nuvio plugin (a repository of scrapers). The Nuvio add-on and CloudStream repo
// entries are gone.
const ADDON_TYPES = [
  ["stremio", "Stremio add-on", "A Stremio add-on URL — its manifest is read for you, so its catalogs, metadata, streams and subtitles all appear as providers."],
];
const PLUGIN_TYPES = [
  ["nuvio-plugin", "Nuvio plugin", "A Nuvio plugin URL — the scrapers it publishes appear as providers."],
];
const SOURCE_TYPES = [...ADDON_TYPES, ...PLUGIN_TYPES];
const typeLabel = (t) => SOURCE_TYPES.find(([v]) => v === t)?.[1] ?? t;

/**
 * Settings, as groups of tabs.
 *
 * It used to be one flat row of ten names in no particular order (Profile,
 * Posters, Providers, Tracking, AI, Content, Add-ons, Plugins, Layout, Server),
 * which hid the two things you actually come here to change: what the catalogs
 * show, and who they are read from. The sections are grouped now, with the group
 * name above its tabs.
 *
 * **One tab, one thing.** Nothing shares a pane with something else: this profile
 * (Profile, Content, Posters), how it looks (Appearance & layout), where its
 * content and its history come from (Trackers & providers, Add-ons & plugins), and
 * the assistant (AI). The **Server** tab is gone.
 */
const SETTINGS_GROUPS = [
  {
    group: "This profile",
    sections: [
      ["profile", "Profile"],
      ["content", "Content"],
      ["posters", "Posters"],
      ["appearance", "Appearance & layout"],
    ],
  },
  {
    group: "Where it comes from",
    sections: [
      ["providers", "Trackers & providers"],
      ["addons", "Add-ons & plugins"],
    ],
  },
  {
    group: "Assistant",
    sections: [["ai", "AI"]],
  },
];

// The flat list, in the order the groups define — this is what "which tab is
// active" and "what does an unknown section fall back to" are answered from.
const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections);

/**
 * The Live TV & Sports profile's own settings — the whole screen, not an extra
 * tab: where the channels come from, where the guide comes from, how often both
 * update. The Movies & Shows sections (Content, Posters, Providers, Tracking, AI,
 * Trackers, AI, Add-ons) do not apply to a live playlist, so they are not offered
 * while that profile is active.
 */
const LIVE_SETTINGS_GROUPS = [
  {
    // The profile's own four first — source, countries, guide, refresh — because
    // they are the only reason this screen is different from the other profile's.
    group: "Live TV & Sports",
    sections: [
      ["livesource", "Source"],
      ["livecountries", "Countries"],
      ["liveguide", "Guide & EPG"],
      ["liverefresh", "Refresh"],
    ],
  },
  {
    group: "Profile & playback",
    sections: [
      ["profile", "Profile"],
      ["appearance", "Appearance & layout"],
    ],
  },
];
const LIVE_SETTINGS_SECTIONS = LIVE_SETTINGS_GROUPS.flatMap((g) => g.sections);
const settingsGroups = () => (liveProfile() ? LIVE_SETTINGS_GROUPS : SETTINGS_GROUPS);
const settingsSections = () => (liveProfile() ? LIVE_SETTINGS_SECTIONS : SETTINGS_SECTIONS);

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const state = {
  tab: "home",
  // The catalog ids the addon's manifest publishes. `null` until it answers, and
  // `rowOf` filters nothing while it is null.
  publishedCatalogs: null,
  row: localStorage.getItem(KEY.row) || "movie", // movie | series
  layout: localStorage.getItem(KEY.layout) || "grid",
  safe: readJSON(KEY.safe, true),
  // How often the screen re-reads itself, in minutes (0 = only when you ask). The
  // addon's own cache follows the same setting server-side.
  refresh: readJSON(KEY.refresh, 60),
  // Bumped by a refresh so a re-read is a new URL for the browser cache too.
  gen: 0,
  profile: localStorage.getItem(KEY.profile) || PROFILES[0],
  profiles: PROFILES,
  // Live TV & Sports: which of its two rows is showing, and the channels, groups
  // and guide the server has answered with.
  liveRow: localStorage.getItem(KEY.liveRow) || "livetv",
  liveSource: readJSON(KEY.liveSource, { mode: "dth", m3u: "", host: "", username: "", password: "", epg: "", providers: [], refreshMinutes: 0 }),
  live: { loading: false, loaded: false, all: [], total: 0, groups: [], rows: [], updated: 0, error: "", guide: null, guideLoading: false, guideError: "" },
  providers: readJSON(KEY.providers, { tmdb: { enabled: true }, tvdb: { enabled: false }, mdblist: { enabled: false } }),
  tracking: readJSON(KEY.tracking, {
    trakt: { enabled: false },
    simkl: { enabled: false },
    myanimelist: { enabled: false },
    anilist: { enabled: false },
    letterboxd: { enabled: false },
    mydramalist: { enabled: false },
  }),
  posters: readJSON(KEY.posters, { enabled: true, pattern: "" }),
  ai: readJSON(KEY.ai, {
    enabled: true,
    provider: "groq",
    model: "",
    hasKey: {},
    enhanceArtwork: true,
    enhanceMissing: true,
    // "Pick for me" — which row the Ask box searches. "" = both.
    pickRow: "",
  }),
  // id → watch state, mirrored from the server so the modal can show the state
  // a title is already pinned in.
  watchlist: {},
  // Every pin, with its state and where it was made — the calendar needs to
  // tell its own plan-to-watch pins apart from the watchlist rows.
  watchItems: [],
  // The custom rows you fill yourself: which row each stored title is in.
  customItems: [],
  // The Custom card's label (a setting — see Settings → Content).
  customLabel: "Custom",
  sources: migrateSources(readJSON(KEY.sources, [])),
  // App language and the country whose services the regional OTT cards show.
  language: localStorage.getItem(KEY.language) || "en-US",
  country: localStorage.getItem(KEY.country) || "US",
  // Which provider supplies the content inside a row: "tmdb" (default) or
  // "tvdb". Row membership is always TMDB's — this picks whose titles, artwork
  // and translations every catalog shows.
  contentSource: localStorage.getItem(KEY.contentSource) || "tmdb",
  // The choices the server offers (languages, countries), and the search screen's
  // filter vocabulary (regions, categories per row type, periods, sorts).
  options: { languages: [], countries: [] },
  searchVocab: null,
  settingsSection: localStorage.getItem(KEY.section) || "profile",
  accent: localStorage.getItem(KEY.accent) || "gold",
  motion: localStorage.getItem(KEY.motion) || "auto",
  // "Pick the cards for you": when it is on, the per-profile visibility below
  // decides which rows, cards and catalog rows this profile shows. Off means every
  // card shows, which is the default so nothing disappears on its own.
  pickCards: readJSON(KEY.pickCards, false),
  // Per profile: rows.movie / rows.series, cards.<key>, catalogs.<id>. A missing
  // entry means "shown", so a card added later is visible without a migration.
  visibility: readJSON(KEY.visibility, {}),
  collections: [],
  order: {},
  calendar: { month: new Date().toISOString().slice(0, 7), day: null },
};

/** A pin is keyed by type *and* id — TMDB numbers films and shows in one space. */
const watchKey = (m) => `${m?.type === "series" ? "series" : "movie"}:${m?.id || ""}`;

/** Only the fields the app draws are pinned. */
const pinOf = (m) => ({
  id: m.id,
  type: m.type,
  name: m.name,
  poster: m.poster,
  background: m.background,
  releaseInfo: m.releaseInfo,
  imdbRating: m.imdbRating,
  description: m.description,
  hasBetterPoster: Boolean(m.hasBetterPoster),
});

/**
 * Sources are **carried over**, not dropped.
 *
 * This build lists two kinds — a Stremio add-on and a Nuvio plugin — and an entry
 * saved under an older kind is translated into the one it really was rather than
 * thrown away: dropping them is what made a stored add-on and its providers vanish
 * from Settings without a word. "nuvio" was a manifest add-on, so it becomes a
 * Stremio add-on; the old CloudStream "repo" becomes a Nuvio plugin.
 */
function migrateSources(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => {
      const type = s?.type === "nuvio" ? "stremio" : s?.type === "repo" ? "nuvio-plugin" : s?.type;
      return s && s.url && SOURCE_TYPES.some(([t]) => t === type) ? { ...s, type } : null;
    })
    .filter(Boolean);
}

function applyWatchlist(payload) {
  const map = {};
  const items = payload?.items || [];
  for (const item of items) map[`${item.type}:${item.id}`] = item.state;
  state.watchlist = map;
  state.watchItems = items;
}

/**
 * The stored rows, as the app reads them.
 *
 * Only the **calendar's** plans use a stored row now: the Watchlist card is the
 * three states and nothing else, and there is no "add cards" row anywhere.
 */
function applyCustomRows(payload) {
  state.customItems = payload?.items || [];
}

const rowKey = () => state.row;
const apiType = () => state.row;
const setRow = (row) => {
  state.row = row;
  localStorage.setItem(KEY.row, row);
};
const cardByKey = (key) => state.collections.find((c) => c.key === key);
/**
 * A card's catalogs **as the addon publishes them**.
 *
 * A card's own list used to be drawn whatever it said, so a stale card list (or an
 * addon that no longer serves a row) left a chip and a row behind for a catalog id
 * that answers 404 — "Anime" and "Asian Drama" were the visible pair. Every read of
 * a card goes through here, so the fix is one place: until the manifest answers,
 * nothing is filtered, and after it does a row the addon does not publish simply
 * is not drawn.
 */
const rowOf = (c) => {
  const r = c[rowKey()] || { cover: "", catalogs: [] };
  const live = state.publishedCatalogs;
  if (!live || !live.size || !r.catalogs.length) return r;
  const catalogs = r.catalogs.filter((cat) => live.has(cat.id));
  return catalogs.length === r.catalogs.length ? r : { ...r, catalogs };
};

/**
 * A card's name **on the row you are looking at**.
 *
 * One card is not the same thing on Movies and on Shows: the Runtimes card holds
 * minutes on one and episode counts on the other, so the addon names each row and
 * the app reads that name. Cards that only have one name fall back to it.
 */
const titleOf = (c, row = rowKey()) => c?.[row]?.title || c?.title || "";

const get = async (path) => {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};

const post = async (path, body) => {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json().catch(() => ({})) : { ok: false, message: `HTTP ${res.status}` };
};

async function pushSettings(patch) {
  try {
    const res = await post("/settings", patch);
    if (res) mergeServerSettings(res);
  } catch {
    /* offline — the local copy still applies */
  }
}

function mergeServerSettings(res) {
  const fold = (group, store, key) => {
    for (const name of Object.keys(store)) {
      const on = group?.[name]?.enabled;
      if (typeof on === "boolean") store[name].enabled = on;
      if (group?.[name]?.hasKey) store[name].hasKey = true;
    }
    writeJSON(key, store);
  };
  if (res.providers) fold(res.providers, state.providers, KEY.providers);
  if (res.tracking) fold(res.tracking, state.tracking, KEY.tracking);
  if (Array.isArray(res.sources)) {
    // The server's copy is the one the player reads, so it wins — but only when it
    // actually holds something. A server that has never seen a source must not wipe
    // the add-ons this device already has; it is told about them instead.
    if (res.sources.length || !state.sources.length) {
      state.sources = migrateSources(res.sources);
      writeJSON(KEY.sources, state.sources);
    } else {
      pushSettings({ sources: state.sources });
    }
  }
  if (res.posters) {
    state.posters = { ...state.posters, ...res.posters };
    writeJSON(KEY.posters, state.posters);
  }
  if (res.ai) {
    state.ai = { ...state.ai, ...res.ai };
    writeJSON(KEY.ai, state.ai);
  }
  if (typeof res.safe === "boolean") {
    state.safe = res.safe;
    writeJSON(KEY.safe, state.safe);
  }
  if (res.refresh && typeof res.refresh.minutes === "number") {
    state.refresh = res.refresh.minutes;
    writeJSON(KEY.refresh, state.refresh);
  }
  if (typeof res.language === "string" && res.language) {
    state.language = res.language;
    localStorage.setItem(KEY.language, state.language);
  }
  if (typeof res.country === "string" && res.country) {
    state.country = res.country;
    localStorage.setItem(KEY.country, state.country);
  }
  if (typeof res.customLabel === "string" && res.customLabel) state.customLabel = res.customLabel;
  if (res.content?.source === "tmdb" || res.content?.source === "tvdb") {
    state.contentSource = res.content.source;
    localStorage.setItem(KEY.contentSource, state.contentSource);
  }
  if (res.options) state.options = res.options;
}

/**
 * What every catalog-ish request carries: the SFW switch and the content
 * language. The language is in the URL so a switch is a different URL for the
 * browser cache as well as for the server's pools.
 */
function catalogQuery() {
  const params = new URLSearchParams();
  if (!state.safe) params.set("adult", "1");
  if (state.language) params.set("lang", state.language);
  // Only present after a refresh: it makes the re-read a different URL, so the
  // browser cannot answer it out of its own copy of the row.
  if (state.gen) params.set("gen", String(state.gen));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Last-resort upscale for a TMDB url (used when a better poster is missing). */
function tmdbUpscale(url) {
  if (!url) return url;
  return url.replace("/w500/", "/w780/").replace("/w780/", "/w1280/").replace("/w185/", "/w500/");
}

/**
 * Move a title between watch states (or off the list when `next` is null) and
 * redraw — both the modal's buttons and the watchlist rows behind it.
 */
async function setWatchState(item, next) {
  const body = next === null ? { item: pinOf(item), remove: true } : { item: pinOf(item), state: next };
  try {
    const res = await post("/watchlist", body);
    if (res && Array.isArray(res.items)) applyWatchlist(res);
  } catch {
    /* offline — the list simply does not change */
  }
  // The watchlist card *is* its contents, so a pin or an unpin redraws it now —
  // unlike every other card, which holds its artwork until the next launch.
  forgetCardArt(watchlistCard());
  refreshPins(item);
}

/**
 * The poster to show. A "better poster" (btttr.cc) is used as-is; anything the
 * poster service could not cover gets the upscale treatment, which is the
 * "apply it to the ones without a better poster" option in AI settings.
 */
function posterOf(m) {
  if (!m) return "";
  if (!state.ai?.enabled || !state.ai?.enhanceArtwork) return m.poster || "";
  if (m.hasBetterPoster) return m.poster || "";           // already the good one
  if (state.ai.enhanceMissing === false) return m.poster || "";
  return tmdbUpscale(m.poster);
}

function backdropOf(m) {
  if (!m) return "";
  const url = m.background || "";
  if (!state.ai?.enabled || !state.ai?.enhanceArtwork) return url;
  return url.replace("/w780/", "/w1280/");
}

/**
 * The banner's picture: a **landscape** backdrop, at the largest size TMDB serves.
 *
 * The banner's frame is 16:9. A 2:3 poster in it is either cropped into a letterbox
 * or blown up until it is blurry, so the banner never uses a poster: it uses the
 * backdrop (shot wide) and asks for `w1280` even when the row was served `w500`,
 * which is what keeps it sharp across a full-width banner.
 */
function heroImage(m) {
  const wide = m?.background || m?.poster || "";
  return wide ? wide.replace(/\/w\d+\//, "/w1280/") : "";
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  // Deep-flatten: panes and rows legitimately return nested arrays of nodes.
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/* ------------------------------------------------------------------- modal */

let modalItem = null;

/** The state a pinned title is in, drawn on its watchlist row card. */
function watchTag(m) {
  const label = WATCH_STATES.find(([id]) => id === m.state)?.[1];
  return label ? el("span", { class: `watch-tag ${m.state}`, text: label }) : null;
}

/* ------------------------------------------------------- the Custom card */

/** The row the **Custom** card publishes — your own list, filled from the modal. */
const CUSTOM_ROW = "add-cards";
const customLabel = () => state.customLabel || "Custom";

/** Is this title already in your custom list? */
const inCustomRow = (m) =>
  state.customItems.some(
    (i) => i.row === CUSTOM_ROW && String(i.id) === String(m?.id) && (i.type === "series") === (m?.type === "series"),
  );

/**
 * Add the title to your custom list, or take it out again.
 *
 * One button that toggles, exactly like the watch states: a mis-click is one click
 * to undo, and the list is read back from the server so the Custom card's row is
 * redrawn with what it now holds.
 */
async function toggleCustomRow(item) {
  try {
    const res = await post("/customrows", { row: CUSTOM_ROW, item: pinOf(item) });
    if (res && Array.isArray(res.items)) applyCustomRows(res);
  } catch {
    /* offline — the list simply does not change */
  }
  if (!refreshPins(item)) render();
}

/**
 * Redraw the pin buttons after a pin, an unpin or a custom-row toggle.
 *
 * They live on the **title page** (`#title-pins`) now, so they are replaced where
 * they stand instead of by reopening a card over the page you are reading. Returns
 * `true` when it found them, so a caller only re-renders a screen that needs it.
 */
function refreshPins(item) {
  const host = document.getElementById("title-pins");
  if (!host) return false;
  host.replaceChildren(...pinButtons(item));
  return true;
}

const modal = {
  root: null,
  open(item, coverUrl) {
    modalItem = item;
    this.root.hidden = false;
    const hero = document.getElementById("modal-hero");
    const art = backdropOf(item) || coverUrl;
    hero.style.backgroundImage = art ? `url("${art}")` : "none";
    document.getElementById("modal-title").textContent = item.name || "";
    document.getElementById("modal-meta").textContent =
      [item.releaseInfo, item.imdbRating ? `★ ${item.imdbRating}` : ""].filter(Boolean).join("  ·  ");
    document.getElementById("modal-desc").textContent = item.description || "";

    // Pin the title to a watch state. Clicking the state it is already in
    // unpins it, so a mis-tap is one click to undo.
    const current = state.watchlist[watchKey(item)] || "";
    const customOn = inCustomRow(item);
    document.getElementById("modal-pins").replaceChildren(
      ...WATCH_STATES.map(([id, label]) =>
        el("button", {
          class: `btn pin focusable${current === id ? " active" : ""}`,
          type: "button",
          id: `pin-${id}`,
          title: current === id ? `Pinned as ${label} — click to unpin` : `Pin as ${label}`,
          "aria-pressed": String(current === id),
          text: current === id ? `${label} · pinned` : label,
          onclick: () => setWatchState(item, current === id ? null : id),
        }),
      ),
      // The Custom card's own row: the one list that is neither a watch state nor
      // a catalog — the titles you put there yourself.
      el("button", {
        class: `btn pin focusable${customOn ? " active" : ""}`,
        type: "button",
        id: "pin-custom",
        title: customOn ? `In ${customLabel()} — click to remove` : `Add to ${customLabel()}`,
        "aria-pressed": String(customOn),
        text: customOn ? `${customLabel()} · added` : `Add to ${customLabel()}`,
        onclick: () => toggleCustomRow(item),
      }),
    );
  },
  close() {
    this.root.hidden = true;
  },
};

/* --------------------------------------------------------------- data rows */

function posterCard(m, opts = {}) {
  const poster = posterOf(m);
  // The calendar mixes films and series in one grid, so it asks for the row type
  // to be drawn on the card.
  const kind = opts.kind ? (m.type === "movie" ? "Movie" : "Series") : "";
  return el(
    // `data-id` lets the checks tell a real duplicate apart from two TMDB
    // titles that share a name.
    "button",
    {
      class: "poster focusable",
      type: "button",
      "data-id": m.id || "",
      // The card page's frame follows the title you point at, so the backdrop it
      // should show travels on the poster itself.
      "data-backdrop": backdropOf(m) || heroImage(m) || "",
      // A poster opens the title's **page**, not a quick-look modal: the page is
      // where the cast, the studio, the franchise, the seasons and the sources are.
      onclick: () => go(`#/t/${m.type === "series" ? "series" : "movie"}/${String(m.id || "").replace(/^tmdb:/, "")}`),
    },
    // A card always shows something. A plan made from the calendar stores only the
    // fields the app draws, and any picture can fail to load — either way the plate
    // used to be left empty, which is the dark rectangle "glitching" on a pin. The
    // title's own initials stand in for it instead.
    poster
      ? el("img", {
          src: poster,
          alt: m.name,
          loading: "lazy",
          onerror: (event) => {
            const img = event.currentTarget;
            if (img && img.parentElement) img.replaceWith(posterFallback(m.name));
          },
        })
      : posterFallback(m.name),
    el(
      "div",
      { class: "poster-cap" },
      el("div", { class: "poster-name", text: m.name }),
      el("div", {
        class: "poster-sub",
        text: [kind, m.releaseInfo, m.imdbRating ? `★ ${m.imdbRating}` : ""].filter(Boolean).join(" · "),
      }),
      opts.watch ? watchTag(m) : null,
    ),
  );
}

/**
 * One window of a catalog row.
 *
 * A watchlist (or calendar) row is your own state, so it is requested with a
 * fresh `_=` every time and the server answers it `no-store`. Without both, the
 * browser serves its cached copy of the row and a title you just unpinned is
 * still on screen — which is exactly what "removing it from the watchlist does
 * not remove it" was.
 */
/** The first letters of a title, drawn when there is no poster to draw. */
const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("") ||
  "?";

const posterFallback = (name) => el("div", { class: "poster-fallback", text: initialsOf(name).toUpperCase() });

async function fetchCatalog(catalog, skip = 0) {
  const suffix = skip ? `/skip=${skip}` : "";
  const stateful = catalog.kind === "watchlist" || catalog.kind === "custom";
  const bust = stateful ? `&_=${Date.now()}` : "";
  return get(`/catalog/${apiType()}/${encodeURIComponent(catalog.id)}${suffix}.json${catalogQuery()}${bust}`);
}

/**
 * What an empty row means depends on the row. A watchlist row is empty because
 * nothing has been pinned yet, not because the catalog failed.
 */
function emptyRowText(catalog) {
  if (catalog.kind === "watchlist") {
    return `${catalog.name} is empty — open a title and pin it as ${catalog.state || "planned"}.`;
  }
  if (catalog.kind === "custom") {
    return `${catalog.name} is empty — open any title and add it to this row.`;
  }
  return "No titles returned for this catalog.";
}

/**
 * Fill a catalog row. The strip is not a fixed window: scrolling it to the end
 * asks the server for the next one, so a row keeps going the way Explore does.
 * (A row used to stop dead after its first window, which is what "this row does
 * not scroll" meant.)
 */
async function fillStrip(strip, catalog) {
  let skip = 0;
  let done = false;
  let busy = false;

  const onScroll = () => {
    if (strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 600) load();
  };

  const load = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const { metas } = await fetchCatalog(catalog, skip);
      if (!skip) strip.replaceChildren();
      if (!metas.length) {
        done = true;
        strip.removeEventListener("scroll", onScroll);
        strip.append(
          el("p", { class: skip ? "empty strip-end" : "empty", text: skip ? "End of catalog." : emptyRowText(catalog) }),
        );
        return;
      }
      for (const m of metas) strip.append(posterCard(m, { watch: catalog.kind === "watchlist" }));
      skip += metas.length;
    } catch (err) {
      done = true;
      strip.removeEventListener("scroll", onScroll);
      if (!skip) {
        strip.replaceChildren(
          el("p", { class: "empty", text: `Could not load “${catalog.name}” — ${err.message}` }),
        );
      }
    } finally {
      busy = false;
    }
  };

  strip.addEventListener("scroll", onScroll, { passive: true });
  await load();
}

function lazyStrip(catalog) {
  const strip = el("div", { class: "strip" });
  for (let i = 0; i < 6; i++) strip.append(el("div", { class: "placeholder" }));
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      fillStrip(strip, catalog);
    }
  }, { rootMargin: "400px" });
  observer.observe(strip);
  return strip;
}

/**
 * A clickable catalog-name chip.
 *
 * Clicking a chip takes you to the row itself: it opens the card and scrolls that
 * catalog's row into view. It used to drop straight into Explore, which skipped
 * the other rows of the collection you were looking at.
 */
/**
 * A drawn icon, in the **SVG namespace**.
 *
 * `el("svg", …)` cannot draw one: `document.createElement` makes an HTML element
 * merely *named* "svg", and its `<path>` children are never rendered. That is why
 * the tag-line arrows came out as empty pills — a filled plate with an invisible
 * mark — and the search funnel and the shuffle mark were missing too. Everything
 * built here is a real SVG node, so every stroked glyph (`.glyph svg`,
 * `.search-glyph svg`) paints.
 */
const SVG_NS = "http://www.w3.org/2000/svg";
function svgNode(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  for (const child of children.flat(Infinity)) if (child) node.append(child);
  return node;
}

/** A drawn chevron, for the show-more control. */
const chevronDown = () =>
  el(
    "span",
    { class: "glyph", "aria-hidden": "true" },
    svgNode("svg", { viewBox: "0 0 24 24" }, svgNode("path", { d: "M6 9l6 6 6-6" })),
  );
const chevronUp = () =>
  el(
    "span",
    { class: "glyph", "aria-hidden": "true" },
    svgNode("svg", { viewBox: "0 0 24 24" }, svgNode("path", { d: "M6 15l6-6 6 6" })),
  );

/** One row of the tag track, measured, so a step is a row and not a guess. */
const trackRow = (track) => {
  const first = track.firstElementChild;
  const height = first?.getBoundingClientRect?.().height || first?.offsetHeight || 26;
  return height + 8;
};

/**
 * A line of chips, held to two rows with **up/down arrows that scroll it**.
 *
 * A card page and the banner carry one chip per catalog, and the big cards hold
 * nearly two hundred tags — a wall of pills that pushes the rows off the screen. So
 * the line is a two-row window: the arrows step it a row at a time (and the wheel
 * over it scrolls it too), each arrow going dim at its own end of the list. A short
 * list gets no control at all. Nothing is expanded in place — the line stays two
 * rows tall however many tags there are.
 */
const CHIP_CLAMP_AT = 8;

function chipLine(children, { className = "cats" } = {}) {
  if (children.length <= CHIP_CLAMP_AT) return el("div", { class: className }, ...children);
  const track = el("div", { class: "chip-track", tabindex: "0" }, ...children);
  const up = el(
    "button",
    { class: "chip-arrow up focusable", type: "button", title: "Scroll the tags up", "aria-label": "Scroll the tags up", onclick: () => step(-1) },
    chevronUp(),
  );
  const down = el(
    "button",
    { class: "chip-arrow down focusable", type: "button", title: "Scroll the tags down", "aria-label": "Scroll the tags down", onclick: () => step(1) },
    chevronDown(),
  );

  function step(direction) {
    track.scrollBy({ top: direction * trackRow(track), behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // Each arrow dims at its own end, so the line says where it is without a label.
  // "At the end" is only claimed when the track can actually be measured: a DOM
  // with no layout (jsdom, a WebView before first paint) reports every height as
  // zero, and the control must stay usable there rather than look finished.
  const sync = () => {
    const measurable = track.scrollHeight > track.clientHeight + 2;
    const hidden = track.scrollHeight - track.clientHeight - track.scrollTop;
    down.disabled = measurable && hidden <= 2;
    up.disabled = measurable && track.scrollTop <= 2;
    down.classList.toggle("at-end", down.disabled);
    up.classList.toggle("at-end", up.disabled);
  };
  track.addEventListener("scroll", sync, { passive: true });
  // Measured once the line is in the document, not before.
  requestAnimationFrame(sync);

  return el(
    "div",
    { class: `${className} chip-block chip-clamped`, title: `${children.length} tags — use the arrows to scroll them` },
    track,
    el("div", { class: "chip-scroll" }, up, down),
  );
}

/**
 * A card's tag.
 *
 * It is a **label**, not a control: the tags on the banner and on a card page name
 * what is inside the card, and turning them into buttons made every tag a hidden
 * door into a catalog nobody meant to open. They are plain text in the app's own
 * pill, so pointing at one does nothing.
 */
function catalogChip(card, cat) {
  return el("button", {
    class: "chip focusable",
    type: "button",
    title: `Go to ${cat.name}`,
    text: cat.name,
    onclick: () => openRow(card.key, cat.id),
  });
}

/**
 * Open a card and bring one of its rows to the top of the screen.
 *
 * The page renders asynchronously (each row fetches its own titles), so the scroll
 * is retried over a few frames until the row exists — and it is a no-op when we are
 * already on that card.
 */
function openRow(key, catalogId) {
  const here = parseHash();
  if (here.view !== "card" || here.key !== key) go(`#/c/${encodeURIComponent(key)}`);
  const find = () => document.querySelector(`.cat-row[data-catalog="${CSS.escape(catalogId)}"]`);
  let tries = 0;
  const jump = () => {
    const node = find();
    if (node) {
      // Guarded: a bare DOM implementation (jsdom, an old WebView) has no
      // scrollIntoView, and jumping is a nicety, not a requirement.
      if (typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start", behavior: "smooth" });
      node.classList.add("row-flash");
      setTimeout(() => node.classList.remove("row-flash"), 1200);
      return;
    }
    if (tries++ < 40) requestAnimationFrame(jump);
  };
  requestAnimationFrame(jump);
}

/* ---------------------------------------------------------------- routing */

function parseHash() {
  const [raw, rawQuery = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const hash = raw;
  const query = new URLSearchParams(rawQuery);
  if (hash.startsWith("c/")) return { view: "card", key: decodeURIComponent(hash.slice(2)) };
  if (hash.startsWith("x/")) {
    const [key, id] = hash.slice(2).split("/");
    return { view: "explore", key: decodeURIComponent(key), id: decodeURIComponent(id || "") };
  }
  if (hash.startsWith("s/")) {
    const [id, name] = hash.slice(2).split("/");
    return { view: "sources", id: decodeURIComponent(id || ""), name: decodeURIComponent(name || "") };
  }
  // A title's own page, and the list behind any name on it (a person, a studio, a
  // genre, a franchise, a season). Both are real routes, so they can be linked to,
  // go Back to, and remember where they were scrolled.
  if (hash.startsWith("t/")) {
    const [type, id] = hash.slice(2).split("/");
    return { view: "title", type: decodeURIComponent(type || "movie"), id: decodeURIComponent(id || "") };
  }
  if (hash.startsWith("l/")) {
    // Three segments, not two: a season's list is `l/season/<show>/<season>`, and
    // reading only two dropped the season number — every season then opened season 1.
    const [kind, id, extra] = hash.slice(2).split("/");
    return {
      view: "list",
      kind: decodeURIComponent(kind || "person"),
      id: decodeURIComponent(id || ""),
      extra: decodeURIComponent(extra || ""),
      type: query.get("type") || "",
    };
  }
  if (hash.startsWith("channel/")) return { view: "channel", id: decodeURIComponent(hash.slice(8)) };
  if (hash === "guide") return { view: "guide" };
  if (hash.startsWith("categories/")) return { view: "category", group: decodeURIComponent(hash.slice(11)) };
  if (hash === "categories") return { view: "categories" };
  if (hash === "profiles") return { view: "profiles" };
  if (hash === "calendar") return { view: "calendar" };
  if (hash === "search") return { view: "search" };
  if (hash === "settings") return { view: "settings" };
  return { view: "home" };
}

const go = (hash) => {
  location.hash = hash;
};

/* ------------------------------------------------------------------ shuffle */

function applyShuffle(key, catalogs) {
  const pinned = catalogs.filter((c) => PINNED.test(c.name));
  const rest = catalogs.filter((c) => !PINNED.test(c.name));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  state.order[key] = [...pinned, ...rest].map((c) => c.id);
}

/* -- what this profile shows ------------------------------------------------- */

/**
 * The visibility of the current profile: which media rows, cards and catalog rows
 * it shows. Missing means shown, so a card or row added in a later version appears
 * without touching what you have already hidden.
 */
function visFor() {
  const key = state.profile || PROFILES[0];
  if (!state.visibility[key]) state.visibility[key] = { rows: { movie: true, series: true }, cards: {}, catalogs: {} };
  const v = state.visibility[key];
  v.rows = v.rows || { movie: true, series: true };
  v.cards = v.cards || {};
  v.catalogs = v.catalogs || {};
  return v;
}

const saveVisibility = () => writeJSON(KEY.visibility, state.visibility);

/** A pick only takes effect when the profile is picking — otherwise all shows. */
const picking = () => state.pickCards === true;
const rowEnabled = (row) => !picking() || visFor().rows[row] !== false;
const cardVisible = (card) => !picking() || visFor().cards[card.key] !== false;
const catalogVisible = (cat) => !picking() || visFor().catalogs[cat.id] !== false;

function orderedCatalogs(card) {
  const catalogs = rowOf(card).catalogs;
  const order = state.order[card.key];
  if (order) {
    const byId = new Map(catalogs.map((c) => [c.id, c]));
    const sorted = order.map((id) => byId.get(id)).filter(Boolean);
    for (const c of catalogs) if (!order.includes(c.id)) sorted.push(c);
    return sorted;
  }
  return catalogs;
}

// A drawn icon, like the rest of the controls — not the ⇄ text glyph.
const shuffleIcon = () =>
  el(
    "span",
    { class: "glyph", "aria-hidden": "true" },
    svgNode(
      "svg",
      { viewBox: "0 0 24 24" },
      svgNode("path", { d: "M4 7h3.2l9.6 10H20" }),
      svgNode("path", { d: "M17 14l3 3-3 3" }),
      svgNode("path", { d: "M4 17h3.2l9.6-10H20" }),
      svgNode("path", { d: "M17 4l3 3-3 3" }),
    ),
  );

/* -------------------------------------------------------------------- views */

/* ---- switch profile ------------------------------------------------------- */

/** Pick a profile and enter the app. */
function chooseProfile(name) {
  state.profile = name;
  localStorage.setItem(KEY.profile, name);
  pushSettings({ profile: name });
  // Each profile's settings are its own: entering Live TV & Sports lands on its
  // Source section, and entering Movies & Shows lands on Content — so the two
  // never share a section that does not exist for them.
  const first = name === LIVE_PROFILE ? "livesource" : SETTINGS_SECTIONS[0][0];
  state.settingsSection = first;
  localStorage.setItem(KEY.section, first);
  location.hash = "#/";
  render();
}

/**
 * A profile's avatar — a drawn mark, not a letter.
 *
 * The two profiles are not people, they are **ways of watching**, so each gets the
 * mark that says which: a clapperboard for Movies & Shows, a screen taking a signal
 * for Live TV & Sports. Anything else falls back to a person, so a profile added
 * later still has one. Drawn with `svgNode`, in the SVG namespace — `el("svg", …)`
 * makes an HTML element that merely has the name, whose paths never paint.
 */
function avatarNode(name) {
  if (name === LIVE_PROFILE) {
    return svgNode(
      "svg",
      { class: "avatar-mark", viewBox: "0 0 48 48", "aria-hidden": "true" },
      svgNode("rect", { x: "8", y: "16", width: "32", height: "21", rx: "3.5" }),
      svgNode("path", { d: "M19 41l-3 4M29 41l3 4" }),
      svgNode("path", { d: "M24 5v5" }),
      svgNode("path", { d: "M18 10a8.5 8.5 0 0 1 12 0" }),
    );
  }
  if (name === PROFILES[0]) {
    return svgNode(
      "svg",
      { class: "avatar-mark", viewBox: "0 0 48 48", "aria-hidden": "true" },
      svgNode("rect", { x: "9", y: "20", width: "30", height: "19", rx: "3" }),
      svgNode("path", { d: "M7 16h34l-2.5-6.5H9.5z" }),
      svgNode("path", { d: "M16 9.5l4.5 6.5M26 9.5l4.5 6.5" }),
    );
  }
  return svgNode(
    "svg",
    { class: "avatar-mark", viewBox: "0 0 48 48", "aria-hidden": "true" },
    svgNode("circle", { cx: "24", cy: "17", r: "7.5" }),
    svgNode("path", { d: "M10 40c0-7.5 6.3-12 14-12s14 4.5 14 12" }),
  );
}

/**
 * The switch-profile screen — the first thing the app shows, as Nuvio does.
 * Pick a profile to enter the app; `#/profiles` reopens it from the top bar.
 */
function renderProfiles() {
  return [
    el(
      "section",
      { class: "profiles" },
      // These are **modes**, not accounts: "Movies & Shows" and "Live TV & Sports"
      // are two ways to use the app, and the screen reads as a mode picker.
      el("p", { class: "hero-kicker", text: "Modes" }),
      el("h1", { class: "view-title", text: "What do you want to watch?" }),
      el("p", { class: "view-hint", text: "Pick a mode to start. Each one keeps its own settings." }),
      el(
        "div",
        { class: "profile-grid" },
        ...PROFILES.map((name) =>
          el(
            "button",
            {
              class: `profile-tile focusable${name === state.profile ? " active" : ""}`,
              type: "button",
              "aria-current": name === state.profile ? "true" : false,
              onclick: () => chooseProfile(name),
            },
            el("span", { class: "avatar", "aria-hidden": "true" }, avatarNode(name)),
            el("span", { class: "profile-tile-name", text: name }),
            el("span", { class: "profile-tile-sub", text: name === state.profile ? "current mode" : "switch to this mode" }),
          ),
        ),
      ),
    ),
  ];
}

/* --------------------------------------- artwork drawn from a card's contents */

/**
 * One draw per app launch.
 *
 * A card's artwork is made of real images of the titles the card actually holds, and
 * which slice of them is drawn is decided once per launch from this value: the
 * pictures stay put while the app runs, and a new launch draws again — the requested
 * "all cards change on app start".
 */
const LAUNCH_SEED = Math.floor(Math.random() * 1e9);

/**
 * Up to `count` images from a card's first visible catalog.
 *
 * The generated cover stays the base layer, so the artwork is never blank — not
 * before the row answers, not without a provider key — and the card's own titles are
 * drawn over it, so the banner and every card show what is inside them. The images
 * come from the catalog endpoint the rows already use; nothing extra is fetched, and
 * a failure just leaves the cover showing.
 */
/** One draw per card per launch: a redraw reuses it instead of asking again. */
const contentDrawn = new Map();

/**
 * Lay pictures into the frame, from this launch's slice of the card.
 *
 * The frame *becomes* the artwork: the generated cover is hidden the moment the
 * pictures arrive (`art-filled` on the frame), so what you see in the banner's inner
 * card and in every card's inner card is the titles themselves — not a vector scene
 * with a strip over it. A `backdrop` strip is the card page's frame, which holds
 * **one landscape shot** of one of the card's titles rather than `count` posters.
 */
function drawTiles(strip, art, count, layout) {
  if (layout === "backdrop") {
    // One wide shot from the card's own titles, picked once per launch. The banner
    // and the card page now read the same way: a landscape frame with a backdrop in
    // it, never a 2:3 poster cropped into a 16:9 hole.
    const shot = art[LAUNCH_SEED % art.length];
    const src = backdropOf(shot) || heroImage(shot) || shot?.poster || "";
    if (!src) return;
    strip.replaceChildren(el("img", { class: "content-tile", src, alt: "", loading: "lazy" }));
  } else {
    const start = art.length > count ? LAUNCH_SEED % (art.length - count + 1) : 0;
    strip.replaceChildren(
      ...art.slice(start, start + count).map((m) =>
        el("img", { class: "content-tile", src: m.poster || m.background, alt: "", loading: "lazy" }),
      ),
    );
  }
  strip.classList.add("filled");
  // `closest` and not `parentElement`: the frame is whichever artwork container
  // the strip ended up in, and it is the frame that hides the generated cover.
  const frame = strip.closest(".icon-wrap, .hero-art, .section-art");
  if (frame) frame.classList.add("art-filled");
}

/**
 * Forget a card's drawn pictures, so the next render asks for them again.
 *
 * The watchlist card is the one card whose contents change while the app runs: pin
 * or unpin a title and its wall of posters is stale the moment you do. Its draw is
 * dropped rather than replayed from the per-launch cache, which is what makes it
 * change *immediately* instead of on the next launch like every other card.
 */
function forgetCardArt(card) {
  if (!card) return;
  for (const key of [...contentDrawn.keys()]) {
    if (key.startsWith(`${card.key}:`)) contentDrawn.delete(key);
  }
}

/** The card whose rows are your own pins. */
const watchlistCard = () =>
  state.collections.find((c) => rowOf(c).catalogs.some((cat) => cat.kind === "watchlist"));

/** Frames waiting for their pictures — filled a few at a time, not all at once. */
const contentJobs = [];
let contentBusy = 0;
const CONTENT_CONCURRENCY = 3;
/** How many of a card's rows one frame will read before it gives up. */
const CONTENT_ROW_TRIES = 3;

function contentStrip(card, row, count, layout) {
  const strip = el("div", {
    class: layout === "backdrop" ? "content-strip backdrop" : "content-strip",
    "aria-hidden": "true",
  });
  // The pictures are asked for **after** the screen is in the document — see
  // `hydrateContent`. A strip built during render has no frame to fill yet, and a
  // lazy observer over a detached node is how a card kept its cover for good.
  // `layout` is how the frame draws what it gets: a wall of posters, or (the card
  // page) one landscape backdrop. It is not part of the cache key — both layouts
  // want the same list of the card's titles.
  strip._job = { card, row, count, layout, key: `${card.key}:${row}` };
  return strip;
}

/**
 * Fill every frame on the screen.
 *
 * Runs once a screen has been drawn, so the frames exist and the pictures have
 * somewhere to land, and it draws from the per-launch cache first — so a redraw
 * (the banner's ten-second move, or coming back to Home) reuses one draw instead
 * of asking again. Three are in flight at a time, so opening Home is not twenty
 * catalog calls at once.
 */
function hydrateContent() {
  for (const strip of document.querySelectorAll(".content-strip")) {
    const job = strip._job;
    if (!job || strip.classList.contains("filled")) continue;
    strip._job = null;
    const cached = contentDrawn.get(job.key);
    if (cached) {
      drawTiles(strip, cached, job.count, job.layout);
      continue;
    }
    const cats = orderedCatalogs(job.card).filter(catalogVisible);
    if (!cats.length) continue;
    contentJobs.push({ strip, job, cats });
  }
  pumpContent();
}

function pumpContent() {
  while (contentBusy < CONTENT_CONCURRENCY && contentJobs.length) {
    const { strip, job, cats } = contentJobs.shift();
    contentBusy++;
    fillFrame(strip, job, cats, 0).finally(() => {
      contentBusy--;
      pumpContent();
    });
  }
}

/**
 * Ask a card's rows for pictures, and stop at the first one that answers.
 *
 * Reading only the **first** row is what kept the Watchlist card empty: its first
 * row is **Watching**, which holds nothing until you start something, while **Plan
 * to Watch** already held titles — so the frame stayed a cover with a full watchlist
 * behind it. The frame now walks on to the next row, bounded by `CONTENT_ROW_TRIES`
 * so a card of a hundred empty rows cannot turn one frame into a hundred requests.
 *
 * A **watchlist** card is the exception: its wall *is* your titles, so it collects
 * every state's posters instead of stopping at the first one that answered.
 */
async function fillFrame(strip, job, cats, from) {
  // The watchlist card's wall **is your watchlist**, so it is read from the
  // watchlist itself rather than from one of its three catalog rows. That is the fix
  // for "the two posters never come": those rows are per media type, so on the
  // Movies row a watchlist of shows answered nothing at all, however full Plan to
  // Watch was.
  if (cats.some((cat) => cat.kind === "watchlist")) {
    const pins = await watchlistArt(job.row);
    if (pins.length) {
      contentDrawn.set(job.key, pins);
      if (strip.isConnected) drawTiles(strip, pins, job.count, job.layout);
      return;
    }
  }
  await collectArt(strip, job, job.row, cats, from, []);
}

/**
 * The posters of your own pins, in the order the card's rows show them.
 *
 * Titles of the row you are on come first — the Movies card is your films. If that
 * row holds none, **every** pin is used instead: an empty frame is a worse answer
 * than a poster from the other row, and it is the one the card kept giving.
 */
async function watchlistArt(row) {
  let payload;
  try {
    // A cache-buster: a pin or an unpin must be visible on the next draw, and this
    // is the one list on the page that changes while the app is open.
    payload = await get(`/watchlist.json?_=${Date.now()}${Math.random().toString(36).slice(2, 7)}`);
  } catch {
    return [];
  }
  const items = (payload?.items || []).filter((i) => i && (i.poster || i.background));
  const forRow = items.filter((i) => (row === "movie" ? i.type === "movie" : i.type === "series"));
  const use = forRow.length ? forRow : items;
  const rank = (i) => (i.state === "watching" ? 0 : i.state === "planned" ? 1 : 2);
  return [...use].sort((a, b) => rank(a) - rank(b));
}

/** Read a card's rows for pictures, drawing each time something arrives. */
async function collectArt(strip, job, media, cats, from, art) {
  // A watchlist card's wall *is* your titles, so it collects every state's posters
  // instead of stopping at the first row that answered.
  const gather = cats.some((cat) => cat.kind === "watchlist");
  const last = Math.min(cats.length, from + CONTENT_ROW_TRIES);
  for (let i = from; i < last; i++) {
    const cat = cats[i];
    // A watchlist (or custom) row is *your* state, not a cached list: it is read
    // with a cache-buster and answered `no-store`, so a card drawn before a pin can
    // never be replayed over it.
    const stateful = cat.kind === "watchlist" || cat.kind === "custom";
    const bust = stateful ? `&_=${Date.now()}${Math.random().toString(36).slice(2, 7)}` : "";
    try {
      const { metas = [] } = await get(`/catalog/${media}/${encodeURIComponent(cat.id)}.json${catalogQuery()}${bust}`);
      const got = metas.filter((m) => m.poster || m.background);
      if (!got.length) continue;
      art.push(...got);
      contentDrawn.set(job.key, art);
      if (strip.isConnected) drawTiles(strip, art, job.count, job.layout);
      if (!gather) return art;
    } catch {
      /* the next row may answer */
    }
  }
  return art;
}

/* ------------------------------------------------------------- hero rotation */

/** How often the banner moves to another card. */
const HERO_ROTATE_MS = 10_000;
let heroTimer = null;
let heroKey = null;
// True while the cursor is over the banner — the rotation holds still then.
let heroHover = false;

/** The cards the banner may show: visible, and actually holding rows. */
const heroCandidates = () => state.collections.filter((c) => cardVisible(c) && rowOf(c).catalogs.length);

/** The card the banner shows — one pick at launch, a new one every ten seconds. */
function heroCard() {
  const cards = heroCandidates();
  if (!cards.length) return null;
  const hit = cards.find((c) => c.key === heroKey);
  if (hit) return hit;
  heroKey = cards[Math.floor(Math.random() * cards.length)].key;
  return cards.find((c) => c.key === heroKey);
}

/* ------------------------------------------- the banner's one picture */

/** The catalog the banner is drawn from: Now Playing on movies, On the Air on shows. */
const HERO_CATALOG = { movie: "Now Playing", series: "On the Air" };

/** Every title the banner may show, from that one catalog, this launch. */
let heroList = [];
/** Which catalog `heroList` came from — the banner never moves off it. */
let heroCatKey = null;
/** The title on screen right now. */
let heroAt = 0;
/** The card the banner is on, so the left-hand labels can be redrawn with it. */
let heroFeatured = null;

/**
 * The row the banner draws from — **Now Playing** for films, **On the Air** for shows.
 *
 * The banner is a billboard for what is out now, so it is not a random card's first
 * row: it is the row that means "this just came out", whichever card happens to own
 * it, and the banner's own labels are that card's.
 */
function heroSource() {
  const want = (HERO_CATALOG[apiType()] || "").toLowerCase();
  if (!want) return null;
  for (const card of state.collections) {
    if (!cardVisible(card)) continue;
    const cat = orderedCatalogs(card).filter(catalogVisible).find((c) => String(c.name || "").toLowerCase() === want);
    if (cat) return { card, cat };
  }
  return null;
}

/**
 * Read the banner's catalog once, then show one title out of it.
 *
 * Cached per launch like every other card's artwork, so the ten-second move is a
 * redraw of one picture and never a new request.
 */
async function loadHeroArt(src, node) {
  const row = apiType();
  if (src) {
    const key = `hero:${row}:${src.cat.id}`;
    if (heroCatKey !== key) {
      heroCatKey = key;
      heroAt = 0;
      heroList = contentDrawn.get(key) || [];
      if (!heroList.length) {
        try {
          const { metas = [] } = await get(`/catalog/${row}/${encodeURIComponent(src.cat.id)}.json${catalogQuery()}`);
          heroList = metas.filter((m) => m.poster || m.background);
          if (heroList.length) {
            contentDrawn.set(key, heroList);
            // A different title each launch, like the cards.
            heroAt = LAUNCH_SEED % heroList.length;
          }
        } catch {
          heroList = [];
        }
      }
    }
  }
  drawHeroTile(node);
}

/** Put the current title's landscape picture in the banner's frame. */
function drawHeroTile(node) {
  // A freshly built banner is not in the document yet, so the caller's node wins
  // when it passes one; the ten-second redraw passes none and uses the page.
  const scope = node || document;
  // The banner shows **its card**: the card's own title, its own tags, and one of
  // its own pictures. So the title is not touched here — `heroBlock` sets it and
  // nothing overwrites it with the name of whatever film happens to be on screen,
  // which is what turned the banner into a title poster with the card's name lost.
  const shot = scope.querySelector(".hero-art .content-strip") || document.querySelector(".hero-art .content-strip");
  if (!shot || !heroList.length) return;
  const m = heroList[heroAt % heroList.length];
  shot.replaceChildren(el("img", { class: "content-tile", src: heroImage(m), alt: "", loading: "eager" }));
  // The same marker a card's strip carries: `filled` means "these are the pictures",
  // and the frame under it is what hides the generated cover.
  shot.classList.add("filled");
  const frame = shot.closest(".hero-art");
  if (frame) frame.classList.add("art-filled");
}

/**
 * Move the banner to another title in the **same** catalog, every ten seconds.
 *
 * The banner used to walk the cards, so its labels and its picture both changed;
 * what it refreshes is one picture from Now Playing (or On the Air), so it keeps its
 * card and its labels and redraws the shot — never the title already on screen.
 */
function startHeroRotation() {
  stopHeroRotation();
  heroTimer = setInterval(() => {
    // The banner is being read — hold it still until the cursor leaves it.
    if (heroHover) return;
    if (heroList.length < 2) return;
    heroAt = (heroAt + 1 + Math.floor(Math.random() * (heroList.length - 1))) % heroList.length;
    drawHeroTile();
  }, HERO_ROTATE_MS);
}

function stopHeroRotation() {
  if (heroTimer) clearInterval(heroTimer);
  heroTimer = null;
}

/* -------------------------------------------------------- catalog refresh */

/**
 * How often the screen re-reads its catalogs and metadata.
 *
 * One setting drives both halves of "update itself": the addon's TMDB cache
 * lifetime is the same interval server-side, and the app re-reads the screen on
 * that clock. A refresh only runs while the app is on screen and on a browsing
 * view, and never over an open title — it cannot interrupt what you are doing.
 */
const REFRESH_CHOICES = [
  [15, "Every 15 minutes"],
  [30, "Every 30 minutes"],
  [60, "Every hour"],
  [180, "Every 3 hours"],
  [0, "Only when you ask"],
];

let refreshTimer = null;

/**
 * Re-read the screen now.
 *
 * `gen` rides on every catalog request, so a refresh is a different URL for the
 * browser cache as well as for the addon — without it the rows would be answered
 * from the copy the page already has and nothing would look refreshed.
 */
function refreshNow() {
  state.gen = Date.now();
  // A refresh re-reads whatever the current screen is made of — including the
  // channel list and the guide, which are catalogs too.
  if (liveProfile()) {
    state.live = { ...state.live, loaded: false, guide: null };
    loadLive({ force: true });
    return;
  }
  render();
}

function startAutoRefresh() {
  stopAutoRefresh();
  const minutes = Number(state.refresh);
  if (!minutes || minutes <= 0) return;
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (document.querySelector("#modal:not([hidden])")) return;
    if (!["home", "card", "explore"].includes(parseHash().view)) return;
    refreshNow();
  }, minutes * 60_000);
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** The hero banner — which card it shows changes at random every ten seconds. */
function heroBlock() {
  const src = heroSource();
  const featured = src?.card || heroCard();
  if (!featured) return null;
  const row = rowOf(featured);
  // Which card the banner is on, so `drawHeroTile` can refresh the left-hand labels
  // with the picture instead of leaving them at whatever the first draw said.
  heroFeatured = featured;
  // The titles, their tags and the cards beside this one read on the **left**; the
  // artwork sits on the **right**, the way the cover is composed. (The two children
  // are in that order here, and the stylesheet only sizes them.) The frame is a
  // **button**: the landscape shot is the way into the title on it — the banner is a
  // thing you open, not a poster on the wall — and it falls back to the collection
  // when the picture has not arrived yet.
  //
  // The frame wears `art-blank` from the start: the *generated vector scene* is the
  // fallback for a card with nothing to draw, and the banner always has a title to
  // draw, so what you see while the backdrop is on its way is the app's own flat
  // panel — never the star-and-constellation cover underneath it.
  const node = el(
    "section",
    { class: "hero" },      el("div",
        { class: "hero-body" },
        el("p", { class: "hero-kicker", text: "Spotlight" }),
        // **The card's own title**, not the name of the film that happens to be on
        // the picture, and not a mix of every other card's labels.
        el("h2", { class: "hero-title", text: featured.title }),
        // Just this card's catalog labels, each one a link into that catalog —
        // clamped to two rows, because a big card carries eighty of them. Nothing
        // else goes on the banner: no Explore button, no other cards' tags.
        chipLine(row.catalogs.map((cat) => catalogChip(featured, cat)), { className: "hero-cats" }),
      ),
    // The banner's artwork is **not a control**: it is the picture the banner wears,
    // and the banner is not the way into anything. It is an inert frame (no button,
    // no click, out of the tab order), not a hidden door.
    el(
      "div",
      { class: "hero-art art-blank", "aria-hidden": "true" },
      el("div", { class: "content-strip", "aria-hidden": "true" }),
    ),
  );
  // Reading the banner is a reason for it to hold still: while the cursor is over
  // it the ten-second rotation freezes, and it picks up again on the way out.
  node.addEventListener("mouseenter", () => { heroHover = true; });
  node.addEventListener("mouseleave", () => { heroHover = false; });
  queueMicrotask(() => loadHeroArt(src, node));
  return node;
}

function iconBox(c, row) {
  const r = rowOf(c);
  const name = titleOf(c, row);
  const count = r.catalogs.length;
  // The two cards that are *your own* lists — the watchlist and the custom card —
  // hold **two** posters: a wider wall of them read as a chart rather than as "what
  // you are watching". Every other card draws four.
  const mine = r.catalogs.some((cat) => cat.kind === "watchlist" || cat.kind === "custom");
  const tiles = mine ? 2 : 4;
  return el(
    "div",
    { class: "icon-box" },
    // The artwork is the button; the card's own pictures are laid over it and never
    // take a click, so entering a card still happens on its artwork alone.
    //
    // `art-blank`: the generated vector scene is not drawn on load. The card is the
    // app's flat panel until its own posters answer, and then it is the posters.
    el(
      "div",
      { class: "icon-wrap art-blank" },
      el(
        "button",
        {
          class: "icon-art focusable",
          type: "button",
          title: `Open ${name}`,
          "aria-label": `Open ${name}`,
          onclick: () => {
            setRow(row);
            go(`#/c/${encodeURIComponent(c.key)}`);
          },
        },
        el("img", { src: r.cover, alt: name, loading: "lazy" }),
      ),
      contentStrip(c, row, tiles),
    ),
    el(
      "span",
      { class: "icon-meta" },
      el("span", { class: "icon-name", text: name }),
      el("span", { class: "icon-sub", text: count ? `${count} catalog${count === 1 ? "" : "s"}` : "cover only" }),
    ),
  );
}

/**
 * Every card, in the published order.
 *
 * Home used to be able to show a random subset ("Pick the cards for you"), which
 * is what made the grid look like it had been rearranged: cards were missing and
 * their order was not the one the covers were designed around. The order is now
 * fixed in `scripts/collections.mjs` and Home shows all of it, always.
 */
function collectionList() {
  // A **hidden** card (the banner's own source, On the Board) is not a tile on
  // Home: its rows are already on the left of the banner.
  return state.collections.filter((c) => !c.hidden && cardVisible(c));
}

/** The collection grid, with the vertical divider before the marked card. */
function collectionGrid(row) {
  const container = el("div", { class: state.layout === "rows" ? "icons rows" : "icons grid" });
  for (const c of collectionList()) {
    if (c.divider) container.append(el("div", { class: "v-divider", "aria-hidden": "true" }));
    container.append(iconBox(c, row));
  }
  return container;
}

/** The Movies / Shows switch that lives under the hero banner. */
function rowSwitch() {
  return el(
    "div",
    { class: "row-switch", role: "tablist", "aria-label": "Movies or Shows" },
    ...[["movie", "Movies"], ["series", "Shows"]].filter(([value]) => rowEnabled(value)).map(([value, label]) =>
      el("button", {
        class: `row-btn focusable${state.row === value ? " active" : ""}`,
        type: "button",
        role: "tab",
        "aria-selected": String(state.row === value),
        text: label,
        onclick: () => {
          setRow(value);
          state.order = {};
          render();
        },
      }),
    ),
  );
}

function renderHome() {
  // If this profile hides the row you were on, land on the one it does show.
  if (!rowEnabled(state.row)) setRow(rowEnabled("movie") ? "movie" : "series");
  // **No heading under the switch.** It used to draw "Movies" or "Shows" on a line
  // of its own, directly under the Movies / Shows buttons that already say exactly
  // that — a second label for the same fact, pushing the grid down for nothing.
  return [heroBlock(), rowSwitch(), collectionGrid(state.row)].filter(Boolean);
}

/** One catalog row on a collection page: label, shuffle, explore. */
/**
 * One catalog row on a collection page: the catalog's name and Explore.
 *
 * There is no shuffle icon beside Explore. A shuffle here could only reorder the
 * rows of the collection — which is what it used to do, and what "shuffle" never
 * meant: the obvious reading is "redraw *this* catalog's titles", and that is what
 * Explore's own Shuffle does. So the rows stay in their published order and the
 * only shuffle lives in Explore, over the titles.
 */
function catalogRow(card, cat) {
  return el(
    "div",
    { class: "cat-row", "data-catalog": cat.id },
    el(
      "header",
      { class: "cat-head" },
      // The row's **title is a label, not a control**: it names what is below it,
      // and the **Explore** button beside it is the way in. Making the title itself
      // a button made every row heading a second, unexpected door.
      el("span", { class: "cat-name static", text: cat.name }),
      el(
        "div",
        { class: "cat-tools" },
        el("button", {
          class: "btn explore focusable",
          type: "button",
          text: "Explore",
          onclick: () => go(`#/x/${encodeURIComponent(card.key)}/${encodeURIComponent(cat.id)}`),
        }),
      ),
    ),
    lazyStrip(cat),
  );
}

/* --------------------------------------------------- the page's own backdrop */

/* The page used to wear the **colours of the title you were on**, as a blurred
   backdrop layer behind the rows. It is gone: it tinted the whole screen as you
   moved the cursor across a grid, which read as the content changing colour rather
   than as a background. A page is now its own flat panel again. */

function renderCard(key) {
  const c = cardByKey(key);
  if (!c) return [el("p", { class: "empty", text: "Collection not found." })];
  const row = rowOf(c);
  // The catalogs this profile shows: a hidden row is not drawn here either, so the
  // card reads exactly as Home does (and the chip line cannot link to it).
  const catalogs = orderedCatalogs(c).filter(catalogVisible);

  // Name and tags first, the artwork card second — the same reading order as the
  // banner — and the frame holds **one landscape backdrop** from the card's own
  // titles (see `drawTiles`), not the wall of posters a Home card draws.
  // There is **no artwork frame in the header any more**: the card page is its
  // rows, and the artwork is the page's own background (see `setPageBackdrop`),
  // brought up by pointing at a title. The header is the name and its tags.
  const wrapper = el(
    "section",
    { class: "section" },
    el(
      "header",
      { class: "section-head" },
      el(
        "div",
        { class: "section-meta" },
        el("h2", { text: titleOf(c) }),
        chipLine(row.catalogs.filter(catalogVisible).map((cat) => catalogChip(c, cat))),
      ),
    ),
  );


  if (catalogs.length) {
    for (const cat of catalogs) {
      // A row marked `divider` gets a horizontal rule above it (the Watchlist's
      // Watching → Plan to Watch boundary).
      if (cat.divider) wrapper.append(el("div", { class: "h-divider", "aria-hidden": "true" }));
      wrapper.append(catalogRow(c, cat));
    }
  } else {
    wrapper.append(el("p", { class: "empty", text: "This collection is cover art only — it has no catalogs yet." }));
  }
  return [wrapper];
}

/**
 * The sample row at the top of an Explore page.
 *
 * It is a plain row — no label, no control of its own — so it reads like the
 * catalog below it rather than like a numbered "Shuffle 1/2/3" list. The one
 * Shuffle button in the header redraws all three (that is what `reload` is for).
 */
function shuffleRow(cat) {
  const strip = el("div", { class: "strip" });
  const load = async () => {
    strip.replaceChildren(...Array.from({ length: 5 }, () => el("div", { class: "placeholder" })));
    try {
      // The `_` is a fresh number per draw, and the server answers a shuffle with
      // no-store. Without it this URL is byte-identical every time, the browser
      // serves its cached copy, and Shuffle looks like a button that does nothing.
      const { metas } = await get(
        `/catalog/${apiType()}/${encodeURIComponent(cat.id)}/shuffle=12.json${catalogQuery()}&_=${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      );
      strip.replaceChildren();
      if (!metas.length) {
        strip.append(el("p", { class: "empty", text: "Nothing to shuffle in this catalog yet." }));
        return;
      }
      for (const m of metas) strip.append(posterCard(m));
    } catch (err) {
      strip.replaceChildren(el("p", { class: "empty", text: `Could not shuffle — ${err.message}` }));
    }
  };
  queueMicrotask(load);

  return { node: el("div", { class: "cat-row shuffle-row" }, strip), reload: load };
}

/**
 * Explore: one catalog, scrolling endlessly, with a shuffle.
 * The header shows only the card label and the catalog label.
 */
function renderExplore(key, id) {
  const card = cardByKey(key);
  if (!card) return [el("p", { class: "empty", text: "Collection not found." })];
  const catalogs = rowOf(card).catalogs;
  const cat = catalogs.find((x) => x.id === id);
  if (!cat) return [el("p", { class: "empty", text: "Catalog not found." })];

  const grid = el("div", { class: "grid-titles" });
  const sentinel = el("div", { class: "sentinel" });
  const catMenu = el("div", { class: "cat-menu", hidden: true });
  // The chosen letter's own line: what is being shown, and the way back.
  const filterBar = el("div", { class: "explore-filter", hidden: true });

  const openMenu = () => {
    catMenu.replaceChildren(
      ...catalogs.filter(catalogVisible).map((c) =>
        el("button", {
          class: `menu-item focusable${c.id === cat.id ? " active" : ""}`,
          type: "button",
          text: c.name,
          onclick: () => {
            catMenu.hidden = true;
            go(`#/x/${encodeURIComponent(card.key)}/${encodeURIComponent(c.id)}`);
          },
        }),
      ),
    );
  };

  // The single sample row the header's Shuffle redraws.
  const samples = [];

  // A watchlist (or calendar) catalog holds *your* titles, in your order and in
  // full. There is nothing to draw a random sample from and nothing to shuffle, so
  // Explore for those rows is just the header and the list — no Shuffle, no sample
  // row, no divider.
  const stateful = cat.kind === "watchlist" || cat.kind === "custom";
  // The Discover cards publish their titles in published order, so the sample row on
  // top of their Explore page is noise in front of the catalog — they get no shuffle
  // row, and the Shuffle button that drives it goes with it.
  // The Discover cards and the banner's own rows (Now Playing / Airing Today /
  // Airing This Week / On the Air) get **no shuffle row and no Shuffle button**:
  // there is nothing to sample that the row itself does not already show.
  // The **For You** rows are named after the titles you watch (`More Like …`), so a
  // random sample on top would be a second, unlabelled copy of the same row — no
  // shuffle row, no Shuffle button.
  const sampled =
    !stateful &&
    !String(card.key).startsWith("discover") &&
    card.key !== "on-the-board" &&
    card.key !== "for-you";

  const head = el(
    "header",
    { class: `explore-head${stateful ? " stateful" : ""}` },
    el("button", {
      class: "crumb focusable",
      type: "button",
      title: `Back to ${titleOf(card)}`,
      text: titleOf(card),
      onclick: () => go(`#/c/${encodeURIComponent(card.key)}`),
    }),
    el("span", { class: "crumb-sep", "aria-hidden": "true", text: "›" }),
    el("button", {
      class: "crumb current focusable",
      type: "button",
      title: "Switch catalog",
      text: cat.name,
      onclick: () => {
        openMenu();
        catMenu.hidden = !catMenu.hidden;
      },
    }),
    sampled
      ? el(
          "div",
          { class: "cat-tools" },
          el("button", {
            class: "btn subtle focusable",
            type: "button",
            id: "shuffle-samples",
            title: "Shuffle — draw a fresh sample",
            onclick: () => samples.forEach((row) => row.reload()),
          }, shuffleIcon(), el("span", { text: " Shuffle" })),
        )
      : null,
    // The catalog switcher lives **in the header**, so it drops from the crumb it
    // belongs to instead of floating into the grid.
    catMenu,
  );

  // Endless scroll: keep paging until the catalog is exhausted.
  let skip = 0;
  let done = false;
  let busy = false;
  let pages = 0;
  const MAX_PAGES = 40;

  /** Every title the row has handed over, in order, and whether it was already
   *  counted. The rail indexes this list; the grid draws the part of it the chosen
   *  letter covers. */
  const loaded = [];
  const seenIds = new Set();
  let letterFilter = null;
  const letterOf = (name) => String(name || "").trim().charAt(0).toUpperCase();
  const passes = (m) => !letterFilter || letterOf(m.name) === letterFilter;

  const loadMore = async () => {
    if (busy || done) return;
    // Stop when the cap is reached instead of re-observing forever: a catalog that
    // never runs out would otherwise keep the sentinel in view and ask the server
    // for the next window for the rest of the session.
    if (pages >= MAX_PAGES) {
      done = true;
      observer.disconnect();
      sentinel.replaceChildren(
        el("p", { class: "view-hint inline", text: `Showing the first ${MAX_PAGES} pages of this catalog.` }),
      );
      return;
    }
    busy = true;
    try {
      const { metas } = await fetchCatalog(cat, skip);
      for (const m of metas) {
        const id = `${m.type || apiType()}:${m.id}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        loaded.push(m);
        // A letter is being shown: only its titles reach the grid, and the rest
        // stay in `loaded` for when the letter is cleared.
        if (passes(m)) grid.append(posterCard(m));
      }
      skip += metas.length;
      pages++;
      // The rail is an index of what is actually loaded, so it grows with the row.
      refreshRail();
      if (!metas.length) {
        done = true;
        observer.disconnect();
        sentinel.replaceChildren(
          el("p", {
            class: "view-hint inline",
            text: letterFilter ? `No more titles starting with ${letterFilter} in this catalog.` : "End of catalog.",
          }),
        );
      }
    } catch (err) {
      done = true;
      observer.disconnect();
      sentinel.replaceChildren(el("p", { class: "empty", text: `Could not load — ${err.message}` }));
    }
    busy = false;
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      loadMore().then(() => {
        // Re-observe so the next page loads while the sentinel is still in view.
        if (!done) {
          observer.disconnect();
          observer.observe(sentinel);
        }
      });
    }
  }, { rootMargin: "600px" });

  // ONE random sample on top, then a horizontal rule, then the normal endlessly
  // scrolling catalog — for a catalog that can be sampled at all.
  if (sampled) samples.push(shuffleRow(cat));
  const shuffles = sampled ? el("div", { class: "explore-shuffles" }, ...samples.map((row) => row.node)) : null;
  const rule = sampled ? el("div", { class: "h-divider", "aria-hidden": "true" }) : null;

  /* The alphabet rail — the **titles in this row**, by first letter.
   *
   * It is an index of the contents, not of the card's tags: a letter with titles
   * under it jumps straight to the first one (and greys out when the titles loaded
   * so far have nothing under it). The row loads page after page, so the rail is
   * refreshed as each page lands — a letter cannot be "empty" for a title that has
   * not arrived yet, it is simply not offered until it has.
   *
   * It is laid out *in the grid's own row* (`.explore-body`): a column in the right
   * gutter whose letters sit level with the poster columns, and `sticky` so it
   * rides down under the header as the row grows. It used to be `position: fixed`
   * at the middle of the viewport, which dropped it over the sample row at the top
   * of the page instead of beside the posters. */
  const alphaRail = el("nav", { class: "alpha-rail", "aria-label": "Titles by first letter" });
  const railIndex = new Map();
  const refreshRail = () => {
    railIndex.clear();
    for (const m of loaded) {
      const letter = letterOf(m.name);
      if (letter && !railIndex.has(letter)) railIndex.set(letter, m);
    }
    alphaRail.replaceChildren(
      ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map((letter) => {
        const has = railIndex.has(letter);
        const chosen = letterFilter === letter;
        const what = chosen
          ? `Showing only the titles starting with ${letter} — pick it again for all of them`
          : has
            ? `Show only the titles starting with ${letter}`
            : `Load and show the titles starting with ${letter}`;
        return el(
          "button",
          {
            class: `alpha focusable${has ? "" : " off"}${chosen ? " on" : ""}`,
            type: "button",
            text: letter,
            title: what,
            "aria-label": what,
            "aria-pressed": String(chosen),
            onclick: () => pickLetter(letter),
          },
        );
      }),
    );
  };

  /** Draw the grid from whatever the chosen letter covers. */
  const paintGrid = () => grid.replaceChildren(...loaded.filter(passes).map((m) => posterCard(m)));

  const updateFilterBar = () => {
    filterBar.hidden = !letterFilter;
    if (!letterFilter) return;
    filterBar.replaceChildren(
      el("span", { class: "explore-filter-text", text: `Titles starting with ${letterFilter}` }),
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Show all",
        onclick: () => pickLetter(letterFilter),
      }),
    );
  };

  /**
   * Pick a letter: Explore shows that letter's titles and nothing else.
   *
   * The grid is filtered to them, and the row is paged in as far as it takes to
   * fill the letter out — a letter the first page never mentioned still has its
   * titles, they are simply further down the catalog. Picking the same letter
   * again puts everything back.
   */
  const pickLetter = async (letter) => {
    letterFilter = letterFilter === letter ? null : letter;
    paintGrid();
    updateFilterBar();
    refreshRail();
    if (!letterFilter) return;
    const first = grid.firstElementChild;
    if (first && typeof first.scrollIntoView === "function") {
      first.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    // Page the row in **as far as it goes**: a letter's titles are scattered through
    // the whole catalog, and stopping as soon as twenty of them had turned up is what
    // made "A" look like it only held twenty Action films. The letter fills out until
    // the catalog runs out, with only a generous ceiling so a huge row cannot spin.
    for (let i = 0; i < 60; i += 1) {
      if (done) break;
      if (grid.children.length >= 400) break;
      const before = pages;
      await loadMore();
      if (pages === before) break;
      refreshRail();
    }
  };
  refreshRail();

  const body = el(
    "section",
    { class: "section explore" },
    head,
    shuffles,
    rule,
    el(
      "div",
      { class: "explore-body" },
      el("div", { class: "explore-grid" }, filterBar, grid, sentinel),
      alphaRail,
    ),
  );
  // The catalog's own rows move the page's backdrop; the shuffle rows do not.

  // Kick off the first page once the section is in the document.
  queueMicrotask(() => {
    loadMore().then(() => {
      if (!done) observer.observe(sentinel);
    });
  });
  return [body];
}

/* ------------------------------------------------------------------- search */

function allCatalogs() {
  const out = [];
  for (const c of state.collections) for (const cat of rowOf(c).catalogs) out.push({ card: c, cat });
  return out;
}

// A drawn funnel, like the rest of the controls.
const filterIcon = () =>
  el(
    "span",
    { class: "glyph", "aria-hidden": "true" },
    svgNode(
      "svg",
      { viewBox: "0 0 24 24" },
      svgNode("path", { d: "M3 5h18" }),
      svgNode("path", { d: "M6 12h12" }),
      svgNode("path", { d: "M10 19h4" }),
    ),
  );

/** The query string of the search screen, which *is* its state. */
function searchParams() {
  const hash = location.hash;
  const at = hash.indexOf("?");
  return new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
}

/** Used only if the server predates the vocabulary route, so the panel still works. */
const SEARCH_FALLBACK = {
  types: [["", "All"], ["series", "TV Series"], ["movie", "Movie"]],
  continents: [["all", "All continents"]],
  countries: [["all", "All countries"]],
  providers: [["all", "All services"]],
  moods: [["all", "All moods"]],
  themes: [["all", "All themes"]],
  categories: { movie: [], series: [] },
  periods: [["all", "All Time Periods"], ["before", "Before"]],
  sorts: [["popularity", "Popularity"], ["recent", "Recent"], ["rating", "High Rating"]],
};

/** One labelled row of filter chips. */
/**
 * One filter line: a label and its choices.
 *
 * A line with more choices than two rows can hold (Country has every country with
 * titles, Theme has every theme row) is clamped to two rows with the same chevron
 * the card tags use — unless the choice you already made is buried under the fold,
 * in which case the line opens so you can see it. Short lines get no control at all.
 */
const FILTER_CLAMP_AT = 12;

function filterRow(label, choices, active, onPick, { clamp = false } = {}) {
  const chips = choices.map(([value, text]) =>
    el("button", {
      class: `filter-chip focusable${value === active ? " active" : ""}`,
      type: "button",
      text,
      "aria-pressed": String(value === active),
      onclick: () => onPick(value),
    }),
  );
  const long = clamp && choices.length > FILTER_CLAMP_AT;
  if (!long) {
    return el(
      "div",
      { class: "filter-row" },
      el("span", { class: "filter-label", text: label }),
      el("div", { class: "filter-body" }, el("div", { class: "filter-options" }, ...chips)),
    );
  }
  // **The same control the card tag lines use**: a two-row window with up and down
  // arrows that step it a row at a time (and the wheel working over it). It used to
  // be a "More (N)" pill that expanded the line in place, which turned one filter
  // into a wall of chips and pushed every line under it off the screen.
  const options = el("div", { class: "filter-options clamped", tabindex: "0" }, ...chips);
  // A DOM with no layout (jsdom, a WebView before first paint) has no `scrollBy`, so
  // the arrows stay usable there instead of throwing on the first press.
  const step = (direction) => {
    if (typeof options.scrollBy !== "function") return;
    options.scrollBy({ top: direction * trackRow(options), behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const up = el(
    "button",
    { class: "chip-arrow up focusable", type: "button", title: `Scroll ${label} up`, "aria-label": `Scroll ${label} up`, onclick: () => step(-1) },
    chevronUp(),
  );
  const down = el(
    "button",
    { class: "chip-arrow down focusable", type: "button", title: `Scroll ${label} down`, "aria-label": `Scroll ${label} down`, onclick: () => step(1) },
    chevronDown(),
  );
  // Each arrow dims at its own end, and "at the end" is only claimed once the track
  // can be measured, so a DOM with no layout keeps both arrows usable.
  const sync = () => {
    const measurable = options.scrollHeight > options.clientHeight + 2;
    const hidden = options.scrollHeight - options.clientHeight - options.scrollTop;
    down.disabled = measurable && hidden <= 2;
    up.disabled = measurable && options.scrollTop <= 2;
    down.classList.toggle("at-end", down.disabled);
    up.classList.toggle("at-end", up.disabled);
  };
  options.addEventListener("scroll", sync, { passive: true });
  requestAnimationFrame(() => {
    sync();
    // The chip you already picked is always on screen, however far down the list it is.
    const chosen = options.querySelector(".filter-chip.active");
    if (chosen && typeof chosen.scrollIntoView === "function") chosen.scrollIntoView({ block: "nearest" });
  });
  return el(
    "div",
    { class: "filter-row" },
    el("span", { class: "filter-label", text: label }),
    el("div", { class: "filter-body" }, options, el("div", { class: "chip-scroll" }, up, down)),
  );
}

/**
 * The search screen.
 *
 * The bar is wide, carries the filter control on its left, and suggests as you
 * type: collections and catalogs from the cards this row already has, plus titles
 * from TMDB. The filters are the screen's state — they live in the URL, so a
 * filtered browse is shareable and the Back button undoes a filter.
 */
function renderSearch() {
  const params = searchParams();
  const query = params.get("q") || "";
  // Where it is from (Country), what it is (Genre), when it is (Time), and how it
  // is ordered (Sort). **Continent, OTT, Mood and Theme are gone**: a country
  // already narrows the same ground a continent does, a mood is a genre under
  // another name, and a service filter only means something once you have said
  // where you are — four more lines of chips to scroll past for an answer the
  // three under them already give.
  const filters = {
    type: params.get("type") || "",
    country: params.get("country") || "all",
    category: params.get("category") || "all",
    period: params.get("period") || "all",
    sort: params.get("sort") || "popularity",
  };
  const FILTER_KEYS = ["country", "category", "period"];
  const vocab = state.searchVocab || SEARCH_FALLBACK;

  // No `text-input` here: that class paints a bordered box, and inside the bar's own
  // panel it drew a second border around the placeholder.
  const input = el("input", {
    class: "search-input focusable",
    type: "search",
    placeholder: "Search titles…",
    value: query,
    id: "search-input",
    autocomplete: "off",
  });

  // Titles come from TMDB through the server. This is what the Ask box feeds:
  // "a lonely detective in the rain" only means something if search can find
  // *titles*, not just collection names.
  const titles = el("div", { class: "search-titles", id: "search-titles" });
  const suggestions = el("div", { class: "search-suggest", id: "search-suggest", hidden: true });
  let timer = null;

  const suggestRow = (kind, label, onclick) =>
    el(
      "button",
      { class: "suggest-item focusable", type: "button", onclick },
      el("span", { class: "suggest-kind", text: kind }),
      el("span", { class: "suggest-text", text: label }),
    );

  /**
   * The dropdown suggests **titles, and only titles**.
   *
   * It used to lead with matching Collections and Catalogs, so typing "home" showed
   * a `Catalog — Homeless — Themes & Tags` line above any film — the reported "why
   * is search showing this in place of contents". The box now suggests the titles
   * themselves, which is what searching for a film means.
   */
  const drawSuggestions = (_text, metas = []) => {
    const nodes = metas.slice(0, 6).map((m) => suggestRow("Title", m.name, () => go(`#/t/${m.type === "series" ? "series" : "movie"}/${String(m.id || "").replace(/^tmdb:/, "")}`)));
    // The way **into** the results: the dropdown is what you get while typing, and
    // the wall of posters is what you get when you ask for it.
    const text = String(_text || "").trim();
    if (text) {
      nodes.push(
        el(
          "button",
          { class: "suggest-item suggest-more focusable", type: "button", onclick: () => submitNow(_text) },
          el("span", { class: "suggest-kind", text: "All" }),
          el("span", { class: "suggest-text", text: `More results for \u201c${text}\u201d` }),
        ),
      );
    }
    suggestions.replaceChildren(...nodes);
    suggestions.hidden = !nodes.length;
  };

  /** Run the search: the way out of the dropdown, and what Enter does. */
  const submitNow = (text) => {
    const p = new URLSearchParams(resultQuery());
    const value = String(text ?? input.value ?? "").trim();
    if (value) p.set("q", value);
    else p.delete("q");
    suggestions.hidden = true;
    go(`#/search?${p.toString()}`);
  };

  const resultQuery = () => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (filters.type) p.set("type", filters.type);
    for (const key of FILTER_KEYS) if (filters[key] !== "all") p.set(key, filters[key]);
    if (filters.sort !== "popularity") p.set("sort", filters.sort);
    if (!state.safe) p.set("adult", "1");
    return p.toString();
  };

  /* Results keep going instead of stopping at a number.

     A result window is a few TMDB pages of each row type, the same depth a catalog
     row is read at; **Load more results** asks the server for the next window and
     appends it. There is no ceiling — the button stays until the server says there
     is nothing left to ask for.

     Which page the next window starts at is the **server's** answer, not the app's
     arithmetic: the server stops reading a row type early when TMDB returns a short
     page, so "six pages further on" could step straight past the end and make the
     button look dead. `next` is the page to continue from, and it is null at the
     end. */
  let searchStart = 0;
  let searchBusy = false;
  const searchSeen = new Set();
  const groups = { movie: null, show: null };

  // Movies and shows are two lists, not one mixed grid: the row type is the first
  // thing you want to know about a result, and a name that exists as a film *and*
  // a series is two different answers.
  const groupNode = (key) => {
    if (groups[key]) return groups[key];
    const node = el(
      "section",
      { class: "search-group" },
      el("h3", { class: "result-head", text: key === "movie" ? "Movies" : "Shows" }),
      el("div", { class: "grid-titles" }),
    );
    groups[key] = node;
    return node;
  };

  // **The results page themselves in.** A window is six TMDB pages per row type —
  // 120 titles — and there used to be a *Load more results* button for the next
  // one, so a search looked like it had stopped at 120 whatever the catalogue
  // really held. The sentinel at the foot of the list does what Explore's does:
  // when it comes into view the next window is read and appended, and the count
  // beside each group climbs until TMDB has nothing left to hand over.
  const moreSentinel = el("div", { class: "sentinel", id: "search-sentinel" });
  let searchDone = true;
  let searchObserver = null;

  const appendMetas = (metas) => {
    for (const m of metas) {
      const key = m.type === "movie" ? "movie" : "show";
      const id = `${key}:${m.id}`;
      if (searchSeen.has(id)) continue;
      searchSeen.add(id);
      const node = groupNode(key);
      node.querySelector(".grid-titles").append(posterCard(m));
      const label = key === "movie" ? "Movies" : "Shows";
      node.querySelector(".result-head").textContent = `${label} (${node.querySelectorAll(".poster").length})`;
      // Always in front of the sentinel, even when this group is new.
      if (!node.isConnected) titles.insertBefore(node, moreSentinel.isConnected ? moreSentinel : null);
    }
  };

  // One observer for the screen, watching the sentinel; a redraw builds a new one,
  // and the old sentinel is out of the document by then so it can never fire.
  const watchSentinel = () => {
    if (searchObserver || typeof IntersectionObserver !== "function") return;
    searchObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      if (searchBusy || searchDone) return;
      loadTitles(query, true);
    }, { rootMargin: "600px" });
    searchObserver.observe(moreSentinel);
  };

  const loadTitles = async (text, more = false, { grid = true } = {}) => {
    const trimmed = (text || "").trim();
    if (!more) {
      searchStart = 0;
      searchSeen.clear();
      groups.movie = null;
      groups.show = null;
      searchDone = true;
      titles.replaceChildren();
    }
    // **While you type, the dropdown is the only thing on screen.** The results grid
    // used to be drawn from the same keystroke, so a handful of suggested titles sat
    // on top of a wall of posters for a search that had not been run yet.
    if (!resultQuery() || !grid) {
      searchDone = true;
      if (!grid && trimmed) {
        try {
          const p = new URLSearchParams(resultQuery());
          p.set("q", trimmed);
          const { metas = [] } = await get(`/search.json?${p.toString()}`);
          drawSuggestions(trimmed, metas);
        } catch {
          drawSuggestions(trimmed);
        }
      } else {
        drawSuggestions(trimmed);
      }
      return;
    }
    if (searchBusy) return;
    searchBusy = true;
    if (!more) titles.replaceChildren(el("p", { class: "view-hint", text: "Searching titles…" }));
    try {
      const p = new URLSearchParams(resultQuery());
      if (searchStart > 0) p.set("start", String(searchStart));
      const { metas = [], next = null } = await get(`/search.json?${p.toString()}`);
      if (!more) {
        titles.replaceChildren();
        drawSuggestions(trimmed, metas);
        if (!metas.length) {
          titles.append(el("p", { class: "view-hint", text: "Nothing matched. Try fewer filters, or a different region." }));
          searchDone = true;
          return;
        }
      }
      appendMetas(metas);
      // `next` is the server's own cursor: the page to continue from, or null once
      // it has read past the end of every row type.
      searchStart = typeof next === "number" && next > 0 ? next : 0;
      searchDone = !metas.length || typeof next !== "number";
      if (!searchDone && !moreSentinel.isConnected) titles.append(moreSentinel);
      watchSentinel();
    } catch {
      if (!more) titles.replaceChildren();
      searchDone = true;
    } finally {
      searchBusy = false;
    }
  };

  const refresh = (value) => {
    clearTimeout(timer);
    // Typing clears the results and shows the dropdown again; the grid comes back
    // when you ask for it (Enter, or "More results" in the dropdown).
    titles.replaceChildren();
    suggestions.hidden = false;
    timer = setTimeout(() => loadTitles(value, false, { grid: false }), 250);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      suggestions.hidden = true;
      return;
    }
    if (e.key === "Enter") submitNow(input.value);
  });
  input.addEventListener("input", () => refresh(input.value));

  // Changing a filter keeps the text you have typed and re-reads the row from the
  // server — this is a new URL, so it is also a new request and a new history entry.
  const pick = (name, value) => {
    const p = new URLSearchParams(resultQuery());
    const next = { ...filters, [name]: value };
    for (const key of [...FILTER_KEYS, "sort"]) {
      if (next[key] && next[key] !== "all" && !(key === "sort" && next[key] === "popularity")) p.set(key, next[key]);
      else p.delete(key);
    }
    if (next.type) p.set("type", next.type);
    else p.delete("type");
    // Whatever is in the box right now, not what the URL was rendered from.
    const text = document.getElementById("search-input")?.value ?? query;
    if (text.trim()) p.set("q", text.trim());
    go(`#/search?${p.toString()}`);
  };

  // Categories are per row type — TV has no Romance, Horror or Thriller — so with
  // no type chosen only the categories both rows have are offered, rather than a
  // list that would empty one of the two rows.
  const categoryList = filters.type
    ? vocab.categories?.[filters.type] || []
    : (vocab.categories?.movie || []).filter((c) => (vocab.categories?.series || []).includes(c));

  const panel = el(
    "section",
    { class: "search-filters", id: "search-filters", hidden: !filtersActive(filters) },
    filterRow("Type", vocab.types, filters.type, (v) => pick("type", v)),
    filterRow("Country", vocab.countries, filters.country, (v) => pick("country", v), { clamp: true }),
    categoryList.length
      ? filterRow(
          "Genre",
          [["all", "All Genres"], ...categoryList.map((c) => [c, c])],
          filters.category,
          (v) => pick("category", v),
          { clamp: true },
        )
      : null,
    filterRow("Time", vocab.periods, filters.period, (v) => pick("period", v)),
    filterRow("Sort", vocab.sorts, filters.sort, (v) => pick("sort", v)),
  );

  const filterBtn = el(
    "button",
    {
      class: `search-filter-btn focusable${filtersActive(filters) ? " on" : ""}`,
      type: "button",
      id: "search-filter-btn",
      title: "Filters",
      "aria-label": "Filters",
      "aria-expanded": String(!panel.hidden),
      onclick: () => {
        panel.hidden = !panel.hidden;
        filterBtn.setAttribute("aria-expanded", String(!panel.hidden));
      },
    },
    filterIcon(),
    el("span", { text: "Filters" }),
  );

  if (resultQuery()) queueMicrotask(() => loadTitles(query));

  return [
    el("h1", { class: "view-title", text: "Search" }),
    el(
      "div",
      { class: "search-wrap" },
      // The field is the app's own panel: the magnifier leads it, the text fills it
      // edge to edge, and the filter control closes it — one control, full width.
      el("div", { class: "search-bar" }, input, filterBtn, suggestions),
    ),
    filters.country !== "all" && query.trim()
      ? el("p", {
          class: "view-hint",
          text: "TMDB search results carry no origin country, so Country applies while browsing — clear the text box to browse by it.",
        })
      : null,
    panel,
    titles,
  ].filter(Boolean);
}

const filtersActive = (f) =>
  Boolean(f.type) || ["country", "category", "period"].some((k) => f[k] !== "all") || f.sort !== "popularity";

/* ----------------------------------------------------------------- calendar */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The Calendar's plan-to-watch pin — and why it is not a watchlist row.
 *
 * The watchlist rows are states you progress through, and they scan whatever is
 * in that state. A calendar pin is different: it is a plan about a *date* — a
 * release you saw on the grid and mean to get to — so it lives in its own row
 * (`calendar-plans`) and the grid lists only the **recent** ones (the last
 * `CAL_RECENT_DAYS`). Putting it in the watchlist's Plan to Watch row was wrong:
 * a plan made on a Tuesday grid is not the same list as everything you plan to
 * watch, and mixing them made "plan to watch" mean two things.
 */
const CAL_RECENT_DAYS = 30;
const CAL_ROW = "calendar-plans";

const keyOfItem = (i) => `${i.type}:${i.id}`;

/** The calendar's own pins, newest first, recent only. */
function calendarPins() {
  const since = Date.now() - CAL_RECENT_DAYS * 864e5;
  return state.customItems
    .filter((i) => i.row === CAL_ROW)
    .filter((i) => !i.addedAt || Date.parse(i.addedAt) >= since)
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

/** Was this title planned *from the calendar*? */
const isCalendarPin = (item) => calendarPins().some((i) => keyOfItem(i) === watchKey(item));

/** Plan the title from the calendar — or take the plan away again. */
async function calendarPlan(item) {
  try {
    const res = await post("/customrows", { row: CAL_ROW, item: pinOf(item) });
    if (res && Array.isArray(res.items)) applyCustomRows(res);
  } catch {
    /* offline — the plan simply does not change */
  }
  render();
}

/**
 * Take a plan back off the calendar.
 *
 * The pin used to be add-only — a plan was a fact about a date and a stray click
 * must not delete it — but add-only with no other way to remove one meant a plan
 * you no longer wanted sat there for good. It is a toggle again, and this is the
 * half that removes.
 */
async function calendarUnplan(item) {
  try {
    const res = await post("/customrows", { row: CAL_ROW, item: pinOf(item), remove: true });
    if (res && Array.isArray(res.items)) applyCustomRows(res);
  } catch {
    /* offline — the plan simply does not change */
  }
  render();
}

function calendarCard(m) {
  const planned = isCalendarPin(m);
  return el(
    "div",
    { class: "cal-item" },
    posterCard(m, { kind: true }),
    // A calendar pin is a plan about a **date**, and it is a toggle: planning says
    // so, and pressing it again takes the plan back. It was briefly add-only, which
    // left a plan you had changed your mind about with no way off the calendar.
    el("button", {
      class: `btn pin cal-pin focusable${planned ? " active" : ""}`,
      type: "button",
      "data-cal-pin": keyOfItem(m),
      "aria-pressed": String(planned),
      title: planned ? "Planned from the calendar — click to remove the plan" : "Plan to watch (calendar pin)",
      text: planned ? "Plan to Watch · planned" : "Plan to Watch",
      onclick: () => (planned ? calendarUnplan(m) : calendarPlan(m)),
    }),
  );
}

function renderCalendar() {
  const { month } = state.calendar;
  const [year, mon] = month.split("-").map(Number);
  const grid = el("div", { class: "cal-grid" });
  const detail = el("div", { class: "cal-detail" });

  // The month grid is drawn immediately; the titles arrive from the server.
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const today = new Date().toISOString().slice(0, 10);

  const byDate = new Map();

  function drawGrid() {
    grid.replaceChildren(...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => el("div", { class: "cal-dow", text: d })));
    for (let i = 0; i < firstWeekday; i++) grid.append(el("div", { class: "cal-cell blank" }));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      const items = byDate.get(iso) || [];
      grid.append(
        el(
          "button",
          {
            class: `cal-cell focusable${iso === today ? " today" : ""}${state.calendar.day === iso ? " selected" : ""}`,
            type: "button",
            // Clicking the selected day again deselects it.
            onclick: () => {
              state.calendar.day = state.calendar.day === iso ? null : iso;
              render();
            },
            "aria-pressed": String(state.calendar.day === iso),
          },
          el("span", { class: "cal-day", text: String(d) }),
          items.length
            ? el("span", { class: "cal-count", text: `${items.length} title${items.length === 1 ? "" : "s"}` })
            : el("span", { class: "cal-count empty" }),
        ),
      );
    }
  }

  function drawDetail() {
    const iso = state.calendar.day;
    // Nothing selected → nothing shown, and no caption over it.
    if (!iso) {
      detail.replaceChildren();
      return;
    }
    const items = byDate.get(iso) || [];
    detail.replaceChildren(
      items.length
        ? el("div", { class: "grid-titles" }, ...items.map((m) => calendarCard(m)))
        : el("p", { class: "empty", text: "Nothing releases on this day." }),
    );
  }

  drawGrid();
  drawDetail();

  // A day holds films *and* series, so both rows are read for the month.
  Promise.all(
    ["movie", "series"].map((type) =>
      get(`/calendar/${type}/${month}.json${catalogQuery()}`)
        .then((data) => data.metas || [])
        .catch(() => []),
    ),
  )
    .then((lists) => {
      const seen = new Set();
      for (const m of lists.flat()) {
        const id = `${m.type}:${m.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const list = byDate.get(m.releaseDate) || [];
        list.push(m);
        byDate.set(m.releaseDate, list);
      }
      drawGrid();
      drawDetail();
    })
    .catch((err) => {
      detail.replaceChildren(el("p", { class: "empty", text: `Could not load the calendar — ${err.message}` }));
    });

  return [
    el(
      "header",
      { class: "cal-head" },
      el("h1", { class: "view-title", text: "Calendar" }),
      el("div", { class: "cal-nav" },
        el("button", { class: "icon-btn focusable", type: "button", text: "‹", "aria-label": "Previous month", onclick: () => { state.calendar = { month: shiftMonth(month, -1), day: null }; render(); } }),
        el("span", { class: "cal-month", text: `${MONTH_NAMES[mon - 1]} ${year}` }),
        el("button", { class: "icon-btn focusable", type: "button", text: "›", "aria-label": "Next month", onclick: () => { state.calendar = { month: shiftMonth(month, 1), day: null }; render(); } }),
      ),
    ),
    grid,
    detail,
  ];
}

/* ----------------------------------------------------------------- sources */

function sourceProviders(source) {
  if (Array.isArray(source.providers) && source.providers.length) return source.providers;
  return [];
}

/** A manifest resource → the label the Sources screen shows it under. */
const RESOURCE_LABELS = { catalog: "Catalog", meta: "Metadata", stream: "Streams", subtitles: "Subtitles", addon_catalog: "Add-on catalog" };
const resourceLabel = (name) => RESOURCE_LABELS[name] || (name ? name.charAt(0).toUpperCase() + name.slice(1) : "");

/** What one source serves, grouped: resources (add-ons) and scrapers (plugins). */
function sourceGroups(source) {
  const resources = (source.resources || []).map(resourceLabel).filter(Boolean);
  const scrapers = Array.isArray(source.scrapers) ? source.scrapers : [];
  const providers = sourceProviders(source);
  // A repository's "providers" *are* its scrapers.
  if (!scrapers.length && source.kind === "repo") scrapers.push(...providers);
  return { resources, scrapers, providers };
}

/**
 * One source's providers, laid out by what they are.
 *
 * A **Stremio add-on** declares resources (`catalog`, `meta`, `stream`,
 * `subtitles`) and names its catalogs — both are shown. A **Nuvio plugin**
 * publishes scrapers, which are the providers; a repo has no catalogs to list.
 */
function sourceBody(source) {
  const { resources, scrapers, providers } = sourceGroups(source);
  const line = (label, items) =>
    items.length
      ? el("div", { class: "source-line" },
          el("span", { class: "source-line-label", text: label }),
          el("div", { class: "chips" }, ...items.map((p) => el("span", { class: "chip", text: p }))),
        )
      : null;
  // A **Nuvio plugin** answers with *streams*, not catalogs: its scrapers are the
  // sources a title can be played from. A **Stremio add-on** declares everything it
  // serves — catalog, metadata, streams, subtitles — and names its catalogs, so both
  // are listed.
  const isPlugin = scrapers.length > 0 || source.kind === "plugin" || source.kind === "repo";
  const lines = isPlugin
    ? [line("Streams", scrapers.length ? scrapers : providers)]
    : [line("Resources", resources), line("Catalogs", providers)];
  const nodes = lines.filter(Boolean);
  if (nodes.length) return nodes;
  return [
    source.status && !source.status.ok
      ? el("p", { class: "option-desc", text: source.status.text })
      : el("p", { class: "option-desc", text: "Reading this source's providers…" }),
  ];
}

function sourceGraph(meta) {
  const hubs = state.sources.map((s) => ({
    label: s.name || typeLabel(s.type),
    providers: sourceProviders(s),
  }));

  const W = 1040;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2;
  const R1 = 210;
  const R2 = 92;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "graph");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Sources graph");

  const line = (a, b, cls) => {
    const l = document.createElementNS(ns, "line");
    l.setAttribute("x1", a.x); l.setAttribute("y1", a.y);
    l.setAttribute("x2", b.x); l.setAttribute("y2", b.y);
    l.setAttribute("class", cls);
    svg.append(l);
  };
  const node = (p, r, cls, label, dy = 0) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", r);
    c.setAttribute("class", cls);
    svg.append(c);
    if (label) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", p.x); t.setAttribute("y", p.y + dy);
      t.setAttribute("class", "graph-label");
      t.setAttribute("text-anchor", "middle");
      t.textContent = label.length > 26 ? `${label.slice(0, 25)}…` : label;
      svg.append(t);
    }
  };

  const center = { x: cx, y: cy };
  const positions = hubs.map((h, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, hubs.length)) * Math.PI * 2;
    return { hub: h, x: cx + Math.cos(a) * R1, y: cy + Math.sin(a) * R1, a };
  });

  for (let i = 0; i < positions.length; i++) {
    line(positions[i], positions[(i + 1) % positions.length], "graph-edge faint");
    line(center, positions[i], "graph-edge");
  }

  const leaves = [];
  for (const pos of positions) {
    const provs = pos.hub.providers;
    const spread = Math.PI * 0.9;
    const start = pos.a - spread / 2;
    provs.forEach((name, j) => {
      const a = provs.length === 1 ? pos.a : start + (j / (provs.length - 1)) * spread;
      const p = { x: pos.x + Math.cos(a) * R2, y: pos.y + Math.sin(a) * R2 };
      line(pos, p, "graph-edge");
      leaves.push({ p, name });
    });
  }

  node(center, 15, "graph-node center", meta?.name || "Title", 34);
  for (const pos of positions) node(pos, 9, "graph-node hub", pos.hub.label, -16);
  for (const l of leaves) node(l.p, 6, "graph-node leaf", l.name, 18);

  return svg;
}

function renderSources(id, name) {
  const meta = { id, name: name || "Title" };
  const nodes = [
    el("div", { class: "sources-head" },
      el("div", {},
        el("p", { class: "hero-kicker", text: "Sources" }),
        el("h2", { class: "view-title", text: meta.name }),
        el("p", { class: "view-hint", text: "Providers connected by the add-on, plugin or repository that returns them." }),
      ),
      el("div", { class: "graph-legend" },
        el("span", { class: "dot hub" }), el("span", { text: "add-on / plugin" }),
        el("span", { class: "dot leaf" }), el("span", { text: "provider" }),
      ),
    ),
  ];

  const addons = state.sources.filter((s) => ADDON_TYPES.some(([t]) => t === s.type));
  const plugins = state.sources.filter((s) => PLUGIN_TYPES.some(([t]) => t === s.type));
  const ordered = [...addons, ...plugins];

  if (!ordered.length) {
    nodes.push(
      el("div", { class: "empty-panel" },
        el("p", { text: "No sources configured yet. Add add-ons or plugins in Settings and their providers appear here, linked to the source that returns them." }),
        el("button", { class: "btn primary focusable", type: "button", text: "Open Settings", onclick: () => go("#/settings") }),
      ),
    );
    return nodes;
  }

  const saved = state.sources;
  state.sources = ordered;
  nodes.push(sourceGraph(meta));
  state.sources = saved;

  for (const [title, list] of [["Add-ons", addons], ["Plugins & repositories", plugins]]) {
    if (!list.length) continue;
    nodes.push(el("h3", { class: "result-head", text: title }));
    nodes.push(el("div", { class: "source-provider-list" }, ...list.map((s) =>
      el("div", { class: "source-providers" },
        el("div", { class: "source-providers-head" },
          el("span", { class: "source-type", text: `${typeLabel(s.type)}${s.name ? ` · ${s.name}` : ""}` }),
          el("span", { class: "source-url", text: s.url }),
        ),
        ...sourceBody(s),
      ))));
  }
  return nodes;
}

/* ---------------------------------------------------------- a title, in full */

/**
 * One title's own page.
 *
 * The title used to be a modal over whatever screen you were on — a poster, a
 * description and five buttons. It is a **page** now, because what you want from a
 * title does not fit in a card: who made it, who is in it, what studio and what
 * franchise it belongs to, its rating, its seasons, and what else is like it — and
 * every one of those is a way into its own catalog, not a label.
 */
async function renderTitle(type, id) {
  const media = type === "series" ? "series" : "movie";
  setRow(media);
  let data;
  try {
    data = await get(`/title/${media}/${encodeURIComponent(id)}.json${state.safe ? "" : "?adult=1"}`);
  } catch (err) {
    return [el("div", { class: "empty-panel" }, el("p", { text: `Could not load this title — ${err.message}` }))];
  }
  if (!data?.ok) {
    return [el("div", { class: "empty-panel" }, el("p", { text: data?.error || "This title could not be loaded." }))];
  }

  const meta = { ...data.meta, type: media };
  const art = backdropOf(meta) || posterOf(meta);
  const facts = [
    data.certification,
    media === "movie"
      ? (data.runtime ? `${data.runtime} min` : "")
      : [data.seasonsCount ? `${data.seasonsCount} season${data.seasonsCount === 1 ? "" : "s"}` : "", data.episodesCount ? `${data.episodesCount} episodes` : ""].filter(Boolean).join(" · "),
    meta.releaseInfo,
    meta.imdbRating ? `★ ${meta.imdbRating}` : "",
    data.status,
  ].filter(Boolean);

  const node = el(
    "article",
    { class: "title-page" },

    // **The backdrop is the page.** The title's own wide shot fills the top of the
    // screen, with the actions sitting on it — so Play is the first thing you see,
    // not something you scroll to.
    el(
      "header",
      { class: "title-hero" },
      art ? el("img", { class: "title-hero-art", src: art, alt: "", loading: "eager" }) : null,
      el("div", { class: "title-hero-scrim", "aria-hidden": "true" }),
      el(
        "div",
        { class: "title-hero-inner" },
        el("button", { class: "crumb focusable", type: "button", text: "‹ Back", onclick: () => history.back() }),
        el("h1", { class: "title-name", text: meta.name || "Untitled" }),
        facts.length ? el("p", { class: "title-facts", text: facts.join("  ·  ") }) : null,
        el(
          "div",
          { class: "title-actions" },
          el("button", {
            class: "btn primary play-btn focusable",
            type: "button",
            id: "title-play",
            text: "▶  Play",
            onclick: () => openSources(meta),
          }),
          el("button", {
            class: "btn subtle focusable",
            type: "button",
            id: "title-sources",
            text: "Sources",
            title: "Choose which add-on plays this title",
            onclick: () => openSources(meta),
          }),
          // The pin buttons live on the page now, not in a modal.
          el("div", { class: "title-pins", id: "title-pins" }, ...pinButtons(meta)),
        ),
      ),
    ),

    el(
      "div",
      { class: "title-body" },
      data.tagline ? el("p", { class: "title-tagline", text: data.tagline }) : null,
      meta.description ? el("p", { class: "title-overview", text: meta.description }) : null,

      data.genres.length
        ? el("div", { class: "title-row" },
            el("h3", { class: "row-head", text: "Genres" }),
            el("div", { class: "chips" }, ...data.genres.map((g) =>
              el("button", {
                class: "chip focusable",
                type: "button",
                text: g.name,
                onclick: () => go(`#/l/genre/${g.id}?type=${media}`),
              })
            )),
          )
        : null,

      peopleRow("Directed by", [...data.creators, ...data.directors]),
      peopleRow("Written by", data.writers),
      peopleRow("Cast", data.cast),
      logoRow("Studios", data.companies, "company"),
      logoRow("Networks", data.networks, "network"),

      // **The franchise**, when the film is part of one: its own parts, in order.
      data.collection ? titleStrip("The franchise", `The ${data.collection.name}`) : null,
      // **Seasons**, for a show: each one opens its own episode list.
      data.seasons.length
        ? el("section", { class: "title-row" },
            el("h3", { class: "row-head", text: "Seasons" }),
            el("div", { class: "season-grid" }, ...data.seasons.map((s) =>
              el("button", {
                class: "season-card focusable",
                type: "button",
                onclick: () => go(`#/l/season/${encodeURIComponent(id)}/${s.number}?type=${media}`),
              },
                s.poster ? el("img", { src: s.poster, alt: "", loading: "lazy" }) : el("div", { class: "poster-fallback", text: `S${s.number}` }),
                el("span", { class: "season-name", text: s.name }),
                el("span", { class: "season-sub", text: [s.year, s.episodes ? `${s.episodes} episodes` : ""].filter(Boolean).join(" · ") }),
              )
            )),
          )
        : null,

      data.more.length ? titleStrip("More like this", null, data.more) : null,
    ),
  );

  // The two strips that need their own request are filled once the page is drawn.
  queueMicrotask(() => {
    if (data.collection) fillStripFrom(node.querySelector(`[data-strip="collection"]`), `/list/collection/${data.collection.tmdbId}.json${listQuery("movie")}`, "This franchise has no other titles.");
  });

  return [node];
}

/** One name's own catalog, as a grid — a person's credits, a studio, a genre. */
async function renderList(kind, id, type, extra = "") {
  const media = type === "series" ? "series" : "movie";
  let metas = [];
  // `extra` is a season's number: `/list/season/<show>/<n>.json`.
  const path = `/list/${kind}/${encodeURIComponent(id)}${extra ? `/${encodeURIComponent(extra)}` : ""}.json${listQuery(media)}`;
  try {
    ({ metas = [] } = await get(path));
  } catch (err) {
    return [el("div", { class: "empty-panel" }, el("p", { text: `Could not load this list — ${err.message}` }))];
  }
  const heading = { person: "Credits", company: "From this studio", network: "On this network", genre: "In this genre", keyword: "With this tag", season: "Episodes", collection: "In this franchise" }[kind] || "Titles";
  return [
    el("div", { class: "sources-head" },
      el("div", {},
        el("p", { class: "hero-kicker", text: heading }),
        el("h2", { class: "view-title", text: `${metas.length} ${media === "movie" ? "films" : "shows"}` }),
      ),
      el("div", { class: "row-switch" },
        ...[['movie', 'Movies'], ['series', 'Shows']].map(([value, label]) =>
          el("button", {
            class: `row-btn focusable${media === value ? " active" : ""}`,
            type: "button",
            text: label,
            onclick: () => go(`#/l/${kind}/${encodeURIComponent(id)}?type=${value}`),
          })
        ),
      ),
    ),
    metas.length
      ? el("div", { class: "grid-titles" }, ...metas.map((m) => posterCard(m)))
      : el("p", { class: "empty", text: "Nothing here for this row." }),
  ];
}

/** The query every list request carries: the row, and the SFW switch. */
const listQuery = (type) => `?type=${encodeURIComponent(type)}${state.safe ? "" : "&adult=1"}`;

/** The pin buttons for a title — the same ones the quick-look modal draws. */
function pinButtons(item) {
  const current = state.watchlist[watchKey(item)] || "";
  const customOn = inCustomRow(item);
  return [
    ...WATCH_STATES.map(([sid, label]) =>
      el("button", {
        class: `btn pin focusable${current === sid ? " active" : ""}`,
        type: "button",
        id: `pin-${sid}`,
        title: current === sid ? `Pinned as ${label} — click to unpin` : `Pin as ${label}`,
        "aria-pressed": String(current === sid),
        text: current === sid ? `${label} · pinned` : label,
        onclick: () => setWatchState(item, current === sid ? null : sid),
      }),
    ),
    el("button", {
      class: `btn pin focusable${customOn ? " active" : ""}`,
      type: "button",
      id: "pin-custom",
      title: customOn ? `In ${customLabel()} — click to remove` : `Add to ${customLabel()}`,
      "aria-pressed": String(customOn),
      text: customOn ? `${customLabel()} · added` : `Add to ${customLabel()}`,
      onclick: () => toggleCustomRow(item),
    }),
  ];
}

/** A row of people, each opening their own credits. */
function peopleRow(label, people) {
  const list = (people || []).filter((p) => p && p.name && p.tmdbId);
  if (!list.length) return null;
  return el("section", { class: "title-row" },
    el("h3", { class: "row-head", text: label }),
    el("div", { class: "people" }, ...list.map((p) =>
      el("button", {
        class: "person focusable",
        type: "button",
        title: `${p.name} — open their credits`,
        onclick: () => go(`#/l/person/${p.tmdbId}?type=${state.row}`),
      },
        p.poster ? el("img", { class: "person-face", src: p.poster, alt: "", loading: "lazy" }) : el("span", { class: "person-face person-initials", text: initialsOf(p.name).toUpperCase() }),
        el("span", { class: "person-name", text: p.name }),
        p.role ? el("span", { class: "person-role", text: p.role }) : null,
      )
    )),
  );
}

/** A row of studios / networks, each opening its own titles. */
function logoRow(label, list, kind) {
  const items = (list || []).filter((c) => c && c.name && c.tmdbId);
  if (!items.length) return null;
  return el("section", { class: "title-row" },
    el("h3", { class: "row-head", text: label }),
    el("div", { class: "chips" }, ...items.map((c) =>
      el("button", {
        class: "chip focusable",
        type: "button",
        text: c.name,
        title: `${c.name} — open its titles`,
        onclick: () => go(`#/l/${kind}/${c.tmdbId}?type=${state.row}`),
      })
    )),
  );
}

/** A titled row of posters — the franchise, or "more like this". */
function titleStrip(label, emptyText, metas) {
  const strip = el("div", { class: "strip", "data-strip": label === "The franchise" ? "collection" : "inline" });
  if (metas) for (const m of metas) strip.append(posterCard(m));
  else strip.append(el("p", { class: "empty", text: "Loading…" }));
  return el("section", { class: "title-row" }, el("h3", { class: "row-head", text: label }), strip);
}

/** Fill a strip that needed its own request. */
async function fillStripFrom(strip, url, emptyText) {
  if (!strip) return;
  try {
    const { metas = [] } = await get(url);
    strip.replaceChildren();
    if (!metas.length) strip.append(el("p", { class: "empty", text: emptyText }));
    else for (const m of metas) strip.append(posterCard(m));
  } catch (err) {
    strip.replaceChildren(el("p", { class: "empty", text: `Could not load — ${err.message}` }));
  }
}

/* ----------------------------------------------------------------- settings */

function toggleRow(checked, title, desc, onchange) {
  return el("label", { class: "option focusable", tabindex: "0" },
    el("input", { type: "checkbox", checked, onchange }),
    el("span", { class: "option-body" },
      el("span", { class: "option-title", text: title }),
      desc ? el("span", { class: "option-desc", text: desc }) : null,
    ),
  );
}

function radioRow(checked, name, title, desc, onchange) {
  return el("label", { class: "option focusable", tabindex: "0" },
    el("input", { type: "radio", name, checked, onchange }),
    el("span", { class: "option-body" },
      el("span", { class: "option-title", text: title }),
      desc ? el("span", { class: "option-desc", text: desc }) : null,
    ),
  );
}

async function verifyKey(name, store, keyName) {
  const entry = store[name] || (store[name] = {});
  entry.status = { ok: false, text: "Checking…" };
  writeJSON(keyName, store);
  render();
  try {
    entry.status = (await post("/providers/verify", { name })) || { ok: false, text: "no response" };
  } catch (err) {
    entry.status = { ok: false, text: `could not reach the server — ${err.message}` };
  }
  writeJSON(keyName, store);
  render();
}

function keyRow(group, name, label, desc, store, keyName) {
  const entry = store[name] || (store[name] = {});
  const input = el("input", {
    class: "text-input focusable",
    type: "password",
    placeholder: entry.hasKey ? "•••••••• (set — paste a new key to replace)" : "Paste API key…",
    id: `${group}-${name}-key`,
  });
  const save = el("button", {
    class: "btn primary focusable",
    type: "button",
    text: entry.hasKey ? "Replace key" : "Save key",
    onclick: async () => {
      const key = input.value.trim();
      if (!key) return;
      store[name] = { ...entry, enabled: true, hasKey: true };
      writeJSON(keyName, store);
      await pushSettings({ [group]: { [name]: { enabled: true, key } } });
      input.value = "";
      await verifyKey(name, store, keyName);
    },
  });
  const clear = entry.hasKey
    ? el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Remove key",
        onclick: async () => {
          store[name] = { ...entry, enabled: false, hasKey: false };
          writeJSON(keyName, store);
          await pushSettings({ [group]: { [name]: { enabled: false, key: "" } } });
          render();
        },
      })
    : null;

  return el("div", { class: "provider" },
    el("div", { class: "provider-head" },
      el("div", {},
        el("span", { class: "option-title", text: label }),
        el("span", { class: `badge ${entry.enabled && entry.hasKey ? "on" : "off"}`, text: entry.hasKey ? (entry.enabled ? "enabled" : "key set · off") : "no key" }),
      ),
      el("label", { class: "switch" },
        el("input", {
          type: "checkbox",
          checked: Boolean(entry.enabled),
          onchange: (e) => {
            store[name] = { ...store[name], enabled: e.target.checked };
            writeJSON(keyName, store);
            pushSettings({ [group]: { [name]: { enabled: e.target.checked } } });
            render();
          },
        }),
        el("span", { class: "slider" }),
      ),
    ),
    el("p", { class: "option-desc", text: desc }),
    el("div", { class: "source-form" }, input, save, clear),
    entry.hasKey
      ? el("div", { class: "provider-check" },
          el("button", { class: "btn subtle focusable", type: "button", text: "Check connection", onclick: () => verifyKey(name, store, keyName) }),
          entry.status ? el("span", { class: `source-status ${entry.status.ok ? "ok" : "bad"}`, text: entry.status.text }) : null,
        )
      : null,
  );
}

function aiAskRow() {
  const input = el("input", { class: "text-input focusable", type: "text", placeholder: "Tell me what to watch…", id: "ai-ask" });
  const mic = el("button", { class: "btn focusable", type: "button", text: "🎙 Voice", onclick: () => startVoice(input) });
  const send = el("button", {
    class: "btn primary focusable",
    type: "button",
    text: "Ask",
    onclick: () => {
      const q = input.value.trim();
      if (q) aiIntent(q);
    },
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send.click();
  });
  return el("div", { class: "ai-ask" },
    el("p", { class: "option-desc", text: "Type or speak — the assistant turns it into a search." }),
    el("div", { class: "ai-ask-form" }, input, mic, send),
  );
}

function startVoice(input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    input.placeholder = "Voice isn't available in this build — type instead.";
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => {
    const said = e.results?.[0]?.[0]?.transcript ?? "";
    if (said) {
      input.value = said;
      aiIntent(said);
    }
  };
  rec.onerror = () => {
    input.placeholder = "Couldn't hear that — type instead.";
  };
  try {
    rec.start();
  } catch {
    const text = prompt("What do you want to watch?");
    if (text) aiIntent(text);
  }
}

/**
 * The Ask box. With a provider and a key it asks the model to turn the sentence
 * into a search query; without one — or if the provider is unreachable — the
 * typed words are searched as-is, so the box still works with no AI configured.
 */
async function aiIntent(text, picked) {
  const q = String(text || "").trim();
  if (!q) return;
  // "Pick for me" narrows the search to one row: the assistant is asked for a
  // film, and the answer must not come back as a series (or the reverse).
  const side = picked ?? (state.ai?.pickRow === "movie" || state.ai?.pickRow === "series" ? state.ai.pickRow : "");
  const to = (query) => {
    const p = new URLSearchParams({ q: query });
    if (side) p.set("type", side);
    go(`#/search?${p.toString()}`);
  };
  // Whether a key is set is the **server's** answer, not this page's: a key can
  // live in the environment, and the page only ever sees "set / not set" from
  // `/ai.json`. Gating on the local copy is what made Ask silently fall back to a
  // literal search on a server that had a working key.
  const provider = state.ai?.provider || "";
  const ready = Boolean(state.ai?.enabled !== false && provider);
  if (ready) {
    try {
      const res = await post("/ai/ask", { prompt: q });
      if (res?.ok && res.query) return to(res.query);
    } catch {
      /* fall through to the literal text */
    }
  }
  to(q);
}

/* ---- settings panes ------------------------------------------------------- */

/**
 * Profile — shows which profile is active and lets you switch in place, so the
 * pane is informative even when you never touch it.
 */
/**
 * One switch in the profile editor: a media row, a card, or a catalog inside a card.
 *
 * `level` decides where the pick is stored, so one drawing serves all three and a
 * pick is remembered per profile (`nuvio.visibility`).
 */
function visRow(checked, level, id, title, desc, depth = 0) {
  const input = el("input", {
    type: "checkbox",
    name: `${level}:${id}`,
    "data-vis-level": level,
    "data-vis-id": id,
    ...(checked ? { checked: "checked" } : {}),
    onchange: (e) => {
      const v = visFor();
      if (level === "row") v.rows[id] = e.target.checked;
      else if (level === "card") v.cards[id] = e.target.checked;
      else v.catalogs[id] = e.target.checked;
      saveVisibility();
      render();
    },
  });
  return el(
    "label",
    {
      class: `option vis-option focusable${depth ? " vis-sub" : ""}`,
      tabindex: "0",
      style: depth ? `padding-left: ${depth * 16}px` : "",
    },
    input,
    el("span", { class: "option-body" },
      el("span", { class: "option-title", text: title }),
      desc ? el("span", { class: "option-desc", text: desc }) : null,
    ),
  );
}

/**
 * Settings → Profile: the profile you are on, and what it shows.
 *
 * This is the "pick the cards for you" editor: one switch for each of Movies and
 * Shows, one per card, and one per catalog row inside a card — so a profile can be
 * exactly Netflix-and-anime, or films only, without a second app.
 */
function paneProfile() {
  // Only the profile in use — switching happens on the switch-profile screen.
  const v = visFor();
  const editing = state.pickCards === true;
  // **Edit** is the way in. The editor used to be a bare toggle sitting in the pane
  // with a paragraph of explanation, so "there is a profile editor at all" was
  // something you had to notice; an Edit button on the profile itself is where you
  // look for it — and it reads as edit-then-done, which is what it is.
  const setEditing = (on) => {
    state.pickCards = on;
    writeJSON(KEY.pickCards, on);
    render();
  };
  return [
    el(
      "div",
      { class: "current-profile" },
      el("span", { class: "avatar", "aria-hidden": "true" }, avatarNode(state.profile)),
      el(
        "div",
        { class: "current-profile-body" },
        el("span", { class: "current-profile-name", text: state.profile }),
        el("span", { class: "current-profile-note", text: editing ? "Editing this profile" : "Current profile" }),
      ),
      el("button", {
        class: `btn focusable${editing ? " subtle" : " primary"}`,
        type: "button",
        id: "profile-edit",
        text: editing ? "Done" : "Edit",
        "aria-pressed": String(editing),
        title: editing ? "Close the profile editor" : "Pick the rows, cards and catalogs this profile shows",
        onclick: () => setEditing(!editing),
      }),
    ),
    el("p", {
      class: "option-desc",
      text: editing
        ? "Switch off anything this profile should not show, then press Done. Off by default: with the editor closed, everything shows and nothing is hidden."
        : "This is the profile the app is using. Open the profile icon in the top bar to switch; press Edit to choose which rows, cards and catalogs this profile shows.",
    }),

    editing ? el("div", { class: "vis-editor" },
      el("section", { class: "vis-section" },
        el("div", { class: "group-head" },
          el("span", { class: "option-title", text: "Media rows" }),
          el("span", { class: "option-desc", text: "The Movies and Shows rows under the hero banner." }),
        ),
        visRow(v.rows.movie !== false, "row", "movie", "Movies", "The Movies row and its cards."),
        visRow(v.rows.series !== false, "row", "series", "Shows", "The Shows row and its cards."),
      ),

      el("section", { class: "vis-section" },
        el("div", { class: "group-head" },
          el("span", { class: "option-title", text: "Cards" }),
          el("span", { class: "option-desc", text: `${state.collections.filter(cardVisible).length} of ${state.collections.length} cards show on Home, in the published order. Each card's catalog rows are listed inside it.` }),
        ),
        ...state.collections.map((card) => visCard(card, v)),
      ),
    ) : null,
  ].filter(Boolean);
}

/**
 * One card in the visibility editor: the card's own switch, then its catalog rows.
 *
 * Cards are separate blocks rather than one long list, so "which rows belong to
 * this card?" is answered by the box they sit in — and the card's header reports
 * how many of its rows are on, which is the number you actually want while picking.
 */
function visCard(card, v) {
  const rows = rowOf(card).catalogs;
  const shownRows = rows.filter((cat) => v.catalogs[cat.id] !== false).length;
  const shown = v.cards[card.key] !== false;
  return el("div", { class: `vis-card${shown ? "" : " off"}` },
    visRow(shown, "card", card.key, titleOf(card), rows.length ? `${shownRows} of ${rows.length} catalog rows on` : "No catalog rows yet"),
    rows.length
      ? el("div", { class: "vis-card-rows" },
          ...rows.map((cat) => visRow(v.catalogs[cat.id] !== false, "catalog", cat.id, cat.name, "", 1)),
        )
      : null,
  );
}

/**
 * Settings → Posters: one switch, the poster service, and its URL pattern.
 *
 * There is **no API-key box**: the service bttr.cc needs no key at all, and the one
 * that does (RPDB) carries it inside its own URL — so the pattern is the single
 * input this pane needs, and a second box would only ask for a key nothing reads.
 */
function panePosters() {
  const pattern = el("input", {
    class: "text-input focusable",
    type: "text",
    id: "poster-pattern",
    value: state.posters.pattern || POSTER_SERVICES[0][2],
    placeholder: "https://…/{imdb_id}.jpg",
  });
  const status = el("span", { class: "source-status", text: "" });

  // Which service the stored pattern belongs to. Matched on the host rather than on
  // the whole string, because an RPDB URL carries the user's own key in it and would
  // never equal the template.
  const host = (url) => String(url || "").match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase() || "";
  const current = String(state.posters.pattern || POSTER_SERVICES[0][2]);
  const hostname = host(current);
  const active = hostname.includes("btttr.cc")
    ? "bttr"
    : hostname.includes("ratingposterdb.com")
      ? "rpdb"
      : "custom";

  return [
    toggleRow(state.posters.enabled !== false, "Upgrade posters everywhere", "Use the poster service for every title; titles it cannot cover keep their original artwork.", (e) => {
      state.posters = { ...state.posters, enabled: e.target.checked };
      writeJSON(KEY.posters, state.posters);
      pushSettings({ posters: { enabled: e.target.checked } });
      render();
    }),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Poster service" }),
      el("p", { class: "option-desc", text: "Which service supplies the artwork, and the URL it is asked for. Pick one and its pattern is filled in below; edit the pattern to use anything else — {imdb_id}, {tmdb_id} and {type} are filled in per title." }),
      ...POSTER_SERVICES.map(([id, label, url, desc]) =>
        radioRow(active === id, "posterservice", label, desc, async () => {
          state.posters = { ...state.posters, source: id, pattern: url, enabled: true };
          writeJSON(KEY.posters, state.posters);
          await pushSettings({ posters: { source: id, pattern: url, enabled: true } });
          render();
        }),
      ),
      active === "custom"
        ? el("p", { class: "option-desc", text: "A pattern of your own — save it below and check that it answers." })
        : null,
    ),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "URL pattern" }),
      el("div", { class: "source-form" }, pattern,
        el("button", { class: "btn primary focusable", type: "button", text: "Save pattern", onclick: async () => {
          const value = pattern.value.trim();
          if (!value) return;
          state.posters = { ...state.posters, pattern: value };
          writeJSON(KEY.posters, state.posters);
          await pushSettings({ posters: { pattern: value } });
          render();
        } }),
        el("button", { class: "btn subtle focusable", type: "button", text: "Check service", onclick: async () => {
          status.className = "source-status";
          status.textContent = "Checking…";
          try {
            const res = await get("/posters/check");
            status.className = `source-status ${res.ok ? "ok" : "bad"}`;
            status.textContent = res.text;
          } catch (err) {
            status.className = "source-status bad";
            status.textContent = `could not check — ${err.message}`;
          }
        } }),
      ),
      el("div", { class: "provider-check" }, status),
    ),
  ];
}

function paneProviders() {
  // Which provider supplies the content *inside* a row lives here, next to the
  // keys that make it possible — it used to be a second copy of the same switch
  // in Content, which is exactly what "why is TMDB in two places?" means.
  const tvdbReady = Boolean(state.providers.tvdb?.enabled && state.providers.tvdb?.hasKey);
  const sourceRow = (value, title, desc) =>
    radioRow(state.contentSource === value, "contentSource", title, desc, () => {
      state.contentSource = value;
      localStorage.setItem(KEY.contentSource, value);
      pushSettings({ content: { source: value } });
      render();
    });

  return [
    el("p", { class: "option-desc", text: "Paste a key and enable a provider. Catalogs keep the same names; the provider changes the contents behind them." }),
    ...PROVIDERS.map(([name, label, desc]) => keyRow("providers", name, label, desc, state.providers, KEY.providers)),
    el("div", { class: "group-head" },
      el("span", { class: "option-title", text: "Content source" }),
      el("span", { class: "option-desc", text: "Which enabled provider supplies the titles inside a row." }),
    ),
    sourceRow("tmdb", "TMDB", "Default. Every row is TMDB's — its titles, its translations, its artwork."),
    sourceRow(
      "tvdb",
      "TVDB",
      tvdbReady
        ? "Every catalog shows TVDB's titles, translations, years and artwork instead. The rows themselves are still chosen by TMDB, which is what can build them."
        : "Needs the TVDB key above. Without one the app keeps serving TMDB content rather than empty rows.",
    ),
  ];
}

function paneTracking() {
  return [
    el("p", { class: "option-desc", text: "Connect a service to track what you watch. Each key is stored on the server — the page only ever learns whether one is set." }),
    ...TRACKER_GROUPS.flatMap((group) => [
      // The divider belongs *before* the group it separates, the way the rule on a
      // collection page sits above the row it introduces.
      group.divider ? el("div", { class: "h-divider tracking-divider", "aria-hidden": "true" }) : null,
      el("div", { class: "group-head" },
        el("span", { class: "option-title", text: group.title }),
        el("span", { class: "option-desc", text: group.hint }),
      ),
      ...group.services.map(([name, label, desc]) => keyRow("tracking", name, label, desc, state.tracking, KEY.tracking)),
    ].filter(Boolean)),
  ];
}

/**
 * One free AI provider: pick it with the switch, paste its key, check it.
 * The key goes to the server (as every other key does) — the page only ever
 * learns whether one is set.
 */
function aiProviderRow(slug, label, signup, note) {
  const hasKey = Boolean(state.ai.hasKey?.[slug]);
  const active = state.ai.provider === slug;
  // The models the provider reported, filled in by Test connection / Load models.
  const modelList = el("div", { class: "model-list", id: `ai-${slug}-models` });
  /**
   * Show the models as pickable chips.
   *
   * Clicking one sets it as the model in use — the model box below stops being a
   * name you have to know and becomes a name you picked from what the provider
   * actually serves today.
   */
  const drawModels = (models, recommended = "") => {
    modelList.replaceChildren(
      ...models.slice(0, 24).map((id) =>
        el("button", {
          class: `model-chip focusable${id === state.ai.model || id === recommended ? " suggested" : ""}`,
          type: "button",
          text: id,
          title: `Use ${id}`,
          onclick: async () => {
            state.ai.model = id;
            writeJSON(KEY.ai, state.ai);
            await pushSettings({ ai: { model: id } });
            render();
          },
        }),
      ),
    );
  };
  const input = el("input", {
    class: "text-input focusable",
    type: "password",
    id: `ai-${slug}-key`,
    placeholder: hasKey ? "•••••••• (set — paste a new key to replace)" : "Paste API key…",
  });
  const status = el("span", { class: "source-status", text: "" });

  return el("div", { class: `provider ai-provider${active ? " active" : ""}` },
    el("div", { class: "provider-head" },
      el("div", { class: "ai-provider-name" },
        el("span", { class: "option-title", text: label }),
        el("span", { class: `badge ${hasKey ? "on" : "off"}`, text: hasKey ? "key set" : "no key" }),
        el("span", { class: "badge free", text: "free tier" }),
      ),
      el("label", { class: "switch", title: `Use ${label}` },
        el("input", {
          type: "radio",
          name: "ai-provider",
          value: slug,
          checked: active,
          onchange: () => {
            state.ai.provider = slug;
            writeJSON(KEY.ai, state.ai);
            pushSettings({ ai: { provider: slug } });
            render();
          },
        }),
        el("span", { class: "slider" }),
      ),
    ),
    el("p", { class: "option-desc", text: note }),
    el("div", { class: "source-form" }, input,
      el("button", {
        class: "btn primary focusable",
        type: "button",
        text: hasKey ? "Replace key" : "Save key",
        onclick: async () => {
          const value = input.value.trim();
          if (!value) return;
          state.ai.hasKey = { ...(state.ai.hasKey || {}), [slug]: true };
          // The first key pasted becomes the provider in use.
          if (!state.ai.provider) state.ai.provider = slug;
          writeJSON(KEY.ai, state.ai);
          await pushSettings({ ai: { keys: { [slug]: value }, provider: state.ai.provider } });
          input.value = "";
          render();
        },
      }),
      hasKey
        ? el("button", {
            class: "btn subtle focusable",
            type: "button",
            text: "Remove key",
            onclick: async () => {
              state.ai.hasKey = { ...(state.ai.hasKey || {}), [slug]: false };
              writeJSON(KEY.ai, state.ai);
              await pushSettings({ ai: { keys: { [slug]: "" } } });
              render();
            },
          })
        : null,
    ),
    el("div", { class: "provider-check" },
      // Test connection, and load the models in the same call: a model list only
      // comes back from a key that works, so one button answers both questions.
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Test connection",
        onclick: async () => {
          status.className = "source-status";
          status.textContent = "Testing…";
          modelList.replaceChildren();
          try {
            const res = await post("/ai/verify", { provider: slug });
            status.className = `source-status ${res?.ok ? "ok" : "bad"}`;
            status.textContent = res?.text || (res?.ok ? "connected" : "not connected");
            drawModels(res?.chat || []);
          } catch (err) {
            status.className = "source-status bad";
            status.textContent = `could not check — ${err.message}`;
          }
        },
      }),
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Load models",
        onclick: async () => {
          status.className = "source-status";
          status.textContent = "Loading models…";
          modelList.replaceChildren();
          try {
            const res = await post("/ai/models", { provider: slug });
            status.className = `source-status ${res?.ok ? "ok" : "bad"}`;
            status.textContent = res?.text || "no models";
            drawModels(res?.chat || [], res?.recommended);
          } catch (err) {
            status.className = "source-status bad";
            status.textContent = `could not list models — ${err.message}`;
          }
        },
      }),
      el("a", { class: "ai-signup", href: signup, target: "_blank", rel: "noreferrer", text: "Get a free key" }),
      status,
    ),
    modelList,
  );
}

function paneAi() {
  return [
    toggleRow(state.ai.enabled, "Enable AI", "Turns on the assistant and its options.", (e) => {
      state.ai.enabled = e.target.checked;
      writeJSON(KEY.ai, state.ai);
      pushSettings({ ai: { enabled: state.ai.enabled } });
      render();
    }),
    state.ai.enabled ? [
      toggleRow(state.ai.enhanceArtwork, "Classic posters & banners → high quality", "Requests the next-bigger artwork size so older posters and banners look modern.", (e) => {
        state.ai.enhanceArtwork = e.target.checked;
        writeJSON(KEY.ai, state.ai);
        pushSettings({ ai: { enhanceArtwork: state.ai.enhanceArtwork } });
        render();
      }),
      toggleRow(state.ai.enhanceMissing !== false, "Give the same treatment to posters without a better poster", "Titles the poster service could not cover (no IMDb id) still get the high-quality artwork treatment.", (e) => {
        state.ai.enhanceMissing = e.target.checked;
        writeJSON(KEY.ai, state.ai);
        pushSettings({ ai: { enhanceMissing: state.ai.enhanceMissing } });
        render();
      }),
      // "Pick the cards for you" is back, and it is the switch over the editor in
      // Settings → Profile: hit it here and pick there.
      toggleRow(state.pickCards === true, "Pick the cards for you", "Shows only the rows, cards and catalogs you picked in Settings → Profile. Off means the whole card set, in the published order.", (e) => {
        state.pickCards = e.target.checked;
        writeJSON(KEY.pickCards, state.pickCards);
        render();
      }),
      el("p", { class: "option-desc", text: "Pick a free provider and paste its API key. The key is stored on the server, never in the page, and the Ask box falls back to a plain search when no key is set." }),
      ...AI_PROVIDERS.map(([slug, label, signup, note]) => aiProviderRow(slug, label, signup, note)),
      el("div", { class: "provider" },
        el("span", { class: "option-title", text: "Model" }),
        el("p", { class: "option-desc", text: "Optional. Providers rename models faster than this ships — leave it empty to use the provider's default." }),
        el("div", { class: "source-form" },
          el("input", {
            class: "text-input focusable",
            type: "text",
            id: "ai-model",
            value: state.ai.model || "",
            placeholder: "Model (optional)",
          }),
          el("button", {
            class: "btn primary focusable",
            type: "button",
            text: "Save model",
            onclick: async (e) => {
              const value = e.target.closest(".provider").querySelector("#ai-model").value.trim();
              state.ai.model = value;
              writeJSON(KEY.ai, state.ai);
              await pushSettings({ ai: { model: value } });
              render();
            },
          }),
        ),
      ),
      aiAskRow(),
      // "Pick for me": the Ask box answers with one row type instead of both.
      el("p", { class: "option-title", text: "Pick movies or shows for me" }),
      el("p", { class: "option-desc", text: "Which row the Ask box searches. Both is the default, and a picked side rides along as the search's Type filter." }),
      ...[ ["", "Both"], ["movie", "Movies"], ["series", "Shows"] ].map(([value, label]) =>
        radioRow((state.ai.pickRow || "") === value, "pickrow", label, "", () => {
          state.ai.pickRow = value;
          writeJSON(KEY.ai, state.ai);
          pushSettings({ ai: { pickRow: value } });
          render();
        }),
      ),
    ] : null,
  ];
}


// Used only when the server predates the options payload, so the selects are
// never empty.
const FALLBACK_LANGUAGES = [["en-US", "English (US)"], ["hi-IN", "Hindi"], ["es-ES", "Spanish"]];
const FALLBACK_COUNTRIES = [["US", "United States"], ["IN", "India"], ["GB", "United Kingdom"]];

/**
 * Content — where you are, and what language you read it in.
 *
 * The country drives the three Regional OTT cards (that country's own services,
 * not every region's), and the language is the language every row is served in —
 * which is also the primary subtitle language.
 */
/**
 * Content: what the rows contain.
 *
 * The country picker is gone as well as the language one. Both belonged to the
 * regional OTT cards' *names* rather than to what a row holds, and the country is
 * published by the server (`/settings` → `country`) — so the two settings that
 * only ever confused the question "what am I looking at?" are not here. What is
 * left is the one switch that really does change a row's contents.
 */
function paneContent() {
  return [
    radioRow(state.safe, "safe", "SFW", "Safe for work — adult titles excluded (TMDB default).", () => {
      state.safe = true; writeJSON(KEY.safe, true); pushSettings({ safe: true }); render();
    }),
    radioRow(!state.safe, "safe", "NSFW", "Include adult titles where TMDB supports it.", () => {
      state.safe = false; writeJSON(KEY.safe, false); pushSettings({ safe: false }); render();
    }),
    el("p", { class: "option-title", text: "Refresh catalogs & metadata" }),
    el("p", { class: "option-desc", text: "How often the addon re-reads TMDB and the screen re-reads itself. The addon's cache follows the same interval, so a row can actually come back different." }),
    ...REFRESH_CHOICES.map(([minutes, label]) =>
      radioRow(Number(state.refresh) === minutes, "refresh", label, minutes === 0 ? "Nothing is re-read until you press Refresh now." : `Catalogs and metadata are re-read every ${minutes} minutes.`, () => {
        state.refresh = minutes;
        writeJSON(KEY.refresh, minutes);
        pushSettings({ refresh: { minutes } });
        render();
      }),
    ),
    el("div", { class: "provider" },
      el("button", { class: "btn primary focusable", type: "button", text: "Refresh now", onclick: () => refreshNow() }),
    ),
    // The Custom card's label. The card holds *your* list, so what it is called is
    // yours to say; the name is stored server-side (Settings) and the card set is
    // re-read so Home shows the new label immediately.
    el("p", { class: "option-title", text: "Custom card" }),
    el("p", { class: "option-desc", text: "The name of the Custom card on Home — the list you fill yourself from any title's modal." }),
    el("div", { class: "provider" },
      el("input", {
        class: "text-input focusable",
        type: "text",
        id: "custom-label",
        maxlength: "40",
        placeholder: "Custom",
        value: state.customLabel || "",
        onchange: async (event) => {
          const value = String(event.currentTarget.value || "").trim().slice(0, 40) || "Custom";
          state.customLabel = value;
          await pushSettings({ customLabel: value });
          await refreshCollections();
          render();
        },
      }),
    ),
  ];
}

/**
 * Paint the accent and the motion setting onto the document.
 *
 * Both are applied as CSS custom properties / one root class, so every rule in
 * the stylesheet follows them and nothing has to be re-rendered to re-tint.
 */
function applyTheme() {
  const [, , rgb, base, deep] = accentOf(state.accent);
  const root = document.documentElement;
  root.style.setProperty("--accent", base);
  root.style.setProperty("--accent-rgb", rgb);
  root.style.setProperty("--accent-deep", deep);
  root.classList.toggle("motion-off", state.motion === "off");
  root.classList.toggle("motion-full", state.motion === "full");
  // Written out for the boot script in `index.html`, which applies them **before
  // the first paint**. Without it the app painted its default gold and then
  // re-tinted a frame later — the "golden accent on boot" flash.
  try {
    localStorage.setItem(KEY.theme, JSON.stringify({ base, rgb, deep, motion: state.motion }));
  } catch {
    /* private mode — the app still tints, it just flashes on the next boot */
  }
}

/** Settings → Appearance: the accent colour, and how much the app moves. */
function paneAppearance() {
  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Accent colour" }),
      el("p", { class: "option-desc", text: "The colour the app is painted in — buttons, chips, highlights, borders. Gold is the default; pick another and the whole app follows." }),
      el("div", { class: "accent-row" },
        ...ACCENTS.map(([id, label, , base]) =>
          el("button", {
            class: `accent-swatch focusable${state.accent === id ? " active" : ""}`,
            type: "button",
            id: `accent-${id}`,
            title: label,
            "aria-label": label,
            "aria-pressed": String(state.accent === id),
            style: `--swatch: ${base}`,
            onclick: () => {
              state.accent = id;
              localStorage.setItem(KEY.accent, id);
              applyTheme();
              render();
            },
          }),
        ),
      ),
      el("div", { class: "provider-check" }, el("span", { class: "source-status", text: `Accent: ${accentOf(state.accent)[1]}` })),
    ),
    el("div", { class: "group-head" },
      el("span", { class: "option-title", text: "Motion" }),
      el("span", { class: "option-desc", text: "Transitions between screens, hover lifts and the row highlight." }),
    ),
    ...MOTIONS.map(([value, title, desc]) =>
      radioRow(state.motion === value, "motion", title, desc, () => {
        state.motion = value;
        localStorage.setItem(KEY.motion, value);
        applyTheme();
        render();
      }),
    ),
  ];
}

function paneLayout() {
  return LAYOUTS.map(([value, title, desc]) =>
    radioRow(state.layout === value, "layout", title, desc, () => {
      state.layout = value;
      localStorage.setItem(KEY.layout, value);
      render();
    }),
  );
}

/**
 * Settings → Appearance & layout, one pane: how the app looks (accent, motion) and
 * how its cards are laid out. They were two tabs for one question.
 */
function paneAppearanceLayout() {
  return [
    ...paneAppearance(),
    el("div", { class: "h-divider", "aria-hidden": "true" }),
    el("div", { class: "group-head" },
      el("span", { class: "option-title", text: "Layout" }),
      el("span", { class: "option-desc", text: "How Home holds its cards." }),
    ),
    ...paneLayout(),
  ];
}

/** One source section (Add-ons or Plugins), with server-side inspection. */
function sourceSection(title, hint, types, list) {
  const select = el("select", { class: "text-input focusable" }, ...types.map(([value, label]) => el("option", { value, text: label })));
  const urlInput = el("input", { class: "text-input focusable", type: "text", placeholder: "https://…" });
  const add = el("button", {
    class: "btn primary focusable",
    type: "button",
    text: "Add",
    onclick: async () => {
      const url = urlInput.value.trim();
      if (!url) return;
      state.sources.push({ type: select.value, url, status: null });
      urlInput.value = "";
      saveSources();
      await inspectSource(state.sources.length - 1);
    },
  });
  return [
    el("p", { class: "option-desc", text: hint }),
    el("div", { class: "source-form" }, select, urlInput, add),
    list.length ? el("div", { class: "sources" }, ...list.map((s) => sourceRow(s, state.sources.indexOf(s)))) : el("p", { class: "option-desc", text: "None added yet." }),
  ];
}

/**
 * Keep the sources on the server as well as in this page.
 *
 * They have to live server-side because **reading a stream happens there** (a
 * browser cannot call another host's `/stream/…`), and because the addon publishes
 * what it can play to Nuvio itself. The page keeps its own copy so Settings draws
 * instantly and works offline.
 */
function saveSources() {
  writeJSON(KEY.sources, state.sources);
  pushSettings({ sources: state.sources });
}

/**
 * Inspect a source **through our server** (`/api/source`). Doing it here instead
 * of in the page is what makes third-party sources work: a browser is blocked by
 * CORS from reading another host's manifest.json.
 */
async function inspectSource(index, { quiet = false } = {}) {
  const source = state.sources[index];
  if (!source) return;
  if (!quiet) {
    source.status = { ok: false, text: "Checking…" };
    render();
  }
  try {
    const res = await post("/api/source", { type: source.type, url: source.url });
    source.providers = res.providers || [];
    source.resources = res.resources || [];
    source.scrapers = res.scrapers || [];
    source.kind = res.kind || "";
    source.name = res.name || source.name;
    source.status = { ok: Boolean(res.ok), text: res.ok ? `${res.name || typeLabel(source.type)} · ${res.message}` : res.message };
  } catch (err) {
    source.status = { ok: false, text: `could not check — ${err.message}` };
  }
  saveSources();
  if (!quiet) render();
}

/**
 * Read every source the app has not read yet — quietly, and only once.
 *
 * A source restored from an older build (or added on another device) is stored
 * without its providers, and its row then shows nothing under it. Reading them here
 * is what makes the providers appear on their own instead of waiting for a click
 * that nothing on screen tells you to make. A source that answered badly keeps its
 * status, so this never runs twice for the same source.
 */
async function hydrateSources() {
  const pending = state.sources.filter((s) => s && !s.status);
  if (!pending.length) return;
  for (const source of pending) await inspectSource(state.sources.indexOf(source), { quiet: true });
  render();
}

function sourceRow(source, index) {
  return el("div", { class: "source" },
    el("div", { class: "source-main" },
      el("span", { class: "source-type", text: `${typeLabel(source.type)}${source.name ? ` · ${source.name}` : ""}` }),
      el("span", { class: "source-url", text: source.url }),
      source.status ? el("span", { class: `source-status ${source.status.ok ? "ok" : "bad"}`, text: source.status.text }) : null,
      ...sourceBody(source),
    ),
    el("div", { class: "source-actions" },
      el("button", { class: "btn subtle focusable", type: "button", text: "Providers", title: "Read this source's providers", onclick: () => inspectSource(index) }),
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Remove",
        onclick: () => {
          state.sources.splice(index, 1);
          saveSources();
          render();
        },
      }),
    ),
  );
}

/**
 * Settings → Add-ons & plugins, one pane: both kinds of source, each with its own
 * form, so "where do I add a source?" has one answer.
 */
function paneAddonsPlugins() {
  const addons = state.sources.filter((s) => ADDON_TYPES.some(([t]) => t === s.type));
  const plugins = state.sources.filter((s) => PLUGIN_TYPES.some(([t]) => t === s.type));
  return [
    ...sourceSection("Stremio add-ons", "A Stremio add-on URL is read on the server (manifest.json), so it works even when the host sends no CORS headers — its catalogs, metadata, streams and subtitles are listed as providers.", ADDON_TYPES, addons),
    el("div", { class: "h-divider tracking-divider", "aria-hidden": "true" }),
    ...sourceSection("Nuvio plugins", "A Nuvio plugin is read on the server and the scrapers it publishes are listed as providers.", PLUGIN_TYPES, plugins),
  ];
}

/**
 * Settings → Trackers & providers, one pane.
 *
 * The trackers come **first**, in their three groups, then the providers that supply
 * the content and the keys that make them work.
 */
function paneTrackersProviders() {
  return [...paneTracking(), el("div", { class: "h-divider tracking-divider", "aria-hidden": "true" }), ...paneProviders()];
}

function renderSettings() {
  const section = state.settingsSection;

  const panes = {
    livesource: paneLiveSource,
    livecountries: paneLiveCountries,
    liveguide: paneLiveGuide,
    liverefresh: paneLiveRefresh,
    profile: paneProfile,
    posters: panePosters,
    providers: paneTrackersProviders,
    // The old tabs are kept as aliases so a section id remembered in localStorage
    // still lands on the pane it named instead of falling back to the first one.
    tracking: paneTrackersProviders,
    ai: paneAi,
    content: paneContent,
    addons: paneAddonsPlugins,
    plugins: paneAddonsPlugins,
    layout: paneAppearanceLayout,
    appearance: paneAppearanceLayout,
    livelayout: paneAppearanceLayout,
  };

  // A stored section that does not exist for this profile (the Live TV profile has
  // its own set) falls back to that profile's first section.
  const sections = settingsSections();
  const active = sections.find(([id]) => id === section) || sections[0];

  const nav = el("nav", { class: "settings-nav", "aria-label": "Settings sections" },
    ...settingsGroups().flatMap((group) => [
      el("span", { class: "settings-group", text: group.group }),
      ...group.sections.map(([id, label]) =>
        el("button", {
          class: `settings-tab focusable${id === active[0] ? " active" : ""}`,
          type: "button",
          "aria-current": id === active[0] ? "true" : false,
          text: label,
          onclick: () => {
            state.settingsSection = id;
            localStorage.setItem(KEY.section, id);
            render();
          },
        }),
      ),
    ]),
  );

  const body = el("section", { class: "setting" },
    el("h3", { text: active[1] }),
    (panes[active[0]] || paneProfile)(),
  );

  return [
    el("h1", { class: "view-title", text: "Settings" }),
    el("p", { class: "view-hint", text: `Profile: ${state.profile}` }),
    el("div", { class: "settings" }, nav, el("div", { class: "settings-pane" }, body)),
  ];
}

/* ------------------------------------------------------------------- chrome */

/** The profile button is an icon — the profile it stands for lives in its title. */
function renderProfile() {
  const btn = document.getElementById("profile");
  const label = `Profile: ${state.profile} — switch profile`;
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(
    ...TABS.map(([key, label]) =>
      el("button", {
        class: "tab focusable",
        type: "button",
        role: "tab",
        "aria-selected": String(parseHash().view === "home"),
        text: label,
        onclick: () => go("#/"),
      }),
    ),
  );
}

/**
 * Take the boot screen away once the first screen is on the page.
 *
 * The fade is CSS; this only flips the class after that first paint, so what
 * appears behind the splash is a finished screen rather than an empty shell. The
 * node is hidden once the fade is over so it cannot swallow a click.
 */
function endBoot() {
  const bootScreen = document.getElementById("boot");
  if (!bootScreen || bootScreen.classList.contains("done")) return;
  bootScreen.classList.add("done");
  setTimeout(() => { bootScreen.hidden = true; }, 700);
}

/** Which screen a route points at, for remembering where it was scrolled. */
const routeOf = (r) => [r.view, r.key || "", r.id || "", r.name || "", r.group || ""].join("|");

/** Where each screen was last left, so going back does not land at the top. */
const scrollMemory = new Map();
let lastRoute = "";

async function render() {
  const parsed = parseHash();
  const { view, key, id, name, group, type, kind, extra } = parsed;
  const browsing = ["home", "card", "explore"].includes(view);

  // A screen you are **returning to** is put back where you left it, and a screen
  // you are **already on** does not move at all — a pin, a filter or a settings
  // toggle re-renders the same route and must not throw the page back to the top,
  // which is what a bare `scrollTo(0)` here used to do on every click.
  const route = routeOf(parsed);
  const wasAt = window.scrollY;
  if (lastRoute && lastRoute !== route) scrollMemory.set(lastRoute, wasAt);
  const restore = route === lastRoute ? wasAt : scrollMemory.get(route) ?? 0;
  lastRoute = route;

  document.getElementById("tabs").hidden = !browsing;
  document.getElementById("back").hidden = view === "home" || view === "profiles";
  document.getElementById("settings").hidden = !browsing;
  document.getElementById("search").hidden = !browsing;
  // The switch-profile screen is full screen: no browsing chrome over it.
  document.getElementById("calendar").hidden = view === "profiles";
  renderProfile();

  let nodes;
  if (view === "guide") nodes = renderGuide();
  else if (view === "categories") nodes = renderLiveCategories();
  else if (view === "category") nodes = renderLiveCategory(group);
  else if (view === "channel") nodes = renderChannel(id);
  else if (view === "title") nodes = await renderTitle(type, id);
  else if (view === "list") nodes = await renderList(kind, id, type, extra);
  else if (view === "profiles") nodes = renderProfiles();
  else if (view === "card") nodes = renderCard(key);
  else if (view === "explore") nodes = renderExplore(key, id);
  else if (view === "sources") nodes = renderSources(id, name);
  else if (view === "settings") nodes = renderSettings();
  else if (view === "search") nodes = liveProfile() ? renderLiveSearch() : renderSearch();
  else if (view === "calendar") nodes = renderCalendar();
  // The second profile has its own Home — the channels, not the cards.
  else nodes = liveProfile() ? renderLiveHome() : renderHome();

  const main = document.getElementById("main");
  main.replaceChildren(...nodes);
  // Now that the frames are in the document, lay the cards' own pictures into
  // them — in place of the generated vector scene.
  hydrateContent();
  // One class, animation defined in the stylesheet: the new screen arrives
  // instead of appearing, and "no animation" removes it entirely.
  main.classList.remove("view-in");
  void main.offsetWidth;
  main.classList.add("view-in");
  renderTabs();
  window.scrollTo({ top: restore });

  // Only Home has a banner: the ten-second rotation runs there, and any other screen
  // stops it rather than leaving a timer redrawing a banner that is not on screen.
  // The Live TV profile has no banner to rotate — its first card is the Guide.
  if (view === "home" && !liveProfile()) startHeroRotation();
  else stopHeroRotation();
  // The catalog refresh runs on every browsing view, not just Home.
  startAutoRefresh();
  // A source stored without its providers is read once, so its providers appear
  // without anyone having to press anything.
  queueMicrotask(hydrateSources);
}

/* ------------------------------------------------------------ keyboard nav */

/**
 * Wheel over the titles scrolls the titles — and only the titles.
 *
 * Pointing at a row and scrolling is how you browse cards, so the wheel moves
 * the row under the cursor *instead of* the page. That stays true at either end
 * of the row as well: the page must not start scrolling because the row ran out,
 * which used to drag the whole screen away the moment a row ended. The page
 * scrolls normally anywhere the cursor is not over a row of titles.
 *
 * Shift+wheel and trackpad horizontal gestures keep their normal meaning.
 */
const ROW_SELECTOR = ".strip, .icons.rows";

/** Is the app asked not to animate? "Always" overrides the system preference. */
const reducedMotion = () => {
  const root = document.documentElement;
  if (root.classList.contains("motion-full")) return false;
  if (root.classList.contains("motion-off")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
};

/**
 * Scroll a row smoothly instead of jumping one wheel-notch at a time.
 *
 * A raw `scrollLeft += delta` per wheel event is what made the rows feel rough:
 * the browser fires a burst of wheel events with uneven deltas, and every one of
 * them snapped the row to a new position. Here the wheel only moves a *target*,
 * and a frame loop eases the row toward it, so a flick glides and a slow scroll
 * creeps. With motion switched off it goes straight to the target.
 */
const glides = new WeakMap();

function glide(row, target) {
  if (reducedMotion()) {
    row.scrollLeft = target;
    return;
  }
  const anim = glides.get(row) || { target: row.scrollLeft, raf: 0 };
  anim.target = target;
  glides.set(row, anim);
  if (anim.raf) return;
  const step = () => {
    const delta = anim.target - row.scrollLeft;
    if (Math.abs(delta) < 0.6) {
      row.scrollLeft = anim.target;
      anim.raf = 0;
      return;
    }
    row.scrollLeft += delta * 0.24;
    anim.raf = requestAnimationFrame(step);
  };
  anim.raf = requestAnimationFrame(step);
}

function horizontalWheel() {
  document.addEventListener(
    "wheel",
    (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      // A menu, the modal or a dropdown keeps its own scrolling.
      if (e.target?.closest?.(".cat-menu, .modal-card, .settings-nav, .search-suggest")) return;
      const row = e.target?.closest?.(ROW_SELECTOR);
      // A row that has nothing clipped scrolls nowhere — leave that to the page.
      if (!row || row.scrollWidth - row.clientWidth <= 1) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      // The page never moves while the cursor is on the titles: the row takes the
      // wheel to its end and then simply stops.
      e.preventDefault();
      glide(row, Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + delta)));
    },
    { passive: false },
  );
}

function setupInput() {
  document.getElementById("back").addEventListener("click", () => {
    const { view, key } = parseHash();
    if (view === "explore") go(`#/c/${encodeURIComponent(key)}`);
    else go("#/");
  });
  document.getElementById("settings").addEventListener("click", () => go("#/settings"));
  document.getElementById("search").addEventListener("click", () => go("#/search"));
  document.getElementById("calendar").addEventListener("click", () => go("#/calendar"));

  // The profile icon opens the switch-profile screen (it no longer drops a menu).
  document.getElementById("profile").addEventListener("click", () => {
    if (parseHash().view === "profiles") return;
    go("#/profiles");
  });

  document.getElementById("modal-sources").addEventListener("click", () => {
    if (!modalItem) return;
    go(`#/s/${encodeURIComponent(modalItem.id)}/${encodeURIComponent(modalItem.name || "Title")}`);
    modal.close();
  });

  for (const node of document.querySelectorAll("[data-close]")) node.addEventListener("click", () => modal.close());
  window.addEventListener("hashchange", render);
  horizontalWheel();

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
    if (typing) return;
    const list = [...document.querySelectorAll(".focusable")].filter((n) => n.offsetParent !== null);
    const cur = document.activeElement;
    let i = list.indexOf(cur);

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (!list.length) return;
      e.preventDefault();
      i = i === -1 ? 0 : i + (e.key === "ArrowRight" ? 1 : -1);
      list[Math.max(0, Math.min(list.length - 1, i))].focus();
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!list.length) return;
      e.preventDefault();
      if (i === -1) return list[0].focus();
      const from = cur.getBoundingClientRect();
      let best = null;
      let bestScore = Infinity;
      for (const node of list) {
        if (node === cur) continue;
        const r = node.getBoundingClientRect();
        const dy = r.top - from.top;
        if (e.key === "ArrowDown" && dy < 12) continue;
        if (e.key === "ArrowUp" && dy > -12) continue;
        const score = Math.abs(dy) * 3 + Math.abs(r.left - from.left);
        if (score < bestScore) {
          bestScore = score;
          best = node;
        }
      }
      if (best) best.focus();
      return;
    }

    if (e.key === "Escape" || e.key === "Backspace") {
      if (!modal.root.hidden) return modal.close();
      if (parseHash().view !== "home") { e.preventDefault(); go("#/"); }
    }
  });
}

/* ---------------------------------------------------------- Live TV & Sports */

/**
 * The second profile is a different app.
 *
 * It has its own two buttons (Live TV / Sports, where Movies & Shows has
 * Movies / Shows), its own cards — the channels, grouped by the playlist's own
 * categories, with the Guide as the first card — its own screens (the TiviMate-
 * style Guide and a channel page) and its own settings, which replace the
 * Movies & Shows ones entirely rather than sitting beside them.
 */
const LIVE_ROWS = [["livetv", "Live TV"], ["sports", "Sports"]];
const liveProfile = () => state.profile === LIVE_PROFILE;

const liveRowKey = () => state.liveRow;
const setLiveRow = (value) => {
  state.liveRow = value;
  localStorage.setItem(KEY.liveRow, value);
};

/** The Live TV / Sports switch — the profile's own two buttons. */
function liveRowSwitch() {
  return el(
    "div",
    { class: "row-switch", role: "tablist", "aria-label": "Live TV or Sports" },
    ...LIVE_ROWS.map(([value, label]) =>
      el("button", {
        class: `row-btn focusable${liveRowKey() === value ? " active" : ""}`,
        type: "button",
        role: "tab",
        id: `live-row-${value}`,
        "aria-selected": String(liveRowKey() === value),
        text: label,
        onclick: () => {
          setLiveRow(value);
          render();
        },
      }),
    ),
  );
}

/** The live source, as the app keeps it (the server keeps its own masked copy). */
function liveSource() {
  const live = {
    // `dth` is the premium/DTH/operator catalogue — the profile's own source. `m3u`
    // and `xtream` are your own box's export.
    mode: "dth",
    m3u: "",
    host: "",
    username: "",
    password: "",
    epg: "",
    refreshMinutes: 0,
    // Which of the catalogue's providers this profile is drawn from. Empty means
    // "not picked yet", and the app says so rather than showing an empty profile.
    providers: [],
    // Which countries of the catalogue this profile is scoped to. `allCountries`
    // means every country the catalogue covers; a picked list means just those.
    countries: [],
    allCountries: false,
    ...state.liveSource,
  };
  // A stored mode from before the catalogue replaced the public directory says
  // "demo", which is not a source any more — land on the catalogue rather than on a
  // pane with nothing selected.
  if (!["dth", "m3u", "xtream"].includes(live.mode)) live.mode = "dth";
  if (!Array.isArray(live.providers)) live.providers = [];
  return live;
}

/**
 * The countries Live TV is scoped to, as the `countries=` parameter.
 *
 * Empty means "no filter": either every country is enabled or none is picked, and
 * the whole directory is in play either way. This one string is what the Guide, the
 * Categories card and the channel rows all read, so one setting moves them together.
 */
const liveCountriesPicked = () => {
  const live = liveSource();
  if (live.allCountries) return "";
  return (Array.isArray(live.countries) ? live.countries : []).map((c) => String(c).toUpperCase()).join(",");
};

const liveFetch = (params = {}, force = false) => {
  const p = new URLSearchParams({ limit: "400", ...params });
  const picked = liveCountriesPicked();
  if (picked && !p.has("countries")) p.set("countries", picked);
  if (force) p.set("force", "1");
  return get(`/live/channels.json?${p.toString()}`);
};

/**
 * Read the channels: the full list once, then one row per category.
 *
 * Rows are per category because that is what the request asked for — cards like
 * the Movies & Shows ones — and because one request per row keeps each row's
 * payload small however large the playlist is.
 */
async function loadLive({ force = false } = {}) {
  if (state.live.loading) return;
  state.live = { ...state.live, loading: true };
  render();
  try {
    // **One read, not one per group.** Live TV used to fetch the lineup and then a
    // second request per category to draw a channel row for each one — a dozen calls
    // to paint rows nobody asked for. The profile is two cards and the channels are
    // inside them, so the lineup is read once and the categories come from the
    // server's own group list.
    const first = await liveFetch({ limit: String(LIVE_CHANNEL_LIMIT) }, force);
    state.live = {
      loading: false,
      loaded: true,
      all: first.channels || [],
      total: first.total || 0,
      groups: (first.groups || []).map((g) => g.name).filter((name) => name && name !== "General"),
      // The server's own group list — name *and* channel count — which is what the
      // Channels screen draws its tiles from.
      groupList: first.groups || [],
      updated: first.updated || 0,
      error: first.error || "",
      guide: state.live.guide,
      guideLoading: false,
      guideError: state.live.guideError,
    };
  } catch (err) {
    state.live = { ...state.live, loading: false, loaded: true, error: String((err && err.message) || err) };
  }
  render();
}

/**
 * Every channel currently on screen, for the Guide, the cards and lookups.
 *
 * The **Sports** tab is the Live TV lineup filtered to sport — by the channel's own
 * name and its groups — rather than a second list built from category rows. A
 * lineup with nothing sport-shaped in it falls back to the whole list, so the tab
 * is never an empty screen on a playlist that simply does not carry any.
 */
function liveChannelsShown() {
  const all = state.live.all || [];
  if (liveRowKey() !== "sports") return all;
  const sport = all.filter((c) => /sport/i.test(`${c.name || ""} ${(c.groups || []).join(" ")}`));
  return sport.length ? sport : all;
}

const findChannel = (id) => liveChannelsShown().find((c) => c.id === id) || (state.live.all || []).find((c) => c.id === id) || null;

/* ------------------------------------------------------------------- guide */

/** Read the guide: programme blocks per channel id, when an EPG URL is set. */
async function loadGuide({ force = false } = {}) {
  if (state.live.guideLoading) return;
  state.live = { ...state.live, guideLoading: true };
  render();
  try {
    const picked = liveCountriesPicked();
    const guide = await get(
      `/live/guide.json?hours=6${force ? "&force=1" : ""}${picked ? `&countries=${encodeURIComponent(picked)}` : ""}`,
    );
    state.live = { ...state.live, guideLoading: false, guide, guideError: guide.error || "" };
  } catch (err) {
    state.live = { ...state.live, guideLoading: false, guideError: String((err && err.message) || err) };
  }
  render();
}

const minutesLeft = (ms) => Math.max(0, Math.round(ms / 60_000));
const clockOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The programme on now, and the one after, for one channel. */
function nowNext(channel, guide) {
  const key = channel.epgId || channel.id;
  const list = guide?.programmes?.[key] || [];
  const now = Date.now();
  const index = list.findIndex((p) => p.start <= now && p.stop > now);
  if (index === -1) return { now: null, next: list.find((p) => p.start > now) || null };
  return { now: list[index], next: list[index + 1] || null };
}

/**
 * The Guide — the TiviMate-shaped grid: a time ruler across the top, a channel
 * column down the left, and one block per programme.
 *
 * The blocks are real programmes when an XMLTV URL is set. Without one the grid
 * still draws the lineup and says so once at the top, rather than inventing a
 * schedule or hiding the screen.
 */
function renderGuide() {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  if (!state.live.guide && !state.live.guideLoading) queueMicrotask(() => loadGuide());

  const channels = liveChannelsShown().slice(0, LIVE_GUIDE_CHANNELS);
  const guide = state.live.guide;
  const hasEpg = Boolean(guide && guide.epg);
  const start = Date.now();
  const span = LIVE_GUIDE_HOURS * 3600_000;
  const hours = Array.from({ length: LIVE_GUIDE_HOURS }, (_, i) => start + i * 3600_000);

  const rows = channels.map((channel, i) => {
    const programs = hasEpg ? (guide.programmes[channel.epgId || channel.id] || []) : [];
    const blocks = programs
      .filter((p) => p.stop > start && p.start < start + span)
      .map((p) => {
        const from = Math.max(p.start, start);
        const to = Math.min(p.stop, start + span);
        const left = ((from - start) / span) * 100;
        const width = Math.max(((to - from) / span) * 100, 2);
        return el(
          "div",
          { class: "guide-block", style: `left:${left}%;width:${width}%` },
          el("span", { class: "guide-block-title", text: p.title }),
          el("span", { class: "guide-block-time", text: `${clockOf(p.start)} – ${clockOf(p.stop)}` }),
        );
      });
    return el(
      "div",
      { class: "guide-row" },
      el(
        "button",
        {
          class: "guide-channel focusable",
          type: "button",
          title: `Open ${channel.name}`,
          onclick: () => go(`#/channel/${encodeURIComponent(channel.id)}`),
        },
        el("span", { class: "guide-num", text: String(i + 1) }),
        channel.logo
          ? el("img", { class: "guide-logo", src: channel.logo, alt: "", loading: "lazy" })
          : el("span", { class: "guide-logo fallback", text: (channel.name || "?").slice(0, 1).toUpperCase() }),
        el("span", { class: "guide-name", text: channel.name }),
      ),
      el(
        "div",
        { class: `guide-track${hasEpg ? "" : " bare"}` },
        hasEpg ? blocks : el("span", { class: "guide-nodata", text: "No programme data" }),
      ),
    );
  });

  const marker = ((Math.max(Date.now(), start) - start) / span) * 100;

  return [
    el("h1", { class: "view-title", text: "Guide" }),
    el("p", { class: "view-hint", text: `${channels.length} channels · the next ${LIVE_GUIDE_HOURS} hours` }),
    liveRowSwitch(),
    hasEpg
      ? null
      : el("p", {
          class: "view-hint",
          text: "No guide data — add an XMLTV (EPG) URL in Settings → Guide & EPG and these rows fill with real programmes.",
        }),
    el(
      "div",
      { class: "guide" },
      el(
        "div",
        { class: "guide-head" },
        el("span", { class: "guide-corner", text: "Channel" }),
        el(
          "div",
          { class: "guide-times" },
          ...hours.map((h) => el("span", { class: "guide-time", text: clockOf(h) })),
          // Where "now" is, so the grid reads like a live TV app's.
          el("span", { class: "guide-now", style: `left:${marker}%`, "aria-hidden": "true" }),
        ),
      ),
      el("div", { class: "guide-body" }, ...rows),
    ),
  ].filter(Boolean);
}

/* ----------------------------------------------------------------- channels */

/** One channel tile: logo, name, and the group/country it came with. */
function channelCard(channel) {
  return el(
    "button",
    {
      class: "channel-card focusable",
      type: "button",
      title: `${channel.name}${channel.groups?.length ? ` — ${channel.groups.join(", ")}` : ""}`,
      onclick: () => go(`#/channel/${encodeURIComponent(channel.id)}`),
    },
    el(
      "span",
      { class: "channel-art" },
      channel.logo
        ? el("img", { src: channel.logo, alt: "", loading: "lazy" })
        : el("span", { class: "channel-fallback", text: (channel.name || "?").slice(0, 1).toUpperCase() }),
    ),
    el("span", { class: "channel-name", text: channel.name }),
    el("span", { class: "channel-sub", text: [channel.groups?.[0], channel.country].filter(Boolean).join(" · ") }),
  );
}

function channelRow(name, channels) {
  return el(
    "section",
    { class: "cat-row live-row", "data-group": name },
    el(
      "header",
      { class: "cat-head" },
      el("h2", { class: "cat-name", text: name }),
      el("span", { class: "cat-count", text: `${channels.length} channels` }),
    ),
    el("div", { class: "channel-strip" }, ...channels.map(channelCard)),
  );
}

/**
 * One Live TV card — the same box a Movies card wears.
 *
 * The profile's two cards used to be `hero` **banners**: a full-width panel with a
 * big title and two buttons, twice, one under the other. They are **cards** now,
 * exactly like Genres and Decades are on the Movies home: a 16:9 frame carrying the
 * first few rows of what is inside it, then the name and a line of description under
 * it — and the frame is the button, the way a cover is.
 */
function liveCard({ id, title, sub, rows, action }) {
  return el(
    "div",
    { class: "icon-box live-card" },
    el(
      "div",
      { class: "icon-wrap" },
      el(
        "button",
        { class: "icon-art focusable", type: "button", id, title, "aria-label": title, onclick: action },
        el("div", { class: "guide-mini" }, ...rows),
      ),
    ),
    el(
      "span",
      { class: "icon-meta" },
      el("span", { class: "icon-name", text: title }),
      el("span", { class: "icon-sub", text: sub }),
    ),
  );
}

/** The Guide card — the first card of the profile, and its way into the grid. */
function guideCard() {
  const channels = liveChannelsShown().slice(0, 4);
  const guide = state.live.guide;
  const rows = channels.map((channel) => {
    const { now } = nowNext(channel, guide);
    return el(
      "div",
      { class: "guide-mini-row" },
      el("span", { class: "guide-mini-name", text: channel.name }),
      el("span", { class: `guide-mini-block${now ? "" : " bare"}`, text: now ? now.title : "—" }),
    );
  });
  if (!rows.length) {
    rows.push(
      el("div", { class: "guide-mini-row" },
        el("span", { class: "guide-mini-name", text: "Lineup" }),
        el("span", { class: "guide-mini-block bare", text: state.live.loading ? "reading…" : "—" })),
    );
  }
  const updated = state.live.updated ? new Date(state.live.updated).toLocaleTimeString() : "";
  return liveCard({
    id: "open-guide",
    title: "Guide",
    sub: [
      `${state.live.total || state.live.all.length} channels`,
      state.live.groups.length ? `${state.live.groups.length} categories` : "",
      updated ? `updated ${updated}` : "",
      state.live.guide && state.live.guide.epg === false ? "no EPG yet" : "",
    ].filter(Boolean).join(" · "),
    rows,
    action: () => go("#/guide"),
  });
}

/**
 * The Channels card — the profile's second card.
 *
 * It was a **Categories** card that listed category names and nothing else, which
 * is a table of contents for a list you have not seen. This one is the channels
 * themselves: the first few in the lineup, and the count, with the frame opening the
 * full list. No category rows sit under it either — the wall of one row per category
 * is gone, so the profile is the switch, two cards, and the screens they open.
 */
function channelsCard() {
  const channels = liveChannelsShown();
  const rows = channels.slice(0, 4).map((channel) =>
    el(
      "div",
      { class: "guide-mini-row" },
      el("span", { class: "guide-mini-name", text: channel.name }),
      el("span", { class: "guide-mini-block", text: channel.groups?.[0] || "—" }),
    ),
  );
  if (!rows.length) {
    rows.push(
      el("div", { class: "guide-mini-row" },
        el("span", { class: "guide-mini-name", text: "Channels" }),
        el("span", { class: "guide-mini-block bare", text: state.live.loading ? "reading…" : "—" })),
    );
  }
  return liveCard({
    id: "open-channels",
    title: liveRowKey() === "sports" ? "Sports channels" : "Channels",
    sub: channels.length
      ? `${channels.length} channels${state.live.groups.length ? ` · ${state.live.groups.length} groups` : ""}`
      : "Reading the channel list…",
    rows,
    action: () => go("#/categories"),
  });
}

/**
 * The Live TV banner — this profile's own Spotlight.
 *
 * The Movies home opens on a banner, and the Live TV profile had none: it began
 * at the switch. This is the same box: a kicker that says which tab you are on, the
 * channel's name where a card's title sits, what is on it now (or its group when
 * there is no guide yet), its own groups as chips, and its picture on the right —
 * a channel's picture is its **logo**, so that is what the frame holds, centred on
 * the app's flat panel. There is nothing to rotate here the way the Movies banner
 * refreshes a backdrop: a logo and a name are already stable, so the banner picks
 * one channel per launch the way every card picks its own slice.
 */
function liveHeroBlock() {
  const channels = liveChannelsShown().filter((c) => c.name);
  if (!channels.length) return null;
  const channel = channels[LAUNCH_SEED % channels.length];
  const { now } = nowNext(channel, state.live.guide);
  const sports = liveRowKey() === "sports";
  const groups = channel.groups || [];
  return el(
    "section",
    { class: "hero live-hero" },
    el(
      "div",
      { class: "hero-body" },
      el("p", { class: "hero-kicker", text: sports ? "Sports" : "Live TV" }),
      el("h2", { class: "hero-title", text: channel.name }),
      el("p", {
        class: "hero-line",
        text: now
          ? `Now playing · ${now.title}`
          : [groups[0], channel.country].filter(Boolean).join(" · ") || "Live channel",
      }),
      chipLine(
        groups.map((group) =>
          el("button", {
            class: "chip focusable",
            type: "button",
            text: group,
            onclick: () => go(`#/categories/${encodeURIComponent(group)}`),
          }),
        ),
        { className: "hero-cats" },
      ),
    ),
    el(
      "button",
      {
        class: "hero-art focusable live-hero-art",
        type: "button",
        title: `Open ${channel.name}`,
        "aria-label": `Open ${channel.name}`,
        onclick: () => go(`#/channel/${encodeURIComponent(channel.id)}`),
      },
      channel.logo
        ? el("img", { class: "live-hero-logo", src: channel.logo, alt: "", loading: "lazy" })
        : el("span", { class: "live-hero-initials", text: initialsOf(channel.name) }),
    ),
  );
}

/**
 * Live TV & Sports Home.
 *
 * **The banner comes first, then the Live TV / Sports switch, then the two cards** —
 * the same reading as the Movies home, where the banner is above the Movies/Shows
 * buttons and the cards are under them. They were the other way round once, so the
 * cards floated over the tabs that decide what they show. Under the cards there is
 * **nothing**: the wall of one channel row per category is gone.
 */
function renderLiveHome() {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  const nodes = [
    liveHeroBlock(),
    liveRowSwitch(),
    el("div", { class: "icons grid live-cards" }, guideCard(), channelsCard()),
  ].filter(Boolean);
  if (state.live.loading && !state.live.loaded) {
    nodes.push(el("p", { class: "empty", text: "Reading the channel list…" }));
  } else if (state.live.error && !state.live.all.length) {
    nodes.push(el("p", { class: "empty", text: `The channel source could not be read — ${state.live.error}` }));
  } else if (state.live.error) {
    nodes.push(el("p", { class: "view-hint", text: `Last read failed (${state.live.error}) — showing the lineup from the last good read.` }));
  }
  return nodes;
}

/**
 * The Categories screen — every category in this playlist, with its channel count.
 *
 * Picking one opens that category's channels. The list is the playlist's own
 * vocabulary, not a fixed set, so a directory read by country and a personal M3U
 * both answer with their real categories.
 */
function renderLiveCategories() {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  const groups = state.live.groupList || [];
  return [
    el("h1", { class: "view-title", text: "Channels" }),
    el("p", {
      class: "view-hint",
      text: groups.length
        ? `${liveChannelsShown().length} channels in ${groups.length} groups — pick a group to see its channels.`
        : "Reading the channel list…",
    }),
    el(
      "div",
      { class: "cat-tiles" },
      ...groups.map((group) =>
        el(
          "button",
          {
            class: "cat-tile focusable",
            type: "button",
            "data-group": group.name,
            onclick: () => go(`#/categories/${encodeURIComponent(group.name)}`),
          },
          el("span", { class: "cat-tile-name", text: group.name }),
          el("span", { class: "cat-tile-count", text: `${group.count} channel${group.count === 1 ? "" : "s"}` }),
        ),
      ),
    ),
  ];
}

/** One category's channels. */
function renderLiveCategory(group) {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  if (state.live.categoryGroup !== group && !state.live.categoryLoading) loadLiveGroup(group);
  const channels = state.live.categoryGroup === group ? state.live.categoryChannels || [] : [];
  return [
    el("h1", { class: "view-title", text: group }),
    el("p", {
      class: "view-hint",
      text: channels.length ? `${channels.length} channels in ${group}.` : "Reading this category…",
    }),
    channels.length
      ? el("div", { class: "channel-strip search-channels" }, ...channels.map(channelCard))
      : el("p", { class: "empty", text: "No channels in this category." }),
  ];
}

/** Read one category's channels — one request, only when it is opened. */
async function loadLiveGroup(group) {
  state.live = { ...state.live, categoryGroup: group, categoryChannels: [], categoryLoading: true };
  render();
  try {
    const res = await liveFetch({ group, limit: "300" });
    state.live = { ...state.live, categoryGroup: group, categoryChannels: res.channels || [], categoryLoading: false };
  } catch {
    state.live = { ...state.live, categoryGroup: group, categoryChannels: [], categoryLoading: false };
  }
  render();
}

/** A channel page: what it is, what is on now, and where it streams from. */
function renderChannel(id) {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  const channel = findChannel(id);
  if (!channel) {
    return [
      el("h1", { class: "view-title", text: "Channel" }),
      el("p", { class: "empty", text: state.live.loading ? "Reading the channel list…" : "Channel not found in this playlist." }),
    ];
  }
  if (!state.live.guide && !state.live.guideLoading) queueMicrotask(() => loadGuide());
  const { now, next } = nowNext(channel, state.live.guide);
  const url = el("input", { class: "text-input focusable", type: "text", readonly: "", value: channel.url || "", id: "channel-url" });
  return [
    el(
      "section",
      { class: "section channel-page" },
      el(
        "header",
        { class: "section-head" },
        el(
          "div",
          { class: "section-meta" },
          el("h2", { text: channel.name }),
          el("p", { class: "hero-sub", text: [channel.groups?.join(" · "), channel.country].filter(Boolean).join(" · ") }),
          chipLine(
            [
              now ? el("span", { class: "chip", text: `Now: ${now.title} · ${minutesLeft(now.stop - Date.now())} min left` }) : null,
              next ? el("span", { class: "chip", text: `Next: ${next.title} · ${clockOf(next.start)}` }) : null,
            ].filter(Boolean),
          ),
        ),
        el(
          "div",
          { class: "section-art channel-art-large" },
          channel.logo
            ? el("img", { src: channel.logo, alt: channel.name })
            : el("span", { class: "channel-fallback big", text: (channel.name || "?").slice(0, 1).toUpperCase() }),
        ),
      ),
      el("div", { class: "group-head" }, el("span", { class: "option-title", text: "Stream" })),
      el("div", { class: "source-form" }, url,
        el("button", {
          class: "btn primary focusable",
          type: "button",
          id: "channel-play",
          text: IS_HLS(channel.url) ? "Play (HLS)" : "Play stream",
          disabled: !channel.url,
          onclick: () => openPlayer(channel.url, channel.name),
        }),
        el("button", {
          class: "btn subtle focusable",
          type: "button",
          text: "Copy link",
          onclick: () => {
            if (navigator.clipboard) navigator.clipboard.writeText(channel.url || "").catch(() => {});
          },
        }),
      ),
      el("p", {
        class: "option-desc",
        text: channel.url
          ? "Played here — an `.m3u8` live stream is handed to the app's own player, with the embedded copy of hls.js behind it, so this window and the APK play what the browser alone cannot. Copy the link to open it in a separate player instead."
          : "This channel has no stream URL in the lineup. Add your playlist under Settings → Source, or open the link in your own player.",
      }),
    ),
  ];
}

/**
 * Search in the Live TV profile searches *channels*, not titles.
 *
 * The Movies & Shows search asks TMDB about films; a live playlist has nothing to
 * do with that, and its channel list is already in memory — so this filters it as
 * you type, with the same suggestion behaviour (matching names under the box) the
 * other profile's search has.
 */
function renderLiveSearch() {
  if (!state.live.loaded && !state.live.loading) queueMicrotask(() => loadLive());
  const input = el("input", {
    class: "search-input focusable",
    type: "search",
    id: "search-input",
    placeholder: "Search channels…",
    autocomplete: "off",
  });
  const suggestions = el("div", { class: "search-suggest", id: "search-suggest", hidden: true });
  const results = el("div", { class: "channel-strip search-channels", id: "live-results" });

  const pool = () => state.live.all;
  const matches = (needle) => {
    const text = needle.trim().toLowerCase();
    if (!text) return [];
    const seen = new Set();
    const out = [];
    for (const channel of pool()) {
      if (seen.has(channel.id)) continue;
      if (!channel.name.toLowerCase().includes(text)) continue;
      seen.add(channel.id);
      out.push(channel);
      if (out.length >= 60) break;
    }
    return out;
  };

  const draw = () => {
    const hits = matches(input.value);
    suggestions.replaceChildren(
      ...hits.slice(0, 8).map((channel) =>
        el(
          "button",
          {
            class: "suggest-item focusable",
            type: "button",
            onclick: () => go(`#/channel/${encodeURIComponent(channel.id)}`),
          },
          el("span", { class: "suggest-kind", text: "Channel" }),
          el("span", { class: "suggest-text", text: `${channel.name}${channel.groups?.length ? ` — ${channel.groups[0]}` : ""}` }),
        ),
      ),
    );
    suggestions.hidden = !hits.length;
    results.replaceChildren(
      ...(input.value.trim() ? hits.map(channelCard) : []),
    );
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") suggestions.hidden = true;
  });

  return [
    el("h1", { class: "view-title", text: "Search channels" }),
    el("div", { class: "search-wrap" }, el("div", { class: "search-bar" }, input, suggestions)),
    el("p", { class: "view-hint", text: `${state.live.total || state.live.all.length} channels in this playlist — type to filter them.` }),
    results,
  ];
}

/* -------------------------------------------------- live settings panes */

/** Settings → Source: which playlist the channels come from. */
/** The provider catalogue, read once and kept for the session. */
let liveProviderList = null;

async function loadProviderList() {
  if (liveProviderList) return liveProviderList;
  try {
    const data = await get("/live/countries.json");
    liveProviderList = Array.isArray(data.providers) ? data.providers : [];
  } catch {
    liveProviderList = [];
  }
  return liveProviderList;
}

/**
 * The provider picker — the premium/DTH catalogue, one chip per provider.
 *
 * Live TV's lineup is a *subscriber's* lineup, so the first question is which
 * provider you are a subscriber of. Picking one is what makes the profile show
 * anything: its own feed names the channels and schedules them, and each chip says
 * whether that provider's guide is attached.
 */
function providerPicker(picked, save) {
  const search = el("input", {
    class: "text-input focusable",
    type: "text",
    id: "live-provider-filter",
    placeholder: "Filter providers or countries…",
  });
  const rows = el("div", { class: "filter-options country-picker", id: "live-providers" });
  const paint = () => {
    if (!liveProviderList) {
      rows.replaceChildren(el("p", { class: "empty", text: "Reading the provider catalogue…" }));
      return;
    }
    const needle = search.value.trim().toLowerCase();
    const matching = liveProviderList.filter(
      (p) => !needle || p.name.toLowerCase().includes(needle) || String(p.country).toLowerCase() === needle,
    );
    // What is already picked always stays on screen, so a choice cannot be hidden
    // by whatever is typed in the filter.
    const list = [
      ...liveProviderList.filter((p) => picked.has(p.id)),
      ...matching.filter((p) => !picked.has(p.id)),
    ].slice(0, 80);
    rows.replaceChildren(
      ...(list.length
        ? list.map((p) =>
            el("button", {
              class: `filter-chip focusable${picked.has(p.id) ? " active" : ""}`,
              type: "button",
              "data-provider": p.id,
              "aria-pressed": String(picked.has(p.id)),
              title: `${p.name} — ${p.country}${p.epg ? " · ships a public guide" : " · supply an EPG URL for its guide"}`,
              text: `${p.name} · ${p.country}`,
              onclick: () => {
                const next = new Set(picked);
                if (next.has(p.id)) next.delete(p.id);
                else next.add(p.id);
                save({ providers: [...next] });
              },
            }),
          )
        : [el("p", { class: "empty", text: "No provider matches that." })]),
    );
  };
  search.addEventListener("input", paint);
  if (!liveProviderList) queueMicrotask(() => loadProviderList().then(paint));
  paint();
  return el(
    "div",
    null,
    el("div", { class: "source-form" }, search),
    rows,
    el("p", {
      class: "option-desc",
      text: "Picking a provider adds its lineup to Live TV and to the Guide. Providers that publish a public XMLTV feed bring their own schedule with them; the rest are scheduled from the EPG URL under Guide & EPG.",
    }),
  );
}

function paneLiveSource() {
  const live = liveSource();
  const pickedProviders = new Set((Array.isArray(live.providers) ? live.providers : []).map(String));
  const field = (id, label, value, placeholder, type = "text") => {
    const input = el("input", { class: "text-input focusable", type, id, value, placeholder });
    input.addEventListener("change", () => save({ [label]: input.value.trim() }));
    return input;
  };
  const save = (patch) => {
    state.liveSource = { ...liveSource(), ...patch };
    writeJSON(KEY.liveSource, state.liveSource);
    pushSettings({ live: state.liveSource });
    state.live = { ...state.live, loaded: false, rows: [] };
    loadLive({ force: true });
    // Re-draw the pane, so a picked provider's chip lights up where it stands.
    render();
  };

  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Where the lineup comes from" }),
      el("p", {
        class: "option-desc",
        text: "The catalogue is the premium, DTH and operator providers themselves — pick the ones you subscribe to and Live TV draws their lineup and their guide. Streams are never shipped: a premium stream belongs to a subscriber's box, so export your own playlist (or log in to your Xtream panel) and it meets the catalogue on the channel's `tvg-id`. The playlist URL and the password stay on the server, never in the page.",
      }),
      el("div", { class: "options" },
        ...[["dth", "Premium & DTH catalogue", "Sky, DIRECTV, Tata Play, Airtel, DStv, Astro, Foxtel and the rest — the operator's own lineup and guide, per country."],
          ["m3u", "My M3U playlist", "An M3U/M3U8 URL (or a path on the server) with your own channels, exported from your box."],
          ["xtream", "Xtream Codes login", "Host, username and password — the live streams and their categories are read from the panel."]].map(([mode, title, desc]) =>
          radioRow(live.mode === mode, "live-mode", title, desc, () => save({ mode })),
        ),
      ),
      live.mode === "dth" ? providerPicker(pickedProviders, save) : null,
      live.mode === "m3u"
        ? el("div", { class: "source-form" }, field("live-m3u", "m3u", live.m3u, "https://…/playlist.m3u"))
        : null,
      live.mode === "xtream"
        ? el("div", { class: "source-form" },
            field("live-host", "host", live.host, "http://host:8080"),
            field("live-user", "username", live.username, "username"),
            field("live-pass", "password", live.password, "password", "password"),
          )
        : null,
      el("div", { class: "provider-check" },
        el("span", {
          class: `source-status${state.live.error ? " bad" : state.live.loaded ? " ok" : ""}`,
          text: state.live.loaded
            ? `${state.live.total || state.live.all.length} channels loaded${state.live.groups.length ? ` in ${state.live.groups.length} categories` : ""}${state.live.error ? ` — last read failed (${state.live.error})` : ""}`
            : "Reading…",
        }),
      ),
      el("div", { class: "source-form" },
        el("button", { class: "btn primary focusable", type: "button", text: "Reload channels", onclick: () => loadLive({ force: true }) }),
      ),
    ),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Metadata" }),
      el("p", { class: "option-desc", text: "Each channel keeps the logo, its categories and its country from the playlist, and its stream URL is kept server-side. Reload re-reads all of it — on the refresh clock below, and whenever you press Refresh now." }),
    ),
  ];
}

/** The directory's country table, read once and kept for the session. */
let liveCountryList = null;

async function loadCountryList() {
  if (liveCountryList) return liveCountryList;
  try {
    const data = await get("/live/countries.json");
    liveCountryList = Array.isArray(data.countries) ? data.countries : [];
  } catch {
    liveCountryList = [];
  }
  return liveCountryList;
}

/**
 * Settings → Countries: which of the directory's countries this profile reads.
 *
 * The public directory is published one file per country, so this is the switch
 * that decides what the **Guide** and the **Categories** card are drawn from.
 * Nothing here is a second source: it is the same directory, sliced by country.
 */
function paneLiveCountries() {
  const live = liveSource();
  const picked = new Set((Array.isArray(live.countries) ? live.countries : []).map((c) => String(c).toUpperCase()));
  const save = (patch) => {
    state.liveSource = { ...liveSource(), ...patch };
    writeJSON(KEY.liveSource, state.liveSource);
    pushSettings({ live: state.liveSource });
    // A different slice of the directory is a different lineup, so the channels and
    // the guide are re-read rather than filtered on screen.
    state.live = { ...state.live, loaded: false, rows: [], guide: null, categoryChannels: [] };
    loadLive({ force: true });
    loadGuide({ force: true });
    render();
  };
  const toggle = (code) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    save({ countries: [...next], allCountries: false });
  };

  const search = el("input", {
    class: "text-input focusable",
    type: "text",
    id: "live-country-filter",
    placeholder: "Filter countries…",
  });
  const rows = el("div", { class: "filter-options country-picker" });
  const paint = () => {
    if (!liveCountryList) {
      rows.replaceChildren(el("p", { class: "empty", text: "Reading the country list…" }));
      return;
    }
    const needle = search.value.trim().toLowerCase();
    const matching = liveCountryList.filter(
      (c) => !needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle,
    );
    // What is already picked always stays on screen, so a choice cannot be hidden
    // by whatever is typed in the filter.
    // **Every country, not the first sixty.** The list was cut at 60 — which, at
    // an alphabetical start, meant it stopped around Denmark and countries after
    // it could not be picked at all. The picker is its own scrolling window
    // (`.country-picker`), so the whole list lives in it and nothing is hidden.
    const list = [
      ...liveCountryList.filter((c) => picked.has(c.code)),
      ...matching.filter((c) => !picked.has(c.code)),
    ];
    rows.replaceChildren(
      ...(list.length
        ? list.map((c) =>
            el("button", {
              class: `filter-chip focusable${picked.has(c.code) ? " active" : ""}`,
              type: "button",
              "aria-pressed": String(picked.has(c.code)),
              title: `${c.name} (${c.code})`,
              text: `${c.flag ? `${c.flag} ` : ""}${c.name}`,
              onclick: () => toggle(c.code),
            }),
          )
        : [el("p", { class: "empty", text: "No country matches that." })]),
    );
  };
  search.addEventListener("input", paint);
  if (!liveCountryList) queueMicrotask(() => loadCountryList().then(paint));
  paint();    const pickedNote = live.allCountries
    ? "Reading every country the catalogue covers."
    : picked.size
      ? `${picked.size} countr${picked.size === 1 ? "y" : "ies"} selected — the Guide and the Categories card show those.`
      : "Nothing picked, so the whole catalogue is read.";

  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Countries" }),
      el("p", { class: "option-desc", text: "Every provider in the catalogue belongs to a country. Pick the countries you want and both the Guide and the Categories card are scoped to them — the catalogue is shipped with the app, so this works with no network and with nothing to log in to." }),
      el("div", { class: "options" },
        radioRow(Boolean(live.allCountries), "live-countries", "All countries", "Every country the catalogue covers, read in one go.", () => save({ allCountries: true })),
        radioRow(!live.allCountries, "live-countries", "Only the countries I pick", "Pick them below — each channel carries its own country.", () => save({ allCountries: false })),
      ),
      el("div", { class: "source-form" }, search),
      rows,
      el("div", { class: "source-form" },
        el("button", { class: "btn subtle focusable", type: "button", text: "Clear countries", onclick: () => save({ countries: [], allCountries: false }) }),
        el("button", { class: "btn primary focusable", type: "button", text: "Apply countries", onclick: () => loadLive({ force: true }) }),
      ),
      el("div", { class: "provider-check" }, el("span", { class: "source-status", text: pickedNote })),
    ),
  ];
}

/** Settings → Guide & EPG: the XMLTV source the grid is drawn from. */
function paneLiveGuide() {
  const live = liveSource();
  const input = el("input", { class: "text-input focusable", type: "text", id: "live-epg", value: live.epg, placeholder: "https://…/guide.xml (XMLTV)" });
  const status = el("span", { class: "source-status", text: live.epg ? "An EPG URL is set." : "No EPG URL — the Guide draws the lineup only." });
  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "XMLTV guide" }),
      el("p", {
        class: "option-desc",
        text: "An XMLTV (EPG) URL — `.xml` or `.xml.gz`. A DTH provider's guide is its lineup: Foxtel, Freeview Australia and Sky New Zealand publish one, so picking those providers is enough and this box can stay empty. Set it and it wins, for your own box's guide or another provider's. Channels are matched by `tvg-id`.",
      }),
      el("div", { class: "source-form" }, input,
        el("button", { class: "btn primary focusable", type: "button", text: "Save EPG", onclick: () => {
          state.liveSource = { ...liveSource(), epg: input.value.trim() };
          writeJSON(KEY.liveSource, state.liveSource);
          pushSettings({ live: state.liveSource });
          state.live = { ...state.live, guide: null, guideError: "" };
          loadGuide({ force: true });
        } }),
        el("button", { class: "btn subtle focusable", type: "button", text: "Reload guide", onclick: () => loadGuide({ force: true }) }),
      ),
      el("div", { class: "provider-check" }, status,
        state.live.guideError ? el("span", { class: "source-status bad", text: ` — ${state.live.guideError}` }) : null,
      ),
    ),
  ];
}

/** Settings → Live TV & Sports: the refresh clock for channels and guide. */
function paneLiveRefresh() {
  const live = liveSource();
  const choice = (minutes) => () => {
    state.liveSource = { ...liveSource(), refreshMinutes: minutes };
    writeJSON(KEY.liveSource, state.liveSource);
    pushSettings({ live: state.liveSource });
    render();
  };
  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "How often the channels update" }),
      el("p", { class: "option-desc", text: "The playlist and the guide are re-read on this clock, so channels, logos and programme data keep themselves up to date." }),
      el("div", { class: "options" },
        radioRow(Number(live.refreshMinutes) === 0, "live-refresh", "Follow the content refresh setting", "The same interval as Settings → Content (15 / 30 / 60 / 180 minutes, or only when you ask).", choice(0)),
        ...[15, 30, 60, 180].map((m) => radioRow(Number(live.refreshMinutes) === m, "live-refresh", `Every ${m} minutes`, null, choice(m))),
      ),
      el("div", { class: "source-form" },
        el("button", { class: "btn primary focusable", type: "button", text: "Refresh now", onclick: () => { state.gen = Date.now(); loadLive({ force: true }); loadGuide({ force: true }); } }),
      ),
    ),
  ];
}

/* ------------------------------------------------------------------- boot */

/** Re-read the cards — the regional OTT cards change with the country setting. */
async function refreshCollections() {
  try {
    state.collections = await get("/collections.json");
  } catch {
    /* keep the cards already on screen */
  }
  state.order = {};
}

/* ---------------------------------------------------------------- playback */

/**
 * Play a stream inside the app.
 *
 * A live channel is an HLS playlist (`.m3u8`) far more often than it is a plain
 * file, and only Safari and Android's own player play those natively — everything
 * else needs `hls.js`. It is **vendored next to the app** (`./vendor/hls.min.js`)
 * rather than pulled from a CDN, so the Electron window and the APK play a live
 * stream with no third-party script and nothing to fetch but the stream itself. The
 * loader is kept, so opening a second channel does not download it again.
 */
let hlsLoader = null;
let playerHls = null;
let playerNode = null;

const IS_HLS = (url) => /\.m3u8(\?|#|$)/i.test(String(url || ""));

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/hls.min.js";
      script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("hls.js did not load")));
      script.onerror = () => reject(new Error("hls.js is not available"));
      document.head.append(script);
    });
  }
  return hlsLoader;
}

function stopPlayer() {
  if (playerHls) {
    try { playerHls.destroy(); } catch { /* already gone */ }
    playerHls = null;
  }
  if (playerNode) {
    playerNode.remove();
    playerNode = null;
  }
  document.removeEventListener("keydown", playerKey);
}

function playerKey(e) {
  if (e.key === "Escape") return stopPlayer();
  if (e.target?.tagName === "INPUT" || e.target?.tagName === "SELECT") return;
  const video = document.querySelector(".player-video");
  if (!video) return;
  const seek = (n) => {
    video.currentTime = Math.max(0, (video.currentTime || 0) + n);
  };
  if (e.key === " " || e.key === "k") {
    e.preventDefault();
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  } else if (e.key === "ArrowRight") seek(10);
  else if (e.key === "ArrowLeft") seek(-10);
  else if (e.key === "ArrowUp") video.volume = Math.min(1, video.volume + 0.1);
  else if (e.key === "ArrowDown") video.volume = Math.max(0, video.volume - 0.1);
  else if (e.key === "m") video.muted = !video.muted;
  else if (e.key === "f") toggleFullscreen();
  else if (e.key === "p") video.requestPictureInPicture?.().catch(() => {});
}

function toggleFullscreen() {
  const target = document.querySelector(".player") || document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else target.requestFullscreen?.().catch(() => {});
}

/** `1:04:07` / `4:07` — a clock, not a number. */
const timecode = (seconds) => {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s).padStart(2, "0")}`;
};

/**
 * The player.
 *
 * Full screen, with the controls a streaming app is expected to have — play/pause,
 * a seek bar you can drag, the time, volume and mute, playback speed, picture-in-
 * picture and fullscreen — plus, for a title, a **Sources** drawer: every stream the
 * add-ons you added answered with, grouped by add-on, one click to play. Keyboard:
 * space/k play, ←/→ seek 10s, ↑/↓ volume, m mute, f fullscreen, p picture-in-picture,
 * Esc close.
 */
async function openPlayer(url, title, opts = {}) {
  const src = String(url || "").trim();
  if (!src) return;
  stopPlayer();

  const video = el("video", { class: "player-video", playsinline: true, autoplay: true });
  const seek = el("input", { class: "player-seek focusable", type: "range", min: "0", max: "1000", value: "0", step: "1" });
  const volume = el("input", { class: "player-volume focusable", type: "range", min: "0", max: "1", value: "1", step: "0.05" });
  const clock = el("span", { class: "player-time", text: "0:00 / 0:00" });
  const rate = el("select", { class: "player-rate text-input focusable" },
    ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => el("option", { value: String(v), text: `${v}×`, selected: v === 1 })),
  );
  const playBtn = el("button", {
    class: "player-icon focusable", type: "button", text: "❚❚", title: "Play / pause",
    onclick: () => (video.paused ? video.play().catch(() => {}) : video.pause()),
  });

  video.addEventListener("play", () => { playBtn.textContent = "❚❚"; });
  video.addEventListener("pause", () => { playBtn.textContent = "▶"; });
  video.addEventListener("timeupdate", () => {
    const d = video.duration || 0;
    seek.value = d ? String(Math.round((video.currentTime / d) * 1000)) : "0";
    clock.textContent = `${timecode(video.currentTime)} / ${d ? timecode(d) : "live"}`;
  });
  seek.addEventListener("input", () => {
    const d = video.duration || 0;
    if (d) video.currentTime = (Number(seek.value) / 1000) * d;
  });
  volume.addEventListener("input", () => { video.volume = Number(volume.value); video.muted = Number(volume.value) === 0; });
  rate.addEventListener("change", () => { video.playbackRate = Number(rate.value) || 1; });

  // The Sources drawer: which add-on this stream came from, and the others on offer.
  const drawer = el("aside", { class: "player-sources", hidden: true });
  const drawSources = (list, currentUrl) => {
    drawer.replaceChildren(
      el("h3", { class: "row-head", text: "Sources" }),
      list && list.length
        ? el("div", { class: "stream-list" }, ...list.map((s) =>
            el("button", {
              class: `stream focusable${s.url === currentUrl ? " active" : ""}`,
              type: "button",
              onclick: async () => {
                drawer.hidden = true;
                await openPlayer(s.url, opts.title || title, { ...opts, current: s.url });
              },
            },
              el("span", { class: "stream-name", text: s.name || s.source || "Stream" }),
              el("span", { class: "stream-detail", text: [s.quality, s.source, s.title].filter(Boolean).join(" · ") }),
            )
          ))
        : el("p", { class: "empty", text: "No streams returned. Add or fix an add-on in Settings → Add-ons & plugins, then press Sources again." }),
    );
  };
  drawSources(opts.streams || [], src);

  const node = el(
    "div",
    { class: "player" },
    el(
      "div",
      { class: "player-head" },
      el("span", { class: "player-title", text: opts.title || title || "Live" }),
      opts.streams?.length
        ? el("button", {
            class: "btn subtle focusable", type: "button", text: "Sources", id: "player-sources",
            onclick: () => { drawer.hidden = !drawer.hidden; },
          })
        : null,
      el("button", { class: "btn subtle focusable", type: "button", text: "Close", onclick: stopPlayer }),
    ),
    el("div", { class: "player-stage" }, video, drawer),
    el(
      "div",
      { class: "player-controls" },
      playBtn,
      seek,
      clock,
      el("button", { class: "player-icon focusable", type: "button", text: "🔇", title: "Mute", onclick: () => { video.muted = !video.muted; } }),
      volume,
      rate,
      el("button", { class: "player-icon focusable", type: "button", text: "PiP", title: "Picture in picture", onclick: () => video.requestPictureInPicture?.().catch(() => {}) }),
      el("button", { class: "player-icon focusable", type: "button", text: "⛶", title: "Fullscreen", onclick: toggleFullscreen }),
    ),
    el("p", { class: "player-note", text: src }),
  );
  document.body.append(node);
  playerNode = node;
  document.addEventListener("keydown", playerKey);
  try {
    const native = video.canPlayType("application/vnd.apple.mpegurl");
    if (IS_HLS(src) && !native) {
      const Hls = await loadHls();
      if (Hls.isSupported()) {
        playerHls = new Hls({ lowLatencyMode: true });
        playerHls.loadSource(src);
        playerHls.attachMedia(video);
      } else {
        // No MSE either: the browser's own HLS is the only thing left to try.
        video.src = src;
      }
    } else {
      video.src = src;
    }
    await video.play().catch(() => {
      /* autoplay refused: the controls are right there */
    });
  } catch (err) {
    node.append(el("p", { class: "player-error", text: `Could not play this stream — ${err.message}` }));
  }
}

/**
 * Play a title: ask the server for its streams, then open the player.
 *
 * The streams come from the Stremio add-ons you added (see `addon/streams.mjs`) —
 * read on the server, because a browser cannot call another host's `/stream/…`.
 * With none configured, or with none answering, the player still opens and says so.
 */
async function openSources(meta) {
  const media = meta.type === "series" ? "series" : "movie";
  const id = String(meta.id || "").replace(/^tmdb:/, "");
  const overlay = el("div", { class: "player loading-player" },
    el("div", { class: "player-head" },
      el("span", { class: "player-title", text: `Finding sources — ${meta.name || ""}` }),
      el("button", { class: "btn subtle focusable", type: "button", text: "Close", onclick: () => overlay.remove() }),
    ),
    el("p", { class: "player-note", text: "Asking the add-ons and plugins you added…" }),
  );
  document.body.append(overlay);
  let payload = null;
  try {
    payload = await get(`/streams/${media}/${encodeURIComponent(id)}.json?name=${encodeURIComponent(meta.name || "")}`);
  } catch (err) {
    overlay.replaceChildren(
      el("div", { class: "player-head" },
        el("span", { class: "player-title", text: meta.name || "" }),
        el("button", { class: "btn subtle focusable", type: "button", text: "Close", onclick: () => overlay.remove() }),
      ),
      el("p", { class: "player-error", text: `Could not read the streams — ${err.message}` }),
    );
    return;
  }
  const streams = payload?.streams || [];
  const lines = (payload?.sources || []).map((s) => `${s.name}: ${s.ok ? s.message : `failed — ${s.message}`}`);
  overlay.remove();

  if (!streams.length) {
    const reason =
      payload?.reason === "no-sources"
        ? "No add-on is configured to play anything. Add a Stremio add-on in Settings → Add-ons & plugins."
        : payload?.reason === "no-imdb"
          ? "This title has no IMDb id, so an add-on cannot be asked for streams."
          : "No playable stream came back.";
    document.body.append(el("div", { class: "player" },
      el("div", { class: "player-head" },
        el("span", { class: "player-title", text: meta.name || "" }),
        el("button", { class: "btn subtle focusable", type: "button", text: "Close", onclick: (e) => e.currentTarget.closest(".player").remove() }),
      ),
      el("p", { class: "player-error", text: reason }),
      lines.length ? el("div", { class: "stream-list" }, ...lines.map((l) => el("p", { class: "player-note", text: l }))) : null,
    ));
    return;
  }

  // The first stream that is not a trailer/cam rip plays straight away; the rest are
  // one click away in the Sources drawer.
  const best = streams.find((s) => !/cam|trailer|sample/i.test(`${s.name} ${s.title}`)) || streams[0];
  await openPlayer(best.url, meta.name, { title: meta.name, meta, streams, current: best.url });
}

async function boot() {
  modal.root = document.getElementById("modal");
  // The app keeps its own place on the page (`render` remembers where each screen
  // was left), so the browser's own restore is turned off — two of them fighting
  // over the scroll on Back is what made it land somewhere unpredictable.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  applyTheme();
  setupInput();

  try {
    state.collections = await get("/collections.json");
  } catch (err) {
    document.getElementById("main").replaceChildren(
      el("p", { class: "empty", text: `Could not reach the catalog server: ${err.message}` }),
    );
    return;
  }

  // What the addon actually publishes, read from its own manifest.
  //
  // A card is drawn from the list the app was handed, and that list can name a row
  // the addon no longer serves — a retired catalog, or a card list from an older
  // build. Those rows used to render and then answer 404 when they were opened. With
  // the manifest in hand, `rowOf` drops them before anything is drawn, so a screen
  // can only ever offer rows that exist.
  try {
    const manifest = await get("/manifest.json");
    const ids = (manifest?.catalogs || []).map((c) => c.id).filter(Boolean);
    if (ids.length) state.publishedCatalogs = new Set(ids);
  } catch {
    /* no manifest: nothing is filtered, exactly as before */
  }

  // The country has no picker any more, but it is still real state: it decides
  // which services the three Regional OTT cards name. It was read above the card
  // list, so a country changed elsewhere has to re-read the cards here.
  const cachedCountry = state.country;
  try {
    mergeServerSettings(await get("/settings"));
  } catch {
    /* server without the settings route */
  }
  if (state.country !== cachedCountry) await refreshCollections();

  // The AI state, from the server: which provider is in use, and whether it has a
  // key — the key itself may be in the environment rather than in this browser, so
  // the page must ask rather than guess. Without this, the Ask box and the AI
  // options all behaved as if nothing were configured.
  try {
    const ai = await get("/ai.json");
    if (ai && typeof ai === "object") {
      state.ai = { ...state.ai, ...ai, hasKey: { ...(state.ai?.hasKey || {}), ...(ai.hasKey || {}) } };
      writeJSON(KEY.ai, state.ai);
    }
  } catch {
    /* server without the AI route */
  }

  // The pins decide what the Watchlist card's three rows hold.
  try {
    applyWatchlist(await get("/watchlist.json"));
  } catch {
    /* server without the watchlist route */
  }

  // And the custom rows decide what the row after them holds.
  try {
    applyCustomRows(await get("/customrows.json"));
  } catch {
    /* server without the custom-row route */
  }

  // The search screen's filter vocabulary: the regions, the categories that exist
  // per row type, the periods and the sorts — from the server, so the panel can
  // never offer a genre TMDB does not have.
  try {
    const { filters } = await get("/search/filters.json");
    if (filters) state.searchVocab = filters;
  } catch {
    /* an older server: the panel falls back to a short list */
  }

  // Read every stored source again, on every start.
  //
  // "0 providers" was stored state: a source added when the read failed kept its
  // empty provider list forever, so it looked like add-ons and repos never worked
  // however many times you pressed the button. Re-reading them at boot means one
  // refresh fixes every source, and the list is only ever as stale as this page.
  if (state.sources.length) {
    // Sequential: a dozen parallel third-party fetches is a burst a lot of hosts
    // rate-limit, and this is not on the critical path.
    (async () => {
      for (let i = 0; i < state.sources.length; i++) {
        if (!state.sources[i]?.url) continue;
        await inspectSource(i, { quiet: true }).catch(() => {});
      }
      render();
    })();
  }

  // The app always opens on the switch-profile screen, the way Nuvio does —
  // unless the link points somewhere specific.
  const hash = location.hash;
  if (!hash || hash === "#/" || hash === "#") {
    location.hash = "#/profiles";
  }
  // `render` is awaited: the boot screen must not fade out over a page that has
  // not been drawn yet (the title and list screens fetch before they render).
  await render();
  endBoot();
}

// Safety net: a boot that cannot reach the server must not leave the splash up
// for ever, so the screen goes away on its own after a few seconds either way.
setTimeout(endBoot, 8000);

boot();
