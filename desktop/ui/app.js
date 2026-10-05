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

const PROVIDERS = [
  ["tmdb", "TMDB", "Powers every catalog row and title metadata — pasting a key and enabling it changes the live contents immediately, with the same catalog names."],
  ["tvdb", "TVDB", "Extra series metadata (episode art, air dates)."],
  ["mdblist", "MDBList", "Aggregated ratings — enabling it replaces each title's rating with MDBList's."],
];

const TRACKERS = [
  ["simkl", "SIMKL", "Watched history and lists."],
  ["trakt", "Trakt", "Scrobbling and watched history."],
  ["letterboxd", "Letterboxd", "Film diary and lists."],
];

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

const SETTINGS_SECTIONS = [
  ["profile", "Profile"],
  ["posters", "Posters"],
  ["providers", "Providers"],
  ["tracking", "Tracking"],
  ["ai", "AI"],
  ["content", "Content"],
  ["addons", "Add-ons"],
  ["plugins", "Plugins"],
  ["layout", "Layout"],
  ["server", "Server"],
];

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
  tracking: readJSON(KEY.tracking, { simkl: { enabled: false }, trakt: { enabled: false }, letterboxd: { enabled: false } }),
  posters: readJSON(KEY.posters, { enabled: true, pattern: "" }),
  ai: readJSON(KEY.ai, {
    enabled: true,
    provider: "groq",
    model: "",
    hasKey: {},
    enhanceArtwork: true,
    enhanceMissing: true,
    autoPickCards: false,
  }),
  // id → watch state, mirrored from the server so the modal can show the state
  // a title is already pinned in.
  watchlist: {},
  sources: readJSON(KEY.sources, []),
  // App language and the country whose services the regional OTT cards show.
  language: localStorage.getItem(KEY.language) || "en-US",
  country: localStorage.getItem(KEY.country) || "US",
  // Which provider supplies the content inside a row: "tmdb" (default) or
  // "tvdb". Row membership is always TMDB's — this picks whose titles, artwork
  // and translations every catalog shows.
  contentSource: localStorage.getItem(KEY.contentSource) || "tmdb",
  // The choices the server offers (languages, countries).
  options: { languages: [], countries: [] },
  settingsSection: localStorage.getItem(KEY.section) || "profile",
  collections: [],
  order: {},
  picks: null,
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
  for (const item of payload?.items || []) map[`${item.type}:${item.id}`] = item.state;
  state.watchlist = map;
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
async function setWatchState(item, next) {
  const body = next === null ? { item: pinOf(item), remove: true } : { item: pinOf(item), state: next };
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

/** A clickable catalog-name chip that opens that catalog inside the card. */
function catalogChip(card, cat) {
  return el("button", {
    class: "chip focusable",
    type: "button",
    title: `Open ${cat.name}`,
    text: cat.name,
    onclick: () => go(`#/x/${encodeURIComponent(card.key)}/${encodeURIComponent(cat.id)}`),
  });
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

function collectionList() {
  if (state.ai?.enabled && state.ai?.autoPickCards) {
    if (!state.picks) {
      // "Pick the cards for you" chooses *which* cards appear — never their
      // order. Shuffling the card order here is what made Home look scrambled:
      // the picks are re-read in the published, canonical order instead.
      const keys = state.collections.map((c) => c.key);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      const chosen = new Set(keys.slice(0, 8));
      state.picks = state.collections.filter((c) => chosen.has(c.key)).map((c) => c.key);
    }
    const picked = state.picks.map((k) => cardByKey(k)).filter(Boolean);
    if (picked.length) return picked;
  }
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
          state.picks = null;
          render();
        },
      }),
    ),
  );
}

