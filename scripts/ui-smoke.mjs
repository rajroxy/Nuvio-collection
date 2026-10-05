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
    const state = { "plan-to-watch": "planned", watching: "watching", watched: "watched" }[slug];
    return json200({ metas: WATCH.items.filter((i) => i.type === type && i.state === state) });
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
// Alpha of the strongest colour stop in a rule's background.
const peakAlpha = (body) => Math.max(0, ...[...body.matchAll(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1])),
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

const heroArtBefore = $(".hero-art")?.getAttribute("style");
$$(".row-switch .row-btn")[1].click();
await settle(120);
check("clicking Shows swaps the cards", text($(".section-title")) === "Shows" && $$(".icon-art img").every((i) => (i.getAttribute("src") || "").includes("/covers/shows/")));
check("and swaps the hero banner too", ($(".hero-art")?.getAttribute("style") || "") !== heroArtBefore && ($(".hero-art")?.getAttribute("style") || "").includes("/covers/shows/"));
$$(".row-switch .row-btn")[0].click();
await settle(120);
check("clicking Movies swaps back", text($(".section-title")) === "Movies");

/* ------------------------------------------------- hero label -> catalog */
$$(".hero-cats button.chip")[0].click();
// A row is slower now: each title resolves an IMDb id for its better poster.
await settle(1200);
check("a hero catalog label opens that catalog", window.location.hash.startsWith("#/x/"), window.location.hash);
check("Explore shows the card label and the catalog label",
  Boolean($(".explore-head .crumb")) && Boolean($(".explore-head .crumb.current")),
  text($(".explore-head")));
check("Explore shows only those two labels in the header", $$(".explore-head .crumb").length === 2);
check("Explore has no cover image or extra blurb", !$(".explore .section-cover") && !/catalogs in this collection/.test(text($(".explore"))));
check("Explore has a shuffle", $$(".explore-head .cat-tools .btn").some((b) => text(b).includes("Shuffle")));

/* ------------------------- three shuffle rows above the exploring rows ---- */
/* Three sample rows, drawn as ordinary rows: no "Shuffle 1" labels, no controls
   of their own, one Shuffle in the header and a rule before the catalog. */
check("Explore opens with three sample rows",
  $$(".explore-shuffles .shuffle-row").length === 3, `${$$(".explore-shuffles .shuffle-row").length} rows`);
