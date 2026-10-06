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

// The Countries card's list — **every** country and territory TMDB knows, taken
// from its own `/configuration/countries`, with a handful renamed where TMDB uses
// the same name twice (the two Congos) or a historical one.
//
// Nothing here is assumed to have content: `probe-countries.mjs` records each
// country's real title counts, and `countriesFor` publishes only the countries a
// row actually has titles for, so an island with no film industry contributes
// nothing but costs nothing either.
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
  // Added: the second wave, each one screened for having titles on TMDB before it
  // was written down here.
  ["Iceland", "IS"], ["Slovakia", "SK"], ["Slovenia", "SI"], ["Lithuania", "LT"],
  ["Latvia", "LV"], ["Estonia", "EE"], ["Bosnia and Herzegovina", "BA"], ["Albania", "AL"],
  ["North Macedonia", "MK"], ["Malta", "MT"], ["Luxembourg", "LU"], ["Cyprus", "CY"],
  ["Moldova", "MD"], ["Georgia", "GE"], ["Kazakhstan", "KZ"], ["Nepal", "NP"],
  ["Lebanon", "LB"], ["Iraq", "IQ"], ["Jordan", "JO"], ["Kuwait", "KW"],
  ["Qatar", "QA"], ["Venezuela", "VE"], ["Uruguay", "UY"], ["Ecuador", "EC"],
  ["Bolivia", "BO"], ["Paraguay", "PY"], ["Costa Rica", "CR"], ["Panama", "PA"],
  ["Dominican Republic", "DO"], ["Puerto Rico", "PR"], ["Guatemala", "GT"], ["Cuba", "CU"],
  ["Tunisia", "TN"], ["Algeria", "DZ"], ["Senegal", "SN"],
  // Added: everything else TMDB lists. Territories and historical countries are
  // kept too — TMDB carries titles for them (Soviet Union, Czechoslovakia, East
  // Germany), so they are rows like any other when they have something in them.
  ["Afghanistan", "AF"], ["American Samoa", "AS"], ["Andorra", "AD"], ["Angola", "AO"],
  ["Anguilla", "AI"], ["Antarctica", "AQ"], ["Antigua and Barbuda", "AG"], ["Armenia", "AM"],
  ["Aruba", "AW"], ["Azerbaijan", "AZ"], ["Bahamas", "BS"], ["Bahrain", "BH"],
  ["Barbados", "BB"], ["Belarus", "BY"], ["Belize", "BZ"], ["Benin", "BJ"],
  ["Bermuda", "BM"], ["Bhutan", "BT"], ["Botswana", "BW"], ["Bouvet Island", "BV"],
  ["British Indian Ocean Territory", "IO"], ["British Virgin Islands", "VG"], ["Brunei Darussalam", "BN"], ["Burkina Faso", "BF"],
  ["Burma", "BU"], ["Burundi", "BI"], ["Cambodia", "KH"], ["Cameroon", "CM"],
  ["Cape Verde", "CV"], ["Cayman Islands", "KY"], ["Central African Republic", "CF"], ["Chad", "TD"],
  ["Christmas Island", "CX"], ["Cocos  Islands", "CC"], ["Comoros", "KM"], ["Congo (DRC)", "CD"],
  ["Congo (Republic)", "CG"], ["Cook Islands", "CK"], ["Cote D'Ivoire", "CI"], ["Czechoslovakia", "XC"],
  ["Djibouti", "DJ"], ["Dominica", "DM"], ["East Germany", "XG"], ["East Timor", "TP"],
  ["El Salvador", "SV"], ["Equatorial Guinea", "GQ"], ["Eritrea", "ER"], ["Ethiopia", "ET"],
  ["Faeroe Islands", "FO"], ["Falkland Islands", "FK"], ["Fiji", "FJ"], ["French Guiana", "GF"],
  ["French Polynesia", "PF"], ["French Southern Territories", "TF"], ["Gabon", "GA"], ["Gambia", "GM"],
  ["Gibraltar", "GI"], ["Greenland", "GL"], ["Grenada", "GD"], ["Guadaloupe", "GP"],
  ["Guam", "GU"], ["Guinea", "GN"], ["Guinea-Bissau", "GW"], ["Guyana", "GY"],
  ["Haiti", "HT"], ["Heard and McDonald Islands", "HM"], ["Holy See", "VA"], ["Honduras", "HN"],
  ["Iran", "IR"], ["Jamaica", "JM"], ["Kiribati", "KI"], ["Kosovo", "XK"],
  ["Kyrgyz Republic", "KG"], ["Lao People's Democratic Republic", "LA"], ["Lesotho", "LS"], ["Liberia", "LR"],
  ["Libyan Arab Jamahiriya", "LY"], ["Liechtenstein", "LI"], ["Macao", "MO"], ["Madagascar", "MG"],
  ["Malawi", "MW"], ["Maldives", "MV"], ["Mali", "ML"], ["Marshall Islands", "MH"],
  ["Martinique", "MQ"], ["Mauritania", "MR"], ["Mauritius", "MU"], ["Mayotte", "YT"],
  ["Micronesia", "FM"], ["Monaco", "MC"], ["Mongolia", "MN"], ["Montenegro", "ME"],
  ["Montserrat", "MS"], ["Mozambique", "MZ"], ["Myanmar", "MM"], ["Namibia", "NA"],
  ["Nauru", "NR"], ["Netherlands Antilles", "AN"], ["New Caledonia", "NC"], ["Nicaragua", "NI"],
  ["Niger", "NE"], ["Niue", "NU"], ["Norfolk Island", "NF"], ["North Korea", "KP"],
  ["Northern Ireland", "XI"], ["Northern Mariana Islands", "MP"], ["Oman", "OM"], ["Palau", "PW"],
  ["Palestinian Territory", "PS"], ["Papua New Guinea", "PG"], ["Pitcairn Island", "PN"], ["Reunion", "RE"],
  ["Rwanda", "RW"], ["Samoa", "WS"], ["San Marino", "SM"], ["Sao Tome and Principe", "ST"],
  ["Serbia and Montenegro", "CS"], ["Seychelles", "SC"], ["Sierra Leone", "SL"], ["Solomon Islands", "SB"],
  ["Somalia", "SO"], ["South Georgia and the South Sandwich Islands", "GS"], ["South Sudan", "SS"], ["Soviet Union", "SU"],
  ["St. Helena", "SH"], ["St. Kitts and Nevis", "KN"], ["St. Lucia", "LC"], ["St. Pierre and Miquelon", "PM"],
  ["St. Vincent and the Grenadines", "VC"], ["Sudan", "SD"], ["Suriname", "SR"], ["Svalbard & Jan Mayen Islands", "SJ"],
  ["Swaziland", "SZ"], ["Syrian Arab Republic", "SY"], ["Tajikistan", "TJ"], ["Tanzania", "TZ"],
  ["Timor-Leste", "TL"], ["Togo", "TG"], ["Tokelau", "TK"], ["Tonga", "TO"],
  ["Trinidad and Tobago", "TT"], ["Turkmenistan", "TM"], ["Turks and Caicos Islands", "TC"], ["Tuvalu", "TV"],
  ["Uganda", "UG"], ["United States Minor Outlying Islands", "UM"], ["US Virgin Islands", "VI"], ["Uzbekistan", "UZ"],
  ["Vanuatu", "VU"], ["Wallis and Futuna Islands", "WF"], ["Western Sahara", "EH"], ["Yemen", "YE"],
  ["Yugoslavia", "YU"], ["Zaire", "ZR"], ["Zambia", "ZM"], ["Zimbabwe", "ZW"],
];