function renderHome() {
  const nodes = [heroBlock(), rowSwitch()];
  if (state.ai?.enabled && state.ai?.autoPickCards) {
    nodes.push(
      el("div", { class: "home-head" },
        el("h2", { class: "section-title", text: "Picked for you" }),
        el("button", {
          class: "btn subtle focusable",
          type: "button",
          text: "↻ New picks",
          onclick: () => {
            state.picks = null;
            render();
          },
        }),
      ),
    );
  } else {
    // Just the heading — no hint line under it.
    nodes.push(el("div", { class: "home-head" },
      el("h2", { class: "section-title", text: state.row === "movie" ? "Movies" : "Shows" }),
    ));
  }
  nodes.push(collectionGrid(state.row));
  return nodes.filter(Boolean);
}

/** One catalog row on a collection page: label, shuffle, explore. */
function catalogRow(card, cat) {
  return el(
    "div",
    { class: "cat-row" },
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
          class: "icon-btn small focusable",
          type: "button",
          title: "Shuffle this collection's catalogs",
          "aria-label": "Shuffle catalogs",
          onclick: () => {
            applyShuffle(card.key, rowOf(card).catalogs);
            render();
          },
        }, shuffleIcon()),
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
      const { metas } = await get(
        `/catalog/${apiType()}/${encodeURIComponent(cat.id)}/shuffle=12.json${catalogQuery()}`,
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

function renderSearch(query) {
  const input = el("input", {
    class: "text-input focusable search-input",
    type: "search",
    placeholder: "Search titles, collections and catalogs…",
    value: query || "",
    id: "search-input",
  });
  // Titles come from TMDB through the server. This is what the Ask box feeds:
  // "a lonely detective in the rain" only means something if search can find
  // *titles*, not just collection names.
  const titles = el("div", { class: "search-titles", id: "search-titles" });
  let timer = null;

  const loadTitles = async (value) => {
    const text = (value || "").trim();
    if (!text) {
      titles.replaceChildren();
      return;
    }
    titles.replaceChildren(el("p", { class: "view-hint", text: "Searching titles…" }));
    try {
      const { metas } = await get(`/search.json?q=${encodeURIComponent(text)}${catalogQuery().replace("?", "&")}`);
      titles.replaceChildren();
      if (!metas.length) return;
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
    timer = setTimeout(() => loadTitles(value), 250);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") location.hash = `#/search?q=${encodeURIComponent(input.value)}`;
  });
  input.addEventListener("input", () => refresh(input.value));
  if ((query || "").trim()) queueMicrotask(() => loadTitles(query));

  return [
    el("h1", { class: "view-title", text: "Search" }),
    input,
    titles,
    el("div", { class: "search-results", id: "search-results" }, ...searchResults(query)),
  ];
}

/* ----------------------------------------------------------------- calendar */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
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
        ? el("div", { class: "grid-titles" }, ...items.map((m) => posterCard(m, { kind: true })))
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
          : el("p", { class: "option-desc", text: "No providers read yet — press Providers in Settings." }),
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
  return [
    el("p", { class: "option-desc", text: "Paste a key and enable a provider. Catalogs keep the same names; the provider changes the contents behind them." }),
    ...PROVIDERS.map(([name, label, desc]) => keyRow("providers", name, label, desc, state.providers, KEY.providers)),
  ];
}

