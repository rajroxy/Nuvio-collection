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
//   /api/source                       server-side add-on / plugin / repo lookup
//   /settings (GET/POST)              profile, providers, posters, AI

const API = new URLSearchParams(location.search).get("api") || window.NUVIO_API || "";

// The top bar has no Movies/Shows labels any more — those are buttons on Home.
const TABS = [["home", "Home"]];

const KEY = {
  tab: "nuvio.tab",
  row: "nuvio.row",
  layout: "nuvio.layout",
  safe: "nuvio.safe",
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
};

const PINNED = /◆ Top 10|Airing Today|Airing This Week|On the Air|Now Playing|^Latest|^New Release|^Trending|^Plan to Watch$|^Watching$|^Watched$/;

// The watchlist rows are states, in the order a title moves through them.
const WATCH_STATES = [
  ["planned", "Plan to Watch"],
  ["watching", "Watching"],
  ["watched", "Watched"],
];

// The profiles you can switch between. `Live TV & Sports` is the second one.
const PROFILES = ["Movies & Shows", "Live TV & Sports"];

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
const TRACKER_GROUPS = [
  {
    title: "Film & TV",
    hint: "Watched history, scrobbling and lists.",
    services: [
      ["trakt", "Trakt", "Scrobbling and watched history for films and shows."],
      ["simkl", "SIMKL", "Watched history across films, shows and anime."],
      ["myanimelist", "MyAnimeList", "Anime lists and watched episodes — MAL."],
      ["anilist", "AniList", "Anime and manga lists, with airing progress."],
      ["letterboxd", "Letterboxd", "Film diary and lists."],
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

const ADDON_TYPES = [
  ["stremio", "Stremio add-on", "A Stremio/Nuvio add-on URL — its manifest is read for you."],
  ["nuvio", "Nuvio add-on", "A Nuvio add-on URL — its manifest is read for you."],
];
const PLUGIN_TYPES = [
  ["nuvio-plugin", "Nuvio plugin", "A Nuvio plugin/repository URL."],
  ["cloudstream", "CloudStream repo", "A CloudStream repository URL — its repo.json → plugins are listed."],
];
const SOURCE_TYPES = [...ADDON_TYPES, ...PLUGIN_TYPES];
const typeLabel = (t) => SOURCE_TYPES.find(([v]) => v === t)?.[1] ?? t;

/**
 * Settings, as groups of tabs.
 *
 * It used to be one flat row of ten names in no particular order (Profile,
 * Posters, Providers, Tracking, AI, Content, Add-ons, Plugins, Layout, Server),
 * which hid the two things you actually come here to change: what the catalogs
 * show, and who they are read from. Now the sections are grouped — what you see,
 * who it comes from, how it is tracked, and the app itself — with the group name
 * above its tabs.
 */
const SETTINGS_GROUPS = [
  {
    group: "What you see",
    sections: [
      ["content", "Content"],
      ["layout", "Layout"],
      ["posters", "Posters"],
      ["appearance", "Appearance"],
    ],
  },
  {
    group: "Where it comes from",
    sections: [
      ["providers", "Providers"],
      ["addons", "Add-ons"],
      ["plugins", "Plugins"],
    ],
  },
  {
    group: "Tracking & assistant",
    sections: [
      ["tracking", "Tracking"],
      ["ai", "AI"],
    ],
  },
  {
    group: "This app",
    sections: [
      ["profile", "Profile"],
      ["server", "Server"],
    ],
  },
];

// The flat list, in the order the groups define — this is what "which tab is
// active" and "what does an unknown section fall back to" are answered from.
const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections);

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
  row: localStorage.getItem(KEY.row) || "movie", // movie | series
  layout: localStorage.getItem(KEY.layout) || "grid",
  safe: readJSON(KEY.safe, true),
  profile: localStorage.getItem(KEY.profile) || PROFILES[0],
  profiles: PROFILES,
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
  }),
  // id → watch state, mirrored from the server so the modal can show the state
  // a title is already pinned in.
  watchlist: {},
  // Every pin, with its state and where it was made — the calendar needs to
  // tell its own plan-to-watch pins apart from the watchlist rows.
  watchItems: [],
  // The custom rows you fill yourself: which row each stored title is in.
  customItems: [],
  sources: readJSON(KEY.sources, []),
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

function applyWatchlist(payload) {
  const map = {};
  const items = payload?.items || [];
  for (const item of items) map[`${item.type}:${item.id}`] = item.state;
  state.watchlist = map;
  state.watchItems = items;
}

function applyCustomRows(payload) {
  state.customItems = payload?.items || [];
}