// The three Global OTT cards publish **six** platforms: the ones they were built
// with. Hulu is a US service and was never one of them.
//
// A platform the probe verifies later stays in `PLATFORMS` — the fact list the probe
// writes and the selftest checks — but does **not** become a seventh global row, so
// the cards keep the composition they were designed around.
export const GLOBAL_PLATFORMS = ["Netflix", "Prime Video", "Disney+", "Max", "Apple TV+", "Paramount+"];

/** Those six, resolved against the verified facts — [label, TMDB provider id]. */
export const GLOBAL_OTT = GLOBAL_PLATFORMS.map((label) => {
  const hit = VERIFIED.platforms.find((p) => p.id && p.label === label);
  return hit ? [hit.label, hit.id] : null;
}).filter(Boolean);

// Crunchyroll and Rakuten Viki are the two Asian-catalogue services, and they belong
// to the **Regional OTT** rows (added for every country, see `WORLDWIDE` below)
// rather than to the Global OTT set — one service, one card family, never both.
const ASIAN_ONLY = new Set(["Crunchyroll", "Viki"]);

/**
 * Every global platform the facts hold — [label, TMDB provider id].
 *
 * `probe-tmdb.mjs` verifies these and `probe-platforms.mjs` appends newly verified
 * ones. The *cards* draw from `GLOBAL_OTT`, not from this list.
 */
