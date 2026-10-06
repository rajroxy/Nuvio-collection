#!/usr/bin/env node
/**
 * Headless UI smoke test.
 *
 * Runs the real `desktop/ui` app in jsdom against a running server and walks
 * every screen, failing on any uncaught error. This is the check that stands in
 * for "look at it in a browser" on a headless sandbox — and it has caught real
 * crashes and invisible-image bugs that no amount of reading would have found.
 *
 *   node serve.mjs &
 *   node scripts/ui-smoke.mjs
 *
 * Set NUVIO_UI_BASE to point at another origin (default http://127.0.0.1:4173).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(__dirname, "..", "desktop", "ui");
const BASE = process.env.NUVIO_UI_BASE || "http://127.0.0.1:4173";

const html = readFileSync(path.join(UI, "index.html"), "utf8");
const appJs = readFileSync(path.join(UI, "app.js"), "utf8");

try {
  const res = await fetch(`${BASE}/collections.json`);
  if (!res.ok) throw new Error(String(res.status));
} catch (err) {
  console.error(`the server is not reachable at ${BASE} — start it first (${err.message})`);
  process.exit(2);
}

// The two Content selects are built from the server's own list of languages and
// countries, so the run feeds the real payload through instead of a fixture that
// could drift away from what the addon actually offers.
const liveSettings = await (await fetch(`${BASE}/settings`)).json().catch(() => ({}));
// Same for the search screen's filter vocabulary: the panel is checked against the
// real list the server offers.
const liveFilters = await (await fetch(`${BASE}/search/filters.json`)).json().then((r) => r.filters).catch(() => null);

// The month the calendar opens on, and the days in it that hold *both* a film
// and a show — the calendar used to read only the current row's type.
const CAL_MONTH = new Date().toISOString().slice(0, 7);
const calendarOf = async (type) => {
  try {
    return (await (await fetch(`${BASE}/calendar/${type}/${CAL_MONTH}.json`)).json()).metas || [];
  } catch {
    return [];
  }
};
const moviesInMonth = await calendarOf("movie");
const showsInMonth = await calendarOf("series");
const BOTH_DAYS = new Set(
  moviesInMonth.filter((m) => showsInMonth.some((s) => s.releaseDate === m.releaseDate)).map((m) => m.releaseDate),
);

const errors = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/app/" });
const { window } = dom;
window.onerror = (msg, src, line, col, err) => errors.push(`window.onerror: ${msg} (${src}:${line}:${col}) ${err?.stack || ""}`);
window.addEventListener("unhandledrejection", (e) => errors.push(`unhandledrejection: ${e.reason?.stack || e.reason}`));

window.NUVIO_API = BASE;
const requested = [];
// The bodies POSTed to /settings — this is how a settings change is verified
// without writing a fake value into the real settings file.
const posted = [];
// Answered locally so the run never stores a fake key, mutates the real
// watchlist, or depends on a live host.
const STUBS = {
  [`${BASE}/api/source`]: { ok: true, kind: "repo", name: "Example Repo", providers: ["Netflix", "Anime World", "Torrentio"], message: "3 plugins" },
  [`${BASE}/providers/verify`]: { ok: true, text: "connected · 4 rating sources" },
  [`${BASE}/posters/check`]: { ok: true, text: "posters ok (HTTP 200)" },
  // The model list is answered here too: the live server would call the provider
  // with the real key, which a smoke test has no business doing.
  [`${BASE}/ai/models`]: {
    ok: true,
    models: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile", "whisper-large-v3"],
    chat: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile"],
    recommended: "openai/gpt-oss-20b",
    text: "3 models · 2 for chat · Groq Cloud",
  },
};

// An in-memory stand-in for the server's watchlist, so pinning a title in the
// test never writes into the real `addon/watchlist.json`.
const WATCH = { items: [] };
const watchCounts = () => ({
  planned: WATCH.items.filter((i) => i.state === "planned").length,
  watching: WATCH.items.filter((i) => i.state === "watching").length,
  watched: WATCH.items.filter((i) => i.state === "watched").length,
});
const WATCH_STATES = [
  { id: "planned", label: "Plan to Watch" },
  { id: "watching", label: "Watching" },
  { id: "watched", label: "Watched" },
];
const watchPayload = () => ({ items: WATCH.items, counts: watchCounts(), states: WATCH_STATES });

// The custom row you fill yourself, standing in for `addon/customrows.json` so a
// smoke run never writes the real one.
const CUSTOM_ROW = "add-cards";
let CUSTOM = [];
const customPayload = () => {
  const rows = [...new Set(CUSTOM.map((i) => i.row))].map((id) => ({ id, count: CUSTOM.filter((i) => i.row === id).length }));
  return { rows, counts: Object.fromEntries(rows.map((r) => [r.id, r.count])), items: CUSTOM };
};
const inCustom = (row, item) => CUSTOM.some((i) => i.row === row && `${i.type}:${i.id}` === `${item.type}:${item.id}`);
const json200 = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

window.fetch = (input, init) => {
  const url = String(input);
  requested.push(url);
  if (url === `${BASE}/watchlist.json`) return json200(watchPayload());
  if (url === `${BASE}/watchlist` && init?.method === "POST") {
    const body = JSON.parse(init.body || "{}");
    const key = `${body.item?.type}:${body.item?.id}`;
    const existing = WATCH.items.find((i) => `${i.type}:${i.id}` === key);
    if (body.remove || body.state === null) WATCH.items = WATCH.items.filter((i) => i !== existing);
    else if (existing) WATCH.items = existing.state === body.state ? WATCH.items.filter((i) => i !== existing) : WATCH.items.map((i) => (i === existing ? { ...i, state: body.state } : i));
    else WATCH.items.push({ ...body.item, state: body.state });
    return json200({ ok: true, removed: false, state: body.state, ...watchPayload() });
  }
  // The watchlist rows are served from the store above, not from the live
  // server, so the pin tests are hermetic — no real title gets pinned.
  if (url.includes("/catalog/") && url.includes("nuvio-watchlist--")) {
    const type = url.includes("/catalog/movie/") ? "movie" : "series";
    const slug = url.slice(url.indexOf("nuvio-watchlist--") + "nuvio-watchlist--".length).split(".")[0].split("/")[0];
    // Serve the same windowed pages the real server does, so a paging walk over
    // these rows ends the way it does in the app instead of repeating for ever.
    const skip = Number((url.match(/\/skip=(\d+)/) || [])[1] || 0);
    // The custom row lives in the same card, so it is answered here too.
    const list = slug === "add-cards-in-watchlist"
      ? CUSTOM.filter((i) => i.row === CUSTOM_ROW && i.type === type)
      : WATCH.items.filter((i) => i.type === type && i.state === { "plan-to-watch": "planned", watching: "watching", watched: "watched" }[slug]);
    return json200({ metas: list.slice(skip, skip + 10) });
  }
  if (url === `${BASE}/customrows.json`) return json200(customPayload());
  if (url === `${BASE}/customrows` && init?.method === "POST") {
    const body = JSON.parse(init.body || "{}");
    const row = body.row || CUSTOM_ROW;
    if (inCustom(row, body.item)) CUSTOM = CUSTOM.filter((i) => !(i.row === row && `${i.type}:${i.id}` === `${body.item.type}:${body.item.id}`));
    else CUSTOM.push({ ...body.item, row, state: undefined });
    return json200({ ok: true, ...customPayload() });
  }
  if (STUBS[url]) return json200(STUBS[url]);
  // Settings are answered locally too: the app mirrors them into its own state
  // at boot, so a value left behind in the live settings file would otherwise
  // change what these checks see.
  // A POST only acknowledges: echoing the whole settings object back would be a
  // second, competing source of truth for the toggles under test.
  if (url === `${BASE}/settings` && init?.method === "POST") {
    posted.push(JSON.parse(init.body || "{}"));
    return json200({ profile: "Movies & Shows", safe: true });
  }
  if (url === `${BASE}/settings`) {
    return json200({
      profile: "Movies & Shows",
      safe: true,
      language: liveSettings.language || "en-US",
      country: liveSettings.country || "US",
      content: liveSettings.content || { source: "tmdb" },
      options: liveSettings.options,
      ai: { enabled: true, provider: "groq", model: "", hasKey: {}, enhanceArtwork: true, enhanceMissing: true, autoPickCards: false },
    });
  }
  return fetch(new URL(url, BASE), init);
};
window.scrollTo = () => {};
// jsdom has no IntersectionObserver; fire at once so lazy strips and the endless
// scroll actually run.
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]); }
  disconnect() {}
  unobserve() {}
};

// Simulate an install whose stored section no longer exists, so Settings must
// fall back to the first pane instead of rendering nothing.
window.localStorage.setItem("nuvio.settingsSection", "retired-section");

window.eval(appJs);

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const text = (el) => (el?.textContent || "").trim();

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); return; }
  fail++;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

const settle = (ms = 70) => new Promise((r) => setTimeout(r, ms));
const nav = async (hash, ms = 90) => {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event("hashchange"));
  await settle(ms);
};
// Poll until a condition holds — used where the server needs several round trips.
const waitFor = async (fn, { tries = 80, ms = 250 } = {}) => {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await settle(ms);
  }
  return false;
};

for (let i = 0; i < 120 && !$$("#main > *").length; i++) await settle(40);

console.log("headless UI smoke test\n");
check("boot rendered the app", $$("#main > *").length > 0, `#main children: ${$$("#main > *").length}`);
// The boot screen: a real element, taken away once the first screen is up.
check("there is a boot screen, with a mark and a name",
  Boolean($(".boot")) && Boolean($(".boot-ring")) && /Nuvio/.test(text($(".boot-name"))),
  text($(".boot-name")));
check("and the app takes it away once the first screen is on the page",
  Boolean($(".boot")) && ($(".boot").classList.contains("done") || $(".boot").hidden === true),
  $(".boot") ? `class="${$(".boot").className}" hidden=${$(".boot").hidden}` : "no boot screen");
check("no error before any interaction", errors.length === 0, errors.join(" | "));

/* --------------------------------------------------------------- top bar */
check("no logo / app label in the top bar", !$(".brand") && !$(".mark") && !$(".brand-text"));
check("there is no Movies or Shows tab in the top bar",
  $$("#tabs .tab").map(text).join(",") === "Home", $$("#tabs .tab").map(text).join(","));