check("the sample rows carry no 'Shuffle N' label",
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
check("a horizontal divider separates the three rows from the catalog",
  $(".explore-shuffles")?.nextElementSibling === $(".explore .h-divider") &&
    $(".explore .h-divider")?.nextElementSibling === $(".explore .grid-titles"),
  `${$(".explore-shuffles")?.nextElementSibling?.className || "nothing"} then ${$(".explore .h-divider")?.nextElementSibling?.className || "nothing"}`);
const shuffleRowsFilled = await waitFor(() =>
  $$(".explore-shuffles .shuffle-row").every((r) => r.querySelectorAll(".poster").length > 0));
check("every sample row draws titles", shuffleRowsFilled,
  $$(".explore-shuffles .shuffle-row").map((r) => r.querySelectorAll(".poster").length).join("/"));
check("Explore renders real titles", $$(".explore .grid-titles .poster").length > 0, `${$$(".explore .grid-titles .poster").length} posters`);
// The hero leads with a ◆ Top 10 row, which must stay exactly ten titles.
check("a ◆ Top 10 catalog holds exactly ten titles, however far it is scrolled",
  $$(".explore .grid-titles .poster").length === 10 && /End of catalog\./.test(text($(".explore .sentinel"))),
  `${$$(".explore .grid-titles .poster").length} posters · ${text($(".explore .sentinel")) || "no sentinel"}`);
check("Explore scrolls endlessly and stops at the end",
  /End of catalog\./.test(text($(".explore .sentinel"))) && requested.some((u) => u.includes("skip=")),
  text($(".explore .sentinel")) || "no sentinel text");

/* ------------------------------------------------------------ collection */
await nav("#/");
$$(".icon-art")[1].click();
await settle(160);
check("a collection opens from its artwork", $$(".cat-row").length > 0, `${$$(".cat-row").length} rows`);
check("collection cover is shown", ($(".section-cover")?.getAttribute("src") || "").includes("/covers/"));
check("collection catalog labels are clickable", $$(".cats button.chip").length === $$(".cats .chip").length && $$(".cats button.chip").length > 0);
check("every row has a Shuffle and an Explore", $$(".cat-row .cat-tools .icon-btn.small").length === $$(".cat-row").length && $$(".cat-row .cat-tools .btn.explore").length === $$(".cat-row").length);
check("no section-level shuffle button", $$(".section-actions .btn").length === 0);
check("no 'Load more' anywhere", !window.document.body.textContent.includes("Load more"));
$$(".cats button.chip")[0].click();
await settle(1200);
check("a collection catalog label opens that catalog", window.location.hash.startsWith("#/x/"), window.location.hash);

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
await waitFor(() => requested.filter((u) => u.includes("shuffle=")).length >= shufflesBefore + 3);
check("the header shuffle asks for a fresh draw for every sample row",
  requested.filter((u) => u.includes("shuffle=")).length >= shufflesBefore + 3,
  `${requested.filter((u) => u.includes("shuffle=")).length - shufflesBefore} new shuffle requests`);
check("and all three rows are refilled with a full sample",
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
  $$("#modal-pins .btn.pin").map(text).join(",") === "Plan to Watch,Watching,Watched",
  $$("#modal-pins .btn.pin").map(text).join(","),
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
check("the Watchlist card lists its three states", rows.map((r) => r.name).join(",") === "Plan to Watch,Watching,Watched", rows.map((r) => r.name).join(","));
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
await nav("#/search?q=india", 140);
check("search finds results", $$(".result-list .result").length > 0, `${$$(".result-list .result").length} results`);
await nav("#/search?q=zzzzzznope", 120);
check("search reports no match for nonsense", window.document.body.textContent.includes("Nothing matched"));

/* -------------------------------------------------------------- settings */
await nav("#/settings", 140);
check("settings is organised into sections, starting with Profile",
  $$(".settings-nav .settings-tab").map(text).join(",") === "Profile,Posters,Providers,Tracking,AI,Content,Add-ons,Plugins,Layout,Server",
  $$(".settings-nav .settings-tab").map(text).join(","));
check("an unknown stored section falls back to the first pane",
  text($$(".settings-nav .settings-tab.active")[0]) === "Profile", text($$(".settings-nav .settings-tab.active")[0]));
check("the Profile pane shows the current profile",
  text($(".current-profile-name")) === "Movies & Shows" && /Current profile/i.test(text($(".current-profile"))),
  text($(".current-profile")));
// Only the profile in use is listed — the other one must not appear here.
check("the Profile pane lists only the active profile",
  $$(".current-profile").length === 1 &&
    !text($$(".settings-pane")[0]).includes("Live TV & Sports") &&
    $$(".settings-pane .profile-choices, .settings-pane .btn").length === 0,
  JSON.stringify(text($$(".settings-pane")[0])));
const settingsTab = async (label) => {
  $$(".settings-nav .settings-tab").find((b) => text(b) === label)?.click();
  await settle(90);
};
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
check("AniList is gone from tracking", !$$(".provider .option-title").map(text).includes("AniList"), $$(".provider .option-title").map(text).join(","));
check("tracking has SIMKL, Trakt and Letterboxd", $$(".provider .option-title").map(text).join(",") === "SIMKL,Trakt,Letterboxd");

await settingsTab("Posters");
check("Posters offers the service and its API box", Boolean($("#poster-pattern")) && Boolean($("#poster-key")));
check("the default poster pattern is BetterPosters", ($("#poster-pattern")?.value || "").includes("btttr.cc") && ($("#poster-pattern")?.value || "").includes("{imdb_id}"), $("#poster-pattern")?.value);
$("#poster-pattern").closest(".provider").querySelectorAll(".btn.subtle")[0]?.click();
await settle(200);
check("the poster service can be checked live", $$(".poster-check, .provider-check .source-status").some((s) => text(s).includes("posters ok")) || $$(".provider-check .source-status").some((s) => text(s).includes("ok")), $$(".provider-check .source-status").map(text).join(" | "));

await settingsTab("AI");
check("AI has enable, artwork, missing-poster and auto-pick options", $$(".option").length >= 4, `${$$(".option").length} options`);
check("AI offers the fallback for posters without a better poster", window.document.body.textContent.includes("without a better poster"));
check("AI has a text ask and a voice button", Boolean($("#ai-ask")) && $$(".ai-ask-form .btn").some((b) => text(b).includes("Voice")));

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

/* "Pick the cards for you" chooses cards — it must not reorder them. */
const pickOption = $$(".settings-pane .option").find((o) => text(o).includes("Pick the cards for you"));
pickOption?.querySelector("input")?.click();
await settle(180);
await nav("#/", 220);
const pickedTitles = $$(".icon-box .icon-name").map(text);
const isSubsequence = (sub, all) => {
  let i = 0;
  for (const item of all) if (item === sub[i]) i++;
  return i === sub.length;
};
check(
  "the AI-picked cards keep the published card order",
  pickedTitles.length === 8 && isSubsequence(pickedTitles, published),
  `${pickedTitles.length} cards: ${pickedTitles.join(", ")}`,
);
await nav("#/settings", 140);
await settingsTab("AI");
$$(".settings-pane .option").find((o) => text(o).includes("Pick the cards for you"))?.querySelector("input")?.click();
await settle(160);

/* ------------------------------------------------- language and country ---- */
/* Two settings in one: the language every row is served in (and the primary
   subtitle language), and the country whose services the three Regional OTT
   cards show. Both are chosen from lists the server supplies. */
await settingsTab("Content");
check("Content offers an app language and a country", Boolean($("#app-language")) && Boolean($("#app-country")));
// Which provider supplies the content inside the rows.
const sourcePicks = $$(".settings-pane .option").filter((o) => o.querySelector("input[name=contentSource]"));
check(
  "Content offers a content source: TMDB and TVDB",
  sourcePicks.length === 2 && sourcePicks.map((o) => text(o.querySelector(".option-title"))).join(",") === "TMDB,TVDB",
  sourcePicks.map((o) => text(o.querySelector(".option-title"))).join(","),
);
check(
  "TMDB is the default content source",
  sourcePicks[0].querySelector("input").checked === true,
);
check(
  "the TVDB option explains itself honestly: it re-sources content, or it says it needs a key",
  /TVDB's titles/.test(text(sourcePicks[1])) || /Needs a TVDB key/.test(text(sourcePicks[1])),
  JSON.stringify(text(sourcePicks[1]).slice(0, 120)),
);
sourcePicks[1].querySelector("input").click();
await settle(200);
check("picking TVDB is saved to the server", posted.some((p) => p.content?.source === "tvdb"), JSON.stringify(posted.slice(-2)));
// Re-query: choosing a source re-renders the pane, so the old nodes are detached.
const pickSource = (label) =>
  $$(".settings-pane .option").find((o) => o.querySelector("input[name=contentSource]") && text(o.querySelector(".option-title")) === label);
pickSource("TMDB")?.querySelector("input")?.click();
await settle(200);
check("and picking TMDB is saved too", posted.some((p) => p.content?.source === "tmdb"), JSON.stringify(posted.slice(-2)));
check(
  "the app language list is the server's own, not a short fixture",
  $$("#app-language option").length === (liveSettings.options?.languages?.length ?? 0) &&
    $$("#app-language option").length > 20 &&
    $$("#app-language option").some((o) => o.value === "en-US") &&
    $$("#app-language option").some((o) => o.value === "hi-IN"),
  `${$$("#app-language option").length} languages offered`,
);
check(
  "the country list is the server's, and says how many services each country fills the cards with",
  $$("#app-country option").length === (liveSettings.options?.countries?.length ?? 0) &&
    $$("#app-country option").length >= 60 &&
    $$("#app-country option").every((o) => /service/.test(text(o))),
  `${$$("#app-country option").length} countries`,
);
// Picking a country has to reach the server *and* re-read the card list, because
// the three Regional OTT cards name that country's services.
const collectionsBefore = requested.filter((u) => u === `${BASE}/collections.json`).length;
const countryPick = $("#app-country");
countryPick.value = "IN";
countryPick.dispatchEvent(new window.Event("change"));
await settle(320);
check("choosing a country is saved to the server", posted.some((p) => p.country === "IN"), JSON.stringify(posted.slice(-2)));
check(
  "and the cards are re-read, because the regional rows move with it",
  requested.filter((u) => u === `${BASE}/collections.json`).length > collectionsBefore,
);
check(
  "the pane says what the chosen country will put in the three cards",
  /service|No local service/.test(text($(".settings-pane .provider-check"))),
  text($(".settings-pane .provider-check")),
);
const langPick = $("#app-language");
langPick.value = "hi-IN";
langPick.dispatchEvent(new window.Event("change"));
await settle(320);
check("choosing a language is saved to the server", posted.some((p) => p.language === "hi-IN"), JSON.stringify(posted.slice(-2)));
// The language rides on the catalog URLs, so a switch can never be answered out
// of the browser's cache for the previous language.
await nav("#/", 220);
$$(".hero-cats button.chip")[0]?.click();
await settle(700);
check(
  "the chosen language rides on the catalog requests",
  requested.some((u) => u.includes("lang=hi-IN")),
  requested.filter((u) => u.includes("/catalog/")).slice(-1)[0] || "no catalog request",
);
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

check("no uncaught errors during the whole run", errors.length === 0, errors.slice(0, 5).join(" | "));

console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — ${pass} checks`);
process.exit(fail === 0 ? 0 : 1);