/**
 * The custom row the Watchlist card publishes after its three states.
 *
 * It is read from the cards rather than hard-coded, so the row's name and id
 * come from the one place that defines them (`scripts/collections.mjs`) — the
 * same definition the addon publishes to Nuvio.
 */
function customRow() {
  for (const card of state.collections) {
    for (const row of [card.movie, card.series]) {
      const hit = (row?.catalogs || []).find((c) => c.kind === "custom" && c.row);
      if (hit) return { row: hit.row, name: hit.name, card: card.key };
    }
  }
  return null;
}

const inCustomRow = (row, item) =>
  state.customItems.some((i) => i.row === row && `${i.type}:${i.id}` === watchKey(item));

/** Add a title to a custom row, or take it out when it is already there. */
async function toggleCustomRow(row, item) {
  try {
    const res = await post("/customrows", { row, item: pinOf(item) });
    if (res && Array.isArray(res.items)) applyCustomRows(res);
  } catch {
    /* offline — the row simply does not change */
  }
  modal.open(item);
  render();
}

const rowKey = () => state.row;
const apiType = () => state.row;
const setRow = (row) => {
  state.row = row;
  localStorage.setItem(KEY.row, row);
};
const cardByKey = (key) => state.collections.find((c) => c.key === key);
const rowOf = (c) => c[rowKey()] || { cover: "", catalogs: [] };

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
  if (typeof res.language === "string" && res.language) {
    state.language = res.language;
    localStorage.setItem(KEY.language, state.language);
  }
  if (typeof res.country === "string" && res.country) {
    state.country = res.country;
    localStorage.setItem(KEY.country, state.country);
  }
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
async function setWatchState(item, next, opts = {}) {
  // `source` travels with the pin so the Calendar can tell a plan made on the
  // Calendar apart from a watchlist row — it never changes what the rows hold.
  const pin = opts.source ? { ...pinOf(item), source: opts.source } : pinOf(item);
  const body = next === null ? { item: pin, remove: true } : { item: pin, state: next };
  try {
    const res = await post("/watchlist", body);
    if (res && Array.isArray(res.items)) applyWatchlist(res);
  } catch {
    /* offline — the list simply does not change */
  }
  modal.open(item);
  render();
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
    // The custom row is not a state — it is the list you keep yourself — so it
    // is drawn apart from the three, after a divider.
    const rowInfo = customRow();
    const inRow = rowInfo ? inCustomRow(rowInfo.row, item) : false;
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
      ...(rowInfo
        ? [
            el("span", { class: "pin-divider", "aria-hidden": "true" }),
            el("button", {
              class: `btn pin custom focusable${inRow ? " active" : ""}`,
              type: "button",
              id: "pin-custom-row",
              "aria-pressed": String(inRow),
              title: inRow ? `In ${rowInfo.name} — click to remove` : `Add to ${rowInfo.name}`,
              text: inRow ? `In ${rowInfo.name} · remove` : `＋ ${rowInfo.name}`,
              onclick: () => toggleCustomRow(rowInfo.row, item),
            }),
          ]
        : []),
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
    { class: "poster focusable", type: "button", "data-id": m.id || "", onclick: () => modal.open(m) },
    poster
      ? el("img", { src: poster, alt: m.name, loading: "lazy", onerror: () => { /* keep the box */ } })
      : el("div", { class: "placeholder" }),
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

async function fetchCatalog(catalog, skip = 0) {
  const suffix = skip ? `/skip=${skip}` : "";
  return get(`/catalog/${apiType()}/${encodeURIComponent(catalog.id)}${suffix}.json${catalogQuery()}`);
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
  const hash = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (hash.startsWith("c/")) return { view: "card", key: decodeURIComponent(hash.slice(2)) };
  if (hash.startsWith("x/")) {
    const [key, id] = hash.slice(2).split("/");
    return { view: "explore", key: decodeURIComponent(key), id: decodeURIComponent(id || "") };
  }
  if (hash.startsWith("s/")) {
    const [id, name] = hash.slice(2).split("/");
    return { view: "sources", id: decodeURIComponent(id || ""), name: decodeURIComponent(name || "") };
  }
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
    el(
      "svg",
      { viewBox: "0 0 24 24" },
      el("path", { d: "M4 7h3.2l9.6 10H20" }),
      el("path", { d: "M17 14l3 3-3 3" }),
      el("path", { d: "M4 17h3.2l9.6-10H20" }),
      el("path", { d: "M17 4l3 3-3 3" }),
    ),
  );

/* -------------------------------------------------------------------- views */

/* ---- switch profile ------------------------------------------------------- */

/** Pick a profile and enter the app. */
function chooseProfile(name) {
  state.profile = name;
  localStorage.setItem(KEY.profile, name);
  pushSettings({ profile: name });
  location.hash = "#/";
  render();
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
      el("p", { class: "hero-kicker", text: "Profiles" }),
      el("h1", { class: "view-title", text: "Who's watching?" }),
      el("p", { class: "view-hint", text: "Pick a profile to start. Each one keeps its own settings." }),
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
            el("span", { class: "avatar", "aria-hidden": "true", text: (name[0] || "P").toUpperCase() }),
            el("span", { class: "profile-tile-name", text: name }),
            el("span", { class: "profile-tile-sub", text: name === state.profile ? "current profile" : "switch to this profile" }),
          ),
        ),
      ),
    ),
  ];
}

