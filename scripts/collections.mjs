/**
 * The Nuvio collection set — single source of truth.
 *
 * Shared by the cover generator (`scripts/generate-covers.mjs`) and the catalog
 * addon (`addon/catalogs.mjs`), so the cover art and the catalog rows can never
 * drift apart. Order matters: it is the row order in the Nuvio home screen.
 *
 *   key       stable id — also the cover filename and the catalog id suffix
 *   lines     the title, split across lines for the cover
 *   catalogs  the catalogs inside this card, per row: { movie: [...], show: [...] }
 *
 * **Nothing here is guessed.** Genre names, provider ids and keyword ids all
 * come from `tmdb-verified.json`, produced by `scripts/probe-tmdb.mjs` against
 * the live TMDB API and checked to actually return titles. Guessing any of them
 * is what used to produce rows with no titles in them (TMDB renamed HBO Max to
 * Max, moved Paramount+ in the US, and its keyword search returns "based on
 * visual novel" for "based on novel").
 *
 * Catalog entry kinds and their params:
 *
 *   preset        value: trending | popular | top_rated | now_playing |
 *                 airing_today | airing_this_week | on_the_air
 *   discover      value: latest | new
 *   genre         genre, sort?: "popular"
 *   decade        decade (e.g. 1950), sort?: "popular"
 *   genre-decade  genre, from
 *   continent     codes: ["JP", …]
 *   country       code: "IN"
 *   runtime       min: 30
 *   episodes      max: 4
 *   keyword       id   (verified TMDB keyword id)
 *   provider      providerId, region   (an OTT service in that region)
 *   watchlist     state: planned | watching | watched   (served from the pins)
 *
 *   `take` caps how many titles a catalog keeps. It is only used where the name
 *   promises a fixed size (a ◆ Top 10 really is ten titles) — anywhere else it
 *   is left off, because a capped row is a row that stops scrolling.
 *
 * NOTE on symbols: covers render with the bundled Inter fonts and system fonts
 * are disabled, so a glyph Inter lacks renders as a box. `✦` and `➜` are NOT in
 * Inter — `◆`, `→`, `★`, `·`, `•`, `–`, `—` are. Only use those.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VERIFIED = require("./tmdb-verified.json");

const ALL_DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

export const MOVIE_GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction",
  "Thriller", "War", "Western",
];

export const SHOW_GENRES = [
  "Action & Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Kids", "Mystery", "News", "Reality", "Sci-Fi & Fantasy", "Soap", "Talk",
  "War & Politics", "Western",
];

export const CONTINENTS = {
  Asia: ["JP", "KR", "CN", "IN", "TH", "ID", "PH", "TW", "HK", "MY", "SG", "VN", "PK", "LK", "BD"],
  Europe: ["GB", "FR", "DE", "IT", "ES", "SE", "NO", "DK", "NL", "PL", "RU", "IE", "PT", "GR", "UA", "CZ", "HU", "RO", "FI", "CH", "BE", "AT", "BG", "RS", "HR"],
  "North America": ["US", "CA", "MX"],
  "South America": ["BR", "AR", "CO", "CL", "PE"],
  Africa: ["NG", "ZA", "EG", "KE", "MA", "GH"],
  Oceania: ["AU", "NZ"],
};

// Sixty countries, chosen for having a real amount of TMDB content. Every entry
// is verified in `tmdb-verified.json` — a country with no titles for a row is
// simply not published there (`countriesFor` filters it out).
export const COUNTRIES = [
  ["United States", "US"], ["India", "IN"], ["Japan", "JP"], ["South Korea", "KR"],
  ["United Kingdom", "GB"], ["France", "FR"], ["Spain", "ES"], ["Germany", "DE"],
  ["Italy", "IT"], ["China", "CN"], ["Mexico", "MX"], ["Brazil", "BR"],
  ["Turkey", "TR"], ["Australia", "AU"], ["Canada", "CA"], ["Nigeria", "NG"],
  ["Russia", "RU"], ["Netherlands", "NL"], ["Sweden", "SE"], ["Norway", "NO"],
  ["Denmark", "DK"], ["Poland", "PL"], ["Ireland", "IE"], ["Portugal", "PT"],
  ["Greece", "GR"], ["Argentina", "AR"], ["Colombia", "CO"], ["Chile", "CL"],
  ["Peru", "PE"], ["Egypt", "EG"], ["South Africa", "ZA"], ["Kenya", "KE"],
  ["Morocco", "MA"], ["Ghana", "GH"], ["Israel", "IL"], ["Saudi Arabia", "SA"],
  ["United Arab Emirates", "AE"], ["Indonesia", "ID"], ["Thailand", "TH"], ["Philippines", "PH"],
  // Added: more countries with a good amount of content.
  ["Taiwan", "TW"], ["Hong Kong", "HK"], ["Malaysia", "MY"], ["Singapore", "SG"],
  ["Vietnam", "VN"], ["Pakistan", "PK"], ["Bangladesh", "BD"], ["Sri Lanka", "LK"],
  ["New Zealand", "NZ"], ["Ukraine", "UA"], ["Czech Republic", "CZ"], ["Hungary", "HU"],
  ["Romania", "RO"], ["Finland", "FI"], ["Switzerland", "CH"], ["Belgium", "BE"],
  ["Austria", "AT"], ["Bulgaria", "BG"], ["Serbia", "RS"], ["Croatia", "HR"],
];

// Hulu is a US service, so it is deliberately not in the global platform set.
//
// Crunchyroll and Rakuten Viki are the two Asian-catalogue services: they are
// verified local services in nearly every region, and they belong in the
// **Regional OTT** cards (where they are added for every country, see
// `WORLDWIDE` below), not doubled up in the Global OTT set.
const GLOBAL_EXCLUDE = new Set(["Hulu", "Crunchyroll", "Viki"]);

/** The global OTT platforms — [label, TMDB provider id], all verified. */
export const PLATFORMS = VERIFIED.platforms
  .filter((p) => p.id && !GLOBAL_EXCLUDE.has(p.label))
  .map((p) => [p.label, p.id]);

