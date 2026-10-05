#!/usr/bin/env node
/**
 * Addon self-test — runs the real request handler against a stubbed TMDB API,
 * so request routing, query planning, merging and meta mapping are verified
 * without needing a live key.
 *
 *   node addon/selftest.mjs
 */
process.env.TMDB_API_KEY = process.env.TMDB_API_KEY || "test-key-for-selftest";
// Never write the real settings or watchlist file — those tests hit throwaway paths.
process.env.NUVIO_SETTINGS_FILE = process.env.NUVIO_SETTINGS_FILE || "/tmp/nuvio-settings-selftest.json";
process.env.NUVIO_WATCHLIST_FILE = process.env.NUVIO_WATCHLIST_FILE || "/tmp/nuvio-watchlist-selftest.json";
process.env.NUVIO_CUSTOM_FILE = process.env.NUVIO_CUSTOM_FILE || "/tmp/nuvio-customrows-selftest.json";
// Start from an empty watchlist and custom-row set so those tests are deterministic.
fs.rmSync(process.env.NUVIO_WATCHLIST_FILE, { force: true });
fs.rmSync(process.env.NUVIO_CUSTOM_FILE, { force: true });

import fs from "node:fs";

let seq = 0;
const item = () => ({
  id: ++seq,
  title: `Title ${seq}`,
  name: `Title ${seq}`,
  release_date: "2019-05-01",
  first_air_date: "2019-05-01",
  vote_average: 7.4,
  // Real search/discover results carry their genre ids; the category filter reads
  // exactly this field, so the stub has to carry it too.
  genre_ids: [28, 35],
  popularity: 100 - seq,
  overview: "An overview.",
  poster_path: "/poster.jpg",
  backdrop_path: "/backdrop.jpg",
});

const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

const calls = [];
globalThis.fetch = async (url) => {
  const u = typeof url === "string" ? url : String(url);
  calls.push(u);
  if (u.includes("api.mdblist.com")) return jsonRes({ ratings: { imdb: 8.8, tmdb: 7.1 } });
  // The AI providers: a models call for the key check, a chat call for the ask.
  if (u.includes("api.groq.com")) {
    if (u.endsWith("/models")) return jsonRes({ data: [{ id: "llama-3.1-8b-instant" }] });
    return jsonRes({ choices: [{ message: { content: "neo noir detective rain" } }] });
  }
  // TVDB: a login, a remote-id search and the extended record behind it.
  if (u.includes("api4.thetvdb.com")) {
    if (u.endsWith("/login")) return jsonRes({ status: "success", data: { token: "tvdb-token" } });
    if (u.includes("/search/remoteid/")) {
      return jsonRes({
        data: [
          { id: "movie-7", type: "movie", name: "TVDB Film", year: "1994", image: "movies/7/poster.jpg" },
          { id: "series-42", type: "series", name: "TVDB Show", year: "1999", image: "series/42/poster.jpg" },
        ],
      });
    }
    if (u.includes("/movies/7/extended")) {
      return jsonRes({
        data: {
          id: 7, name: "TVDB Film", year: "1994", image: "movies/7/poster.jpg",
          translations: { hin: { name: "TVDB Film (hi)", overview: "एक फ़िल्म।" } },
        },
      });
    }
    if (u.includes("/series/42/extended")) {
      return jsonRes({ data: { id: 42, name: "TVDB Show", year: "1999", image: "series/42/poster.jpg" } });
    }
    return jsonRes({ data: {} });
  }
  if (u.includes("/external_ids")) return jsonRes({ imdb_id: "tt0111161" });
  if (u.includes("raw.githubusercontent.com")) {
    if (u.endsWith("/repo.json")) return jsonRes({ name: "Example Repo", description: "a test repo", pluginLists: ["plugins.json"] });
    if (u.endsWith("/plugins.json")) return jsonRes([{ name: "Netflix" }, { name: "Anime World" }]);
  }
  if (u.includes("/genre/")) {
    return jsonRes({
      genres: [
        { id: 28, name: "Action" }, { id: 35, name: "Comedy" }, { id: 18, name: "Drama" },
        { id: 10749, name: "Romance" }, { id: 10765, name: "Sci-Fi & Fantasy" }, { id: 16, name: "Animation" },
        { id: 10759, name: "Action & Adventure" },
      ],
    });
  }
  if (u.includes("/search/keyword")) return jsonRes({ results: [] });
  if (u.includes("/search/movie") || u.includes("/search/tv")) return jsonRes({ results: Array.from({ length: 6 }, item) });
  if (/\/(movie|tv)\/\d+/.test(u)) return jsonRes({ ...item(), number_of_episodes: 6, runtime: 100 });
  if (/\/(now_playing|airing_today|on_the_air|top_rated)/.test(u)) return jsonRes({ results: Array.from({ length: 15 }, item) });
  if (u.includes("/trending/")) return jsonRes({ results: Array.from({ length: 12 }, item) });
  if (u.includes("/discover/")) return jsonRes({ results: Array.from({ length: 20 }, item) });
  if (u.includes("/popular")) return jsonRes({ results: Array.from({ length: 25 }, item) });
  if (u.includes("/movie/") || u.includes("/tv/")) return jsonRes(item());
  // Unknown host/route → a realistic 404, so bogus sources fail like they would.
  return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
};

const { handleAddon, buildManifest, catalogMetas } = await import("./index.mjs");
// The rows are built per country now, so the test resolves them the same way a
// request does: through `catalogDefs()` for the country currently configured.
const { catalogDefs } = await import("./catalogs.mjs");
const CATALOG_DEFS = catalogDefs();
const { COUNTRIES, PLATFORMS, COLLECTIONS, MOVIE_GENRES, SHOW_GENRES, collectionsFor, localServices, DEFAULT_COUNTRY } = await import("../scripts/collections.mjs");

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}

const call = async (pathname) => {
  const res = fakeRes();
  const handled = await handleAddon({ headers: { host: "localhost:4173" }, url: pathname }, res, pathname.replace(/\?.*$/, ""), "http://localhost:4173");
  return { handled, res };
};

/** POST a JSON body to a route and read the answer back. */
const postTo = async (pathname, body) => {
  const res = fakeRes();
  const payload = JSON.stringify(body);
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: pathname,
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  await handleAddon(req, res, pathname, "http://localhost:4173");
  return { statusCode: res.statusCode, body: res.body };
};

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("addon self-test");