export const PLATFORMS = VERIFIED.platforms
  .filter((p) => p.id && !ASIAN_ONLY.has(p.label))
  .map((p) => [p.label, p.id]);

export const DECADES = ALL_DECADES;

/** Up to `LOCAL_LIMIT` local OTT services per region, verified to return titles. */
export const LOCAL_LIMIT = 8;
const localFor = (region, type) => (VERIFIED.regions[region]?.[type] ?? []).slice(0, LOCAL_LIMIT);

/**
 * The regional OTT data's own region labels, by ISO code.
 *
 * `tmdb-verified.json` records every region under its name *and* carries the code on
 * the entry itself, so the Regional OTT cards resolve a code straight out of the
 * regional OTT data. They used to resolve it through the Countries card's label list,
 * which made one card family depend on another card's list — and a region the
 * regional OTT data held but that list did not would have had no rows at all.
 */
const REGION_NAMES = new Map(
  Object.entries(VERIFIED.regions).map(([name, entry]) => [String(entry.code || "").toUpperCase(), name]),
);

/** The regional OTT data's name for an ISO code ("" when it holds none). */
export const regionName = (code) => REGION_NAMES.get(String(code || "").toUpperCase()) || "";

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
  const local = localFor(regionName(code), type);
  const seen = new Set(local.map((s) => s.id));
  return [...local, ...WORLDWIDE.filter((s) => !seen.has(s.id))];
};

/**
 * The regions the regional OTT data actually holds services for — its own list, not
 * the Countries card's, so the Regional OTT cards follow the regional OTT labels.
 */
export const OTT_REGIONS = Object.entries(VERIFIED.regions)
  .filter(([, entry]) => entry.movie?.length || entry.tv?.length)
  .map(([name, entry]) => [name, String(entry.code || "").toUpperCase()])
  .sort((a, b) => a[0].localeCompare(b[0]));

/**
 * Every regional OTT service the facts hold — one entry per provider id, in name
 * order, each carrying the region it was verified in.
 *
 * This is what the three Regional OTT cards publish: the regional OTT data itself
 * (78 services), not one country's slice of it (five rows). Two regions listing the
 * same service — Tubi TV is verified in more than one — is one row, scoped to a
 * region where it really resolves, so the catalog it opens is a real one rather than
 * an empty duplicate. Crunchyroll and Viki are not in the regional data (they are the
 * two Asian-catalogue services), so they are appended region-less and
 * `activeRegion()` scopes them per request.
 */