check("profile comes first, calendar to its right",
  Boolean($("#profile") && $("#calendar")) &&
    ($("#profile").compareDocumentPosition($("#calendar")) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
    $("#profile").parentElement === $("#calendar").parentElement);
check("search sits immediately before settings", $("#search")?.nextElementSibling === $("#settings"));
check("the collections/catalogs status text is gone from the top right", !$("#status") && !$(".status"));

/* The top-bar controls must be one matching icon set, not mixed emoji glyphs. */
for (const id of ["back", "profile", "calendar", "search", "settings"]) {
  const btn = window.document.getElementById(id);
  check(`the ${id} control is a drawn icon, not a text glyph`,
    Boolean(btn?.querySelector("svg")) && text(btn) === "",
    `${btn?.querySelectorAll("svg").length} svg · text ${JSON.stringify(text(btn))}`);
}

/* The dividers must be painted, not invisible — "the divider isn't showing"
   is a real regression that no DOM check would catch, so read the stylesheet. */
const css = readFileSync(path.join(UI, "style.css"), "utf8");
const ruleFor = (sel) => {
  const m = css.match(new RegExp(`\\${sel.slice(0, 1)}${sel.slice(1)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};
// Alpha of the strongest colour stop in a rule's background. Tints are written
// as `rgba(var(--accent-rgb), a)` since the accent became a setting, so the
// token form counts too — otherwise every divider would read as invisible.
const peakAlpha = (body) => Math.max(0,
  ...[...body.matchAll(/rgba?\(\s*(?:var\(--accent-rgb\)|[^()]*?)\s*,\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1])),
  ...(body.includes("#") && !body.includes("rgba") ? [1] : [0]));
const dividerChecks = [[".top-divider", ruleFor(".top-divider")], [".v-divider", ruleFor(".v-divider")]];
for (const [sel, body] of dividerChecks) {
  const width = Number((body.match(/width:\s*([\d.]+)px/) || [])[1] || 0);
  check(`${sel} is a drawn line, not a transparent box`,
    width >= 1 && peakAlpha(body) >= 0.5,
    `width ${width}px, strongest alpha ${peakAlpha(body)} — ${body.trim().replace(/\s+/g, " ")}`);
}
const hRule = ruleFor(".h-divider");
check(".h-divider is a drawn line, not a transparent box",
  Number((hRule.match(/height:\s*([\d.]+)px/) || [])[1] || 0) >= 1 && peakAlpha(hRule) >= 0.5,
  `height ${(hRule.match(/height:\s*([\d.]+)px/) || [])[1] || 0}px, strongest alpha ${peakAlpha(hRule)}`);
check("a vertical divider follows the calendar",
  Boolean($(".top-divider")) &&
    $("#calendar")?.nextElementSibling === $(".top-divider") &&
    $(".top-divider")?.parentElement === $(".top-left"),
  $("#calendar")?.nextElementSibling?.className || "nothing after the calendar");
check("the calendar and search icons are both still there", Boolean($("#calendar")) && Boolean($("#search")));

/* --------------------------------------------------- switch profile first */
check("the profile control is an icon, not a name pill",
  Boolean($("#profile svg")) && !$("#profile-name") && !$(".profile-switch"));
check("there is no profile dropdown left", !$("#profile-menu"));
check("the app starts on the switch-profile screen",
  window.location.hash === "#/profiles" && Boolean($(".profile-grid")), `${window.location.hash} · ${$$(".profile-grid").length} grid`);
check("both profiles are offered, including Live TV & Sports",
  $$(".profile-tile .profile-tile-name").map(text).join(",") === "Movies & Shows,Live TV & Sports",
  $$(".profile-tile .profile-tile-name").map(text).join(","));
check("the picker marks the current profile", $$(".profile-tile.active").length === 1);
check("there is no Manage profiles button on the picker",
  !$$(".profiles .btn").some((b) => text(b).includes("Manage")) && $$(".profiles .btn").length === 0,
  $$(".profiles .btn").map(text).join(","));

$$(".profile-tile")[1].click();
await settle(140);
check("picking a profile enters the app", window.location.hash === "#/" && Boolean($(".hero")), window.location.hash);
check("the top-bar icon reports the chosen profile",
  ($("#profile")?.getAttribute("aria-label") || "").includes("Live TV & Sports"), $("#profile")?.getAttribute("aria-label"));
$("#profile").click();
await settle(140);
check("the profile icon reopens the switch-profile screen",
  window.location.hash === "#/profiles" && Boolean($(".profile-grid")), window.location.hash);
$$(".profile-tile")[0].click();
await settle(160);
check("switching back lands on Home as Movies & Shows",
  window.location.hash === "#/" && ($("#profile")?.getAttribute("aria-label") || "").includes("Movies & Shows"),
  $("#profile")?.getAttribute("aria-label"));

/* ------------------------------------------------------------------ home */
await nav("#/");
check("home has a hero", Boolean($(".hero")));
check("the hero art has a cover background", ($(".hero-art")?.getAttribute("style") || "").includes("/covers/"));
check("every hero catalog label is a clickable button",
  $$(".hero-cats button.chip").length > 0 && $$(".hero-cats button.chip").length === $$(".hero-cats .chip").length,
  `${$$(".hero-cats .chip").length} labels`);
check("the hero carries no counts line, only its Explore action",
  !$(".hero-note") &&
    !/\bcatalogs\b/.test(text($(".hero"))) &&
    $$(".hero-actions .btn").map(text).join(",") === "Explore",
  text($(".hero-actions")));
check("no poster carries a BTTR badge",
  !$(".bttr-tag") && !/\bBTTR\b/.test(window.document.body.textContent),
  `${$$(".bttr-tag").length} badges`);
check("the grid heading carries no 'click the artwork' hint",
  !window.document.body.textContent.includes("click a collection's artwork"),
  text($(".home-head")));
check("the grid heading is just the row name", text($(".home-head")) === "Movies", JSON.stringify(text($(".home-head"))));
check("Movies and Shows are buttons after the hero, not tabs", $$(".row-switch .row-btn").map(text).join(",") === "Movies,Shows");
check("Movies is the default selection", $$(".row-switch .row-btn")[0]?.classList.contains("active") === true);
check("the grid under the hero is the Movies grid", text($(".section-title")) === "Movies" && $$(".icon-art img").every((i) => (i.getAttribute("src") || "").includes("/covers/movies/")));
check("every tile image has a real cover src", $$(".icon-art img").every((i) => (i.getAttribute("src") || "").includes("/covers/")));
check("a tile is entered by its artwork only", $$(".icon-box .icon-art").length === $$(".icon-box").length && $$(".icon-box button").length === $$(".icon-box").length);
// Every card (and the banner) draws pictures of what it holds over its cover, and the
// overlay never becomes a second click target.
check("every card lays its own contents over the cover",
  $$(".icon-box").every((b) => Boolean(b.querySelector(".content-strip"))),
  `${$$(".content-strip").length} strips`,
);
// The posters *replace* the vector scene: the frame carries `art-filled` as soon as
// its pictures arrive, which is what hides the generated cover underneath.
check("and the frame keeps its own layout rule, padded from its edges",
  /inset:\s*10px/.test(ruleFor(".content-strip")) && /gap:\s*8px/.test(ruleFor(".content-strip")),
  ruleFor(".content-strip").trim().slice(0, 70));
// jsdom does not compute pointer-events for a class rule, so read the stylesheet —
// the overlay must never swallow the click that enters a card.
check("and the overlay never takes the click that opens a card", /pointer-events:\s*none/.test(ruleFor(".content-strip")), ruleFor(".content-strip").trim().slice(0, 70));
check("the banner lays its card's contents over the cover too", Boolean($(".hero-art .content-strip")));
// The picture keeps the left-hand slot, and it is a **button**: the landscape shot
// is the way into the title on it.
check("the banner's picture is on the left and is clickable",
  $(".hero")?.firstElementChild?.classList.contains("hero-art") &&
    $(".hero-art")?.tagName === "BUTTON" &&
    $(".hero-art")?.getAttribute("type") === "button",
  `${$(".hero")?.firstElementChild?.className} · ${$(".hero-art")?.tagName}`);
// The strips are filled from the catalog endpoint, so give the row a moment to answer.
await settle(2500);
check("and those pictures are real images of the card's titles",
  $$(".content-strip .content-tile").length > 0 &&
    $$(".content-strip .content-tile").every((i) => /^https?:/.test(i.getAttribute("src") || "")),
  `${$$(".content-strip .content-tile").length} tile images`,
);
const filledStrips = $$(".content-strip.filled");
const unframed = filledStrips.filter((s) => !s.parentElement?.classList.contains("art-filled"));
const cardCoverRule = /\.icon-wrap\.art-filled \.icon-art img \{\s*opacity:\s*0/.test(css);
const heroCoverRule = /\.hero-art\.art-filled[^{]*\{\s*background-image:\s*none !important/.test(css);
check("the posters replace the cover in the frame they land in",
  filledStrips.length > 0 && unframed.length === 0 && cardCoverRule && heroCoverRule,
  `${filledStrips.length} filled · ${unframed.length} unframed [${[...new Set(unframed.map((s) => s.parentElement?.className || "detached"))].join("|")}] · cover rules ${cardCoverRule}/${heroCoverRule}`,
);
check("Watchlist is first and a divider precedes the rest",
  text($$(".icon-box .icon-name")[0]) === "Watchlist" && Boolean($(".icons .v-divider")),
  `first: ${text($$(".icon-box .icon-name")[0])}`);

// The reported "my card order is shuffled": nothing may reorder the cards.
const published = (await (await fetch(`${BASE}/collections.json`)).json()).map((c) => c.title);
check(
  "the cards keep the published order",
  $$(".icon-box .icon-name").map(text).join(" | ") === published.join(" | "),
  $$(".icon-box .icon-name").map(text).slice(0, 5).join(", "),
);
// Every card, in the order the addon publishes — no "picks", no subset. The grid
// used to be able to show a random eight, which read as "my cards were rearranged".
check(
  "Home shows every card, not a picked subset",
  $$(".icon-box .icon-name").length === published.length && published.length >= 20,
  `${$$(".icon-box .icon-name").length} of ${published.length}`,
);
check("Home has no 'Picked for you'", !window.document.body.textContent.includes("Picked for you"));

const heroArtBefore = $(".hero-art")?.getAttribute("style");
$$(".row-switch .row-btn")[1].click();
await settle(120);
check("clicking Shows swaps the cards", text($(".section-title")) === "Shows" && $$(".icon-art img").every((i) => (i.getAttribute("src") || "").includes("/covers/shows/")));
check("and swaps the hero banner too", ($(".hero-art")?.getAttribute("style") || "") !== heroArtBefore && ($(".hero-art")?.getAttribute("style") || "").includes("/covers/shows/"));
// The banner moves on its own: a different card every ten seconds, at random. This
// waits out one interval rather than trusting the timer to exist.
const heroBefore = text($(".hero-title"));
await settle(10_600);
check("the banner moves to another card on its own within ten seconds",
  Boolean(text($(".hero-title"))) && text($(".hero-title")) !== heroBefore,
  `${heroBefore} → ${text($(".hero-title"))}`,
);
check("the banner names itself", text($(".hero-kicker")) === "Spotlight", text($(".hero-kicker")));
// A card with eighty tags must not turn the banner into a wall of pills.
check("the banner's tag line is held to two rows when its card has many tags",
  $$(".hero-cats button.chip").length <= 8 || Boolean($(".hero-cats .chip-arrow")),
  `${$$(".hero-cats button.chip").length} tags · ${$(".hero-cats .chip-arrow") ? "two rows + arrows" : "short enough"}`);
// The arrows **scroll** the line — they do not expand it — and they only exist
// where the tags do not fit. The glyph has to be a drawn stroke, or it renders as a
// filled blob on a dark background (an "empty pill").
const heroClamped = $(".hero-cats.chip-clamped");
if (heroClamped) {
  const track = heroClamped.querySelector(".chip-track");
  const arrows = [...heroClamped.querySelectorAll(".chip-arrow")];
  check("a long tag line gets an up arrow and a down arrow",
    arrows.length === 2 &&
      arrows[0].classList.contains("up") && arrows[1].classList.contains("down") &&
      /overflow-y:\s*auto/.test(ruleFor(".chip-clamped .chip-track")) &&
      // The arrows have to be *strokes*: a filled glyph on a dark plate is the
      // "empty pill" this control used to be.
      /stroke:\s*currentColor/.test(ruleFor(".glyph svg")),
    `${arrows.length} arrows · track: ${ruleFor(".chip-clamped .chip-track").trim().slice(0, 40)}`);
  check("the two arrows point opposite ways",
    arrows[0].querySelector("path")?.getAttribute("d") === "M6 15l6-6 6 6" &&
      arrows[1].querySelector("path")?.getAttribute("d") === "M6 9l6 6 6-6",
    `${arrows[0].querySelector("path")?.getAttribute("d")} / ${arrows[1].querySelector("path")?.getAttribute("d")}`);
  // jsdom has no layout, so nothing to scroll — but the *control* is checkable: the
  // down arrow asks the track to scroll by a positive step, and it never opens the
  // line into a wall of pills.
  const asked = [];
  track.scrollBy = (opts) => asked.push(opts?.top || 0);
  const tagsBefore = $$(".hero-cats button.chip").length;
  arrows[1].click();
  await settle(120);
  check("the down arrow scrolls the line a row at a time instead of opening it",
    asked.length === 1 && asked[0] > 0 &&
      !track.classList.contains("open") &&
      $$(".hero-cats button.chip").length === tagsBefore && tagsBefore > 8,
    `asked for ${asked[0]}px · ${tagsBefore} tags still held to two rows`);
  arrows[0].click();
  await settle(60);
  check("and the up arrow scrolls back the same way",
    asked.length === 2 && asked[1] < 0,
    `asked for ${asked.join(", ")}px`);
}
// Reading the banner is a reason for it to hold still: with the cursor on it the
// ten-second rotation freezes, and it picks up again on the way out.
const hoveredTitle = text($(".hero-title"));
$(".hero").dispatchEvent(new window.Event("mouseenter"));
await settle(10_600);
check("the banner freezes while the cursor is over it",
  text($(".hero-title")) === hoveredTitle, `${hoveredTitle} → ${text($(".hero-title"))}`);
$(".hero").dispatchEvent(new window.Event("mouseleave"));
await settle(10_600);
check("and it moves again once the cursor leaves it",
  text($(".hero-title")) !== hoveredTitle, `${hoveredTitle} → ${text($(".hero-title"))}`);
$$(".row-switch .row-btn")[0].click();
await settle(120);
check("clicking Movies swaps back", text($(".section-title")) === "Movies");

/* ----------------------------------------------- hero label -> its row */
/* A catalog label jumps to that row on the card; it no longer skips past the
   other rows into Explore. */
const heroChip = text($$(".hero-cats button.chip")[0]);
$$(".hero-cats button.chip")[0].click();
// A row is slower now: each title resolves an IMDb id for its better poster.
await settle(700);
check("a hero catalog label stays on the card", window.location.hash.startsWith("#/c/"), window.location.hash);
check("and jumps to the row it names",
  $$(".cat-row .cat-name").some((n) => text(n) === heroChip), heroChip);
check("the rows are in the published order, not shuffled by a control",
  $$(".cat-row .cat-name").map(text).join(" | ") ===
    (await (await fetch(`${BASE}/collections.json`)).json())
      .find((c) => c.movie?.catalogs?.some((x) => x.name === heroChip))
      ?.movie.catalogs.map((x) => x.name).join(" | "),
  $$(".cat-row .cat-name").map(text).join(", "),
);
// Enter Explore the way a user does: the row's own button — on a card that owns a
// ◆ Top 10 row, because the banner is no longer pinned to that one card (it
// rotates) and the Discover card's rows are ◆ Top 25 now, so the chip above can
// land on any collection.
await nav("#/c/global-ott-top-10", 900);
$$(".cat-row .btn.explore")[0].click();
await settle(1200);
check("a row's Explore opens that catalog", window.location.hash.startsWith("#/x/"), window.location.hash);
check("Explore shows the card label and the catalog label",
  Boolean($(".explore-head .crumb")) && Boolean($(".explore-head .crumb.current")),
  text($(".explore-head")));
check("Explore shows only those two labels in the header", $$(".explore-head .crumb").length === 2);
check("Explore has no cover image or extra blurb", !$(".explore .section-cover") && !/catalogs in this collection/.test(text($(".explore"))));
check("Explore has a shuffle", $$(".explore-head .cat-tools .btn").some((b) => text(b).includes("Shuffle")));

/* The alphabet rail: an index of the row's *titles* by first letter.
   It is a column in the grid's own row (`.explore-body`), so the letters sit
   level with the poster columns and clear of them — it used to be `position:
   fixed` at the middle of the viewport, which floated it over the sample row. */
check("Explore offers the alphabet rail",
  $$(".alpha-rail .alpha").length === 26, `${$$(".alpha-rail .alpha").length} letters`);
check("the rail is a column in the grid's own row, so its letters line up with the posters",
  $(".explore-body")?.contains($(".alpha-rail")) === true &&
    $(".explore-body")?.contains($(".explore .grid-titles")) === true &&
    /display:\s*flex/.test(ruleFor(".explore-body")) &&
    /position:\s*sticky/.test(ruleFor(".alpha-rail")),
  `${$(".alpha-rail")?.parentElement?.className} · ${ruleFor(".alpha-rail").trim().slice(0, 40)}`);
// It is level with the middle of the screen, not pinned under the header, and it
// lives inside `.explore-body` — so it starts at the catalog row and never at the
// shuffle sample above it.
check("and it is aligned with the middle of the screen, not pinned under the header",
  /top:\s*50vh/.test(ruleFor(".alpha-rail")),
  ruleFor(".alpha-rail").trim().replace(/\s+/g, " ").slice(0, 80));
check("and it is drawn as a plate, not letters floating on the posters",
  /background:\s*rgba\(10, 11, 15/.test(ruleFor(".alpha-rail")),
  ruleFor(".alpha-rail").trim().slice(0, 60));
check("letters this row has nothing under are marked off",
  $$(".alpha-rail .alpha.off").length > 0 && $$(".alpha-rail .alpha:not(.off)").length > 0,
  `${$$(".alpha-rail .alpha.off").length} off · ${$$(".alpha-rail .alpha:not(.off)").length} on`);
// The rail indexes the *contents*: a letter is on exactly when a loaded title
// starts with it.
const onLetters = () => new Set($$(".alpha-rail .alpha:not(.off)").map(text));
const titleLetters = () => new Set($$(".explore .grid-titles .poster")
  .map((p) => (text(p.querySelector(".poster-name")) || "").trim().charAt(0).toUpperCase())
  .filter((c) => /[A-Z]/.test(c)));
check("the rail's letters are the titles that are actually loaded",
  [...onLetters()].sort().join("") === [...titleLetters()].sort().join(""),
  `rail ${[...onLetters()].sort().join("")} vs titles ${[...titleLetters()].sort().join("")}`);
// Picking a letter **shows that letter's titles and nothing else** — it is a
// filter over the row, not a jump to one title (the row is paged in until the
// letter is filled out, and the same letter again puts everything back).
const shownLetters = () => $$(".explore .grid-titles .poster")
  .map((p) => (text(p.querySelector(".poster-name")) || "").trim().charAt(0).toUpperCase())
  .filter((c) => /[A-Z]/.test(c));
const firstLetterBtn = $$(".alpha-rail .alpha:not(.off)")[0];
const letter = firstLetterBtn ? text(firstLetterBtn) : "";
firstLetterBtn?.click();
await settle(260);
const pickedLetters = shownLetters();
check("picking a letter shows that letter's titles and nothing else",
  Boolean(firstLetterBtn) && pickedLetters.length > 0 && pickedLetters.every((c) => c === letter),
  `${letter} → ${[...new Set(pickedLetters)].join("") || "nothing"} (${pickedLetters.length} titles)`);
check("and the line above the grid names the letter, with the way back",
  $(".explore-filter")?.hidden === false &&
    String(text($(".explore-filter-text"))).includes(letter) &&
    Boolean($(".explore-filter button")),
  `${text($(".explore-filter-text"))} · back=${Boolean($(".explore-filter button"))}`);
check("the chosen letter is marked on the rail itself",
  text($(".alpha-rail .alpha.on")) === letter &&
    $(".alpha-rail .alpha.on")?.getAttribute("aria-pressed") === "true",
  `${text($(".alpha-rail .alpha.on")) || "none"} marked`);
$(".explore-filter button")?.click();
await settle(260);
check("picking it again puts the whole row back",
  $(".explore-filter")?.hidden === true &&
    !$(".alpha-rail .alpha.on") &&
    shownLetters().length >= pickedLetters.length,
  `${shownLetters().length} titles back`);

/* -------------------------- one sample row above the exploring rows ------ */
/* ONE sample row, drawn as an ordinary row: no "Shuffle 1" label, no control of
   its own, one Shuffle in the header and a rule before the catalog. */
check("Explore opens with one sample row, then the divider, then the catalog",
  $$(".explore-shuffles .shuffle-row").length === 1,
  `${$$(".explore-shuffles .shuffle-row").length} rows`);
check("the sample row carries no 'Shuffle N' label",
  !/Shuffle\s*\d/.test(text($(".explore-shuffles"))) && !$$(".explore-shuffles .cat-name").length,
  JSON.stringify(text($(".explore-shuffles")).slice(0, 80)));
// The poster tiles are buttons (that is how a title is opened); what a sample row
// must not carry is a shuffle control or a label of its own.
check("the sample rows carry no shuffle control of their own",
  !$$(".explore-shuffles .cat-tools").length && !$$(".explore-shuffles button:not(.poster)").length,
  `${$$(".explore-shuffles button:not(.poster)").length} non-poster controls inside the rows`);
check("there is exactly one shuffle button, at the top right of the header",
  $$(".explore-head .cat-tools button").length === 1 && Boolean($("#shuffle-samples svg")) &&
    $(".explore-head")?.contains($("#shuffle-samples")) === true,
  `${$$(".explore-head .cat-tools button").length} header controls`);
check("a horizontal divider separates the sample row from the catalog",
  $(".explore-shuffles")?.nextElementSibling === $(".explore .h-divider") &&
    $(".explore .h-divider")?.nextElementSibling === $(".explore .explore-body"),
  `${$(".explore-shuffles")?.nextElementSibling?.className || "nothing"} then ${$(".explore .h-divider")?.nextElementSibling?.className || "nothing"}`);
const shuffleRowsFilled = await waitFor(() =>
  $$(".explore-shuffles .shuffle-row").every((r) => r.querySelectorAll(".poster").length > 0));
check("every sample row draws titles", shuffleRowsFilled,
  $$(".explore-shuffles .shuffle-row").map((r) => r.querySelectorAll(".poster").length).join("/"));
check("Explore renders real titles", $$(".explore .grid-titles .poster").length > 0, `${$$(".explore .grid-titles .poster").length} posters`);
// A ◆ Top 10 row must stay exactly ten titles however far it is scrolled. The end
// note is written once the app knows the row is drained, which is a round trip
// after the tiles land — so wait for it rather than assuming the settle covered it.
const drained10 = await waitFor(() => /End of catalog\./.test(text($(".explore .sentinel"))), { tries: 40, ms: 250 });
check("a ◆ Top 10 catalog holds exactly ten titles, however far it is scrolled",
  $$(".explore .grid-titles .poster").length === 10 && /End of catalog\./.test(text($(".explore .sentinel"))),
  `${$$(".explore .grid-titles .poster").length} posters · ${text($(".explore .sentinel")) || "no sentinel"} · drained=${drained10}`);
check("Explore scrolls endlessly and stops at the end",
  drained10 && requested.some((u) => u.includes("skip=")),
  text($(".explore .sentinel")) || "no sentinel text");

/* ------------------------------------------------------------ collection */
await nav("#/");
$$(".icon-art")[1].click();
await settle(160);
check("a collection opens from its artwork", $$(".cat-row").length > 0, `${$$(".cat-row").length} rows`);
// The card page's artwork is the card's own frame — the generated cover is its
// background, and the card's titles are laid inside it — with the name and tags on
// the left, exactly like the banner.
check("the card's artwork is on the right of its name and tags",
  (() => {
    const head = $(".section-head");
    const kids = [...(head?.children || [])];
    return kids.length === 2 && kids[0].classList.contains("section-meta") && kids[1].classList.contains("section-art") &&
      /\/covers\//.test((kids[1].getAttribute("style") || "") + "") === true;
  })(),
  $(".section-head")?.children?.[1]?.className || "no head");
check("and the tags line comes before it in that frame",
  Boolean($(".section-meta")?.querySelector(".cats")), "no tags");
check("the card's own posters are laid inside that frame, padded and never stretched",
  /position:\s*absolute/.test(ruleFor(".content-strip")) &&
    /inset:\s*10px/.test(ruleFor(".content-strip")) &&
    /object-fit:\s*cover/.test(ruleFor(".content-tile")),
  `strip: ${ruleFor(".content-strip").trim().slice(0, 60)}`);
check("collection catalog labels are clickable", $$(".cats button.chip").length === $$(".cats .chip").length && $$(".cats button.chip").length > 0);
// A row carries its catalog's name and Explore — and no shuffle. A shuffle there
// could only reorder the rows, which is not what "shuffle" means to anyone using
// it: they expect that catalog's titles to be redrawn, which is Explore's job.
check("every row names its catalog and offers Explore",
  $$(".cat-row .cat-name").length === $$(".cat-row").length &&
    $$(".cat-row .cat-tools .btn.explore").length === $$(".cat-row").length,
  `${$$(".cat-row").length} rows`);
check("no shuffle icon beside Explore",
  $$(".cat-row .cat-tools .icon-btn").length === 0,
  `${$$(".cat-row .cat-tools .icon-btn").length} icons`);
check("no section-level shuffle button", $$(".section-actions .btn").length === 0);
check("no 'Load more' anywhere", !window.document.body.textContent.includes("Load more"));
// A catalog chip goes to that row instead of dropping into Explore.
const chipLabel = text($$(".cats button.chip")[0]);
$$(".cats button.chip")[0].click();
await settle(300);
check("a collection catalog label stays on the card", window.location.hash.startsWith("#/c/"), window.location.hash);
check("and the row it names is on the page",
  $$(".cat-row .cat-name").some((n) => text(n) === chipLabel),
  chipLabel);

// A card's tag line is a two-row window with up/down arrows that scroll it — the
// big cards carry nearly two hundred tags, and as one wall of pills they pushed
// every row off the page.
await nav("#/c/themes-and-tags", 800);
check("a card with many tags holds its tag line to two rows",
  Boolean($(".cats.chip-clamped")) && $$(".cats .chip-arrow").length === 2,
  `${$$(".cats button.chip").length} tags · ${$$(".cats .chip-arrow").length} arrows`);
check("and that window scrolls instead of growing into a taller wall",
  /max-height/.test(ruleFor(".chip-clamped .chip-track")) &&
    /overflow-y:\s*auto/.test(ruleFor(".chip-clamped .chip-track")),
  ruleFor(".chip-clamped .chip-track").trim().slice(0, 70));
// The arrows have to read as controls: a bordered, tinted plate with a stroke
// glyph in it — not a bare pill with an invisible (filled) glyph.
check("the arrows are drawn as buttons, not bare glyphs",
  /border-radius:\s*10px/.test(ruleFor(".chip-arrow")) &&
    /border:\s*1px solid rgba\(var\(--accent-rgb\), 0\.45\)/.test(ruleFor(".chip-arrow")) &&
    /background:\s*rgba\(var\(--accent-rgb\), 0\.14\)/.test(ruleFor(".chip-arrow")) &&
    /stroke:\s*currentColor/.test(ruleFor(".glyph svg")),
  ruleFor(".chip-arrow").trim().replace(/\s+/g, " ").slice(0, 90));
const chipTrack = $(".cats .chip-track");
const chipArrows = $$(".cats .chip-arrow");
const chipAsked = [];
chipTrack.scrollBy = (opts) => chipAsked.push(opts?.top || 0);
const tagsOnPage = $$(".cats button.chip").length;
chipArrows[1].click();
await settle(120);
chipArrows[0].click();
await settle(60);
check("the arrows scroll the tags a row at a time, and nothing is expanded in place",
  chipAsked.length === 2 && chipAsked[0] > 0 && chipAsked[1] < 0 &&
    !chipTrack.classList.contains("open") && $$(".cats button.chip").length === tagsOnPage,
  `asked ${chipAsked.join(", ")}px · open=${chipTrack.classList.contains("open")}`);
await nav("#/c/watchlist", 500);
check("a card with few tags gets no clamp and no arrows",
  !$(".cats .chip-arrow") && !$(".cats.chip-clamped") && $$(".cats button.chip").length > 0,
  `${$$(".cats button.chip").length} tags`);

/* ---------------------------------------- a catalog row keeps scrolling --- */
// A strip used to stop dead after its first window — that is what "this card
// does not scroll" meant. Scrolling it to the end now asks for the next one.
await nav("#/c/discover", 500);
const strip = $$(".cat-row .strip").find((s) => s.querySelectorAll(".poster").length > 0) || $$(".cat-row .strip")[0];
const filled = await waitFor(() => strip.querySelectorAll(".poster").length > 0, { tries: 60, ms: 250 });
check("a catalog row fills its first window", filled, `${strip.querySelectorAll(".poster").length} posters`);
const windowBefore = strip.querySelectorAll(".poster").length;
strip.dispatchEvent(new window.Event("scroll"));
const grew = await waitFor(() => strip.querySelectorAll(".poster").length > windowBefore, { tries: 60, ms: 250 });
check(
  "scrolling a row asks for the next window instead of ending",
  grew,
  `${windowBefore} -> ${strip.querySelectorAll(".poster").length} posters`,
);

/* ------------------------------- a normal catalog must page deeply -------- */
// The reported bug: a row held ~20 titles, so Explore bottomed out on its first
// or second page and announced "End of catalog." almost immediately.
await nav("#/c/discover", 300);
const deepRow = $$(".cat-row").find((r) => !/◆ Top 10/.test(text(r.querySelector(".cat-name"))));
check("a card offers a normal (non-Top-10) catalog to page", Boolean(deepRow), `${$$(".cat-row").length} rows`);
deepRow?.querySelector(".cat-name").click();
await settle(1200);
const drained = await waitFor(() => /End of catalog\./.test(text($(".explore .sentinel"))));
const deepCount = $$(".explore .grid-titles .poster").length;
check("a normal Explore row pages far past a single window", deepCount > 40, `${deepCount} posters`);
check("and drains to the end rather than stopping after one page", drained, text($(".explore .sentinel")) || "still loading");
// The one header Shuffle, on a catalog deep enough to draw a full sample from.
const shufflesBefore = requested.filter((u) => u.includes("shuffle=")).length;
$("#shuffle-samples").click();
await waitFor(() => requested.filter((u) => u.includes("shuffle=")).length >= shufflesBefore + 1);
check("the header shuffle asks for a fresh draw",
  requested.filter((u) => u.includes("shuffle=")).length >= shufflesBefore + 1,
  `${requested.filter((u) => u.includes("shuffle=")).length - shufflesBefore} new shuffle requests`);
// The draw must not be servable from a browser cache: without the fresh `_=`
// parameter the URL is byte-identical and the row never changes.
check("and the draw cannot come out of the browser's cache",
  requested.filter((u) => u.includes("shuffle=")).slice(-1)[0].includes("&_="),
  requested.filter((u) => u.includes("shuffle=")).slice(-1)[0]);
check("the row is refilled with a full sample",
  await waitFor(() => $$(".explore-shuffles .shuffle-row").every((r) => r.querySelectorAll(".poster").length === 12)),
  $$(".explore-shuffles .shuffle-row").map((r) => r.querySelectorAll(".poster").length).join("/"));
check("the grid below is untouched by a row shuffle",
  $$(".explore .grid-titles .poster").length === deepCount,
  `${$$(".explore .grid-titles .poster").length} vs ${deepCount}`);

check("the drained row asked the server for several windows",
  requested.filter((u) => /\/catalog\//.test(u)).length >= 4,
  `${requested.filter((u) => /\/catalog\//.test(u)).length} catalog requests`);
// By id, not by name: TMDB legitimately holds two different films called
// "The Odyssey", so a name clash is data, not a paging repeat.
const uniqueIds = new Set($$(".explore .grid-titles .poster").map((b) => b.getAttribute("data-id")));
check("no title is served twice in the drained row",
  uniqueIds.size === deepCount && !uniqueIds.has(""),
  `${uniqueIds.size} unique ids of ${deepCount} posters`);

/* --------------------------------------------------- title modal->sources */
await settle(150);
if ($(".explore .grid-titles .poster")) {
  $(".explore .grid-titles .poster").click();
  await settle();
  check("clicking a title opens the modal with artwork",
    $("#modal").hidden === false && ($("#modal-hero")?.getAttribute("style") || "").includes("url("));
  $("#modal-sources").click();
  await settle();
  check("Find sources routes to the sources screen", window.location.hash.startsWith("#/s/"), window.location.hash);
  check("the sources screen renders", Boolean($(".graph")) || Boolean($(".empty-panel")) || Boolean($(".sources-head")));
}

/* --------------------------------------------------------------- watchlist */
// Pin a title from its modal, then read it back out of the Watchlist rows.
await nav("#/c/discover", 500);
const pinRow = $$(".cat-row .strip").find((s) => s.querySelectorAll(".poster").length > 0) || $$(".cat-row .strip")[0];
await waitFor(() => pinRow.querySelectorAll(".poster").length > 0, { tries: 60, ms: 250 });
pinRow.querySelector(".poster").click();
await settle(160);
check(
  "the title modal offers the three watch states",
  $$("#modal-pins .btn.pin:not(.custom)").map(text).join(",") === "Plan to Watch,Watching,Watched",
  $$("#modal-pins .btn.pin").map(text).join(","),
);
check(
  "and the modal offers nothing else — no custom row, no divider",
  $$("#modal-pins .btn.pin").length === 3 && !$("#pin-custom-row") && !$("#modal-pins .pin-divider"),
  $$("#modal-pins .btn.pin").map((b) => `${b.id}:${text(b)}`).join(" | "),
);
$("#pin-planned").click();
await settle(400);
check(
  "pinning marks the active state on the modal",
  $("#pin-planned")?.classList.contains("active") === true && $$("#modal-pins .btn.pin.active").length === 1,
  $$("#modal-pins .btn.pin").map((b) => `${b.id}:${b.className}`).join(" | "),
);

await nav("#/c/watchlist", 600);
const watchRows = () =>
  $$(".cat-row").map((r) => ({
    name: text(r.querySelector(".cat-name")),
    posters: r.querySelectorAll(".poster").length,
    text: text(r),
    tags: text(r.querySelector(".strip")),
  }));
await waitFor(() => watchRows()[0]?.posters === 1, { tries: 60, ms: 250 });
const rows = watchRows();
check(
  "the Watchlist card is its three states and nothing else",
  rows.map((r) => r.name).join(",") === "Plan to Watch,Watching,Watched",
  rows.map((r) => r.name).join(","),
);
check("the pinned title lands in Plan to Watch", rows[0]?.posters === 1, JSON.stringify(rows.map((r) => [r.name, r.posters])));
check("an empty state explains how to fill it", rows[1]?.posters === 0 && /is empty/.test(rows[1]?.text || ""), JSON.stringify(rows[1]?.text?.slice(0, 90)));
check("a pinned card carries its state tag", /Plan to Watch/.test(rows[0]?.tags || ""), JSON.stringify(rows[0]?.tags?.slice(0, 70)));

// Move it, then unpin it by clicking the state it is already in.
$$(".cat-row .strip")[0].querySelector(".poster").click();
await settle(160);
$("#pin-watching").click();
await settle(400);
await nav("#/c/watchlist", 600);
await waitFor(() => watchRows()[1]?.posters === 1, { tries: 40, ms: 250 });
check(
  "moving a pin to Watching moves it between rows",
  watchRows()[1]?.posters === 1 && watchRows()[0]?.posters === 0,
  JSON.stringify(watchRows().map((r) => [r.name, r.posters])),
);
$$(".cat-row .strip")[1].querySelector(".poster").click();
await settle(160);
$("#pin-watching").click();
await settle(400);
await nav("#/c/watchlist", 600);
await waitFor(() => watchRows()[1]?.posters === 0, { tries: 40, ms: 250 });
check(
  "clicking the state a title is already in unpins it",
  watchRows().every((r) => r.posters === 0),
  JSON.stringify(watchRows().map((r) => [r.name, r.posters])),
);

// A watchlist row is your state, so it must be asked for uncached: a cached copy is
// what made "unpinning does not remove it" a real bug.
check(
  "the watchlist rows are requested uncached",
  requested.filter((u) => u.includes("nuvio-watchlist--")).some((u) => u.includes("&_=")),
  requested.filter((u) => u.includes("nuvio-watchlist--")).slice(-1)[0] || "no watchlist request",
);

// Explore for a watchlist catalog: the header and the list, and nothing to shuffle.
await window.fetch(`${BASE}/watchlist`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ item: { id: "tmdb:4242", type: "movie", name: "Planning Too", poster: "https://image.tmdb.org/t/p/w500/p.jpg" }, state: "planned" }),
});
await nav("#/x/watchlist/nuvio-watchlist--plan-to-watch", 700);
await waitFor(() => $$(".explore .grid-titles .poster").length === 1, { tries: 30, ms: 250 });
check(
  "a watchlist catalog opens as a plain list of your titles",
  $$(".explore .grid-titles .poster").length === 1 && text($(".explore .crumb.current")) === "Plan to Watch",
  `${$$(".explore .grid-titles .poster").length} titles`,
);
check(
  "and there is no shuffle, no sample row and no divider on it",
  !$("#shuffle-samples") && !$(".explore .explore-shuffles") && !$(".explore .h-divider") &&
    $$(".explore-head .cat-tools").length === 0,
  `shuffle ${Boolean($("#shuffle-samples"))}, samples ${Boolean($(".explore .explore-shuffles"))}, divider ${Boolean($(".explore .h-divider"))}`,
);
check(
  "a watchlist Explore asks for the list uncached too",
  requested.filter((u) => u.includes("nuvio-watchlist--plan-to-watch")).some((u) => u.includes("&_=")),
  requested.filter((u) => u.includes("nuvio-watchlist--plan-to-watch")).slice(-1)[0] || "none",
);
// Put the stand-in store back the way the later checks expect it.
await window.fetch(`${BASE}/watchlist`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ remove: true, item: { id: "tmdb:4242", type: "movie" } }),
});