// --- manifest -----------------------------------------------------------------
const manifest = buildManifest("http://localhost:4173");
check("manifest declares only the catalog resource", manifest.resources.length === 1 && manifest.resources[0] === "catalog");
check("manifest publishes one row per catalog entry", manifest.catalogs.length === CATALOG_DEFS.length, `got ${manifest.catalogs.length}`);
// Not a magic number: every card that declares catalogs must actually publish
// rows, and the total must equal the published definitions.
check(
  "every card that declares catalogs publishes rows",
  COLLECTIONS.filter((c) => c.catalogs).every((c) => CATALOG_DEFS.some((d) => d.key === c.key)),
  `${CATALOG_DEFS.length} rows`, 
);
check("catalog ids are unique across the manifest", new Set(manifest.catalogs.map((c) => `${c.type}:${c.id}`)).size === manifest.catalogs.length);
// The Watchlist is a real card now: its rows are the states a pinned title
// moves through, served from the stored pins instead of from TMDB.
check(
  "the watchlist card publishes Plan to Watch / Watching / Watched for both rows",
  ["movie", "series"].every((type) =>
    ["Plan to Watch", "Watching", "Watched"].every((name) =>
      manifest.catalogs.some((c) => c.type === type && c.name === name && c.id.startsWith("nuvio-watchlist--")),
    ),
  ),
  manifest.catalogs.filter((c) => c.id.startsWith("nuvio-watchlist--")).map((c) => `${c.type}:${c.name}`).join(","),
);
check("manifest covers both media types", ["movie", "series"].every((t) => manifest.catalogs.some((c) => c.type === t)));

// The card order is the owner's list, spelled out — so it can be read here and
// cannot drift card by card.
const CARD_ORDER_EXPECTED = [
  "watchlist", "on-the-board", "discover-top-10", "discover", "popular-by-genre", "genres",
  "popular-by-decade", "decades", "genre-from-decades", "continental", "countries", "runtimes",
  "based-on-the", "moods-and-vibes", "themes-and-tags", "global-ott-top-10", "global-ott-popular",
  "global-ott", "regional-ott-top-10", "regional-ott-popular", "regional-ott",
];
check(
  "the cards are published in the owner's order, with Based on the after Runtimes",
  COLLECTIONS.map((c) => c.key).join(",") === CARD_ORDER_EXPECTED.join(","),
  COLLECTIONS.map((c) => c.key).join(","),
);
check(
  "runtimes, Based on the, moods and themes come before the three Global OTT cards",
  COLLECTIONS.findIndex((c) => c.key === "based-on-the") === COLLECTIONS.findIndex((c) => c.key === "runtimes") + 1 &&
    COLLECTIONS.findIndex((c) => c.key === "global-ott-top-10") > COLLECTIONS.findIndex((c) => c.key === "themes-and-tags"),
);
check(
  "and the three Regional OTT cards stay last",
  COLLECTIONS.slice(-3).map((c) => c.key).join(",") === "regional-ott-top-10,regional-ott-popular,regional-ott",
  COLLECTIONS.slice(-3).map((c) => c.key).join(","),
);

const inCard = (key) => manifest.catalogs.filter((c) => c.id.startsWith(`nuvio-${key}--`));
const namesIn = (key, type = "movie") => inCard(key).filter((c) => c.type === type).map((c) => c.name);
const allNames = manifest.catalogs.map((c) => `${c.type}:${c.name}`);

// --- card naming rules --------------------------------------------------------
check("popular-by-genre exposes 'Popular in <Genre>'", allNames.includes("movie:Popular in Action") && allNames.includes("series:Popular in Action & Adventure"));
check("genres exposes raw genre names", allNames.includes("movie:Action") && allNames.includes("series:Sci-Fi & Fantasy"));
check("popular-by-decade exposes 'Popular in <decade>s'", allNames.includes("movie:Popular in 1950s") && allNames.includes("series:Popular in 2020s"));
check("decades exposes '<decade>s'", allNames.includes("movie:1950s") && allNames.includes("series:2020s"));
// Genre from ◆ Decades used to publish the movie genres only, which left the
// shows row empty. Both rows are published now, each from its own verified set.
check(
  "genre-from-decades reads '<Genre> ◆ 1950 → Present' for movies",
  allNames.includes("movie:Action ◆ 1950 → Present") && namesIn("genre-from-decades").length === 18,
  `${namesIn("genre-from-decades").length} movie rows`,
);
check(
  "genre-from-decades publishes the shows row too",
  allNames.includes("series:Drama ◆ 1950 → Present") && namesIn("genre-from-decades", "series").length === 16,
  `${namesIn("genre-from-decades", "series").length} series rows`,
);
check(
  "every genre-decade row uses a genre its own row type actually has",
  namesIn("genre-from-decades").every((n) => MOVIE_GENRES.includes(n.replace(" ◆ 1950 → Present", ""))) &&
    namesIn("genre-from-decades", "series").every((n) => SHOW_GENRES.includes(n.replace(" ◆ 1950 → Present", ""))),
);
check(
  "the shows genre-decade rows are backed by TMDB TV genre ids, not movie ones",
  CATALOG_DEFS.filter((d) => d.type === "series" && d.entry.kind === "genre-decade").every((d) => SHOW_GENRES.includes(d.entry.genre)),
);
check("On the Board shows expose its three catalogs", ["Airing Today", "Airing This Week", "On the Air"].every((n) => allNames.includes(`series:${n}`)));
check("spotlight is the discover set marked '◆ Top 10'", allNames.includes("movie:Latest ◆ Top 10") && allNames.includes("series:Top Rated ◆ Top 10"));
check(
  "countries exposes every verified country name",
  namesIn("countries").length === COUNTRIES.length && COUNTRIES.length >= 60 && allNames.includes("movie:Indonesia") && allNames.includes("movie:Finland"),
  `${namesIn("countries").length} of ${COUNTRIES.length}`,
);
check("countries drops the one country with no series (Ghana)", namesIn("countries").includes("Ghana") && !namesIn("countries", "series").includes("Ghana"));
check("continental exposes continents", allNames.includes("movie:Oceania"));
check("runtimes are movie-only minutes", allNames.includes("movie:30+ mins") && !manifest.catalogs.some((c) => c.type === "series" && c.name.includes("mins")));
check("shows use episode buckets instead of runtime", allNames.includes("series:4 Episodes") && allNames.includes("series:10 Episodes"));

