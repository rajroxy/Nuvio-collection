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
import {
  CONTINENTS,
  COUNTRIES,
  GLOBAL_OTT,
  collectionsFor,
  countryVocab,
  keywordVocab,
  localServices,
  title as collectionTitle,
} from "../scripts/collections.mjs";
import { get, hasKey, toMeta, tmdbPath, setKey, resolveGenre } from "./tmdb.mjs";
import { askAI, verifyAI, aiModels, aiProviderName, aiState } from "./ai.mjs";
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
import {
  DEFAULT_ROW,
  items as customItems,
  list as customList,
  rows as customRows,
  counts as customCounts,
  add as customAdd,
  remove as customRemove,
  metasFor as customMetas,
} from "./customrows.mjs";
import { catalogSpecs, activeRegion, catalogDefs, CATALOG_ID_PREFIX, findCatalog } from "./catalogs.mjs";
import { activeCountry, activeContentSource, activeLanguage, getSettings, updateSettings, publicSettings, tmdbKey, providerKeys } from "./settings.mjs";
import { enrichRatings, verifyProvider } from "./providers.mjs";
import { applyPosters, postersEnabled, checkPosterService } from "./posters.mjs";
import { applyContentSource, contentSourceActive, contentSourceStats } from "./tvdb.mjs";
import { inspectSource } from "./sources.mjs";
import { calendarMonth } from "./calendar.mjs";
import { liveChannels, liveGuide, liveStatus, liveCountries, countrySpellings } from "./live.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCHLIST_FILE = path.join(__dirname, "watchlist.json");

export const ADDON_ID = "community.nuvio.collections";
export { CATALOG_ID_PREFIX };

const PAGE_SIZE = 40;

/**
 * How much one search window reads.
 *
 * Search and browse used to keep **twelve titles per row type**, then sixty, then
 * 120 — every one of those was a *cap*, and a cap is the bug: the server had already
 * fetched the titles and then threw them away, so a search offered exactly 120 of
 * something that had thousands. **Nothing is capped now.** A window is `SEARCH_PAGES`
 * TMDB pages per row type (TMDB answers twenty a page), and `Load more` reads the
 * next window and keeps going until TMDB has nothing left to ask for — so the count
 * under each group is the real number of results, and it grows as far as the row
 * does. The only limit left is TMDB's own (page 500 per query), which is not ours to
 * move.
 */
const SEARCH_PAGES = 6;

/**
 * Read up to `pages` pages of one TMDB list, stopping early at the last page.
 *
 * It answers with **how far it actually got**. A short page is the last page, and
 * the loop stops there — so a window can be three pages rather than six, and the
 * caller must continue from wherever the read really ended. Returning the count
 * (and whether the list is finished) is what makes "Load more" line up with TMDB
 * instead of skipping past the end of a short result set.
 */
async function readPages(path, params, pages = SEARCH_PAGES, start = 0) {
  const out = [];
  // `start` is how many pages have already been read, so page 2 of the screen is
  // TMDB's page 7 — that is what lets the results keep going instead of stopping
  // at a number the server picked.
  let read = 0;
  let ended = false;
  for (let page = start + 1; page <= start + pages; page += 1) {
    const data = await get(path, { ...params, page }).catch(() => ({ results: [] }));
    const list = data.results ?? [];
    read += 1;
    out.push(...list);
    // A short page is the last page — there is nothing after it to ask for.
    if (list.length < 20) {
      ended = true;
      break;
    }
  }
  return { items: out, pagesRead: read, ended, next: ended ? null : start + read };
}

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

/* ------------------------------------------------------------------ search */

const SEARCH_TYPES = ["movie", "series"];

/**
 * The search screen's filter vocabulary.
 *
 * Categories are genres, named per row type, because TMDB's movie and TV genre
 * sets are different: TV has no Romance, Horror or Thriller, and nothing called
 * Fantasy (it is "Sci-Fi & Fantasy"). A category a row type does not have is not
 * offered for that type, and choosing it while browsing excludes that row rather
 * than quietly dropping the filter and showing everything.
 */