export const DECADES = ALL_DECADES;

/** Up to `LOCAL_LIMIT` local OTT services per region, verified to return titles. */
export const LOCAL_LIMIT = 3;
const localFor = (regionName, type) => (VERIFIED.regions[regionName]?.[type] ?? []).slice(0, LOCAL_LIMIT);

/** The country name behind an ISO code — the region setting stores the code. */
export const countryName = (code) => {
  const upper = String(code || "").toUpperCase();
  const hit = COUNTRIES.find(([, c]) => c === upper);
  return hit ? hit[0] : "";
};

/**
 * Services that belong in **every** region's Regional OTT card.
 *
 * Crunchyroll and Viki (TMDB's name for Rakuten Viki) are the Asian-catalogue
 * services. Sitting in the Global OTT card meant anime and Asian drama never
 * appeared in the regional rows even though both are local to nearly every region
 * the app covers, which read as "the regional cards have no anime in them". They
 * join the region's own list, after the local ones — a country's own services
 * still come first — and they are deliberately *not* in the Global OTT set, so each
 * service lives in exactly one of the two OTT card families instead of being
 * counted twice.
 */
const WORLDWIDE = (VERIFIED.platforms || [])
  .filter((p) => p.id && (p.label === "Crunchyroll" || p.label === "Viki"))
  .map((p) => ({ id: p.id, name: p.label }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The verified local services for a country, plus the worldwide ones. */
export const localServices = (code, type) => {
  const local = localFor(countryName(code), type);
  const seen = new Set(local.map((s) => s.id));
  return [...local, ...WORLDWIDE.filter((s) => !seen.has(s.id))];
};

/** The regions that actually have a verified local OTT service. */
export const OTT_REGIONS = COUNTRIES.filter(([name]) => localFor(name, "movie").length || localFor(name, "tv").length);

/** The country the collection set is built for unless Settings picks another. */
export const DEFAULT_COUNTRY = (process.env.NUVIO_REGION || "US").toUpperCase();

/** Verified keyword ids, by card. */
const KW = VERIFIED.keywords;

/* entry builders — keep the list definitions short and consistent */

const preset = (name, value, take) => ({ name, kind: "preset", value, take });
const discover = (name, value, take) => ({ name, kind: "discover", value, take });
const genre = (name, g, sort) => ({ name, kind: "genre", genre: g, sort });
const decade = (name, d, sort) => ({ name, kind: "decade", decade: d, sort });
const genreDecade = (name, g, from) => ({ name, kind: "genre-decade", genre: g, from });
const continent = (name, codes) => ({ name, kind: "continent", codes });
const country = (name, code, take) => ({ name, kind: "country", code, take });
const runtime = (name, min) => ({ name, kind: "runtime", min });
const episodes = (name, max) => ({ name, kind: "episodes", max });
const keyword = (name, id, take) => ({ name, kind: "keyword", id, take });
const provider = (name, providerId, region, take) => ({ name, kind: "provider", providerId, region, take });
const watchlist = (name, state) => ({ name, kind: "watchlist", state });

/**
 * Keyword entries for one card, straight from the verified table.
 * Only labels that actually have titles for this row are published — otherwise
 * the row exists but always comes back empty.
 */
// "Documentary" is a genre, not a theme — it is deliberately not part of the
// Themes & Tags card, and it is skipped everywhere it would otherwise appear.
const KEYWORD_EXCLUDE = new Set(["Documentary"]);

const keywordEntries = (group, type, take) =>
  Object.entries(KW[group] ?? {})
    .filter(([name]) => !KEYWORD_EXCLUDE.has(name))
    .filter(([, k]) => (type === "movie" ? k.movieCount : k.tvCount) > 0)
    .map(([name, k]) => keyword(name, k.id, take));

/** Countries that actually have titles for this row (Ghana has films, no series). */
const countriesFor = (type) =>
  COUNTRIES.filter(([name]) => {
    const c = VERIFIED.countries[name];
    return (type === "movie" ? c?.movieCount : c?.tvCount) > 0;
  });

/**
 * Global OTT rows: Top 10, Popular, then everything — for every platform.
 *
 * Only the ◆ Top 10 rows are capped. `Popular`/`everything` used to carry a
 * `take` of 30/40, which made an OTT card the one place in the app whose rows
 * stopped after a couple of screens while every other card kept scrolling — the
 * reported "OTT cards don't scroll" bug. They are uncapped now.
 */
const globalOtt = {
  top10: (take) => PLATFORMS.map(([label, id]) => provider(`${label} ◆ Top 10`, id, null, take)),
  popular: () => PLATFORMS.map(([label, id]) => provider(`Popular ${label}`, id, null)),
  all: () => PLATFORMS.map(([label, id]) => provider(label, id, null)),
};

/**
 * Regional OTT rows for **one** country — the country you are in.
 *
 * These cards used to publish every region's services (107 rows per card, most of
 * them unwatchable from where you are). The country setting picks one, so a card
 * now holds that country's services — up to `LOCAL_LIMIT` per row type — and each
 * row is scoped to that country's region.
 */
function regionalOtt(kind, code) {
  const build = (type) => {
    const services = localServices(code, type);
    // Two services in one region could share a name; disambiguate so two rows can
    // never collide on the same catalog id.
    const nameCount = new Map();
    for (const svc of services) nameCount.set(svc.name, (nameCount.get(svc.name) || 0) + 1);
    const label = (svc) => (nameCount.get(svc.name) > 1 ? `${svc.name} (${svc.id})` : svc.name);
    return services.map((svc) => {
      if (kind === "top10") return provider(`${label(svc)} ◆ Top 10`, svc.id, code, TOP10);
      if (kind === "popular") return provider(`Popular ${label(svc)}`, svc.id, code);
      return provider(label(svc), svc.id, code);
    });
  };
  return { movie: build("movie"), show: build("tv") };
}

const TOP10 = 10;
const both = (list) => ({ movie: list, show: list.map((e) => ({ ...e })) });
const forBoth = (build) => ({ movie: build(MOVIE_GENRES), show: build(SHOW_GENRES) });

/**
 * `<Genre> ◆ 1950 → Present` rows for one row type.
 *
 * Only genres `tmdb-verified.json` recorded as returning titles from 1950 are
 * published, so the card can never contain a row that is always empty.
 */
const decadeGenres = (type, list) =>
  list
    .filter((g) => (VERIFIED.genreDecades?.[type]?.[g]?.count ?? 0) > 0)
    .map((g) => genreDecade(`${g} ◆ 1950 → Present`, g, VERIFIED.genreDecades.from));

const discoverRow = (suffix = "", take) => [
  discover(`Latest${suffix}`, "latest", take),
  discover(`New Release${suffix}`, "new", take),
  preset(`Trending${suffix}`, "trending", take),
  preset(`Popular${suffix}`, "popular", take),
  preset(`Top Rated${suffix}`, "top_rated", take),
];

/**
 * The order Home shows the cards in — explicit, and the single source of truth.
 *
 * The array below is grouped the way the cards were written (all the OTT cards
 * together, all the keyword cards together); this list is what you actually see.
 * The app never reorders or subsets the cards, so the order is the same on every
 * device, in both the Movies and the Shows row, and in Nuvio itself.
 *
 * `based-on-the` sits directly after `runtimes`: the card order is the owner's
 * list, so "Based on the" belongs with the other shape-of-the-title cards (how
 * long it is, what it was made from) rather than down with the keyword cards.
 */
const CARD_ORDER = [
  "watchlist",
  "on-the-board",
  "discover-top-10",
  "discover",
  "popular-by-genre",
  "genres",
  "popular-by-decade",
  "decades",
  "genre-from-decades",
  "continental",
  "countries",
  "runtimes",
  "based-on-the",
  "moods-and-vibes",
  "themes-and-tags",
  "global-ott-top-10",
  "global-ott-popular",
  "global-ott",
  "regional-ott-top-10",
  "regional-ott-popular",
  "regional-ott",
];

/**
 * The whole card set for one country. The regional OTT cards are the only part
 * that depends on it, so this is what the addon rebuilds when the country in
 * Settings changes — a card names the catalogs inside it, and those names are
 * another country's services the moment the setting moves.
 */
const buildCollections = (code) => {
  // The array is written card-group by card-group; `CARD_ORDER` sets the order
  // Home shows them in. The three Watchlist rows are the states a pinned title
  // moves through, served from the stored pins rather than from TMDB; the row
  // after them is the custom one you fill yourself.
  return [
  {
    key: "watchlist",
    lines: ["Watchlist"],
    scene: "watchlist",
    catalogs: both([
      watchlist("Plan to Watch", "planned"),
      watchlist("Watching", "watching"),
      watchlist("Watched", "watched"),
    ]),
  },
  {
    key: "discover-top-10",
    lines: ["Discover", "◆ Top 10"],
    scene: "spotlight-top-10",
    catalogs: both(discoverRow(" ◆ Top 10", TOP10)),
  },
  {
    key: "on-the-board",
    lines: ["On the", "Board"],
    scene: "on-the-board",
    catalogs: {
      movie: [preset("Now Playing", "now_playing")],
      show: [
        preset("Airing Today", "airing_today"),
        preset("Airing This Week", "airing_this_week"),
        preset("On the Air", "on_the_air"),
      ],
    },
  },
  {
    key: "discover",
    lines: ["Discover"],
    scene: "discover",
    catalogs: both(discoverRow()),
  },
  {
    key: "popular-by-genre",
    lines: ["Popular by", "◆ Genre"],
    scene: "popular-by-genre",
    catalogs: forBoth((list) => list.map((g) => genre(`Popular in ${g}`, g, "popular"))),
  },
  {
    key: "genres",
    lines: ["Genres"],
    scene: "genres",
    catalogs: forBoth((list) => list.map((g) => genre(g, g))),
  },
  {
    key: "popular-by-decade",
    lines: ["Popular by", "◆ Decade"],
    scene: "popular-by-decade",
    catalogs: both(ALL_DECADES.map((d) => decade(`Popular in ${d}s`, d, "popular"))),
  },
  {
    key: "decades",
    lines: ["Decades"],
    scene: "decades",
    catalogs: both(ALL_DECADES.map((d) => decade(`${d}s`, d))),
  },
  {
    key: "genre-from-decades",
    lines: ["Genre from", "◆ Decades"],
    scene: "genres-in-or-from-decades",
    // Both rows. TV genres are a different set (no "Science Fiction", but
    // "Sci-Fi & Fantasy"), so each row uses its own verified list — and a
    // combination TMDB has no titles for is not published at all.
    catalogs: {
      movie: decadeGenres("movie", MOVIE_GENRES),
      show: decadeGenres("tv", SHOW_GENRES),
    },
  },

  // Global OTT — Top 10, then Popular, then everything, for each platform.
  {
    key: "global-ott-top-10",
    lines: ["Global OTT", "◆ Top 10"],
    scene: "global-ott-top-10",
    catalogs: both(globalOtt.top10(TOP10)),
  },
  {
    key: "global-ott-popular",
    lines: ["Popular", "Global OTT"],
    scene: "global-ott",
    catalogs: both(globalOtt.popular()),
  },
  {
    key: "global-ott",
    lines: ["Global OTT"],
    scene: "global-ott",
    catalogs: both(globalOtt.all()),
  },

  // Regional OTT — the region's own services: Top 10, Popular, then everything.
  // The three regional cards follow your country, so their covers are title-only
  // (drawing one country's service names would be wrong for every other country).
  {
    key: "regional-ott-top-10",
    lines: ["Regional OTT", "◆ Top 10"],
    scene: "regional-ott-top-10",
    titleOnly: true,
    catalogs: regionalOtt("top10", code),
  },
  {
    key: "regional-ott-popular",
    lines: ["Popular", "Regional OTT"],
    scene: "regional-ott",
    titleOnly: true,
    catalogs: regionalOtt("popular", code),
  },
  {
    key: "regional-ott",
    lines: ["Regional OTT"],
    scene: "regional-ott",
    titleOnly: true,
    catalogs: regionalOtt("all", code),
  },

  {
    key: "continental",
    lines: ["Continental"],
    scene: "continental",
    catalogs: both(Object.entries(CONTINENTS).map(([name, codes]) => continent(name, codes))),
  },
  {
    key: "countries",
    lines: ["Countries"],
    scene: "countries",
    catalogs: {
      movie: countriesFor("movie").map(([name, code]) => country(name, code)),
      show: countriesFor("show").map(([name, code]) => country(name, code)),
    },
  },
  {
    key: "runtimes",
    lines: ["Runtimes"],
    scene: "runtimes",
    // Movies: length buckets. Shows: episode-count buckets instead of runtime.
    catalogs: {
      movie: [runtime("30+ mins", 30), runtime("60+ mins", 60), runtime("90+ mins", 90), runtime("120+ mins", 120)],
      show: [episodes("4 Episodes", 4), episodes("6 Episodes", 6), episodes("8 Episodes", 8), episodes("10 Episodes", 10)],
    },
  },

  {
    key: "based-on-the",
    lines: ["Based", "on the"],
    scene: "based-on-the",
    catalogs: { movie: keywordEntries("based-on-the", "movie"), show: keywordEntries("based-on-the", "show") },
  },
  {
    key: "moods-and-vibes",
    lines: ["Moods", "& Vibes"],
    scene: "moods-and-vibes",
    catalogs: { movie: keywordEntries("moods-and-vibes", "movie"), show: keywordEntries("moods-and-vibes", "show") },
  },
  {
    key: "themes-and-tags",
    lines: ["Themes", "& Tags"],
    scene: "themes-and-tags",
    catalogs: { movie: keywordEntries("themes-and-tags", "movie"), show: keywordEntries("themes-and-tags", "show") },
  },
  ];
};

/**
 * In the published order, with the vertical divider after Watchlist.
 *
 * The divider is a property of the card it sits *before* (the grid draws one when
 * it reaches a card that carries the flag), so it is attached to whatever follows
 * the Watchlist rather than hard-coded on one card that could be reordered away
 * from it. A card the order list does not mention keeps its place at the end
 * instead of vanishing.
 */
const ordered = (cards) => {
  const rank = (c) => {
    const i = CARD_ORDER.indexOf(c.key);
    return i === -1 ? CARD_ORDER.length : i;
  };
  const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
  return sorted.map((c, i) => ({ ...c, divider: i === 1 }));
};

const buildCollectionsOrdered = (code) => ordered(buildCollections(code));

/** Default country's set — what the cover art is generated for. */
export const COLLECTIONS = buildCollectionsOrdered(DEFAULT_COUNTRY);

/** The card set for one country ("US", "IN", …), in the published order. */
export const collectionsFor = (code) =>
  buildCollectionsOrdered(String(code || DEFAULT_COUNTRY).toUpperCase());

export const title = (cat) => cat.lines.join(" ");

/** The catalog entries inside a card for one row ("movie" | "show"). */
export const catalogEntries = (cat, row) => {
  const c = cat.catalogs;
  if (!c) return [];
  const list = Array.isArray(c) ? c : c[row];
  return Array.isArray(list) ? list : [];
};

/** The catalog names inside a card for one row — what the cover shows. */
export const catalogLabels = (cat, row) => catalogEntries(cat, row).map((e) => e.name);

/** The card that should be preceded by a vertical divider in the app. */
export const DIVIDER_BEFORE = "discover-top-10";

/** The subtitle string drawn on the cover (empty for a title-only card). */
export const subtitleOf = (cat, row) => (cat.titleOnly ? "" : catalogLabels(cat, row).join(" · "));