// --- OTT cards ----------------------------------------------------------------
check("global platforms exclude Hulu (a US-only service)", !namesIn("global-ott").includes("Hulu") && !namesIn("global-ott-top-10").includes("Hulu"));
check(
  "every global platform is present in all three OTT cards",
  PLATFORMS.every(([label]) => namesIn("global-ott-top-10").includes(`${label} ◆ Top 10`) && namesIn("global-ott-popular").includes(`Popular ${label}`) && namesIn("global-ott").includes(label)),
);
check("the new Popular Global OTT card exists for both rows", namesIn("global-ott-popular").length > 0 && namesIn("global-ott-popular", "series").length > 0);
check(
  "regional OTT is named after services, never countries",
  (() => {
    const countryNames = new Set(COUNTRIES.map(([name]) => name));
    return ["regional-ott", "regional-ott-top-10", "regional-ott-popular"].every((key) =>
      ["movie", "series"].every((type) =>
        namesIn(key, type).every((name) => {
          const bare = name.replace(/^Popular /, "").replace(/ ◆ Top 10$/, "");
          return !countryNames.has(bare);
        }),
      ),
    );
  })(),
);
// The three regional cards are scoped to the country in Settings, so they name
// **that** country's services — and no other country's.
const serviceNames = (code, type) => localServices(code, type).map((s) => s.name);
const namesInOf = (manifestOf, key, type = "movie") =>
  manifestOf.catalogs.filter((c) => c.id.startsWith(`nuvio-${key}--`) && c.type === type).map((c) => c.name);
check(
  "regional OTT carries the configured country's real service names",
  namesIn("regional-ott").length > 0 && namesIn("regional-ott").every((n) => serviceNames(DEFAULT_COUNTRY, "movie").includes(n)),
  namesIn("regional-ott").join(", ") || "none",
);

// Moving the country setting has to move the rows themselves, not just redraw a
// label: this is what makes the three regional cards follow where you are.
const defaultRowCount = manifest.catalogs.length;
await postTo("/settings", { country: "IN" });
const inManifest = buildManifest("http://localhost:4173");
check(
  "moving the country setting swaps the regional OTT services",
  namesInOf(inManifest, "regional-ott").includes("JioHotstar") &&
    namesInOf(inManifest, "regional-ott").every((n) => serviceNames("IN", "movie").includes(n)),
  namesInOf(inManifest, "regional-ott").join(", ") || "none",
);
check(
  "the regional row ids carry the new country, so two countries never collide",
  inManifest.catalogs.some((c) => c.id === "nuvio-regional-ott--jiohotstar-in") &&
    inManifest.catalogs.length === defaultRowCount,
  inManifest.catalogs.filter((c) => c.id.startsWith("nuvio-regional-ott--")).map((c) => c.id).join(", "),
);
await postTo("/settings", { country: "US" });
const backManifest = buildManifest("http://localhost:4173");
check(
  "and switching back restores the original rows",
  namesInOf(backManifest, "regional-ott").every((n) => serviceNames(DEFAULT_COUNTRY, "movie").includes(n)) &&
    !backManifest.catalogs.some((c) => c.id.startsWith("nuvio-regional-ott") && c.id.endsWith("-in")),
  namesInOf(backManifest, "regional-ott").join(", "),
);