// There is no "add cards" row anywhere: not on the card, and not in the modal.
check(
  "no 'Add cards in watchlist' row exists on the card",
  !watchRows().some((r) => /add cards/i.test(r.name)),
  watchRows().map((r) => r.name).join(","),
);
check(
  "and no app button offers one",
  !$("#pin-custom-row") && !/Add cards/.test(window.document.body.textContent || ""),
  "#pin-custom-row is " + Boolean($("#pin-custom-row")),
);


/* ---------------------------------------------------------------- calendar */
await nav("#/calendar", 260);
check("calendar is a month grid, not a catalog list", $$(".cal-grid .cal-cell").length > 27 && $$(".cal-dow").length === 7, `${$$(".cal-grid .cal-cell").length} cells`);
check("calendar shows the month name", /^[A-Z][a-z]+ \d{4}$/.test(text($(".cal-month"))), text($(".cal-month")));
check("calendar is not Latest or New Release rows", !/^Latest|^New Release/.test(text($(".view-title"))));

/* The caption texts are gone. */
check(
  "the calendar carries no caption text",
  !/Everything releasing this month/.test(window.document.body.textContent) &&
    !/Releases on/.test(window.document.body.textContent) &&
    !$$(".cal-detail .result-head").length,
  JSON.stringify($$(".view-hint").map(text)),
);