const SEARCH_CATEGORIES = [
  //  label        movie genre        TV genre
  ["Romance", "Romance", null],
  ["Action", "Action", "Action & Adventure"],
  ["Fantasy", "Fantasy", "Sci-Fi & Fantasy"],
  ["Animation", "Animation", "Animation"],
  ["Suspense", "Thriller", null],
  ["Sci-Fi", "Science Fiction", "Sci-Fi & Fantasy"],
  ["Horror", "Horror", null],
  ["Comedy", "Comedy", "Comedy"],
  ["Crime", "Crime", "Crime"],
  ["Adventure", "Adventure", "Action & Adventure"],
  ["Thriller", "Thriller", null],
  ["Drama", "Drama", "Drama"],
  ["Mystery", "Mystery", "Mystery"],
  ["Family", "Family", "Family"],
  ["History", "History", "War & Politics"],
  ["War", "War", "War & Politics"],
  ["Western", "Western", "Western"],
  ["Documentary", "Documentary", "Documentary"],
  ["Reality", null, "Reality"],
  ["Kids", null, "Kids"],
];

/**
 * The panel filters by the *card lines*, not by an invented vocabulary: a
 * continent filter is the Continental card's own continents, the OTT filter is the
 * Global OTT card's own platforms, the Mood and Theme filters are the keyword rows
 * those two cards publish, and the Country filter is every country the Countries
 * card has a row for. One panel, the same names the cards use — which is what the
 * request meant by "a filter per card line".
 */
const SEARCH_CONTINENTS = [["all", "All continents"], ...Object.keys(CONTINENTS).map((name) => [name, name])];
const SEARCH_COUNTRIES = [["all", "All countries"], ...countryVocab()];
const SEARCH_PROVIDERS = [["all", "All services"], ...GLOBAL_OTT.map(([label, id]) => [String(id), label])];
const SEARCH_MOODS = [["all", "All moods"], ...keywordVocab("moods-and-vibes").map(([name, id]) => [String(id), name])];
const SEARCH_THEMES = [["all", "All themes"], ...keywordVocab("themes-and-tags").map(([name, id]) => [String(id), name])];

const CONTINENT_CODES = new Map(Object.entries(CONTINENTS).map(([name, codes]) => [name, codes.join("|")]));
const COUNTRY_CODES = new Set(SEARCH_COUNTRIES.map(([code]) => code));
const PROVIDER_IDS = new Set(SEARCH_PROVIDERS.map(([id]) => id));
const MOOD_IDS = new Set(SEARCH_MOODS.map(([id]) => id));
const THEME_IDS = new Set(SEARCH_THEMES.map(([id]) => id));

/** The period choices: the last eleven years, then the decade buckets, then "Before". */
function periodChoices() {
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 11 }, (_, i) => {
    const y = String(thisYear - i);
    return [y, y];
  });
  return [["all", "All Time Periods"], ...years, ["2015-2011", "2015-2011"], ["2010-2000", "2010-2000"], ["before", "Before"]];
}

const SEARCH_SORTS = [
  ["popularity", "Popularity"],
  ["recent", "Recent"],
  ["rating", "High Rating"],
];

const SEARCH_FILTERS = {
  types: [["", "All"], ["series", "TV Series"], ["movie", "Movie"]],
  continents: SEARCH_CONTINENTS,
  countries: SEARCH_COUNTRIES,
  providers: SEARCH_PROVIDERS,
  moods: SEARCH_MOODS,
  themes: SEARCH_THEMES,
  categories: {
    movie: SEARCH_CATEGORIES.filter(([, movie]) => movie).map(([label]) => label),
    series: SEARCH_CATEGORIES.filter(([, , tv]) => tv).map(([label]) => label),
  },
  periods: periodChoices(),
  sorts: SEARCH_SORTS,
};