// One setting covers both: the language rows are served in is the primary
// subtitle language, so it has to reach the provider as a `language` parameter.
await postTo("/settings", { language: "hi-IN" });
// Only look at the calls this check makes: `calls` is a shared log that earlier
// checks (and the cached genre list) have already written to.
const langMark = calls.length;
await catalogMetas("movie", { entry: { name: "Popular in Action", kind: "genre", genre: "Action", sort: "popular" } }, 0);
const langCalls = calls.slice(langMark);
check(
  "the language setting rides on every title request",
  langCalls.length > 0 && langCalls.every((u) => !/\/discover|\/trending|\/popular|\/search\//.test(u) || u.includes("language=hi-IN")),
  `${langCalls.length} calls`,
);
// A single request can ask for another language without a settings write — the
// app sends it, and it is what makes a language switch a different URL.
const jaMark = calls.length;
const japanese = await call("/catalog/movie/nuvio-on-the-board--now-playing.json?lang=ja-JP");
check(
  "a ?lang= request is served in that language",
  japanese.res.statusCode === 200 && calls.slice(jaMark).some((u) => u.includes("language=ja-JP")),
  `${calls.length - jaMark} calls`,
);
await postTo("/settings", { language: "en-US" });
check("the new Popular Regional OTT card exists for both rows", namesIn("regional-ott-popular").length > 0 && namesIn("regional-ott-popular", "series").length > 0);
check("regional OTT Top 10 names read '<Service> ◆ Top 10'", namesIn("regional-ott-top-10").every((n) => n.endsWith("◆ Top 10")));

// --- keyword cards ------------------------------------------------------------
for (const [card, labels] of [
  ["based-on-the", ["Books", "Comics", "Graphic Novels", "Video Games", "True Stories", "Plays", "Short Stories"]],
  ["moods-and-vibes", ["Adrenaline Rush", "Mind Bending", "Cozy & Comforting", "Epic & Sweeping", "Feel Good", "Slow Burn", "Tearjerkers"]],
  ["themes-and-tags", ["Detective", "Gangster", "Superhero", "Time Loop", "Animal Attack", "Slasher", "Possession", "Zombie"]],
]) {
  check(`${card} exposes its catalog names for both rows`, ["movie", "series"].every((t) => labels.every((l) => namesIn(card, t).includes(l))));
}
check("kind cards are backed by baked keyword ids, not a live search", CATALOG_DEFS.filter((d) => d.entry.kind === "keyword").every((d) => Number.isInteger(d.entry.id)));
check("Documentary is not a theme or tag", !namesIn("themes-and-tags").includes("Documentary") && !namesIn("themes-and-tags", "series").includes("Documentary"));

const { res: manifestRes } = await call("/manifest.json");
check("GET /manifest.json returns 200 with every catalog", manifestRes.statusCode === 200 && manifestRes.body?.catalogs?.length === CATALOG_DEFS.length, `got ${manifestRes.body?.catalogs?.length}`);

// --- catalogs -----------------------------------------------------------------
const simple = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
check("on-the-board Now Playing returns 200", simple.res.statusCode === 200);
check("on-the-board Now Playing returns metas", simple.res.body?.metas?.length > 0);
const airing = await call("/catalog/series/nuvio-on-the-board--airing-today.json");
check("on-the-board Airing Today (shows) returns metas", airing.res.statusCode === 200 && airing.res.body?.metas?.length > 0);
const meta = simple.res.body.metas[0];
check("meta has the fields the app needs", Boolean(meta.id && meta.type === "movie" && meta.name && meta.poster));
check("meta id is namespaced for the app", meta.id.startsWith("tmdb:"));
check("meta poster is an absolute https url", /^https:\/\//.test(meta.poster || ""), meta.poster);

// Structured entries drive the queries — exercise the trickier kinds directly.
const genreRow = await catalogMetas("movie", { entry: { name: "Popular in Action", kind: "genre", genre: "Action", sort: "popular" } }, 0);
check("genre entry resolves a TMDB genre id", calls.some((u) => u.includes("/genre/movie/list")) && calls.some((u) => u.includes("with_genres=")));
check("genre entry returns metas", genreRow.length > 0);

await catalogMetas("series", { entry: { name: "2020s", kind: "decade", decade: 2020 } }, 0);
check("decade entry filters by air date", calls.some((u) => u.includes("first_air_date.gte=2020-01-01")));

await catalogMetas("movie", { entry: { name: "30+ mins", kind: "runtime", min: 30 } }, 0);
check("runtime entry filters by runtime", calls.some((u) => u.includes("with_runtime.gte=30")));

const countryRow = await catalogMetas("movie", { entry: { name: "India", kind: "country", code: "IN" } }, 0);
check("country entry filters by origin country", calls.some((u) => u.includes("with_origin_country=IN")));
check("country entry returns metas", countryRow.length > 0);

const keywordRow = await catalogMetas("movie", { entry: { name: "Zombie", kind: "keyword", id: 1234 } }, 0);
check("keyword entry filters by the baked keyword id", calls.some((u) => u.includes("with_keywords=1234")));
check("keyword entry returns metas", keywordRow.length > 0);

const providerRow = await catalogMetas("movie", { entry: { name: "Netflix", kind: "provider", providerId: 8, region: null } }, 0);
check("global provider entry uses the configured region", calls.some((u) => u.includes("with_watch_providers=8")) && calls.some((u) => u.includes("watch_region=US")));
check("provider entry returns metas", providerRow.length > 0);

await catalogMetas("series", { entry: { name: "JioHotstar", kind: "provider", providerId: 2336, region: "IN" } }, 0);
check("regional provider entry uses its own region", calls.some((u) => u.includes("with_watch_providers=2336") && u.includes("watch_region=IN")));

await catalogMetas("movie", { entry: { name: "Netflix", kind: "provider", providerId: 8, region: null } }, 0, { adult: true });
check("SFW/NSFW switch maps to include_adult", calls.some((u) => u.includes("include_adult=true")));

const epRow = await catalogMetas("series", { entry: { name: "8 Episodes", kind: "episodes", max: 8 } }, 0);
check("episodes entry keeps shows within the episode cap", epRow.length > 0 && epRow.every((m) => m.type === "series"));
const epTight = await catalogMetas("series", { entry: { name: "4 Episodes", kind: "episodes", max: 4 } }, 0);
check("episodes entry drops shows above the cap", epTight.length === 0, `got ${epTight.length}`);

const skipped = await call("/catalog/movie/nuvio-on-the-board--now-playing/skip=5.json");
check("skip route is parsed", skipped.handled && skipped.res.statusCode === 200);

// --- paging depth -------------------------------------------------------------
// The bug this guards against: every row read TMDB `page: 1` only, so a row had
// 20 titles and Explore hit "End of catalog." on its second page. The stub hands
// out fresh ids per request, so a deeper window must return *new* titles.
const DEEP = { id: "paging-depth-probe", entry: { name: "Depth", kind: "genre", genre: "Action", sort: "popular" } };
const deepA = await catalogMetas("movie", DEEP, 0);
const deepB = await catalogMetas("movie", DEEP, 40);
const deepC = await catalogMetas("movie", DEEP, 80);
check("a row serves a full first window", deepA.length === 40, `${deepA.length} titles`);
check("paging past the first window returns more titles", deepB.length === 40 && deepC.length === 40, `${deepB.length}/${deepC.length}`);
check("deeper pages are different titles, not a repeat of page 1",
  deepB[0].id !== deepA[0].id && deepC[0].id !== deepB[0].id);
check("no title repeats across the served windows",
  new Set([...deepA, ...deepB, ...deepC].map((m) => m.id)).size === 120,
  `${new Set([...deepA, ...deepB, ...deepC].map((m) => m.id)).size} unique of 120`);
check("a repeat request is served from the cached pool, not re-fetched",
  JSON.stringify(await catalogMetas("movie", DEEP, 40)) === JSON.stringify(deepB));

// `take` catalogues (the ◆ Top 10 rows) must stop at their length.
const TOP = { id: "take-probe", entry: { name: "Top 10", kind: "genre", genre: "Action", sort: "popular", take: 10 } };
const topA = await catalogMetas("movie", TOP, 0);
check("a Top 10 row holds ten titles and no more",
  topA.length === 10 && (await catalogMetas("movie", TOP, 10)).length === 0, `${topA.length} then ${(await catalogMetas("movie", TOP, 10)).length}`);

// Shuffle: the Explore page's three top rows draw a random sample.
const { catalogShuffle } = await import("./index.mjs");
const sample = await catalogShuffle("movie", DEEP, 12);
check("shuffle returns the requested number of titles", sample.length === 12, `${sample.length} titles`);
check("shuffle samples the pool instead of taking its head",
  sample.some((m) => !deepA.slice(0, 12).some((x) => x.id === m.id)));
const sample2 = await catalogShuffle("movie", DEEP, 12);
check("a second shuffle is a fresh draw", sample.map((m) => m.id).join() !== sample2.map((m) => m.id).join(),
  `${sample.map((m) => m.id).slice(0, 4).join()} vs ${sample2.map((m) => m.id).slice(0, 4).join()}`);
const shuffledRoute = await call("/catalog/movie/nuvio-discover--latest/shuffle=12.json");
check("the shuffle route answers with a sample",
  shuffledRoute.handled && shuffledRoute.res.statusCode === 200 && shuffledRoute.res.body.metas.length === 12,
  `${shuffledRoute.res.body?.metas?.length} titles`);
const clamped = await call("/catalog/movie/nuvio-discover--latest/shuffle=9999.json");
check("an absurd shuffle count is clamped, not honoured",
  clamped.res.statusCode === 200 && clamped.res.body.metas.length <= 60, `${clamped.res.body?.metas?.length} titles`);
check("the shuffle route serves different titles on each call",
  (await call("/catalog/movie/nuvio-discover--latest/shuffle=12.json")).res.body.metas.map((m) => m.id).join() !==
    shuffledRoute.res.body.metas.map((m) => m.id).join());

// Two catalogs must never share a pool, even when one carries no id.
const one = await catalogMetas("movie", { entry: { name: "A", kind: "genre", genre: "Action", sort: "popular" } }, 0);
const two = await catalogMetas("movie", { entry: { name: "B", kind: "keyword", id: 4321 } }, 0);
check("catalogs without ids do not share each other's pool",
  one[0].id !== two[0].id && calls.some((u) => u.includes("with_keywords=4321")));

const unknown = await call("/catalog/movie/nuvio-nope.json");
check("unknown catalog id returns 404 with metas", unknown.res.statusCode === 404);

const passthrough = await call("/index.html");
check("non-addon route falls through to static", passthrough.handled === false);

const status = await call("/addon-status.json");
check("status reports key present and every catalog", status.res.body?.tmdbKey === true && status.res.body?.catalogs === CATALOG_DEFS.length, `got ${status.res.body?.catalogs}`);

// --- settings -----------------------------------------------------------------
const settingsGet = await call("/settings");
check(
  "GET /settings returns the profile and provider state",
  settingsGet.handled && settingsGet.res.statusCode === 200 && typeof settingsGet.res.body?.providers?.tmdb?.enabled === "boolean",
);

const posted = await (async () => {
  const res = fakeRes();
  const payload = JSON.stringify({ profile: "Live TV & Sports", ai: { enhanceArtwork: true, enhanceMissing: true } });
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: "/settings",
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  const handled = await handleAddon(req, res, "/settings", "http://localhost:4173");
  return { handled, res };
})();
// "Pick the cards for you" is gone: Home always shows every card, in the published
// order, so the AI options that remain are the ones about artwork and posters.
check(
  "POST /settings persists the profile and the AI options",
  posted.handled && posted.res.statusCode === 200 && posted.res.body?.profile === "Live TV & Sports" &&
    posted.res.body?.ai?.enhanceArtwork === true && posted.res.body?.ai?.enhanceMissing === true &&
    posted.res.body?.ai?.autoPickCards === undefined,
  JSON.stringify(posted.res.body?.ai),
);
// The Content pane builds its two selects from this payload.
check(
  "settings offer the app language and country choices",
  settingsGet.res.body?.language === "en-US" && settingsGet.res.body?.country === "US" &&
    (settingsGet.res.body?.options?.languages?.length ?? 0) > 20 &&
    (settingsGet.res.body?.options?.countries?.length ?? 0) === COUNTRIES.length &&
    settingsGet.res.body.options.countries.every((c) => typeof c.services === "number"),
  `${settingsGet.res.body?.options?.languages?.length} languages, ${settingsGet.res.body?.options?.countries?.length} countries`,
);
check("settings never echo a key back", !JSON.stringify(posted.res.body).includes("test-key"));

// --- second metadata provider -------------------------------------------------
await (async () => {
  const res = fakeRes();
  const payload = JSON.stringify({ providers: { mdblist: { enabled: true, key: "mdblist-test" }, tvdb: { enabled: true, key: "tvdb-test" } } });
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: "/settings",
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  await handleAddon(req, res, "/settings", "http://localhost:4173");
})();

const enriched = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
check("enabling MDBList actually queries it", calls.some((u) => u.includes("api.mdblist.com")));
check("MDBList replaces the title rating", enriched.res.body?.metas?.some((m) => m.imdbRating === "8.8"), `first: ${enriched.res.body?.metas?.[0]?.imdbRating}`);
check("provider keys still never come back", !JSON.stringify(enriched.res.body).includes("mdblist-test"));

// --- content source: which provider supplies what a row shows ----------------
// TMDB alone can *generate* a row; TVDB supplies a title's name, translation,
// year and artwork. Choosing TVDB has to change what the row shows, not just what
// a settings file says.
await postTo("/settings", { content: { source: "tvdb" }, language: "hi-IN" });
const tvdbRow = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
const tvdbMetas = tvdbRow.res.body?.metas || [];
check(
  "selecting TVDB re-sources the row's content from TVDB",
  tvdbMetas.length >= 8 &&
    tvdbMetas.slice(0, 8).every((m) => m.contentSource === "tvdb" && m.name === "TVDB Film (hi)") &&
    tvdbMetas.slice(0, 8).every((m) => m.poster === "https://artworks.thetvdb.com/banners/movies/7/poster.jpg"),
  `${tvdbMetas[0]?.name} · ${tvdbMetas[0]?.poster}`,
);
check(
  "and the row's language is the one TVDB translates into",
  tvdbMetas[0]?.description === "एक फ़िल्म।",
  tvdbMetas[0]?.description,
);
check(
  "the row's membership is still TMDB's, so the ids keys and pins rely on do not move",
  tvdbMetas.every((m) => m.id.startsWith("tmdb:")),
);
const statusTvdb = (await call("/addon-status.json")).res.body;
check(
  "addon status reports the content source and how many titles it upgraded",
  statusTvdb?.contentSource === "tvdb" && statusTvdb?.contentSourceActive === "tvdb" && statusTvdb?.contentSourceStats?.applied > 0,
  JSON.stringify(statusTvdb?.contentSourceStats),
);

// Asking for TVDB without a usable key has to fall back rather than serve blank
// rows — a source switch must never be able to empty the app.
await postTo("/settings", { content: { source: "tvdb" }, providers: { tvdb: { enabled: false, key: "tvdb-test" } } });
const fallbackRow = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
check(
  "TVDB without an enabled key falls back to TMDB content",
  fallbackRow.res.statusCode === 200 && (fallbackRow.res.body?.metas?.length ?? 0) > 0 &&
    !fallbackRow.res.body.metas.some((m) => m.contentSource === "tvdb") &&
    (await call("/addon-status.json")).res.body?.contentSourceActive === "tmdb",
  `${fallbackRow.res.body?.metas?.length} titles`,
);
// Back to TMDB content: the poster and rating checks below are about TMDB rows.
await postTo("/settings", { content: { source: "tmdb" }, providers: { tvdb: { enabled: true, key: "tvdb-test" } }, language: "en-US" });

const verifyMdb = await (async () => {
  const res = fakeRes();
  const payload = JSON.stringify({ name: "mdblist" });
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: "/providers/verify",
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  await handleAddon(req, res, "/providers/verify", "http://localhost:4173");
  return res;
})();
check("POST /providers/verify checks the key against the provider", verifyMdb.statusCode === 200 && verifyMdb.body?.ok === true, JSON.stringify(verifyMdb.body));

// --- better posters ----------------------------------------------------------
const posterRow = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
check(
  "better posters replace the artwork (IMDb id resolved from TMDB)",
  posterRow.res.body?.metas?.some((m) => (m.poster || "").startsWith("https://btttr.cc/poster/imdb/poster-default/tt0111161.jpg")),
  posterRow.res.body?.metas?.[0]?.poster,
);
check("better-poster titles are flagged so the UI knows which need the fallback",
  posterRow.res.body?.metas?.some((m) => m.hasBetterPoster === true));

// The setting must really change the contents, not just be stored.
const patchSettings = async (body) => {
  const res = fakeRes();
  const payload = JSON.stringify(body);
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: "/settings",
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  await handleAddon(req, res, "/settings", "http://localhost:4173");
  return res;
};
await patchSettings({ posters: { enabled: false } });
const plainRow = await call("/catalog/movie/nuvio-on-the-board--now-playing.json");
check(
  "disabling the poster service falls back to TMDB artwork",
  /image\.tmdb\.org/.test(plainRow.res.body?.metas?.[0]?.poster || ""),
  plainRow.res.body?.metas?.[0]?.poster,
);
await patchSettings({ posters: { enabled: true } });

// --- release calendar ---------------------------------------------------------
const cal = await call("/calendar/movie/2026-10.json");
check("calendar returns a month of releases with dates",
  cal.res.statusCode === 200 && cal.res.body?.days >= 28 && cal.res.body?.metas?.length > 0 && cal.res.body.metas.every((m) => m.releaseDate),
  `days ${cal.res.body?.days}, ${cal.res.body?.metas?.length} titles`);
check("calendar rejects a malformed month", (await call("/calendar/movie/nope.json")).handled === false);

// --- sources are read server-side (this is what fixes add-ons/repos) ----------
const inspect = async (type, url) => {
  const res = fakeRes();
  const payload = JSON.stringify({ type, url });
  const req = {
    method: "POST",
    headers: { host: "localhost:4173" },
    url: "/api/source",
    on(event, handler) {
      if (event === "data") handler(Buffer.from(payload));
      if (event === "end") handler();
    },
  };
  await handleAddon(req, res, "/api/source", "http://localhost:4173");
  return res;
};
const repo = await inspect("cloudstream", "https://github.com/example/cs");
check("a CloudStream repo is read server-side into providers", repo.body?.ok === true && repo.body.providers.includes("Netflix"), JSON.stringify(repo.body));
const deadAddon = await inspect("stremio", "https://nope.invalid/addon");
check("an unreachable add-on reports a failure, not a crash", deadAddon.statusCode === 200 && deadAddon.body?.ok === false && /not reachable/.test(deadAddon.body.message));

// --- settings expose the poster service ---------------------------------------
const posterSettings = (await call("/settings")).res.body?.posters;
check("settings expose the poster service", posterSettings?.enabled === true && /\{imdb_id\}/.test(posterSettings.pattern));

// --- OTT rows must keep scrolling --------------------------------------------
// The reported bug: an OTT card was the one place whose rows stopped after a
// couple of screens, because Popular/Everything carried a hard `take` of 30/40
// while every other card paged on. Only a ◆ Top 10 may be capped.
check(
  "no OTT row caps its length except the ◆ Top 10 ones",
  CATALOG_DEFS.filter((d) => d.entry.kind === "provider" && !/◆ Top 10$/.test(d.name)).every((d) => !d.entry.take),
  CATALOG_DEFS.filter((d) => d.entry.kind === "provider" && d.entry.take && !/◆ Top 10$/.test(d.name)).map((d) => `${d.id}=${d.entry.take}`).join(", ") || "none",
);
check(
  "every ◆ Top 10 row is still exactly ten titles",
  CATALOG_DEFS.filter((d) => /◆ Top 10$/.test(d.name)).every((d) => d.entry.take === 10),
);
const ottDef = CATALOG_DEFS.find((d) => d.id === "nuvio-global-ott--netflix" && d.type === "movie");
check("the Global OTT 'everything' row exists and is uncapped", Boolean(ottDef) && !ottDef.entry.take);
const ottA = await catalogMetas("movie", ottDef, 0);
const ottB = await catalogMetas("movie", ottDef, 40);
check("an OTT row keeps serving windows past the first one", ottA.length === 40 && ottB.length === 40, `${ottA.length}/${ottB.length}`);
check("and the second window holds different titles", ottB[0].id !== ottA[0].id);

// --- title search (what the Ask box feeds) ------------------------------------
const search = await call("/search.json?q=matrix");
check(
  "title search answers with metas the app can render",
  search.handled && search.res.statusCode === 200 && search.res.body?.metas?.length > 0 && search.res.body.metas[0].id.startsWith("tmdb:"),
  `${search.res.body?.metas?.length} titles`,
);
check("title search looks in both movies and shows", calls.some((u) => u.includes("/search/movie")) && calls.some((u) => u.includes("/search/tv")));
check("an empty title search is a no-op, not a crash", (await call("/search.json?q=")).res.body?.metas?.length === 0);

// --- the search screen's filters ---------------------------------------------
const vocab = await call("/search/filters.json");
check(
  "the search screen is offered its filter vocabulary",
  vocab.res.body?.filters?.regions?.length >= 9 &&
    vocab.res.body.filters.categories.movie.includes("Romance") &&
    vocab.res.body.filters.categories.series.includes("Romance") === false &&
    vocab.res.body.filters.periods.length > 10 &&
    vocab.res.body.filters.sorts.map(([id]) => id).join(",") === "popularity,recent,rating",
  `${vocab.res.body?.filters?.categories?.series?.length} series categories`,
);
check(
  "TV has no Romance genre, so it is not offered for that row",
  !vocab.res.body.filters.categories.series.includes("Romance") && vocab.res.body.filters.categories.series.includes("Drama"),
);

// Browsing with no text at all: that is what the panel is for.
const browseKr = await call("/search.json?type=series&region=KR&category=Drama&sort=rating");
check(
  "browsing applies the filters as a TMDB discover query",
  calls.some((u) => u.includes("/discover/tv") && u.includes("with_origin_country=KR") && u.includes("with_genres=18") && u.includes("vote_average.desc")),
  calls.filter((u) => u.includes("/discover/tv")).slice(-1)[0],
);
check("and returns titles", browseKr.res.body?.metas?.length > 0, `${browseKr.res.body?.metas?.length}`);
check("no text and no filters returns nothing", (await call("/search.json")).res.body?.metas?.length === 0);
await call("/search.json?period=1990-1980&type=movie");
check("a period filter maps to a date range", calls.some((u) => u.includes("primary_release_date.gte=1980-01-01") && u.includes("primary_release_date.lte=1990-12-31")));
await call("/search.json?period=before&type=movie");
check("and 'Before' means before 2000", calls.some((u) => u.includes("primary_release_date.lte=1999-12-31")));
check(
  "a category the row type does not have yields an empty row, not every title",
  (await call("/search.json?type=series&category=Romance")).res.body?.metas?.length === 0,
);

// A text query is narrowed by what search can honour: genre ids and the year.
check(
  "a text query is narrowed by the category",
  (await call("/search.json?q=action&type=movie&category=Romance")).res.body?.metas?.length === 0,
);
const searchAction = await call("/search.json?q=action&type=movie&category=Action");
check("and keeps the titles that match it", searchAction.res.body?.metas?.length > 0, `${searchAction.res.body?.metas?.length} titles`);
check("the response reports the filters it used", searchAction.res.body?.filters?.category === "Action" && searchAction.res.body.filters.active === true);

// --- AI providers -------------------------------------------------------------
const aiInfo = await call("/ai.json");
check(
  "/ai.json offers the free providers",
  aiInfo.handled && Object.keys(aiInfo.res.body?.providers || {}).length === 4 && aiInfo.res.body.providers.groq.free === true,
  Object.keys(aiInfo.res.body?.providers || {}).join(","),
);
check("no provider is ready until a key is saved", aiInfo.res.body.ready === false && aiInfo.res.body.hasKey.groq === false);

const noKeyAsk = await postTo("/ai/ask", { prompt: "a lonely detective in the rain" });
check(
  "the Ask route reports a missing key instead of failing",
  noKeyAsk.statusCode === 200 && noKeyAsk.body?.ok === false && /no Groq Cloud key/.test(noKeyAsk.body.text),
  JSON.stringify(noKeyAsk.body),
);
check("an unknown provider is refused", (await postTo("/ai/verify", { provider: "nope" })).body?.ok === false);

await patchSettings({ ai: { provider: "groq", keys: { groq: "groq-test-key" } } });
const masked = (await call("/settings")).res.body?.ai;
check("AI settings report whether a key is set", masked?.hasKey?.groq === true && masked.provider === "groq");
check("AI settings never echo the key", !JSON.stringify(masked).includes("groq-test-key"));
check("the AI key never comes back from /ai.json either", !JSON.stringify((await call("/ai.json")).res.body).includes("groq-test-key"));

const asked = await postTo("/ai/ask", { prompt: "a lonely detective in the rain" });
check(
  "POST /ai/ask turns a sentence into a search query through the provider",
  asked.body?.ok === true && asked.body.query === "neo noir detective rain" && asked.body.provider === "groq",
  JSON.stringify(asked.body),
);
check("the ask really called the provider", calls.some((u) => u.includes("api.groq.com")));
const verified = await postTo("/ai/verify", { provider: "groq" });
check("POST /ai/verify checks the key against the provider", verified.body?.ok === true, JSON.stringify(verified.body));
await patchSettings({ ai: { provider: "groq", keys: { groq: "" } } });

// --- the watchlist ------------------------------------------------------------
const fightClub = { id: "tmdb:550", type: "movie", name: "Fight Club", poster: "https://image.tmdb.org/t/p/w500/f.jpg", releaseInfo: "1999" };
const emptyRow = await call("/catalog/movie/nuvio-watchlist--plan-to-watch.json");
check(
  "an empty watchlist row is an empty catalog, not a 404",
  emptyRow.handled && emptyRow.res.statusCode === 200 && emptyRow.res.body.metas.length === 0,
);
const pinned = await postTo("/watchlist", { item: fightClub, state: "planned" });
check(
  "pinning a title stores it as Plan to Watch",
  pinned.body?.ok === true && pinned.body.state === "planned" && pinned.body.counts.planned === 1,
  JSON.stringify(pinned.body?.counts),
);
const plannedRow = await call("/catalog/movie/nuvio-watchlist--plan-to-watch.json");
check(
  "the Plan to Watch row serves the pinned title",
  plannedRow.res.body?.metas?.length === 1 && plannedRow.res.body.metas[0].name === "Fight Club",
  `${plannedRow.res.body?.metas?.length} titles`,
);
check("and it is served from the stored pin, not from TMDB discover", plannedRow.res.body.metas[0].id === "tmdb:550");
check("a movie pin does not leak into the shows row", (await call("/catalog/series/nuvio-watchlist--plan-to-watch.json")).res.body.metas.length === 0);

// TMDB numbers films and shows in one id space, so the key must include the type.
const sameId = { id: "tmdb:550", type: "series", name: "A Show Called 550" };
await postTo("/watchlist", { item: sameId, state: "watched" });
check(
  "a film and a show with the same TMDB id are two different pins",
  (await call("/catalog/series/nuvio-watchlist--watched.json")).res.body.metas[0]?.name === "A Show Called 550" &&
    (await call("/catalog/movie/nuvio-watchlist--plan-to-watch.json")).res.body.metas[0]?.name === "Fight Club",
);

// The show is pinned as watched already, so counts are read relative to it.
const moved = await postTo("/watchlist", { item: fightClub, state: "watched" });
check(
  "a pin can move state, leaving the state it left",
  moved.body?.state === "watched" && moved.body.counts.planned === 0 && moved.body.counts.watched === 2,
  JSON.stringify(moved.body?.counts),
);
check(
  "the moved title really shows up in its new row",
  (await call("/catalog/movie/nuvio-watchlist--watched.json")).res.body.metas.some((m) => m.name === "Fight Club"),
);
const toggled = await postTo("/watchlist", { item: fightClub, state: "watched" });
check(
  "pinning the state a title is already in unpins it",
  toggled.body?.removed === true && toggled.body.counts.watched === 1 && !(await call("/catalog/movie/nuvio-watchlist--watched.json")).res.body.metas.length,
  JSON.stringify(toggled.body?.counts),
);
check("an unknown state is refused", (await postTo("/watchlist", { item: fightClub, state: "whenever" })).statusCode === 400);
const removed = await postTo("/watchlist", { item: sameId, remove: true });
check("unpinning takes the title off the list", removed.body?.removed === true && removed.body.items.length === 0, `${removed.body?.items?.length} left`);
check("the watchlist survives a re-read (it is stored, not in memory)", Array.isArray((await call("/watchlist.json")).res.body?.items));
const statusRow = await call("/addon-status.json");
check("addon status reports the watchlist and the AI provider", Boolean(statusRow.res.body?.watchlist) && statusRow.res.body.aiProvider === "groq");

// --- the custom row after the states ------------------------------------------
// The row after the watchlist states is the one you fill yourself: nothing moves
// a title in or out of it except you adding it and taking it away.
check(
  "the watchlist card publishes a custom row after its three states",
  ["movie", "series"].every((type) =>
    manifest.catalogs.some((c) => c.type === type && c.id === "nuvio-watchlist--add-cards-in-watchlist"),
  ),
  manifest.catalogs.filter((c) => c.id.includes("add-cards")).map((c) => `${c.type}:${c.name}`).join(","),
);
const customEmpty = await call("/catalog/movie/nuvio-watchlist--add-cards-in-watchlist.json");
check("an empty custom row is an empty catalog, not a 404", customEmpty.handled && customEmpty.res.statusCode === 200 && customEmpty.res.body.metas.length === 0);
const customAdd = await postTo("/customrows", { row: "add-cards", item: fightClub });
check(
  "adding a title to the custom row stores it there",
  customAdd.body?.ok === true && customAdd.body.inRow === true && customAdd.body.counts["add-cards"] === 1,
  JSON.stringify(customAdd.body?.counts),
);
check(
  "and the row serves it as a normal catalog",
  (await call("/catalog/movie/nuvio-watchlist--add-cards-in-watchlist.json")).res.body.metas[0]?.name === "Fight Club",
);
check(
  "a custom row is not a watch state — it does not touch the watchlist",
  (await call("/watchlist.json")).res.body.items.length === 0,
  `${(await call("/watchlist.json")).res.body.items.length} pins`,
);
check(
  "adding the same title again takes it back out",
  (await postTo("/customrows", { row: "add-cards", item: fightClub })).body?.removed === true &&
    !(await call("/catalog/movie/nuvio-watchlist--add-cards-in-watchlist.json")).res.body.metas.length,
);
check(
  "the custom row survives a re-read (it is stored, not in memory)",
  Boolean((await call("/customrows.json")).res.body?.rows) && Array.isArray((await call("/customrows.json")).res.body?.items),
);

// A calendar plan is not a watch state: it is a plan about a *date*, kept in its
// own row, so covering a release on the grid never fills the watchlist's Plan to
// Watch row with something you did not put there.
const calendarPlan = await postTo("/customrows", { row: "calendar-plans", item: fightClub });
check(
  "a calendar plan goes to the calendar's own row, not to a watch state",
  calendarPlan.body?.inRow === true && calendarPlan.body.counts["calendar-plans"] === 1 &&
    !calendarPlan.body.items.some((i) => i.state === "planned") &&
    (await call("/watchlist.json")).res.body.items.length === 0,
  JSON.stringify(calendarPlan.body?.rows),
);
check(
  "the calendar's plan is not published as a catalog row",
  !manifest.catalogs.some((c) => c.id.includes("calendar-plans")),
  manifest.catalogs.filter((c) => c.id.includes("calendar")).map((c) => c.id).join(",") || "none published",
);
// The Watchlist card's own custom row must never pick a calendar plan up: the two
// rows hold different things, and mixing them is the bug this separation exists to
// prevent.
const addCardsAfterCalendarPlan = await call("/catalog/movie/nuvio-watchlist--add-cards-in-watchlist.json");
check(
  "a calendar plan never shows up in the 'Add cards in watchlist' row",
  addCardsAfterCalendarPlan.res.body.metas.length === 0,
  `${addCardsAfterCalendarPlan.res.body.metas.length} titles in the row`,
);
check(
  "and it can be taken back off again",
  (await postTo("/customrows", { row: "calendar-plans", item: fightClub })).body?.removed === true &&
    !(await call("/customrows.json")).res.body.rows.some((r) => r.id === "calendar-plans"),
);

// --- no-key behaviour ---------------------------------------------------------
delete process.env.TMDB_API_KEY;
const noKey = await call("/catalog/movie/nuvio-genres--action.json");
check("missing key returns 200 with empty metas (never a crash)", noKey.res.statusCode === 200 && noKey.res.body.metas.length === 0);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — ${calls.length} stubbed TMDB calls`);
if (failures) process.exitCode = 1;