export const REGIONAL_SERVICES = (type) => {
  const byId = new Map();
  for (const entry of Object.values(VERIFIED.regions)) {
    for (const svc of entry[type] || []) {
      if (!byId.has(svc.id)) {
        byId.set(svc.id, { id: svc.id, name: svc.name, region: String(entry.code || "").toUpperCase() });
      }
    }
  }
  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set(list.map((s) => s.id));
  return [...list, ...WORLDWIDE.filter((s) => !seen.has(s.id))];
};

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
// A **range**, not a floor: a bare `with_runtime.gte` made "30+ mins" and
// "180+ mins" both open on the same popular films, so every bucket looked like
// the last one. Each step ends where the next begins.
const runtime = (name, min, max) => ({ name, kind: "runtime", min, max });
// Episode buckets are disjoint ranges for the same reason — see `episodes` below.
const episodes = (name, min, max) => ({ name, kind: "episodes", min, max });
// **More like what you watch** — the row is built from TMDB's own recommendations
// for the titles in your Watchlist, resolved on the server (see `addon/catalogs.mjs`).
const recommend = (name) => ({ name, kind: "recommend" });
const keyword = (name, id, take) => ({ name, kind: "keyword", id, take });
// A **custom** row: served from the titles you put in it (`addon/customrows.mjs`),
// keyed by the row id so its contents survive a rename of its label.
const customRow = (name, row) => ({ name, kind: "custom", row });
const provider = (name, providerId, region, take) => ({ name, kind: "provider", providerId, region, take });
/** A platform's own studio's originals — a company, not a catalog of one. */
const original = (name, studio, take) => ({ name, kind: "original", studio: studio || null, take });

/**
 * The studio behind a platform's Originals rows, from `tmdb-verified.json`.
 *
 * `probe-originals.mjs` looks each platform's company up against TMDB and keeps
 * only candidates that really return titles, so a `<Platform> Originals` row is
 * never an empty invention.
 */
const ORIGINALS = VERIFIED.originals || {};
const watchlist = (name, state) => ({ name, kind: "watchlist", state });

/**
 * Keyword entries for one card, straight from the verified table.
 * Only labels that actually have titles for this row are published — otherwise
 * the row exists but always comes back empty.
 */
// Labels that live in the verified ``table but are *not* themes: **Documentary**
// is a genre, and **Anime** / **Asian Drama** are whole catalogues with their own
// **Genres** card. They are skipped wherever a theme list is built.
const KEYWORD_NOT_A_THEME = new Set(["Documentary", "Anime", "Asian Drama"]);

/**
 * The floor a keyword row must clear to be published.
 *
 * The verified table records how many titles each keyword actually returns. A few
 * labels clear zero and were already dropped; many more clear one or two, which is
 * what made **Moods & Vibes** read as "very less contents" — a card of names opening
 * onto a single title. Rows under this many titles are not published at all, so the
 * card holds fewer, fuller rows. **Awards** is exempt: its ceremonies are genuinely
 * small on TMDB, and the card is meant to name them.
 */
const MIN_KEYWORD_TITLES = 8;

const keywordEntries = (group, type, take) =>
  Object.entries(KW[group] ?? {})
    .filter(([name]) => !KEYWORD_NOT_A_THEME.has(name))
    .filter(([, k]) => (type === "movie" ? k.movieCount : k.tvCount) >= (group === "awards" ? 1 : MIN_KEYWORD_TITLES))
    .map(([name, k]) => keyword(name, k.id, take));

/**
 * Named keyword rows out of a group — for a card that publishes a few verified
 * labels rather than the whole group.
 */
const keywordPick = (group, names, type, take) =>
  names
    .filter((name) => KW[group]?.[name])
    .filter((name) => (type === "movie" ? KW[group][name].movieCount : KW[group][name].tvCount) > 0)
    .map((name) => keyword(name, KW[group][name].id, take));

/** Countries that actually have titles for this row (Ghana has films, no series). */
const countriesFor = (type) =>
  COUNTRIES.filter(([name]) => {
    const c = VERIFIED.countries[name];
    return (type === "movie" ? c?.movieCount : c?.tvCount) > 0;
  });