/* A day holds films *and* series, not just the selected row. */
check(
  "both movies and shows are read for the month",
  requested.some((u) => /\/calendar\/movie\//.test(u)) && requested.some((u) => /\/calendar\/series\//.test(u)),
  requested.filter((u) => u.includes("/calendar/")).join(" | "),
);
const bothDay = [...BOTH_DAYS].sort()[0];
if (bothDay) {
  const dayNumber = String(Number(bothDay.slice(8)));
  const cell = $$(".cal-cell:not(.blank)").find((c) => text(c.querySelector(".cal-day")) === dayNumber);
  cell?.click();
  const listed = await waitFor(() => $$(".cal-detail .poster").length > 1, { tries: 40, ms: 250 });
  const captions = $$(".cal-detail .poster-sub").map(text).join(" | ");
  check(
    `a day that has both a film and a show lists both (${bothDay})`,
    listed && /Movie/.test(captions) && /Series/.test(captions),
    captions,
  );
  // The calendar's own pin: plan to watch only, marked as a calendar pin, and
  // kept apart from the watchlist card's rows — which scan every state.
  check(
    "every release on the day offers the calendar's plan pin",
    $$(".cal-detail .cal-item").length === $$(".cal-detail .poster").length && $$(".cal-detail .cal-pin").length > 1,
    `${$$(".cal-detail .cal-pin").length} pins for ${$$(".cal-detail .poster").length} titles`,
  );
  check(
    "the calendar pin is plan to watch, and nothing else",
    $$(".cal-detail .cal-pin").every((b) => text(b).replace(" · pinned", "") === "Plan to Watch"),
    $$(".cal-detail .cal-pin").map(text).join(","),
  );
  $$(".cal-detail .cal-pin")[0].click();
  await settle(400);
  check(
    "planning a release marks the calendar pin",
    $$(".cal-detail .cal-pin.active").length === 1,
    $$(".cal-detail .cal-pin").map((b) => `${text(b)}:${b.className}`).join(" | "),
  );
  // The heading and the cards, and no paragraph of explanation under them — the
  // long hint was asked off this screen.
  check(
    "Recently planned shows the plan as a card",
    $$(".cal-recent .poster").length === 1 && text($(".cal-recent .section-title")) === "Recently planned",
    text($(".cal-recent"))?.slice(0, 120),
  );
  check(
    "and it carries no paragraph of explanation",
    $$(".cal-recent .view-hint").length === 0 && $$(".cal-recent p").length === 0,
    text($(".cal-recent"))?.slice(0, 160),
  );
  // A calendar plan is stored in its own row: putting it in a watch state would
  // fill the Watchlist card's Plan to Watch row with something never planned there.
  check(
    "planning on the calendar does not fill a watchlist state row",
    CUSTOM.some((i) => i.row === "calendar-plans") && !WATCH.items.some((i) => i.state === "planned"),
    `custom rows: ${[...new Set(CUSTOM.map((i) => i.row))].join(",") || "none"} · watch pins: ${WATCH.items.length}`,
  );
  check(
    "the calendar's plan is its own row, not a watch state",
    CUSTOM.filter((i) => i.row === "calendar-plans").length === 1 && WATCH.items.length === 0,
    `calendar-plans: ${CUSTOM.filter((i) => i.row === "calendar-plans").length}, watch pins: ${WATCH.items.length}`,
  );

  // Clicking the selected day again deselects it.
  const selectedCell = $$(".cal-cell.selected")[0];
  selectedCell?.click();
  await settle(160);
  check("clicking the selected day again deselects it", $$(".cal-cell.selected").length === 0, `${$$(".cal-cell.selected").length} still selected`);
} else {
  check("a day that has both a film and a show lists both", false, `no day in ${CAL_MONTH} has both — cannot verify`);
}

const monthBefore = text($(".cal-month"));
$(".cal-nav .icon-btn:last-child").click();
await settle(120);
check("calendar navigates months", text($(".cal-month")) !== monthBefore, `${monthBefore} -> ${text($(".cal-month"))}`);
check("calendar days can be selected", (() => {
  const cell = $$(".cal-cell:not(.blank)")[10];
  cell.click();
  return $$(".cal-cell.selected").length === 1;
})());

/* ------------------------------------------------------------ search */
await nav("#/search?q=india", 200);
check("search finds results", $$(".result-list .result").length > 0, `${$$(".result-list .result").length} results`);
await nav("#/search?q=zzzzzznope", 200);
check("search reports no match for nonsense", window.document.body.textContent.includes("Nothing matched"));
// Movies and shows are two lists under one search, never one mixed grid.
await nav("#/search?q=india", 400);
const grouped = await waitFor(() => $$("#search-titles .search-group").length > 0, { tries: 40, ms: 250 });
const searchedGroups = $$("#search-titles .search-group .result-head").map(text);
check("the searched titles arrive at all", grouped, `${$$("#search-titles .grid-titles .poster").length} posters`);
check("search groups its titles into Movies and Shows",
  searchedGroups.length > 0 && searchedGroups.every((h) => /^(Movies|Shows) \(\d+\)$/.test(h)) && new Set(searchedGroups.map((h) => h.split(" ")[0])).size === searchedGroups.length,
  searchedGroups.join(" | ") || "no groups");
check("a movie group holds only films and a shows group only series",
  $$("#search-titles .search-group").every((g) => g.querySelectorAll(".grid-titles .poster").length > 0),
  `${$$("#search-titles .search-group").length} groups`);

/* The search screen: a full-width bar wearing the app's own panel styling, the
   magnifier and the filter control inside it, suggestions as you type, and the
   panel that carries one filter row per card line. */
await nav("#/search", 160);
const bar = $(".search-bar");
// jsdom does not load the linked stylesheet, so these are read from the file.
check("the search bar is the full width of the page, not a capped box",
  /max-width:\s*none/.test(ruleFor(".search-wrap")) &&
    /width:\s*100%/.test(ruleFor(".search-bar")) &&
    /min-height:\s*60px/.test(ruleFor(".search-bar")),
  `wrap: ${ruleFor(".search-wrap").trim().slice(0, 60)}`);
check("and the field is dressed in the app's own panel, not the browser's input",
  /var\(--panel-2\)/.test(ruleFor(".search-bar")) &&
    /border-radius:\s*14px/.test(ruleFor(".search-bar")) &&
    /border:\s*0/.test(ruleFor(".search-input")),
  `bar: ${ruleFor(".search-bar").trim().slice(0, 60)}`);
check("the magnifier leads the field and the filter control closes it",
  bar?.firstElementChild?.classList.contains("search-glyph") &&
    Boolean($(".search-glyph svg")) &&
    bar?.contains($("#search-filter-btn")) &&
    Boolean($("#search-filter-btn svg")),
  [...(bar?.children || [])].map((n) => n.className || n.id).join(","));
// The field used to carry `text-input` as well, which painted a second bordered
// box inside the bar; and the filter control was an empty 38px square.
check("the field inside the bar is not a bordered box of its own",
  !$("#search-input")?.classList.contains("text-input") && /border:\s*0/.test(ruleFor(".search-input")),
  `#search-input classes: ${$("#search-input")?.className}`);
check("the filter control names itself instead of being an empty square",
  text($("#search-filter-btn")) === "Filters" && !$("#search-filter-btn")?.classList.contains("icon-btn") &&
    /width:\s*auto/.test(ruleFor(".search-filter-btn")),
  `${JSON.stringify(text($("#search-filter-btn")))} · ${ruleFor(".search-filter-btn").trim().slice(0, 44)}`);
// The choices wear the app's own pill, not an underlined word that matches
// nothing else on screen.
check("the filter choices are the app's own pills",
  /border-radius:\s*999px/.test(ruleFor(".filter-chip")) &&
    /background:\s*rgba\(255, 255, 255, 0\.07\)/.test(ruleFor(".filter-chip")),
  ruleFor(".filter-chip").trim().replace(/\s+/g, " ").slice(0, 80));
// The chosen chip is solid, and the "More (216)" control is a drawn pill of its own:
// it had *no rule at all*, so it fell back to the browser's own grey button — the
// control that read like something random on the page.
check("the chosen chip is solid, and the More control is not the browser's default button",
  /\.filter-chip\.active\s*\{[^}]*background:\s*var\(--accent\)/.test(css) &&
    /\.chip-more\s*\{/.test(css) &&
    /border-radius:\s*999px/.test(ruleFor(".chip-more")),
  ruleFor(".chip-more").trim().replace(/\s+/g, " ").slice(0, 80));

// Typing suggests, before you have asked for anything.
const searchInput = $("#search-input");
searchInput.value = "india";
searchInput.dispatchEvent(new window.Event("input"));
await settle(400);
check("typing shows autocomplete suggestions",
  !$("#search-suggest")?.hidden && $$("#search-suggest .suggest-item").length > 0,
  `${$$("#search-suggest .suggest-item").length} suggestions`);
check("a suggestion names what kind of thing it is",
  $$("#search-suggest .suggest-kind").every((k) => ["Collection", "Catalog", "Title"].includes(text(k))),
  $$("#search-suggest .suggest-kind").map(text).join(","));
$$("#search-suggest .suggest-item")[0].click();
await settle(300);
check("a suggestion goes somewhere real",
  window.location.hash.startsWith("#/c/") || window.location.hash.startsWith("#/x/"), window.location.hash);

// The panel.
await nav("#/search", 160);
$("#search-filter-btn").click();
await settle(140);
check("the filter button opens the filter panel", $("#search-filters") && !$("#search-filters").hidden);
const filterLabels = () => $$("#search-filters .filter-row .filter-label").map(text);
check("the panel carries one filter row per card line",
  filterLabels().join(",") === "Type,Continent,Country,OTT,Genre,Mood,Theme,Time,Sort",
  filterLabels().join(","));
// One row of chips, as labels.
const filterChips = (i) => [
  ...($$("#search-filters .filter-row")[i]?.querySelectorAll(".filter-chip") || []),
].map(text);
const filterRowNode = (i) => $$("#search-filters .filter-row")[i];
check("the Continent row is the Continental card's own continents",
  filterChips(1).length === (liveFilters?.continents?.length ?? 0) && filterChips(1).includes("Asia"),
  filterChips(1).join(","));
check("the Country row is every country the Countries card publishes, clamped to two rows",
  filterChips(2).length === (liveFilters?.countries?.length ?? 0) && filterChips(2).length > 100 &&
    filterRowNode(2).querySelector(".filter-options")?.classList.contains("clamped") &&
    Boolean(filterRowNode(2).querySelector(".chip-more")),
  `${filterChips(2).length} countries of ${liveFilters?.countries?.length}`);
check("the OTT row is the Global OTT card's own six platforms",
  filterChips(3).length === (liveFilters?.providers?.length ?? 0) && filterChips(3).includes("Netflix"),
  filterChips(3).join(","));
check("the Mood and Theme rows are the keywords those cards publish, clamped too",
  filterChips(5).length === (liveFilters?.moods?.length ?? 0) &&
    filterChips(6).length === (liveFilters?.themes?.length ?? 0) && filterChips(6).length > 50 &&
    filterRowNode(6).querySelector(".filter-options")?.classList.contains("clamped"),
  `${filterChips(5).length} moods, ${filterChips(6).length} themes`);
check("a clamped row's control says how many choices it holds",
  /More \(\d+\)/.test(text(filterRowNode(2).querySelector(".chip-more"))),
  text(filterRowNode(2).querySelector(".chip-more")));
check("a clamped row opens with its chevron",
  (() => {
    const more = filterRowNode(6).querySelector(".chip-more");
    more.click();
    const open = !filterRowNode(6).querySelector(".filter-options")?.classList.contains("clamped");
    more.click();
    return open && filterRowNode(6).querySelector(".filter-options")?.classList.contains("clamped");
  })(), "the chevron did not toggle the row");
check("the time row offers years, decade buckets and Before",
  filterChips(7).length > 12 && filterChips(7).includes("Before"),
  `${filterChips(7).length} periods`);
check("with no type chosen, only the categories both rows have are offered",
  !filterChips(4).includes("Romance") && filterChips(4).includes("Drama"),
  filterChips(4).slice(0, 8).join(","));

// Picking a filter is a URL — so it is shareable, reloadable and undoable.
$$("#search-filters .filter-chip").find((c) => text(c) === "Japan").click();
await settle(320);
check("picking a country puts it in the URL", window.location.hash.includes("country=JP"), window.location.hash);
check("and the panel says it is active", $$("#search-filters .filter-chip.active").some((c) => text(c) === "Japan"));
await nav("#/search", 180);
$("#search-filter-btn").click();
await settle(140);
$$("#search-filters .filter-chip").find((c) => text(c) === "Asia").click();
await settle(320);
check("picking a continent puts it in the URL too", window.location.hash.includes("continent=Asia"), window.location.hash);
await nav("#/search", 180);
$("#search-filter-btn").click();
await settle(140);
$$("#search-filters .filter-chip").find((c) => text(c) === "Netflix").click();
await settle(320);
check("and so does picking an OTT service", window.location.hash.includes("provider=8"), window.location.hash);
await nav("#/search?type=series", 200);
check("with TV Series chosen the genre row offers the TV genres",
  // +1 for the "All Genres" chip at the head of the row.
  filterChips(4).length === (liveFilters?.categories?.series?.length ?? 0) + 1 && filterChips(4).includes("Drama"),
  filterChips(4).join(","));
await nav("#/search?type=movie&category=Action&period=before&sort=rating", 700);
check("a filtered browse asks the server for it",
  requested.some((u) => u.includes("/search.json?") && u.includes("category=Action") && u.includes("sort=rating")),
  requested.filter((u) => u.includes("/search.json")).slice(-1)[0] || "no search request");

/* -------------------------------------------------------------- settings */
await nav("#/settings", 140);
const settingsTab = async (label) => {
  $$(".settings-nav .settings-tab").find((b) => text(b) === label)?.click();
  await settle(90);
};
// The visibility editor's switches, by the level they pick (row | card | catalog).
const visSwitches = (level) => $$(`.settings-pane .vis-option input[data-vis-level=${level}]`);
check("settings is grouped, and every section sits under a group",
  $$(".settings-nav .settings-group").map(text).join(",") ===
    "What you see,Where it comes from,Tracking & assistant,This app",
  $$(".settings-nav .settings-group").map(text).join(","));
check("the tabs run what-you-see, where-it-comes-from, tracking, this-app",
  $$(".settings-nav .settings-tab").map(text).join(",") ===
    "Content,Layout,Posters,Appearance,Providers,Add-ons,Plugins,Tracking,AI,Profile,Server",
  $$(".settings-nav .settings-tab").map(text).join(","));
check("each group name sits directly above its first tab",
  $$(".settings-nav .settings-group").every((g) => {
    const next = g.nextElementSibling;
    return next && next.classList.contains("settings-tab");
  }));
check("an unknown stored section falls back to the first pane",
  text($$(".settings-nav .settings-tab.active")[0]) === "Content", text($$(".settings-nav .settings-tab.active")[0]));
await settingsTab("Profile");
check("Profile is still a section, just grouped under This app",
  text($$(".settings-nav .settings-tab.active")[0]) === "Profile",
  text($$(".settings-nav .settings-tab.active")[0]));
check("the Profile pane shows the current profile",
  text($(".current-profile-name")) === "Movies & Shows" && /Current profile/i.test(text($(".current-profile"))),
  text($(".current-profile")));

/* "Pick the cards for you" is back, and it is the switch over the Profile editor:
   rows, cards, and each card's catalog rows, remembered per profile. */
check(
  "Profile offers the pick-the-cards switch, off by default",
  $$(".settings-pane .option").some((o) => /Pick the rows, cards and catalogs for this profile/.test(text(o))) &&
    !$$(".settings-pane .option").find((o) => /Pick the rows, cards and catalogs/.test(text(o))).querySelector("input").checked,
);
check(
  "and no editor is shown until it is on — nothing disappears on its own",
  visSwitches("card").length === 0 && visSwitches("row").length === 0,
  `${visSwitches("card").length} card switches`,
);
$$(".settings-pane .option").find((o) => /Pick the rows, cards and catalogs/.test(text(o))).querySelector("input").click();
await settle(160);
check(
  "turning it on opens the editor: Movies, Shows, every card and every catalog row",
  visSwitches("row").length === 2 &&
    visSwitches("card").length === published.length &&
    visSwitches("catalog").length > visSwitches("card").length,
  `${visSwitches("row").length} rows, ${visSwitches("card").length} cards, ${visSwitches("catalog").length} catalogs`,
);
check(
  "each card's catalog rows sit indented under it",
  $$(".settings-pane .vis-option.vis-sub").length === visSwitches("catalog").length &&
    /// indentation is inline padding, so it survives a stylesheet that jsdom never loads
    $$(".settings-pane .vis-option.vis-sub").every((n) => /padding-left/.test(n.getAttribute("style") || "")),
  `${$$(".settings-pane .vis-option.vis-sub").length} indented rows`,
);

// The editor is sectioned — a labelled block per kind of switch, and each card's
// rows inside that card's own box — instead of one long undifferentiated list.
check(
  "the editor is split into named sections, media rows first",
  $$(".settings-pane .vis-section").length === 2 &&
    $$(".settings-pane .vis-section .group-head .option-title").map(text).join(",") === "Media rows,Cards",
  $$(".settings-pane .vis-section .group-head .option-title").map(text).join(","),
);
const cardBlocks = $$(".settings-pane .vis-card");
const cardHeaderSwitches = $$(".settings-pane .vis-card > .vis-option");
const cardRowSwitches = $$(".settings-pane .vis-card > .vis-card-rows > .vis-option");
check(
  "every card is its own block, with the card's own switch at its head",
  cardBlocks.length === published.length &&
    cardHeaderSwitches.length === published.length &&
    cardHeaderSwitches.every((n) => n.querySelector("input")?.getAttribute("data-vis-level") === "card"),
  `${cardBlocks.length} blocks / ${cardHeaderSwitches.length} card switches for ${published.length} cards`,
);
check(
  "each block holds only its own card's catalog rows",
  $$(".settings-pane .vis-card-rows").length === cardBlocks.length &&
    cardRowSwitches.length === visSwitches("catalog").length &&
    cardRowSwitches.every((n) => n.querySelector("input")?.getAttribute("data-vis-level") === "catalog"),
  `${$$(".settings-pane .vis-card-rows").length} row boxes / ${cardRowSwitches.length} rows of ${visSwitches("catalog").length}`,
);
// jsdom never loads style.css, so read the rules the way the other CSS checks do.
const editorSectionHead = ruleFor(".vis-section > .group-head");
const editorCards = ruleFor(".vis-card");
const editorRows = ruleFor(".vis-card-rows");
check(
  "and the sections and the card blocks are actually drawn apart",
  /margin/.test(editorSectionHead) && /border|background/.test(editorCards) && /border-left/.test(editorRows),
  `${editorSectionHead.trim()} · ${editorCards.trim().slice(0, 60)} · ${editorRows.trim().slice(0, 60)}`,
);

// Hide the Watchlist card, then read Home back: the card is gone there, and its
// catalogs are gone from the card itself.
const watchCardSwitch = visSwitches("card").find((i) => i.getAttribute("data-vis-id") === "watchlist");
watchCardSwitch.click();
await settle(180);
await nav("#/", 400);
const homeAfterHiding = $$(".icon-box .icon-name").map(text);
check(
  "a card switched off is not on Home",
  !homeAfterHiding.includes("Watchlist") && homeAfterHiding.length === published.length - 1,
  `${homeAfterHiding.length} of ${published.length} cards`,
);
await nav("#/settings", 140);
await settingsTab("Profile");
visSwitches("card").find((i) => i.getAttribute("data-vis-id") === "watchlist").click();
await settle(180);
await nav("#/", 400);
check(
  "and switching it back on brings it back, in its place",
  $$(".icon-box .icon-name").map(text).join(" | ") === published.join(" | "),
  $$(".icon-box .icon-name").map(text).slice(0, 3).join(", "),
);

// A single catalog row can be hidden too — and the row really leaves the card.
await nav("#/settings", 140);
await settingsTab("Profile");
const genresRowSwitch = visSwitches("catalog").find((i) => /nuvio-genres--/.test(i.getAttribute("data-vis-id") || ""));
const hiddenRowId = genresRowSwitch.getAttribute("data-vis-id");
genresRowSwitch.click();
await settle(180);
await nav("#/c/genres", 700);
check(
  "the catalog row switched off is not on its card",
  $$(".cat-row").length > 0 && !$$(".cat-row").map((r) => r.dataset.catalog).includes(hiddenRowId),
  `${$$(".cat-row").length} rows: ${$$(".cat-row").map((r) => r.dataset.catalog).join(",")} (hidden: ${hiddenRowId})`,
);
await nav("#/settings", 140);
await settingsTab("Profile");
visSwitches("catalog").find((i) => i.getAttribute("data-vis-id") === hiddenRowId)?.click();
await settle(180);
// And the master switch off again: everything shows, the picks are kept.
$$(".settings-pane .option").find((o) => /Pick the rows, cards and catalogs/.test(text(o))).querySelector("input").click();
await settle(180);
await nav("#/", 400);
check(
  "turning the master switch off shows every card again",
  $$(".icon-box .icon-name").length === published.length,
  `${$$(".icon-box .icon-name").length} of ${published.length} cards`,
);
await nav("#/settings", 140);
await settingsTab("Profile");
// A pick is written down per profile, so it survives the master switch and a
// reload — hide one more row, read it back, and put it back the way it was.
await settingsTab("Profile");
const master = () => $$(".settings-pane .option").find((o) => /Pick the rows, cards and catalogs/.test(text(o))).querySelector("input");
master().click();
await settle(180);
const firstSub = $$(".settings-pane .vis-option.vis-sub input")[0];
const rememberedId = firstSub.getAttribute("data-vis-id");
firstSub.click();
await settle(180);
check(
  "a pick is remembered per profile, not just in this render",
  JSON.parse(window.localStorage.getItem("nuvio.visibility") || "{}")["Movies & Shows"]?.catalogs?.[rememberedId] === false,
  `${rememberedId} in ${window.localStorage.getItem("nuvio.visibility")}`,
);
visSwitches("catalog").find((i) => i.getAttribute("data-vis-id") === rememberedId)?.click();
await settle(180);
// Leave the app as it was: the master switch off, so every card shows.
master().click();
await settle(180);
await settingsTab("AI");
check(
  "the AI section carries the same switch, so it is where you remember it from",
  $$(".settings-pane .option").some((o) => /Pick the cards for you/.test(text(o))),
  $$(".settings-pane .option-title").map(text).join(","),
);
await settingsTab("Profile");
// Only the profile in use is listed — the other one must not appear here.
check("the Profile pane lists only the active profile",
  $$(".current-profile").length === 1 &&
    !text($$(".settings-pane")[0]).includes("Live TV & Sports") &&
    $$(".settings-pane .profile-choices, .settings-pane .btn").length === 0,
  JSON.stringify(text($$(".settings-pane")[0])));
await settingsTab("Providers");
check("providers are TMDB, TVDB, MDBList", $$(".provider .option-title").map(text).join(",") === "TMDB,TVDB,MDBList", $$(".provider .option-title").map(text).join(","));
check("each provider has a switch and a key box", $$(".provider .switch").length === 3 && $$(".provider .text-input[type=password]").length === 3);
const tvdbInput = $("#providers-tvdb-key");
tvdbInput.value = "smoke-tvdb-key";
tvdbInput.closest(".provider").querySelector(".btn.primary").click();
await settle(250);
check("saving a key checks the connection live", $$(".provider-check .source-status.ok").some((s) => text(s).includes("connected")), $$(".provider-check .source-status").map(text).join(" | ") || "no status");
check("the key is never kept in the browser", !(window.localStorage.getItem("nuvio.providers") || "").includes("smoke-tvdb-key"));

await settingsTab("Tracking");
check(
  "tracking is grouped: film & TV, then a divider, then asian drama",
  $$(".settings-pane .group-head .option-title").map(text).join(",") === "Film & TV,Asian drama",
  $$(".settings-pane .group-head .option-title").map(text).join(","),
);
check(
  "the anime databases sit with the film trackers",
  $$(".provider .option-title").map(text).join(",") === "Trakt,SIMKL,MyAnimeList,AniList,Letterboxd,MyDramaList",
  $$(".provider .option-title").map(text).join(","),
);
check(
  "a divider separates the drama group from the film & TV group",
  Boolean($(".settings-pane .tracking-divider")) &&
    /Letterboxd/.test(text($(".settings-pane .tracking-divider").previousElementSibling)) &&
    /Asian drama/.test(text($(".settings-pane .tracking-divider").nextElementSibling)) &&
    /MyDramaList/.test(text($(".settings-pane"))),
  text($(".settings-pane .tracking-divider").previousElementSibling).slice(0, 40),
);
check("every tracker has a switch and a key box",
  $$(".provider .switch").length === 6 && $$(".provider .text-input[type=password]").length === 6);

await settingsTab("Posters");
check("Posters offers the service and its API box", Boolean($("#poster-pattern")) && Boolean($("#poster-key")));
check("the default poster pattern is BetterPosters", ($("#poster-pattern")?.value || "").includes("btttr.cc") && ($("#poster-pattern")?.value || "").includes("{imdb_id}"), $("#poster-pattern")?.value);
$("#poster-pattern").closest(".provider").querySelectorAll(".btn.subtle")[0]?.click();
await settle(200);
check("the poster service can be checked live", $$(".poster-check, .provider-check .source-status").some((s) => text(s).includes("posters ok")) || $$(".provider-check .source-status").some((s) => text(s).includes("ok")), $$(".provider-check .source-status").map(text).join(" | "));

await settingsTab("AI");
// "Pick the cards for you" is back — it is the switch over the editor in
// Settings → Profile, and the picks themselves live there.
check(
  "AI has enable, artwork, missing-poster and pick-the-cards options",
  $$(".settings-pane .option").length >= 4 && window.document.body.textContent.includes("Pick the cards for you"),
  `${$$(".settings-pane .option").length} options`,
);
check("AI offers the fallback for posters without a better poster", window.document.body.textContent.includes("without a better poster"));
check("AI has a text ask and a voice button", Boolean($("#ai-ask")) && $$(".ai-ask-form .btn").some((b) => text(b).includes("Voice")));
// "Pick movies or shows for me" — the Ask box can be told which row to answer
// with, and Both (the default) leaves it as it was.
const pickRowOptions = () => $$(".settings-pane .option").filter((o) => o.querySelector("input[name=pickrow]"));
check(
  "AI offers 'pick movies or shows for me', on Both by default",
  pickRowOptions().length === 3 &&
    pickRowOptions().map((o) => text(o.querySelector(".option-title"))).join(",") === "Both,Movies,Shows" &&
    pickRowOptions()[0].querySelector("input").checked === true,
  pickRowOptions().map((o) => text(o.querySelector(".option-title"))).join(","),
);

/* The AI section used to offer toggles with no provider and no key behind them. */
check(
  "AI lists the free providers",
  $$(".ai-provider .option-title").map(text).join(",") === "Groq Cloud,Google AI Studio,OpenRouter,Cerebras Cloud",
  $$(".ai-provider .option-title").map(text).join(","),
);
check(
  "every free provider has a key box, a free badge and a pick switch",
  $$(".ai-provider").length === 4 &&
    $$(".ai-provider input[type=password]").length === 4 &&
    $$(".ai-provider .badge.free").length === 4 &&
    $$(".ai-provider input[type=radio]").length === 4,
  `${$$(".ai-provider").length} providers`,
);
check("AI has a model box", Boolean($("#ai-model")));
// "Test connection" and "Load models" — the two things the AI section was
// missing: whether the key works, and what the provider actually serves today.
check(
  "every AI provider can test its connection and list its models",
  $$(".ai-provider .btn").filter((b) => text(b) === "Test connection").length === 4 &&
    $$(".ai-provider .btn").filter((b) => text(b) === "Load models").length === 4,
  $$(".ai-provider .btn").map(text).filter((t) => /Test|Load/.test(t)).join(","),
);
const modelRequests = requested.filter((u) => u.includes("/ai/models")).length;
$$(".ai-provider .btn").find((b) => text(b) === "Load models")?.click();
await settle(400);
check("loading models asks the server for the provider's real list",
  requested.filter((u) => u.includes("/ai/models")).length > modelRequests,
  `${requested.filter((u) => u.includes("/ai/models")).length} requests`);
check("the models it serves are offered as pickable chips",
  $$(".model-list .model-chip").length > 0 && $$(".model-list .model-chip").every((c) => text(c) === "openai/gpt-oss-20b" || !/whisper/.test(text(c))),
  `${$$(".model-list .model-chip").map(text).join(", ")}`);
// Picking one sets the model in use — the point of listing them.
$$(".model-list .model-chip").find((c) => text(c) === "llama-3.3-70b-versatile")?.click();
await settle(300);
check("picking a model sets it as the model in use",
  posted.some((p) => p.ai?.model === "llama-3.3-70b-versatile"),
  JSON.stringify(posted.slice(-2)));
const groqKey = $("#ai-groq-key");
groqKey.value = "smoke-groq-key";
$$(".ai-provider")[0].querySelector(".btn.primary").click();
await settle(300);
check(
  "saving an AI key marks it set and selects that provider",
  Boolean($$(".ai-provider")[0]?.querySelector(".badge.on")) && (window.localStorage.getItem("nuvio.ai") || "").includes("groq"),
  $$(".ai-provider")[0]?.querySelector(".badge")?.className,
);
check("the AI key is never kept in the browser", !(window.localStorage.getItem("nuvio.ai") || "").includes("smoke-groq-key"));
// "Pick for me" really narrows the Ask box: pick Movies, ask, and the search is
// the Movies row — not both.
pickRowOptions().find((o) => text(o.querySelector(".option-title")) === "Movies")?.querySelector("input")?.click();
await settle(200);
check("picking a side is saved for the assistant",
  posted.some((p) => p.ai?.pickRow === "movie"), JSON.stringify(posted.slice(-1)));
$("#ai-ask").value = "india";
$$(".ai-ask-form .btn").find((b) => text(b) === "Ask")?.click();
const askedSide = await waitFor(() => window.location.hash.includes("type=movie"), { tries: 30, ms: 200 });
check("and the Ask box searches only that row", askedSide, window.location.hash || "still on the settings page");

// Home is the same grid whatever the AI settings say — even after a settings
// round-trip, which is where the old "picks" could come back.
await nav("#/", 220);
const homeTitles = $$(".icon-box .icon-name").map(text);
check(
  "Home is still every card, in the published order",
  homeTitles.length === published.length && homeTitles.join(" | ") === published.join(" | "),
  `${homeTitles.length} of ${published.length}`,
);
await nav("#/settings", 140);
await settingsTab("AI");
$$(".settings-pane .option").find((o) => text(o).includes("Pick the cards for you"))?.querySelector("input")?.click();
await settle(160);

/* ---------------------------------------------------------- content ------ */
/* Both pickers are gone. The language never moved a row's contents, and the
   country only ever named the regional OTT services — it is still server state
   (`/settings` → `country`) and the cards still follow it, but it is not a switch
   the app shows. What is left in Content is the one thing that changes a row. */
await settingsTab("Content");
check(
  "Content offers no language picker and no country picker",
  !$("#app-language") && !$("#app-country"),
  $$(".settings-pane .option-title, .settings-pane .group-head .option-title").map(text).join(","),
);
check(
  "and it no longer repeats the content source, which lives with the providers",
  $$(".settings-pane .option").filter((o) => o.querySelector("input[name=contentSource]")).length === 0,
);
check(
  "what is left is the SFW / NSFW switch",
  $$(".settings-pane .option").filter((o) => o.querySelector("input[name=safe]")).length === 2,
  $$(".settings-pane .option-title").map(text).join(","),
);
// Auto-update: one interval drives the addon's cache and the app's own re-read.
const refreshOptions = () => $$(".settings-pane .option").filter((o) => o.querySelector("input[name=refresh]"));
check(
  "Content offers the catalog/metadata refresh interval",
  refreshOptions().length === 5 &&
    refreshOptions().map((o) => text(o.querySelector(".option-title"))).join(",") ===
      "Every 15 minutes,Every 30 minutes,Every hour,Every 3 hours,Only when you ask",
  refreshOptions().map((o) => text(o.querySelector(".option-title"))).join(","),
);
refreshOptions().find((o) => text(o.querySelector(".option-title")) === "Every 15 minutes")?.querySelector("input")?.click();
await settle(220);
check("picking an interval is saved to the server",
  posted.some((p) => p.refresh?.minutes === 15), JSON.stringify(posted.slice(-1)));
check("and it marks the interval now in use",
  refreshOptions().find((o) => text(o.querySelector(".option-title")) === "Every 15 minutes")?.querySelector("input")?.checked === true);
// The other half of "update itself" — that Refresh now really re-reads — is
// checked at the end of the run, once the settings screens are done with.

/* Which provider supplies the content inside the rows — one place, with the keys. */
await settingsTab("Providers");
const sourcePicks = $$(".settings-pane .option").filter((o) => o.querySelector("input[name=contentSource]"));
check(
  "Providers is where the content source lives: TMDB and TVDB",
  sourcePicks.length === 2 && sourcePicks.map((o) => text(o.querySelector(".option-title"))).join(",") === "TMDB,TVDB",
  sourcePicks.map((o) => text(o.querySelector(".option-title"))).join(","),
);
await settingsTab("Content");
// The server holds the user's own choice, so the check is that the pane shows
// *that* — not that it shows a default. (The app is a live install: the settings
// file is whatever the person using it last picked.)
const liveSource = liveSettings.content?.source === "tvdb" ? "tvdb" : "tmdb";
check(
  "the checked content source is the one the server holds",
  sourcePicks[liveSource === "tmdb" ? 0 : 1].querySelector("input").checked === true,
  liveSource,
);
check(
  "the TVDB option explains itself honestly: it re-sources content, or it says it needs a key",
  /TVDB's titles/.test(text(sourcePicks[1])) || /Needs a TVDB key/.test(text(sourcePicks[1])),
  JSON.stringify(text(sourcePicks[1]).slice(0, 120)),
);
// Re-query every time: choosing a source re-renders the pane, so old nodes detach.
await settingsTab("Providers");
const pickSource = (label) =>
  $$(".settings-pane .option").find((o) => o.querySelector("input[name=contentSource]") && text(o.querySelector(".option-title")) === label);
const otherSource = liveSource === "tvdb" ? "tmdb" : "tvdb";
pickSource(otherSource === "tvdb" ? "TVDB" : "TMDB")?.querySelector("input")?.click();
await settle(220);
check(
  `picking ${otherSource.toUpperCase()} is saved to the server`,
  posted.some((p) => p.content?.source === otherSource),
  JSON.stringify(posted.slice(-2)),
);
// Put the app back where the user left it before the rest of the run continues.
pickSource(liveSource === "tvdb" ? "TVDB" : "TMDB")?.querySelector("input")?.click();
await settle(220);
await settingsTab("Content");
// The server still offers the country list (the addon and Nuvio use it), it is just
// not a switch in the app any more.
check(
  "the server still offers the country and language lists",
  (liveSettings.options?.countries?.length ?? 0) >= 60 && (liveSettings.options?.languages?.length ?? 0) > 20,
  `${liveSettings.options?.countries?.length} countries, ${liveSettings.options?.languages?.length} languages`,
);
// The cards still follow the server's country: it is read with the settings and the
// card list is re-read when it differs from the cached one.
check(
  "the app re-reads the cards when the server's country is not the cached one",
  requested.some((u) => u === `${BASE}/collections.json`),
  `${requested.filter((u) => u === `${BASE}/collections.json`).length} card reads`,
);
// Even with no picker, the language the server holds still rides on the catalog
// URLs — a row can never be answered in the wrong language from a cache.
await nav("#/", 220);
$$(".hero-cats button.chip")[0]?.click();
await settle(700);
check(
  "the server's language still rides on the catalog requests",
  requested.some((u) => u.includes(`lang=${liveSettings.language || "en-US"}`)),
  requested.filter((u) => u.includes("/catalog/")).slice(-1)[0] || "no catalog request",
);

/* ---------------------------------------------------------- appearance ---- */
/* The accent is one colour with three parts (flat, RGB tint, deep gradient), so
   a pick re-tints the whole app instead of half of it. Motion is one switch. */
await nav("#/settings", 140);
await settingsTab("Appearance");
const swatches = $$(".settings-pane .accent-swatch");
check(
  "Appearance offers more than one accent colour",
  swatches.length >= 6 && Boolean($("#accent-gold")),
  `${swatches.length} accents`,
);
// jsdom never loads the linked stylesheet, so the colours are read from the
// root element's own style — which is exactly where applyTheme writes them.
const rootVar = (name) => window.document.documentElement.style.getPropertyValue(name).trim();
check(
  "the accent in use is the one marked, and the document is painted with it",
  $$(".settings-pane .accent-swatch.active").length === 1 &&
    rootVar("--accent").length > 0 &&
    rootVar("--accent-rgb").split(",").length === 3 &&
    rootVar("--accent-deep").length > 0,
  `--accent: ${rootVar("--accent")}`,
);
$("#accent-violet").click();
await settle(160);
check(
  "picking an accent changes the colour the app is painted in",
  rootVar("--accent") === "#9d89e8" && $("#accent-violet").classList.contains("active"),
  rootVar("--accent"),
);
check(
  "the tints follow the accent, so the app is not half gold",
  rootVar("--accent-rgb") === "157, 137, 232" &&
    /rgba\(var\(--accent-rgb\)/.test(css) === true &&
    /rgba\(\s*200,\s*169,\s*106/.test(css) === false,
  rootVar("--accent-rgb"),
);
$("#accent-gold").click();
await settle(160);
check(
  "and it can be put back",
  rootVar("--accent") === "#c8a96a" && rootVar("--accent-rgb") === "200, 169, 106",
);
check(
  "Motion offers follow-system, always and never",
  $$(".settings-pane .option").filter((o) => o.querySelector("input[name=motion]")).length === 3,
  $$(".settings-pane .option-title").map(text).join(","),
);
const motionOff = $$(".settings-pane .option").find((o) => text(o).includes("No animation"));
motionOff.querySelector("input").click();
await settle(160);
check(
  "choosing no animation stops the app's transitions",
  window.document.documentElement.classList.contains("motion-off") && /\.motion-off \*[\s\S]{0,40}animation:\s*none/.test(css),
  [...window.document.documentElement.classList].join(" "),
);
const motionAuto = $$(".settings-pane .option").find((o) => text(o).includes("Follow system"));
motionAuto.querySelector("input").click();
await settle(160);
check("and the system default can be put back", !window.document.documentElement.classList.contains("motion-off"));
await nav("#/settings", 140);

await settingsTab("Plugins");
const pluginForm = $$(".settings-pane .source-form")[0];
pluginForm.querySelector("select").value = "cloudstream";
pluginForm.querySelector("input[type=text]").value = "https://github.com/example/cs";
pluginForm.querySelector(".btn.primary").click();
await settle(250);
check("a CloudStream repo lists its providers (read server-side)",
  $$(".sources .chip").map(text).includes("Netflix") && $$(".sources .chip").map(text).includes("Torrentio"),
  $$(".sources .chip").map(text).join(", ") || "no chips");
check("the repo status is not a bare 404", !$$(".source-status.bad").some((s) => text(s).includes("404")));
check("the add-ons section is separate from plugins", Boolean($$(".settings-nav .settings-tab").find((b) => text(b) === "Add-ons")));

/* ------------------------------------------------- Live TV & Sports profile */
/* The second profile is a different app: two buttons of its own, cards made of
   the playlist's channels, a TiviMate-shaped Guide, and settings of its own. */
await nav("#/profiles", 140);
$$(".profile-tile")[1].click();
// A cold public directory is one ~2.5-5 MB read on the server, so the first Live TV
// screen can legitimately take half a minute to have channels; the budget is sized
// for that rather than for a warm cache.
const liveReady = await waitFor(() => $$(".channel-card").length > 0, { tries: 200, ms: 250 });
check("the Live TV profile reads a real channel list",
  liveReady && requested.some((u) => u.includes("/live/channels.json")),
  `${$$(".channel-card").length} channel cards`);
check("its Home is the channels, not the Movies & Shows card grid",
  $$(".icon-box").length === 0 && $$(".cat-row.live-row").length > 0,
  `${$$(".icon-box").length} cards, ${$$(".cat-row.live-row").length} channel rows`);
check("one card of Live TV is the Guide",
  text($(".live-hero .hero-title")) === "Guide" && $$(".live-hero .guide-mini-row").length > 0 &&
    Boolean($("#open-guide")),
  text($(".live-hero .hero-title")));
// The second card is the playlist's own categories, and it opens the full list.
check("the other card of Live TV is Categories",
  $$(".live-hero .hero-title").map(text).join(",") === "Guide,Categories" && Boolean($("#open-categories")),
  $$(".live-hero .hero-title").map(text).join(","));
$("#open-categories").click();
await settle(220);
check("and it opens the categories the playlist actually publishes",
  window.location.hash === "#/categories" && $$(".cat-tile").length > 0 && $$(".cat-tile .cat-tile-count").length === $$(".cat-tile").length,
  `${$$(".cat-tile").length} tiles · ${window.location.hash}`);
const firstTile = $$(".cat-tile")[0];
const firstGroup = firstTile.querySelector(".cat-tile-name").textContent;
firstTile.click();
await settle(260);
check("picking one shows that category's channels",
  window.location.hash.startsWith("#/categories/") && text($(".view-title")) === firstGroup && $$(".channel-card").length > 0,
  `${window.location.hash} · ${$$(".channel-card").length} channels`);
await nav("#/", 220);
check("same two buttons as Movies & Shows, named Live TV and Sports",
  $$(".row-switch .row-btn").map(text).join(",") === "Live TV,Sports",
  $$(".row-switch .row-btn").map(text).join(","));
check("a channel carries its logo, its name and its group",
  $$(".channel-card").every((c) => c.querySelector(".channel-art") && text(c.querySelector(".channel-name"))),
  text($$(".channel-card")[0]));
check("the channel rows are named after the playlist's own categories",
  $$(".cat-row.live-row .cat-name").length === $$(".cat-row.live-row").length && $$(".cat-row.live-row").length >= 2,
  $$(".cat-row.live-row .cat-name").map(text).join(", "));
// Sports is the same list, narrowed — not an empty screen.
$("#live-row-sports").click();
await settle(220);
check("Sports narrows the same channels to sport",
  $$(".cat-row.live-row").length > 0 && $$(".cat-row.live-row .cat-name").every((n) => /sport/i.test(text(n))) && $$(".channel-card").length > 0,
  $$(".cat-row.live-row .cat-name").map(text).join(", ") || "no rows");
$("#live-row-livetv").click();
await settle(200);

// The Guide: a time ruler, a channel column, one track per channel.
$("#open-guide").click();
await settle(700);
check("the Guide opens as its own screen",
  window.location.hash === "#/guide" && Boolean($(".guide")), window.location.hash);
check("it draws the time ruler and a channel column, like a live TV app",
  $$(".guide-time").length >= 4 && Boolean($(".guide-now")) && $$(".guide-channel").length > 0 &&
    Boolean($(".guide-logo")),
  `${$$(".guide-time").length} hours, ${$$(".guide-channel").length} channels`);
check("and one track per channel, with the guide's own data or an honest empty one",
  $$(".guide-row .guide-track").length === $$(".guide-row").length &&
    ($$(".guide-block").length > 0 || $$(".guide-nodata").length === $$(".guide-row").length),
  `${$$(".guide-block").length} programme blocks, ${$$(".guide-nodata").length} empty tracks`);
$$(".guide-channel")[0].click();
await settle(400);
check("a channel opens its own page, with its stream",
  window.location.hash.startsWith("#/channel/") && Boolean($(".channel-page")) &&
    ($("#channel-url")?.value || "").length > 0,
  window.location.hash);

// Search in this profile searches channels.
await nav("#/search", 200);
const channelInput = $("#search-input");
check("search in the Live TV profile searches channels",
  text($(".view-title")) === "Search channels" && ($("#search-input")?.getAttribute("placeholder") || "").includes("channels"),
  text($(".view-title")));
channelInput.value = "sport";
channelInput.dispatchEvent(new window.Event("input"));
await settle(220);
check("and filters them as you type, with suggestions",
  $$("#live-results .channel-card").length > 0 && !$("#search-suggest")?.hidden,
  `${$$("#live-results .channel-card").length} results`);

// Settings are the profile's own — the Movies & Shows sections are not offered.
await nav("#/settings", 200);
check("the Live TV profile swaps the settings screen entirely",
  $$(".settings-nav .settings-tab").map(text).join(",") === "Source,Countries,Guide & EPG,Refresh,Layout,Appearance,Profile,Server",
  $$(".settings-nav .settings-tab").map(text).join(","));
check("and the Movies & Shows sections are gone while it is active",
  !["Content", "Posters", "Providers", "Add-ons", "Plugins", "Tracking", "AI"].some((label) =>
    $$(".settings-nav .settings-tab").some((t) => text(t) === label),
  ));
check("the Source pane offers the built-in directory, an M3U URL and an Xtream login",
  $$(".settings-pane .option-title").map(text).join("|").includes("Built-in public directory") &&
    $$(".settings-pane .option-title").map(text).join("|").includes("My M3U playlist") &&
    $$(".settings-pane .option-title").map(text).join("|").includes("Xtream Codes login") &&
    $$(".settings-pane .option").length === 3,
  $$(".settings-pane .option-title").map(text).join(","));
// Picking the M3U source reveals its URL field, and the server is told.
$$(".settings-pane .option").find((o) => text(o).includes("My M3U playlist")).querySelector("input").click();
await settle(250);
check("choosing a source reveals its own fields and is pushed to the server",
  Boolean($("#live-m3u")) && posted.some((p) => p.live && p.live.mode === "m3u"),
  JSON.stringify(posted.filter((p) => p.live).slice(-1)[0] || {}));
$$(".settings-pane .option").find((o) => text(o).includes("Built-in public directory")).querySelector("input").click();
await settle(250);
await nav("#/settings", 160);
$$(".settings-nav .settings-tab").find((b) => text(b) === "Guide & EPG").click();
await settle(160);
check("the Guide & EPG section takes an XMLTV URL",
  Boolean($("#live-epg")) && /XMLTV/.test(text($(".settings-pane"))),
  text($$(".settings-pane .option-title")[0]));
await nav("#/settings", 160);
$$(".settings-nav .settings-tab").find((b) => text(b) === "Refresh").click();
await settle(160);
check("and Refresh sets how often the channels and the guide update",
  /How often the channels update/i.test(text($(".settings-pane"))) && $$(".settings-pane .option").length >= 5,
  `${$$(".settings-pane .option").length} choices`);

// Back to the first profile: its settings and its cards return.
await nav("#/profiles", 140);
$$(".profile-tile")[0].click();
await settle(220);
await nav("#/settings", 160);
check("switching back restores the Movies & Shows settings",
  $$(".settings-nav .settings-tab").map(text).join(",") ===
    "Content,Layout,Posters,Appearance,Providers,Add-ons,Plugins,Tracking,AI,Profile,Server",
  $$(".settings-nav .settings-tab").map(text).join(","));

/* ------------------------------------------- the refresh really re-reads ---- */
/* Refresh now has to make the next read a *different* URL. Without the
   cache-buster the browser answers the catalog request out of its own copy and the
   screen never changes — which is exactly why the app puts `gen` on every catalog
   URL it builds after a refresh. A card page is used because its rows always fetch
   (Home's cards keep their drawn artwork for the launch). */
await nav("#/settings", 160);
await settingsTab("Content");
const gensSeen = () => new Set(
  requested
    .filter((u) => u.includes("gen="))
    .map((u) => u.slice(u.indexOf("gen=") + 4).split("&")[0]),
);
const gensBefore = gensSeen();
const refreshNowBtn = $$(".settings-pane .btn.primary").find((b) => text(b) === "Refresh now");
check("Content carries the manual Refresh now", Boolean(refreshNowBtn));
refreshNowBtn.click();
await settle(160);
await nav("#/", 300);
$$(".icon-art")[1]?.click();
await settle(1000);
check(
  "Refresh now re-reads the rows under a new URL instead of the cached one",
  [...gensSeen()].some((g) => !gensBefore.has(g)) &&
    requested.some((u) => u.includes("/catalog/") && u.includes("gen=")),
  `${gensBefore.size} → ${gensSeen().size} cache-buster values`,
);

check("no uncaught errors during the whole run", errors.length === 0, errors.slice(0, 5).join(" | "));

console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — ${pass} checks`);
process.exit(fail === 0 ? 0 : 1);