/** The genre name behind a category label for one row type (null when it has none). */
const categoryGenre = (label, type) => {
  const row = SEARCH_CATEGORIES.find(([name]) => name === label);
  if (!row) return null;
  return (type === "movie" ? row[1] : row[2]) || null;
};

// An unknown value falls back to "all" rather than reaching TMDB as a bad filter —
// a hand-written URL can never empty the screen silently.
const pickOne = (value, allowed) => (allowed.has(value) ? value : "all");

/**
 * A period is "all", "before", a year, or a `YYYY-YYYY` range — validated by shape
 * rather than against the offered list, so a range a filter row does not happen to
 * offer (2011-2015 is offered as 2015-2011) still means what it says.
 */
const validPeriod = (value) => {
  const v = value || "all";
  return v === "all" || v === "before" || /^\d{4}$/.test(v) || /^\d{4}-\d{4}$/.test(v) ? v : "all";
};

const parseFilters = (params) => {
  const type = params.get("type");
  const category = params.get("category") || "all";
  return {
    type: type === "movie" || type === "series" ? type : "",
    continent: CONTINENT_CODES.has(params.get("continent")) ? params.get("continent") : "all",
    country: pickOne(params.get("country"), COUNTRY_CODES),
    provider: pickOne(params.get("provider"), PROVIDER_IDS),
    mood: pickOne(params.get("mood"), MOOD_IDS),
    theme: pickOne(params.get("theme"), THEME_IDS),
    category: category === "all" || SEARCH_CATEGORIES.some(([label]) => label === category) ? category : "all",
    period: validPeriod(params.get("period")),
    sort: SEARCH_SORTS.some(([id]) => id === params.get("sort")) ? params.get("sort") : "popularity",
  };
};

const FILTER_KEYS = ["continent", "country", "provider", "mood", "theme"];

const hasFilters = (f) =>
  Boolean(f.type) ||
  FILTER_KEYS.some((key) => f[key] !== "all") ||
  f.category !== "all" ||
  f.period !== "all" ||
  f.sort !== "popularity";

const filtersPayload = (f) => ({ ...f, active: hasFilters(f) });