/**
 * Global OTT rows: Top 10, Popular, then everything — for the six `GLOBAL_OTT`
 * platforms.
 *
 * Only the ◆ Top 10 rows are capped. `Popular`/`everything` used to carry a
 * `take` of 30/40, which made an OTT card the one place in the app whose rows
 * stopped after a couple of screens while every other card kept scrolling — the
 * reported "OTT cards don't scroll" bug. They are uncapped now.
 */
const globalOtt = {
  top10: (take) => GLOBAL_OTT.map(([label, id]) => provider(`${label} ◆ Top 10`, id, null, take)),
  popular: () => GLOBAL_OTT.map(([label, id]) => provider(`Popular ${label}`, id, null)),
  // Each platform, then that platform's own studio's originals — the row the
  // request asked for, directly after the platform's row.
  all: () =>
    GLOBAL_OTT.flatMap(([label, id]) => {
      const rows = [provider(label, id, null)];
      if (ORIGINALS[label]) rows.push(original(`${label} Originals`, ORIGINALS[label]));
      return rows;
    }),
};

/**
 * Regional OTT rows for **one** country — the country you are in.
 *
 * These cards used to publish every region's services (107 rows per card, most of
 * them unwatchable from where you are). The country setting picks one, so a card
 * now holds that country's services — up to `LOCAL_LIMIT` per row type — and each
 * row is scoped to that country's region.
 */
function regionalOtt(kind) {
  const build = (type) => {
    const services = REGIONAL_SERVICES(type);
    // Two services could share a name; disambiguate so two rows can never collide on
    // the same catalog id.
    const nameCount = new Map();
    for (const svc of services) nameCount.set(svc.name, (nameCount.get(svc.name) || 0) + 1);
    const label = (svc) => (nameCount.get(svc.name) > 1 ? `${svc.name} (${svc.id})` : svc.name);
    return services.map((svc) => {
      // The row carries its own region: this is what makes one service row usable
      // from the region it was verified in instead of one country's five.
      const region = svc.region || null;
      if (kind === "top10") return provider(`${label(svc)} ◆ Top 10`, svc.id, region, TOP10);
      if (kind === "popular") return provider(`Popular ${label(svc)}`, svc.id, region);
      return provider(label(svc), svc.id, region);
    });
  };
  return { movie: build("movie"), show: build("tv") };
}

const TOP10 = 10;
// The Discover card publishes 25 titles per row rather than 10, so it is the one
// "top of the pile" card that is worth scrolling. Its card key stays
// `discover-top-10` — that is the cover's filename and the divider anchor.
const TOP25 = 25;
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
  discover(`Newest${suffix}`, "new", take),
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
  "for-you",
  "discover-top-10",
  "discover",
  "popular-by-genre",
  "top-rated-by-genre",
  "genres",
  "popular-by-decade",
  "top-rated-by-decade",
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
  "custom",
];

/**
 * The whole card set for one country. The regional OTT cards are the only part
 * that depends on it, so this is what the addon rebuilds when the country in
 * Settings changes — a card names the catalogs inside it, and those names are
 * another country's services the moment the setting moves.
 */