function paneTracking() {
  return [
    el("p", { class: "option-desc", text: "Connect a service to track what you watch." }),
    ...TRACKERS.map(([name, label, desc]) => keyRow("tracking", name, label, desc, state.tracking, KEY.tracking)),
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
      el("button", {
        class: "btn subtle focusable",
        type: "button",
        text: "Check key",
        onclick: async () => {
          status.className = "source-status";
          status.textContent = "Checking…";
          try {
            const res = await post("/ai/verify", { provider: slug });
            status.className = `source-status ${res?.ok ? "ok" : "bad"}`;
            status.textContent = res?.text || (res?.ok ? "connected" : "not connected");
          } catch (err) {
            status.className = "source-status bad";
            status.textContent = `could not check — ${err.message}`;
          }
        },
      }),
      el("a", { class: "ai-signup", href: signup, target: "_blank", rel: "noreferrer", text: "Get a free key" }),
      status,
    ),
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
      toggleRow(state.ai.autoPickCards, "Pick the cards for you", "Shows a random set of collections on Home instead of the full grid.", (e) => {
        state.ai.autoPickCards = e.target.checked;
        state.picks = null;
        writeJSON(KEY.ai, state.ai);
        pushSettings({ ai: { autoPickCards: state.ai.autoPickCards } });
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
  const languages = state.options.languages?.length
    ? state.options.languages.map((l) => [l.code, l.label])
    : FALLBACK_LANGUAGES;
  const countries = state.options.countries?.length
    ? state.options.countries.map((c) => [
        c.code,
        c.services ? `${c.name} — ${c.services} service${c.services === 1 ? "" : "s"}` : `${c.name} — no local service`,
      ])
    : FALLBACK_COUNTRIES;

  const language = el("select", { class: "text-input focusable", id: "app-language" },
    ...languages.map(([code, label]) => el("option", { value: code, text: label })));
  language.value = state.language;
  language.addEventListener("change", async () => {
    state.language = language.value;
    localStorage.setItem(KEY.language, state.language);
    await pushSettings({ language: state.language });
    render();
  });

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

  // Who supplies the content inside a row. TMDB is the only provider that can
  // generate a row at all (its discover endpoint answers "90s action on
  // Netflix"); TVDB supplies a title's name, translation, year and artwork. So
  // this chooses the content *source*, never the row list.
  const tvdbReady = Boolean(state.providers.tvdb?.enabled && state.providers.tvdb?.hasKey);
  const contentSourceRow = (value, title, desc) =>
    radioRow(state.contentSource === value, "contentSource", title, desc, () => {
      state.contentSource = value;
      localStorage.setItem(KEY.contentSource, value);
      pushSettings({ content: { source: value } });
      render();
    });

  return [
    contentSourceRow(
      "tmdb",
      "TMDB",
      "Default. Every row is TMDB's — its titles, its translations, its artwork.",
    ),
    contentSourceRow(
      "tvdb",
      "TVDB",
      tvdbReady
        ? "Every catalog shows TVDB's titles, translations, years and artwork instead. The rows themselves are still chosen by TMDB, which is what can build them."
        : "Needs a TVDB key (Settings → Providers). Without one the app keeps serving TMDB content rather than empty rows.",
    ),
    el("div", { class: "provider" },
      el("span", { class: "option-title", text: "App language" }),
      el("p", { class: "option-desc", text: "The language every catalog row is served in — titles, names and overviews — and the primary subtitle language a player should prefer. TMDB falls back to English where a title has no translation." }),
      el("div", { class: "source-form" }, language),
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
async function inspectSource(index) {
  const source = state.sources[index];
  if (!source) return;
  source.status = { ok: false, text: "Checking…" };
  render();
  try {
    const res = await post("/api/source", { type: source.type, url: source.url });
    source.providers = res.providers || [];
    source.name = res.name || source.name;
    source.status = { ok: Boolean(res.ok), text: res.ok ? `${res.name || typeLabel(source.type)} · ${res.message}` : res.message };
  } catch (err) {
    source.status = { ok: false, text: `could not check — ${err.message}` };
  }
  saveSources();
  render();
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
    server: paneServer,
  };

  // A stored section that no longer exists ("profile") falls back to the first one.
  const active = SETTINGS_SECTIONS.find(([id]) => id === section) || SETTINGS_SECTIONS[0];

  const nav = el("nav", { class: "settings-nav", "aria-label": "Settings sections" },
    ...SETTINGS_SECTIONS.map(([id, label]) =>
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
  else if (view === "search") nodes = renderSearch(new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "");
  else if (view === "calendar") nodes = renderCalendar();
  else nodes = renderHome();

  document.getElementById("main").replaceChildren(...nodes);
  renderTabs();
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------ keyboard nav */

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
  state.picks = null;
  state.order = {};
}

async function boot() {
  modal.root = document.getElementById("modal");
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

  // The app always opens on the switch-profile screen, the way Nuvio does —
  // unless the link points somewhere specific.
  const hash = location.hash;
  if (!hash || hash === "#/" || hash === "#") {
    location.hash = "#/profiles";
  }
  render();
}

boot();