/** The release year TMDB reports for a search result. */
const resultYear = (item, type) => {
  const date = type === "movie" ? item.release_date : item.first_air_date;
  const year = Number(String(date || "").slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
};

/** Does a year fall in the chosen period ("2026", "2015-2011", "before")? */
function inPeriod(year, period) {
  if (!period || period === "all") return true;
  if (period === "before") return year !== null && year <= 1999;
  if (/^\d{4}-\d{4}$/.test(period)) {
    const [a, b] = period.split("-").map(Number);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return year !== null && year >= from && year <= to;
  }
  return year === Number(period);
}

/** The discover parameters behind a period choice. */
function periodParams(period, type) {
  const field = type === "movie" ? "primary_release_date" : "first_air_date";
  if (!period || period === "all") return {};
  if (/^\d{4}$/.test(period)) {
    // The dedicated year parameter is the only one that is exact for both types.
    return type === "movie" ? { primary_release_year: period } : { first_air_date_year: period };
  }
  if (/^\d{4}-\d{4}$/.test(period)) {
    const [a, b] = period.split("-").map(Number);
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return { [`${field}.gte`]: `${from}-01-01`, [`${field}.lte`]: `${to}-12-31` };
  }
  return { [`${field}.lte`]: "1999-12-31" };
}

/** Sort choices, in TMDB's language. */
function sortParams(sort, type) {
  if (sort === "recent") return { sort_by: `${type === "movie" ? "primary_release_date" : "first_air_date"}.desc` };
  if (sort === "rating") return { sort_by: "vote_average.desc" };
  return { sort_by: "popularity.desc" };
}

/**
 * A title query, narrowed by whatever of the filters TMDB's search can honour.
 *
 * Search results carry their genre ids and their date, so the category and the
 * period can be applied to them; they carry **no origin country**, so the region
 * filter can only apply while browsing (the app says so on screen).
 */
async function searchTitles(query, f, { adult = false, start = 0 } = {}) {
  const types = f.type ? [f.type] : SEARCH_TYPES;
  const lists = await Promise.all(
    types.map(async (type) => {
      const { items: raw, next } = await readPages(`/search/${tmdbPath(type)}`, {
        query,
        ...(adult ? { include_adult: true } : {}),
      }, SEARCH_PAGES, start);
      let items = raw;
      const genreName = categoryGenre(f.category, type);
      if (f.category !== "all" && genreName) {
        const id = await resolveGenre(type, genreName);
        if (id) items = items.filter((it) => (it.genre_ids || []).includes(id));
      }
      if (f.period !== "all") items = items.filter((it) => inPeriod(resultYear(it, type), f.period));
      // TMDB's own `include_adult` is not enough: it is a hint, and some results
      // still carry `adult: true`. In SFW they are dropped here too.
      if (!adult) items = items.filter((it) => !it.adult);
      // Deduplicated on the way out: paging a search can repeat a title.
      const seen = new Set();
      return {
        metas: sortItems(items, type, f.sort)
          .filter((it) => (seen.has(it.id) ? false : seen.add(it.id)))
          .map((it) => toMeta(it, type))
          .filter(Boolean),
        next,
      };
    }),
  );
  return mergeWindows(lists);
}

/**
 * One window's titles, plus where the next window starts.
 *
 * Two row types are read together, and either can run out first: the cursor is the
 * **smallest** page still worth asking from, so neither row type is skipped over,
 * and it is null only when both are finished.
 */
function mergeWindows(lists) {
  const nexts = lists.map((l) => l.next).filter((n) => typeof n === "number");
  return {
    metas: lists.flatMap((l) => l.metas),
    next: nexts.length ? Math.min(...nexts) : null,
  };
}

/** Sort search results locally, since a search cannot be asked for an order. */
function sortItems(items, type, sort) {
  const year = (it) => resultYear(it, type) || 0;
  if (sort === "recent") return [...items].sort((a, b) => year(b) - year(a));
  if (sort === "rating") return [...items].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  return [...items].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

/**
 * Browsing with no text: TMDB discover, with every filter applied.
 *
 * This is the panel's real job — "Korean romance series, high rating" is a
 * discover query, not a search.
 */
async function browseTitles(f, { adult = false, start = 0 } = {}) {
  const types = f.type ? [f.type] : SEARCH_TYPES;
  const lists = await Promise.all(
    types.map(async (type) => {
      const genreName = categoryGenre(f.category, type);
      // The chosen category does not exist for this row type: an empty row is the
      // honest answer, not every title in it.
      if (f.category !== "all" && !genreName) return [];
      const params = {
        ...sortParams(f.sort, type),
        ...periodParams(f.period, type),
        // A rating sort needs a floor to mean anything: one 9.8 with two votes
        // would otherwise lead the row.
        "vote_count.gte": f.sort === "rating" ? 50 : 5,
      };
      // A continent is a set of origin countries; a single country is itself.
      const codes = f.continent !== "all" ? CONTINENT_CODES.get(f.continent) : f.country !== "all" ? f.country : "";
      if (codes) params.with_origin_country = codes;
      // The OTT filter is a watch-provider filter, so it needs the region you are
      // browsing from as well — a service is only "available" somewhere.
      if (f.provider !== "all") {
        params.with_watch_providers = f.provider;
        params.watch_region = activeRegion();
        params.with_watch_monetization_types = "flatrate";
      }
      // Mood and Theme are keyword rows; both at once asks for titles that carry
      // both keywords, which is what choosing two does.
      const keywords = [f.mood, f.theme].filter((id) => id !== "all");
      if (keywords.length) params.with_keywords = keywords.join(",");
      if (genreName) {
        const id = await resolveGenre(type, genreName);
        if (!id) return [];
        params.with_genres = id;
      }
      if (adult) params.include_adult = true;
      const { items: raw, next } = await readPages(`/discover/${tmdbPath(type)}`, params, SEARCH_PAGES, start);
      let items = raw;
      if (!adult) items = items.filter((it) => !it.adult);
      const seen = new Set();
      return {
        metas: items
          .filter((it) => (seen.has(it.id) ? false : seen.add(it.id)))
          .map((it) => toMeta(it, type))
          .filter(Boolean),
        next,
      };
    }),
  );
  return mergeWindows(lists);
}

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
      // says how to fill it, a TMDB row says the catalog came back empty), and
      // `row` names the custom row so the app can add a title to it.
      catalogs: defs
        .filter((d) => d.type === type)
        .map((d) => ({ id: d.id, name: d.name, kind: d.entry?.kind || "", state: d.entry?.state || "", row: d.entry?.row || "" })),
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
const metasFor = (entry) =>
  poolItems(entry)
    // SFW is enforced here as well as at the API. `include_adult` only covers the
    // discover endpoints, and it is a hint even there: `/trending`, `/now_playing`,
    // `/airing_today` and `/top_rated` take no such parameter at all, so an adult
    // title TMDB flags on a list item would otherwise reach a safe-for-work app.
    // The flag rides on the raw item, so the filter belongs here, before the meta
    // is built — and after it, nothing downstream can tell the difference.
    .filter((item) => entry.adult || !item.adult)
    .map((item) => toMeta(item, entry.media))
    .filter(Boolean);

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

/**
 * Countries the shuffle skims, so one draw is not one country's chart.
 *
 * A row sorted by popularity is, in practice, an American chart: the same big
 * titles at the top of it every time. Shuffle samples the row *and* a handful of
 * other origin countries, so the draw covers what the row actually holds across
 * the world — the row's own filters (its OTT, its genre, its decade) still apply
 * to every one of these, they only change where the titles come from.
 */
const SHUFFLE_COUNTRIES = [
  "US", "IN", "JP", "KR", "GB", "FR", "ES", "IT", "DE", "BR", "MX", "TR",
  "NG", "CN", "HK", "TW", "TH", "ID", "PH", "VN", "SE", "NO", "DK", "FI",
  "PL", "RU", "NL", "BE", "PT", "GR", "AR", "CO", "CL", "EG", "ZA", "AU",
];

/** The row's specs, plus a few country-scoped ones when the row is discover-based. */
function shuffleCountrySpecs(specs) {
  const discover = specs.filter((s) => typeof s?.path === "string" && s.path.startsWith("/discover/"));
  if (!discover.length || discover.length !== specs.length) return specs;
  const picks = [...SHUFFLE_COUNTRIES].sort(() => Math.random() - 0.5).slice(0, 4);
  const extra = picks.map((code) => {
    const base = discover[Math.floor(Math.random() * discover.length)];
    return { path: base.path, params: { ...base.params, with_origin_country: code }, take: PAGE_SIZE / 2 };
  });
  return [...specs, ...extra];
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
  } else if (specs.length === 1 && specs[0].custom) {
    pool = customMetas(specs[0].custom, media, 0, 300);
  } else if (specs.length === 1 && specs[0].episodes) {
    pool = await episodeMetas(media, specs[0].episodes, language, Boolean(opts.adult));
  } else {
    // The pool is the row's own specs **plus a few origin countries**, so a draw
    // is not always the same Hollywood titles: "everything from every country
    // this row holds" is what a shuffle is supposed to mean.
    const varied = shuffleCountrySpecs(specs);
    const entry = remember(pools, key, () => ({ at: Date.now(), media, specs: varied, lists: varied.map(() => []), rounds: 0, items: null, adult: Boolean(opts.adult) }));
    // Sample from a pool many times the sample size. Twelve of the top twenty
    // most popular titles is what made one shuffle look like the last one, and
    // like nothing but the biggest names: the pool has to reach well past them
    // before a random draw is worth anything.
    pool = await deepen(entry, Math.max(count * 8, PAGE_SIZE * 4));
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
async function episodeMetas(media, max, language = activeLanguage(), adult = false) {
  const entry = remember(episodePools, `${media}:${max}:${language}:${adult ? "a" : "s"}`, () => ({ shows: null }));
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
  return entry.shows.filter((d) => adult || !d.adult).map((d) => toMeta(d, media)).filter(Boolean);
}

async function episodesMetas(media, max, skip, language, adult) {
  const metas = await episodeMetas(media, max, language, adult);
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
    return episodesMetas(media, specs[0].episodes, skip, language, Boolean(opts.adult));
  }

  // The watchlist is served from the stored pins, not from TMDB.
  if (specs.length === 1 && specs[0].watchlist) {
    return watchlistMetas(specs[0].watchlist, media, skip, PAGE_SIZE);
  }

  // A custom row is served from the titles you put in it, the same way.
  if (specs.length === 1 && specs[0].custom) {
    return customMetas(specs[0].custom, media, skip, PAGE_SIZE);
  }

  // A pool that only grows: page 2 continues where page 1 stopped, and repeat
  // requests are served from memory. `take` catalogues (the ◆ Top 10 rows) stop
  // at their length, because a Top 10 really does hold ten titles.
  const entry = remember(pools, key, () => ({ at: Date.now(), media, specs, lists: specs.map(() => []), rounds: 0, items: null, adult: Boolean(opts.adult) }));
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
    // Anything that answers differently each time says so explicitly — an absent
    // header still lets a browser reuse a heuristic copy.
    "cache-control": maxAge ? `max-age=${maxAge}` : "no-store",
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
 * The custom rows as the app reads them: every stored title (tagged with its
 * row so one read is enough), plus how many titles each row holds.
 */
function customPayload() {
  return { rows: customRows(), counts: customCounts(), items: customItems() };
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
      customRows: customCounts(),
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

  // Custom rows: the titles you added yourself, after the watchlist states.
  if (pathname === "/customrows.json" || pathname === "/customrows") {
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
        const row = body.row || DEFAULT_ROW;
        const item = body.item || {};
        if (body.remove) json(res, 200, { ...customRemove(row, item), ...customPayload() });
        else json(res, 200, { ...customAdd(row, item), ...customPayload() });
      } catch (err) {
        json(res, 400, { ok: false, text: String(err?.message || err) });
      }
      return true;
    }
    json(res, 200, customPayload());
    return true;
  }

  // The AI provider state (never the keys) and its two live calls.
  if (pathname === "/ai.json") {
    json(res, 200, aiState());
    return true;
  }

  if (pathname === "/ai/ask" || pathname === "/ai/verify" || pathname === "/ai/models") {
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
      const provider = String(body.provider || "");
      const result = pathname === "/ai/ask"
        ? await askAI(String(body.prompt || ""))
        : pathname === "/ai/models"
          ? await aiModels(provider || aiProviderName())
          : await verifyAI(provider, body.key ? String(body.key) : undefined);
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
    const filters = parseFilters(params);
    // A screen with no text and no filter is an empty screen, not a query that
    // happens to match nothing.
    const browsing = !query && hasFilters(filters);
    setKey(tmdbKey());
    if ((!query && !browsing) || !hasKey()) {
      json(res, 200, { query, metas: [], filters: filtersPayload(filters) });
      return true;
    }
    // `start` is the window the screen is asking for: 0 is the first, and each
    // further window continues where the last one stopped. Nothing is capped —
    // the client keeps asking until TMDB runs out.
    const start = Math.max(0, Number(params.get("start")) || 0);
    try {
      const { metas, next } = query
        ? await searchTitles(query, filters, { adult, start })
        : await browseTitles(filters, { adult, start });
      await applyPosters(metas);
      await applyContentSource(metas);
      await enrichRatings(metas);
      json(res, 200, { query, metas, next, filters: filtersPayload(filters) }, 300);
    } catch (err) {
      console.error(`[addon] search ${query || "(browse)"} failed:`, err.message);
      json(res, 200, { query, metas: [], filters: filtersPayload(filters) });
    }
    return true;
  }

  /* ------------------------------------------------------- Live TV & Sports */

  // The channel list: the Live TV profile's catalog. `group` picks one of the
  // playlist's own categories (Sports, News, …), `q` filters by name, and
  // `country` by the country a playlist names in the channel's id.
  if (pathname === "/live/channels.json") {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const group = params.get("group") || "";
    // One country (`country=US`) or a picked set (`countries=US,GB`). A picked set
    // is what the country setting hands over, so the Guide, the Categories card and
    // the channel rows all read the same slice of the directory.
    const wanted = [params.get("country") || "", ...(params.get("countries") || "").split(",")]
      .flatMap((c) => countrySpellings(c))
      .filter(Boolean);
    const needle = (params.get("q") || "").trim().toLowerCase();
    const list = await liveChannels({ force: params.get("force") === "1" });
    const channels = (list.channels || []).filter(
      (c) =>
        (!group || (c.groups || []).includes(group)) &&
        (!wanted.length || wanted.includes(String(c.country || "").toUpperCase())) &&
        (!needle || c.name.toLowerCase().includes(needle)),
    );
    json(res, 200, {
      channels: channels.slice(0, Number(params.get("limit")) || 400),
      total: channels.length,
      groups: list.groups || [],
      updated: list.at || 0,
      error: list.error || "",
    }, 300);
    return true;
  }

  // The guide: the next `hours` of programmes per channel id, plus the lineup the
  // grid is drawn against. Empty programmes with `epg: false` is the honest answer
  // when no XMLTV source is configured.
  if (pathname === "/live/guide.json") {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const guide = await liveGuide({
      hours: Number(params.get("hours")) || 6,
      force: params.get("force") === "1",
      countries: params.get("countries") || "",
    });
    json(res, 200, guide, 300);
    return true;
  }

  // The directory's country table, for the settings screen's country picker.
  if (pathname === "/live/countries.json") {
    json(res, 200, await liveCountries(), 86400);
    return true;
  }

  if (pathname === "/live/status.json") {
    json(res, 200, await liveStatus(), 60);
    return true;
  }

  // The filter panel's own vocabulary — what the search screen draws its rows
  // from, so the app never hard-codes a genre name TMDB does not know.
  if (pathname === "/search/filters.json") {
    json(res, 200, { filters: SEARCH_FILTERS }, 3600);
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
  // A retired or unknown catalog id is a 404, not a crash: the id is matched by
  // shape, so `parsed.def` can be null, and the error handler below reads
  // `parsed.def.id` — which would throw from inside the catch.

  if (!parsed.def) {
    json(res, 404, { metas: [] });
    return true;
  }

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
    // A shuffle is never cached: the whole point is that the same URL answers
    // with a different draw, so a copy in the browser would freeze the row.
    //
    // The watchlist and the calendar's rows are not cached either, and that is a
    // bug fix rather than a nicety: they are *your state*, and a 15-minute copy is
    // what made "unpinning a title does not remove it" — the browser kept serving
    // the row as it was before the unpin.
    const stateful = parsed.def.entry?.kind === "watchlist" || parsed.def.entry?.kind === "custom";
    json(res, 200, { metas }, parsed.shuffle || stateful ? 0 : 900);
  } catch (err) {
    console.error(`[addon] catalog ${parsed.type}/${parsed.def.id} failed:`, err.message);
    json(res, 200, { metas: [] });
  }
  return true;
}