const buildCollections = () => {
  // The array is written card-group by card-group; `CARD_ORDER` sets the order
  // Home shows them in. The three Watchlist rows are the states a pinned title
  // moves through, served from the stored pins rather than from TMDB; the row
  // after them is the custom one you fill yourself.
  return [
  {
    key: "watchlist",
    lines: ["Watchlist"],
    scene: "watchlist",
    // **Watching first**, then a horizontal rule, then Plan to Watch and Watched:
    // what you are on now sits above what is queued and what is finished, and the
    // rule is the boundary. `divider` rides on the entry, so the app draws the rule
    // before that one row on the card page.
    catalogs: both([
      watchlist("Watching", "watching"),
      { ...watchlist("Plan to Watch", "planned"), divider: true },
      watchlist("Watched", "watched"),
    ]),
  },
  {
    key: "for-you",
    lines: ["For", "You"],
    scene: "watchlist",
    // **More like what you watch**: one row drawn from TMDB's own recommendations
    // for the titles in your Watchlist — watched first, then watching, then planned.
    catalogs: both([recommend("More Like What You Watch")]),
  },
  {
    key: "discover-top-10",
    lines: ["Discover", "◆ Top 25"],
    scene: "spotlight-top-10",
    catalogs: both(discoverRow(" ◆ Top 25", TOP25)),
  },
  {
    key: "on-the-board",
    lines: ["On the", "Board"],
    scene: "on-the-board",
    // **Not a card on Home any more**: the hero banner already carries these rows
    // (Now Playing / On the Air) on its left-hand side, so the card is kept for the
    // banner to source but is not drawn in the grid.
    hidden: true,
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
    // The genres, and only the genres. **Anime** and **Asian Drama** are keywords,
    // not genres, so they are not rows here either — they were never asked for as
    // a card, and they are not a genre row. The cards that genuinely hold that
    // content carry it already (Japan in Countries, Crunchyroll and Viki on the
    // OTT cards), and both stay out of Themes & Tags.
    catalogs: {
      movie: MOVIE_GENRES.map((g) => genre(g, g)),
      show: SHOW_GENRES.map((g) => genre(g, g)),
    },
  },
  {
    key: "top-rated-by-genre",
    lines: ["Top Rated", "◆ Genre"],
    // The cover generator paints one scene per `scene` name; a new card reuses an
    // existing painter rather than shipping with no artwork.
    scene: "popular-by-genre",
    catalogs: forBoth((list) => list.map((g) => genre(`Top Rated in ${g}`, g, "top_rated"))),
  },
  {
    key: "popular-by-decade",
    lines: ["Popular by", "◆ Decade"],
    scene: "popular-by-decade",
    catalogs: both(ALL_DECADES.map((d) => decade(`Popular in ${d}s`, d, "popular"))),
  },
  {
    key: "top-rated-by-decade",
    lines: ["Top Rated", "◆ Decade"],
    scene: "popular-by-decade",
    catalogs: both(ALL_DECADES.map((d) => decade(`Top Rated in ${d}s`, d, "top_rated"))),
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

  // Regional OTT — every region's own services: Top 10, Popular, then everything.
  // The rows are the regional OTT data itself, one per service, each scoped to a
  // region where it resolves, so the card is the same everywhere and does not shrink
  // to one country's handful. Covers stay title-only: drawing service names would be
  // wrong for every region the card now covers.
  {
    key: "regional-ott-top-10",
    lines: ["Regional OTT", "◆ Top 10"],
    scene: "regional-ott-top-10",
    titleOnly: true,
    catalogs: regionalOtt("top10"),
  },
  {
    key: "regional-ott-popular",
    lines: ["Popular", "Regional OTT"],
    scene: "regional-ott",
    titleOnly: true,
    catalogs: regionalOtt("popular"),
  },
  {
    key: "regional-ott",
    lines: ["Regional OTT"],
    scene: "regional-ott",
    titleOnly: true,
    catalogs: regionalOtt("all"),
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
    // Shows are not measured in minutes: on the Shows row the same card is its
    // episode-count ladder, so it says **Episodes** there.
    linesByRow: { show: ["Episodes"] },
    scene: "runtimes",
    // Movies: length buckets. Shows: episode-count buckets instead of runtime.
    catalogs: {
      // Longer ladders than the old three-step version: runtime is a real TMDB
      // filter, so every bucket is a row of its own.
      movie: [
        runtime("30–44 mins", 30, 44), runtime("45–59 mins", 45, 59),
        runtime("60–74 mins", 60, 74), runtime("75–89 mins", 75, 89),
        runtime("90–104 mins", 90, 104), runtime("105–119 mins", 105, 119),
        runtime("120–149 mins", 120, 149), runtime("150–179 mins", 150, 179),
        runtime("180+ mins", 180),
      ],
      show: [
        episodes("4 Episodes", 1, 4), episodes("6 Episodes", 5, 6),
        episodes("8 Episodes", 7, 8), episodes("10 Episodes", 9, 10),
        episodes("12 Episodes", 11, 12), episodes("16 Episodes", 13, 16),
        episodes("20 Episodes", 17, 20), episodes("24 Episodes", 21, 24),
      ],
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
  // The **Custom** card: your own list. Its label is a setting (`customLabel`),
  // applied where the cards are served, so this card's name is whatever you called
  // it and its row is filled from `addon/customrows.json`.
  {
    key: "custom",
    lines: ["Custom"],
    scene: "on-the-board",
    catalogs: { movie: [customRow("My List", "add-cards")], show: [customRow("My List", "add-cards")] },
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
  // The rule sits before the **first card after Watchlist that Home actually
  // draws**: a hidden card (the banner's own source) cannot carry it, or the rule
  // would disappear along with the card it was attached to.
  const firstDrawn = sorted.findIndex((c, i) => i > 0 && !c.hidden);
  return sorted.map((c, i) => ({ ...c, divider: i === firstDrawn }));
};

const buildCollectionsOrdered = () => ordered(buildCollections());

/** The card set, in the published order. */
export const COLLECTIONS = buildCollectionsOrdered();

/**
 * The card set, in the published order.
 *
 * It no longer varies by country: the three Regional OTT cards publish the regional
 * OTT data itself, each row carrying its own region, so there is one card set for
 * every country. The country argument is still accepted — the addon uses it as its
 * per-country defs cache key — and deliberately ignored; what a request still scopes
 * by region are the rows with no region of their own, which `activeRegion()` resolves
 * per request in `addon/catalogs.mjs`.
 */
export const collectionsFor = (_code) => buildCollectionsOrdered();

/**
 * A card's name, **for one row** where the two differ.
 *
 * The Runtimes card is about minutes on Movies and about episode counts on Shows,
 * so it wears a different name on each row (`linesByRow`) instead of one title that
 * is only true half the time. Every other card falls back to its `lines`.
 */
export const title = (cat, row) => (cat.linesByRow?.[row] ?? cat.lines).join(" ");

/** The catalog entries inside a card for one row ("movie" | "show"). */
export const catalogEntries = (cat, row) => {
  const c = cat.catalogs;
  if (!c) return [];
  const list = Array.isArray(c) ? c : c[row];
  return Array.isArray(list) ? list : [];
};

/** The catalog names inside a card for one row — what the cover shows. */
export const catalogLabels = (cat, row) => catalogEntries(cat, row).map((e) => e.name);

/**
 * The verified keyword rows of a group as `[label, id]` — the vocabulary the
 * search panel's Mood and Theme filters are built from, so those rows offer the
 * same names the cards do and never a keyword TMDB does not have.
 */
export const keywordVocab = (group) =>
  Object.entries(KW[group] ?? {})
    .filter(([name]) => !KEYWORD_NOT_A_THEME.has(name))
    .map(([name, k]) => [name, k.id]);

/**
 * Every country that really has titles, as `[code, name]` — the search panel's
 * Country filter. A territory with nothing in it is not offered, so choosing one
 * can never produce an empty screen.
 */
export const countryVocab = () =>
  COUNTRIES.filter(([name]) => {
    const c = VERIFIED.countries?.[name];
    return (c?.movieCount || 0) > 0 || (c?.tvCount || 0) > 0;
  }).map(([name, code]) => [code, name]);

/** The card that should be preceded by a vertical divider in the app. */
export const DIVIDER_BEFORE = "discover-top-10";

/** The subtitle string drawn on the cover (empty for a title-only card). */
export const subtitleOf = (cat, row) => (cat.titleOnly ? "" : catalogLabels(cat, row).join(" · "));