/** The hero banner, reflecting the selected row (Movies or Shows). */
function heroBlock() {
  const featured =
    state.collections.find((c) => c.key === "discover-top-10") ||
    state.collections.find((c) => rowOf(c).catalogs.length);
  if (!featured) return null;
  const row = rowOf(featured);
  return el(
    "section",
    { class: "hero" },
    el("div", { class: "hero-art", style: `background-image:url("${row.cover}")` }),
    el(
      "div",
      { class: "hero-body" },
      el("p", { class: "hero-kicker", text: "Featured collection" }),
      el("h2", { class: "hero-title", text: featured.title }),
      // Every catalog label is a link into that catalog.
      el("div", { class: "hero-cats" },
        ...row.catalogs.map((cat) => catalogChip(featured, cat)),
      ),
      // Just the action — no "N catalogs · movies" counters on the banner.
      el(
        "div",
        { class: "hero-actions" },
        el("button", {
          class: "btn primary focusable",
          type: "button",
          text: "Explore",
          onclick: () => go(`#/c/${encodeURIComponent(featured.key)}`),
        }),
      ),
    ),
  );
}

function iconBox(c, row) {
  const r = c[row] || { cover: "", catalogs: [] };
  const count = r.catalogs.length;
  return el(
    "div",
    { class: "icon-box" },
    el(
      "button",
      {
        class: "icon-art focusable",
        type: "button",
        title: `Open ${c.title}`,
        "aria-label": `Open ${c.title}`,
        onclick: () => {
          setRow(row);
          go(`#/c/${encodeURIComponent(c.key)}`);
        },
      },
      el("img", { src: r.cover, alt: c.title, loading: "lazy" }),
    ),
    el(
      "span",
      { class: "icon-meta" },
      el("span", { class: "icon-name", text: c.title }),
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
  return state.collections;
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
    ...[["movie", "Movies"], ["series", "Shows"]].map(([value, label]) =>
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
  // Just the heading — no hint line under it, and no "Picked for you".
  return [
    heroBlock(),
    rowSwitch(),
    el("div", { class: "home-head" },
      el("h2", { class: "section-title", text: state.row === "movie" ? "Movies" : "Shows" }),
    ),
    collectionGrid(state.row),
  ].filter(Boolean);
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
      el("button", {
        class: "cat-name focusable",
        type: "button",
        title: `Explore ${cat.name}`,
        text: cat.name,
        onclick: () => go(`#/x/${encodeURIComponent(card.key)}/${encodeURIComponent(cat.id)}`),
      }),
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

function renderCard(key) {
  const c = cardByKey(key);
  if (!c) return [el("p", { class: "empty", text: "Collection not found." })];
  const row = rowOf(c);
  const catalogs = orderedCatalogs(c);

  const wrapper = el(
    "section",
    { class: "section" },
    el(
      "header",
      { class: "section-head" },
      el("img", { class: "section-cover", src: row.cover, alt: c.title }),
      el(
        "div",
        { class: "section-meta" },
        el("h2", { text: c.title }),
        // The catalog labels are links into each catalog.
        el("div", { class: "cats" }, ...row.catalogs.map((cat) => catalogChip(c, cat))),
      ),
    ),
  );

  if (catalogs.length) {
    for (const cat of catalogs) wrapper.append(catalogRow(c, cat));
  } else {
    wrapper.append(el("p", { class: "empty", text: "This collection is cover art only — it has no catalogs yet." }));
  }
  return [wrapper];
}

/**
 * One of the three sample rows at the top of an Explore page.
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

  const openMenu = () => {
    catMenu.replaceChildren(
      ...catalogs.map((c) =>
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

  // The three sample rows the header's Shuffle redraws.
  const samples = [];

  const head = el(
    "header",
    { class: "explore-head" },
    el("button", {
      class: "crumb focusable",
      type: "button",
      title: `Back to ${card.title}`,
      text: card.title,
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
    el(
      "div",
      { class: "cat-tools" },
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        id: "shuffle-samples",
        title: "Shuffle — draw three fresh samples",
        onclick: () => samples.forEach((row) => row.reload()),
      }, shuffleIcon(), el("span", { text: " Shuffle" })),
    ),
  );

  // Endless scroll: keep paging until the catalog is exhausted.
  let skip = 0;
  let done = false;
  let busy = false;
  let pages = 0;
  const MAX_PAGES = 40;

  const loadMore = async () => {
    if (busy || done || pages >= MAX_PAGES) return;
    busy = true;
    try {
      const { metas } = await fetchCatalog(cat, skip);
      for (const m of metas) grid.append(posterCard(m));
      skip += metas.length;
      pages++;
      if (!metas.length) {
        done = true;
        observer.disconnect();
        sentinel.replaceChildren(el("p", { class: "view-hint inline", text: "End of catalog." }));
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

  // Three unlabelled sample rows on top, then a horizontal rule, then the normal
  // endlessly scrolling catalog.
  samples.push(shuffleRow(cat), shuffleRow(cat), shuffleRow(cat));
  const shuffles = el("div", { class: "explore-shuffles" }, ...samples.map((row) => row.node));
  const rule = el("div", { class: "h-divider", "aria-hidden": "true" });

  const body = el("section", { class: "section explore" }, head, catMenu, shuffles, rule, grid, sentinel);
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

function searchResults(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [el("p", { class: "view-hint", text: "Type to search every collection and catalog in this row." })];
  const cards = state.collections.filter((c) => c.title.toLowerCase().includes(q));
  const cats = allCatalogs().filter(({ cat }) => cat.name.toLowerCase().includes(q)).slice(0, 60);
  const nodes = [];
  if (cards.length) {
    nodes.push(el("h3", { class: "result-head", text: `Collections (${cards.length})` }));
    nodes.push(el("div", { class: "result-list" }, ...cards.map((c) =>
      el("button", { class: "result focusable", type: "button", onclick: () => go(`#/c/${encodeURIComponent(c.key)}`) },
        el("span", { class: "result-name", text: c.title }),
        el("span", { class: "result-sub", text: `${rowOf(c).catalogs.length} catalogs` })),
    )));
  }
  if (cats.length) {
    nodes.push(el("h3", { class: "result-head", text: `Catalogs (${cats.length})` }));
    nodes.push(el("div", { class: "result-list" }, ...cats.map(({ card, cat }) =>
      el("button", { class: "result focusable", type: "button", onclick: () => go(`#/x/${encodeURIComponent(card.key)}/${encodeURIComponent(cat.id)}`) },
        el("span", { class: "result-name", text: cat.name }),
        el("span", { class: "result-sub", text: card.title })),
    )));
  }
  if (!nodes.length) return [el("p", { class: "empty", text: "Nothing matched." })];
  return nodes;
}

// A drawn funnel, like the rest of the controls.
const filterIcon = () =>
  el(
    "span",
    { class: "glyph", "aria-hidden": "true" },
    el(
      "svg",
      { viewBox: "0 0 24 24" },
      el("path", { d: "M3 5h18" }),
      el("path", { d: "M6 12h12" }),
      el("path", { d: "M10 19h4" }),
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
  regions: [["all", "All regions"], ["US", "America"], ["KR", "Korea"], ["GB", "U.K"], ["JP", "Japan"], ["TH", "Thailand"], ["CN", "China"], ["IN", "India"], ["AU", "Australia"], ["EU", "Europe"], ["other", "Other"]],
  categories: { movie: [], series: [] },
  periods: [["all", "All Time Periods"], ["before", "Before"]],
  sorts: [["popularity", "Popularity"], ["recent", "Recent"], ["rating", "High Rating"]],
};

/** One labelled row of filter chips. */
function filterRow(label, choices, active, onPick) {
  return el(
    "div",
    { class: "filter-row" },
    el("span", { class: "filter-label", text: label }),
    el(
      "div",
      { class: "filter-options" },
      ...choices.map(([value, text]) =>
        el("button", {
          class: `filter-chip focusable${value === active ? " active" : ""}`,
          type: "button",
          text,
          "aria-pressed": String(value === active),
          onclick: () => onPick(value),
        }),
      ),
    ),
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
  const filters = {
    type: params.get("type") || "",
    region: params.get("region") || "all",
    category: params.get("category") || "all",
    period: params.get("period") || "all",
    sort: params.get("sort") || "popularity",
  };
  const vocab = state.searchVocab || SEARCH_FALLBACK;

  const input = el("input", {
    class: "text-input focusable search-input",
    type: "search",
    placeholder: "Search titles, collections and catalogs…",
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

  /** Collections and catalogs matching what has been typed so far. */
  const localSuggestions = (text) => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    const cards = state.collections.filter((c) => c.title.toLowerCase().includes(needle)).slice(0, 4);
    const cats = allCatalogs()
      .filter(({ cat }) => cat.name.toLowerCase().includes(needle))
      .slice(0, 4);
    return [
      ...cards.map((c) => suggestRow("Collection", c.title, () => go(`#/c/${encodeURIComponent(c.key)}`))),
      ...cats.map(({ card, cat }) =>
        suggestRow("Catalog", `${cat.name} — ${card.title}`, () => openRow(card.key, cat.id)),
      ),
    ];
  };

  const drawSuggestions = (text, metas = []) => {
    const nodes = [
      ...localSuggestions(text),
      ...metas.slice(0, 5).map((m) => suggestRow("Title", m.name, () => modal.open(m))),
    ];
    suggestions.replaceChildren(...nodes);
    suggestions.hidden = !nodes.length;
  };

  const resultQuery = () => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (filters.type) p.set("type", filters.type);
    if (filters.region !== "all") p.set("region", filters.region);
    if (filters.category !== "all") p.set("category", filters.category);
    if (filters.period !== "all") p.set("period", filters.period);
    if (filters.sort !== "popularity") p.set("sort", filters.sort);
    if (!state.safe) p.set("adult", "1");
    return p.toString();
  };

  const loadTitles = async (text) => {
    const trimmed = (text || "").trim();
    const qs = resultQuery();
    if (!qs) {
      titles.replaceChildren();
      drawSuggestions(trimmed);
      return;
    }
    titles.replaceChildren(el("p", { class: "view-hint", text: "Searching titles…" }));
    try {
      const { metas } = await get(`/search.json?${qs}`);
      titles.replaceChildren();
      drawSuggestions(trimmed, metas);
      if (!metas.length) {
        titles.append(
          el("p", { class: "view-hint", text: "Nothing matched. Try fewer filters, or a different region." }),
        );
        return;
      }
      titles.append(el("h3", { class: "result-head", text: `Titles (${metas.length})` }));
      titles.append(el("div", { class: "grid-titles" }, ...metas.map((m) => posterCard(m))));
    } catch {
      titles.replaceChildren();
    }
  };

  const refresh = (value) => {
    const results = document.getElementById("search-results");
    if (results) results.replaceChildren(...searchResults(value));
    clearTimeout(timer);
    drawSuggestions(value);
    timer = setTimeout(() => loadTitles(value), 250);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      suggestions.hidden = true;
      return;
    }
    if (e.key === "Enter") {
      suggestions.hidden = true;
      const p = new URLSearchParams(resultQuery());
      p.set("q", input.value.trim());
      go(`#/search?${p.toString()}`);
    }
  });
  input.addEventListener("input", () => refresh(input.value));

  // Changing a filter keeps the text you have typed and re-reads the row from the
  // server — this is a new URL, so it is also a new request and a new history entry.
  const pick = (name, value) => {
    const p = new URLSearchParams(resultQuery());
    const next = name === "type" ? { ...filters, type: value } : { ...filters, [name]: value };
    for (const key of ["region", "category", "period", "sort"]) {
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
    filterRow("Region", vocab.regions, filters.region, (v) => pick("region", v)),
    categoryList.length
      ? filterRow(
          "Category",
          [["all", "All Categories"], ...categoryList.map((c) => [c, c])],
          filters.category,
          (v) => pick("category", v),
        )
      : null,
    filterRow("Time", vocab.periods, filters.period, (v) => pick("period", v)),
    filterRow("Sort", vocab.sorts, filters.sort, (v) => pick("sort", v)),
  );

  const filterBtn = el(
    "button",
    {
      class: `icon-btn focusable search-filter-btn${filtersActive(filters) ? " on" : ""}`,
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
  );

  if (resultQuery()) queueMicrotask(() => loadTitles(query));

  return [
    el("h1", { class: "view-title", text: "Search" }),
    el("div", { class: "search-wrap" }, el("div", { class: "search-bar" }, filterBtn, input, suggestions)),
    filters.region !== "all" && query.trim()
      ? el("p", {
          class: "view-hint",
          text: "TMDB search results carry no origin country, so the region filter applies when browsing — clear the text box to browse by region.",
        })
      : null,
    panel,
    titles,
    el("div", { class: "search-results", id: "search-results" }, ...searchResults(query)),
  ].filter(Boolean);
}

const filtersActive = (f) =>
  Boolean(f.type) || f.region !== "all" || f.category !== "all" || f.period !== "all" || f.sort !== "popularity";

/* ----------------------------------------------------------------- calendar */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The Calendar's plan-to-watch pin.
 *
 * It is deliberately **not** the same thing as a watchlist row. A watchlist row
 * scans everything in its state; a calendar pin is a plan and nothing else — a
 * release you saw on a date and mean to get to. So the calendar offers the one
 * state (plan to watch), it marks the pin with where it came from, and the list
 * it draws below the grid is **recent only** (the last `CAL_RECENT_DAYS`), while
 * the Watchlist card keeps every plan, whatever the date.
 */
const CAL_RECENT_DAYS = 30;

const keyOfItem = (i) => `${i.type}:${i.id}`;

/** Was this title planned *from the calendar*? */
const isCalendarPin = (item) =>
  state.watchItems.some((i) => keyOfItem(i) === watchKey(item) && i.state === "planned" && i.source === "calendar");

/** The calendar's own pins — plan to watch, made here, and recent. */
function recentCalendarPins() {
  const since = Date.now() - CAL_RECENT_DAYS * 864e5;
  return state.watchItems
    .filter((i) => i.source === "calendar" && i.state === "planned")
    .filter((i) => !i.addedAt || Date.parse(i.addedAt) >= since)
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

/** Plan the title from the calendar — or take the plan away again. */
async function calendarPlan(item) {
  const planned = state.watchlist[watchKey(item)] === "planned" && isCalendarPin(item);
  await setWatchState(item, planned ? null : "planned", { source: "calendar" });
}

function calendarCard(m) {
  const planned = state.watchlist[watchKey(m)] === "planned" && isCalendarPin(m);
  return el(
    "div",
    { class: "cal-item" },
    posterCard(m, { kind: true }),
    el("button", {
      class: `btn pin cal-pin focusable${planned ? " active" : ""}`,
      type: "button",
      "data-cal-pin": keyOfItem(m),
      "aria-pressed": String(planned),
      title: planned ? "Planned from the calendar — click to remove" : "Plan to watch (calendar pin)",
      text: planned ? "Plan to Watch · pinned" : "Plan to Watch",
      onclick: () => calendarPlan(m),
    }),
  );
}

function renderCalendar() {
  const { month } = state.calendar;
  const [year, mon] = month.split("-").map(Number);
  const grid = el("div", { class: "cal-grid" });
  const detail = el("div", { class: "cal-detail" });
  const recent = el("section", { class: "cal-recent" });

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

  /** The calendar's own recent pins — kept apart from the watchlist card. */
  function drawRecent() {
    const items = recentCalendarPins();
    recent.replaceChildren(
      el("h3", { class: "section-title", text: "Recently planned" }),
      el("p", {
        class: "view-hint",
        text: `Pinned on the calendar, last ${CAL_RECENT_DAYS} days, plan to watch only. The Watchlist card's rows list every Plan to Watch, Watching and Watched title instead.`,
      }),
      items.length
        ? el("div", { class: "grid-titles" }, ...items.map((m) => posterCard(m, { watch: true })))
        : el("p", { class: "empty", text: "Nothing planned from the calendar yet — pin a release above." }),
    );
  }

  drawGrid();
  drawDetail();
  drawRecent();

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
    recent,
  ];
}

/* ----------------------------------------------------------------- sources */

function sourceProviders(source) {
  if (Array.isArray(source.providers) && source.providers.length) return source.providers;
  return [];
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
        el("span", { class: "dot hub" }), el("span", { text: "add-on / plugin / repo" }),
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
    nodes.push(el("div", { class: "source-provider-list" }, ...list.map((s) => {
      const provs = sourceProviders(s);
      return el("div", { class: "source-providers" },
        el("div", { class: "source-providers-head" },
          el("span", { class: "source-type", text: s.name || typeLabel(s.type) }),
          el("span", { class: "source-url", text: s.url }),
        ),
        provs.length
          ? el("div", { class: "chips" }, ...provs.map((p) => el("span", { class: "chip", text: p })))
          : s.status && !s.status.ok
            ? el("p", { class: "option-desc", text: s.status.text })
            : el("p", { class: "option-desc", text: "Reading this source's providers…" }),
      );
    })));
  }
  return nodes;
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
async function aiIntent(text) {
  const q = String(text || "").trim();
  if (!q) return;
  const provider = state.ai?.provider || "";
  const ready = Boolean(state.ai?.enabled && provider && state.ai?.hasKey?.[provider]);
  if (ready) {
    try {
      const res = await post("/ai/ask", { prompt: q });
      if (res?.ok && res.query) return go(`#/search?q=${encodeURIComponent(res.query)}`);
    } catch {
      /* fall through to the literal text */
    }
  }
  go(`#/search?q=${encodeURIComponent(q)}`);
}

/* ---- settings panes ------------------------------------------------------- */

/**
 * Profile — shows which profile is active and lets you switch in place, so the
 * pane is informative even when you never touch it.
 */
function paneProfile() {
  // Only the profile in use — switching happens on the switch-profile screen.
  return [
    el(
      "div",
      { class: "current-profile" },
      el("span", { class: "avatar", "aria-hidden": "true", text: (state.profile[0] || "M").toUpperCase() }),
      el(
        "div",
        { class: "current-profile-body" },
        el("span", { class: "current-profile-name", text: state.profile }),
        el("span", { class: "current-profile-note", text: "Current profile" }),
      ),
    ),
    el("p", { class: "option-desc", text: "This is the profile the app is using. Open the profile icon in the top bar to switch." }),
  ];
}

function panePosters() {
  const pattern = el("input", {
    class: "text-input focusable",
    type: "text",
    id: "poster-pattern",
    value: state.posters.pattern || "https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg",
    placeholder: "https://…/{imdb_id}.jpg",
  });
  const keyInput = el("input", {
    class: "text-input focusable",
    type: "password",
    id: "poster-key",
    placeholder: state.posters.hasKey ? "•••••••• (set)" : "API key (if the service needs one)",
  });
  const status = el("span", { class: "source-status", text: "" });

  return [
    toggleRow(state.posters.enabled !== false, "Upgrade posters everywhere", "Use the poster service for every title; titles it cannot cover keep their original artwork.", (e) => {
      state.posters = { ...state.posters, enabled: e.target.checked };
      writeJSON(KEY.posters, state.posters);
      pushSettings({ posters: { enabled: e.target.checked } });
      render();
    }),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Poster service" }),
      el("p", { class: "option-desc", text: "BetterPosters (bttr.cc) serves enhanced posters keyed by IMDb id, so a TMDB id is resolved first. Change the pattern to use another service — {imdb_id} and {tmdb_id} are filled in per title." }),
      el("div", { class: "source-form" }, pattern,
        el("button", { class: "btn primary focusable", type: "button", text: "Save pattern", onclick: async () => {
          state.posters = { ...state.posters, pattern: pattern.value.trim() };
          writeJSON(KEY.posters, state.posters);
          await pushSettings({ posters: { pattern: state.posters.pattern } });
          render();
        } }),
      ),
      el("div", { class: "source-form" }, keyInput,
        el("button", { class: "btn primary focusable", type: "button", text: "Save key", onclick: async () => {
          const v = keyInput.value.trim();
          if (!v) return;
          state.posters = { ...state.posters, hasKey: true };
          writeJSON(KEY.posters, state.posters);
          await pushSettings({ posters: { apiKey: v } });
          keyInput.value = "";
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
function paneContent() {
  const countries = state.options.countries?.length
    ? state.options.countries.map((c) => [
        c.code,
        c.services ? `${c.name} — ${c.services} service${c.services === 1 ? "" : "s"}` : `${c.name} — no local service`,
      ])
    : FALLBACK_COUNTRIES;

  const country = el("select", { class: "text-input focusable", id: "app-country" },
    ...countries.map(([code, label]) => el("option", { value: code, text: label })));
  country.value = state.country;
  country.addEventListener("change", async () => {
    state.country = country.value;
    localStorage.setItem(KEY.country, state.country);
    await pushSettings({ country: state.country });
    // The regional cards name different services now, so the card list itself
    // has to be re-read.
    await refreshCollections();
    render();
  });

  const chosen = state.options.countries?.find((c) => c.code === state.country);
  const serviceNote = chosen
    ? chosen.services
      ? `${chosen.services} service${chosen.services === 1 ? "" : "s"} fill the three Regional OTT cards.`
      : "No local service was verified for this country — the Regional OTT cards will be empty."
    : "";

  // The source of the content inside a row is *not* chosen here any more: it is
  // chosen next to the providers it belongs to (Settings → Providers), where the
  // keys that make it possible live. Two copies of one switch was one too many.
  return [
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Language" }),
      el("p", { class: "option-desc", text: "Rows are served in English. The language setting used to sit here and read as if it moved the regional OTT cards too, which it never did — so it is gone rather than misleading." }),
    ),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "Country" }),
      el("p", { class: "option-desc", text: "Where you are. The three Regional OTT cards show this country's own services, and the global platform rows report availability for it." }),
      el("div", { class: "source-form" }, country),
      el("div", { class: "provider-check" }, el("span", { class: "source-status", text: serviceNote })),
    ),
    radioRow(state.safe, "safe", "SFW", "Safe for work — adult titles excluded (TMDB default).", () => {
      state.safe = true; writeJSON(KEY.safe, true); pushSettings({ safe: true }); render();
    }),
    radioRow(!state.safe, "safe", "NSFW", "Include adult titles where TMDB supports it.", () => {
      state.safe = false; writeJSON(KEY.safe, false); pushSettings({ safe: false }); render();
    }),
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

function paneServer() {
  return [
    el("p", { class: "option-desc", text: API || "same origin (embedded server)" }),
    el("p", { class: "option-desc", text: `${state.collections.length} collections · ${state.collections.reduce((n, c) => n + rowOf(c).catalogs.length, 0)} catalogs for this row.` }),
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

function saveSources() {
  writeJSON(KEY.sources, state.sources);
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
    source.name = res.name || source.name;
    source.status = { ok: Boolean(res.ok), text: res.ok ? `${res.name || typeLabel(source.type)} · ${res.message}` : res.message };
  } catch (err) {
    source.status = { ok: false, text: `could not check — ${err.message}` };
  }
  saveSources();
  if (!quiet) render();
}

function sourceRow(source, index) {
  const providers = sourceProviders(source);
  return el("div", { class: "source" },
    el("div", { class: "source-main" },
      el("span", { class: "source-type", text: `${typeLabel(source.type)}${source.name ? ` · ${source.name}` : ""}` }),
      el("span", { class: "source-url", text: source.url }),
      source.status ? el("span", { class: `source-status ${source.status.ok ? "ok" : "bad"}`, text: source.status.text }) : null,
      providers.length ? el("div", { class: "chips" }, ...providers.map((p) => el("span", { class: "chip", text: p }))) : null,
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

function renderSettings() {
  const section = state.settingsSection;
  const addons = state.sources.filter((s) => ADDON_TYPES.some(([t]) => t === s.type));
  const plugins = state.sources.filter((s) => PLUGIN_TYPES.some(([t]) => t === s.type));

  const panes = {
    profile: paneProfile,
    posters: panePosters,
    providers: paneProviders,
    tracking: paneTracking,
    ai: paneAi,
    content: paneContent,
    addons: () => sourceSection("Add-ons", "An add-on URL is read on the server (manifest.json), so it works even when the host sends no CORS headers.", ADDON_TYPES, addons),
    plugins: () => sourceSection("Plugins & repositories", "A CloudStream repository is read on the server (repo.json → plugins.json) and every plugin is listed as a provider.", PLUGIN_TYPES, plugins),
    layout: paneLayout,
    appearance: paneAppearance,
    server: paneServer,
  };

  // A stored section that no longer exists ("profile") falls back to the first one.
  const active = SETTINGS_SECTIONS.find(([id]) => id === section) || SETTINGS_SECTIONS[0];

  const nav = el("nav", { class: "settings-nav", "aria-label": "Settings sections" },
    ...SETTINGS_GROUPS.flatMap((group) => [
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

function render() {
  const { view, key, id, name } = parseHash();
  const browsing = ["home", "card", "explore"].includes(view);

  document.getElementById("tabs").hidden = !browsing;
  document.getElementById("back").hidden = view === "home" || view === "profiles";
  document.getElementById("settings").hidden = !browsing;
  document.getElementById("search").hidden = !browsing;
  // The switch-profile screen is full screen: no browsing chrome over it.
  document.getElementById("calendar").hidden = view === "profiles";
  renderProfile();

  let nodes;
  if (view === "profiles") nodes = renderProfiles();
  else if (view === "card") nodes = renderCard(key);
  else if (view === "explore") nodes = renderExplore(key, id);
  else if (view === "sources") nodes = renderSources(id, name);
  else if (view === "settings") nodes = renderSettings();
  else if (view === "search") nodes = renderSearch();
  else if (view === "calendar") nodes = renderCalendar();
  else nodes = renderHome();

  const main = document.getElementById("main");
  main.replaceChildren(...nodes);
  // One class, animation defined in the stylesheet: the new screen arrives
  // instead of appearing, and "no animation" removes it entirely.
  main.classList.remove("view-in");
  void main.offsetWidth;
  main.classList.add("view-in");
  renderTabs();
  window.scrollTo({ top: 0 });
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
      row.scrollLeft = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + delta));
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

async function boot() {
  modal.root = document.getElementById("modal");
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

  try {
    mergeServerSettings(await get("/settings"));
  } catch {
    /* server without the settings route */
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
  render();
}

boot();
