/**
 * The catalog plan — turns each structured catalog entry in
 * `scripts/collections.mjs` into the TMDB queries that back a row.
 *
 * A card publishes one row per entry it declares, so the cover names and the
 * rows are always the same list. Cards with no entries publish nothing.
 *
 * Only the `catalog` resource is advertised — no search, no discover resource.
 */
import { collectionsFor, catalogEntries } from "../scripts/collections.mjs";
import { genres, resolveGenre, tmdbPath } from "./tmdb.mjs";
import { activeCountry } from "./settings.mjs";
import { list as watchlistState } from "./watchlist.mjs";

export const CATALOG_ID_PREFIX = "nuvio-";

/**
 * The region the OTT rows are scoped to — the country set in Settings.
 *
 * It is read per request rather than captured at import: the three regional cards
 * name *your* country's services, so moving the setting has to move the rows.
 */
export const activeRegion = () => activeCountry();

const iso = (d) => d.toISOString().slice(0, 10);
const dateField = (media) => (media === "movie" ? "primary_release_date" : "first_air_date");

/** A single TMDB query: where to fetch, what filters, how many items to keep. */
const q = (path, params, take) => ({ path, params, take });

/* ------------------------------------------------------------------ specs */

// `take` is only set where the name implies a fixed size (the ◆ Top 10 rows).
// Without it a row is uncapped, so the app can keep scrolling it — a hard
// default here is what left every row with 20–30 titles.
function presetSpecs(value, media, take, adult = false) {
  const t = tmdbPath(media);
  const tr = (path, params, n) => q(path, adult ? { ...params, include_adult: true } : params, n);
  switch (value) {
    case "trending": return [q(`/trending/${t}/week`, {}, take)];
    case "popular": return [q(`/${t}/popular`, {}, take)];
    case "top_rated": return [q(`/${t}/top_rated`, {}, take)];
    // The /now_playing, /airing_today and /on_the_air endpoints take no
    // include_adult parameter, so the SFW/NSFW switch cannot apply to them.
    case "now_playing": return [q("/movie/now_playing", {}, take)];
    case "airing_today": return [q("/tv/airing_today", {}, take)];
    case "on_the_air": return [tr("/tv/on_the_air", {}, take)];
    case "airing_this_week": {
      const now = new Date();
      const week = new Date(now.getTime() + 7 * 864e5);
      return [
        tr(`/discover/${t}`, {
          "first_air_date.gte": iso(now),
          "first_air_date.lte": iso(week),
          sort_by: "popularity.desc",
          "vote_count.gte": 1,
        }, take),
      ];
    }
    default: return [];
  }
}

/**
 * TMDB queries backing one catalog entry (async: genre names resolve live).
 *
 * `opts.adult` is the SFW/NSFW switch from the app's settings; TMDB defaults to
 * excluding adult titles, so it is only ever set to true.
 */
async function specsFor(entry, media, opts = {}) {
  const t = tmdbPath(media);
  const adult = opts.adult ? { include_adult: true } : {};
  // No `page` here on purpose: the paging pool supplies the page number, and
  // hard-coding page 1 is exactly what stopped rows from going past 20 titles.
  const page = (params, take) => q(`/discover/${t}`, { ...params, ...adult }, take);
  const range = (decade) => ({
    [`${dateField(media)}.gte`]: `${decade}-01-01`,
    [`${dateField(media)}.lte`]: `${decade + 9}-12-31`,
  });

  switch (entry.kind) {
    case "preset":
      return presetSpecs(entry.value, media, entry.take, opts.adult);

    case "discover":
      if (entry.value === "latest") {
        return [page({ sort_by: `${dateField(media)}.desc`, "vote_count.gte": 5 }, entry.take)];
      }
      return [page({ [`${dateField(media)}.gte`]: iso(new Date(Date.now() - 60 * 864e5)), sort_by: "popularity.desc", "vote_count.gte": 5 }, entry.take)];

    case "genre": {
      const id = await resolveGenre(media, entry.genre);
      if (!id) return [];
      return [page({ with_genres: id, sort_by: entry.sort === "popular" ? "popularity.desc" : "vote_count.desc", "vote_count.gte": 20 }, entry.take)];
    }

    case "decade":
      return [
        page({
          ...range(entry.decade),
          sort_by: entry.sort === "popular" ? "popularity.desc" : "vote_count.desc",
          "vote_count.gte": entry.sort === "popular" ? 20 : 0,
        }, entry.take),
      ];

    case "genre-decade": {
      const id = await resolveGenre(media, entry.genre);
      if (!id) return [];
      return [page({ with_genres: id, [`${dateField(media)}.gte`]: `${entry.from}-01-01`, sort_by: "popularity.desc", "vote_count.gte": 20 }, entry.take)];
    }

    case "continent":
      return [page({ with_origin_country: entry.codes.join("|"), sort_by: "popularity.desc", "vote_count.gte": 20 }, entry.take)];

    // A low vote floor: TMDB has very little for small industries (Ghana, Kenya),
    // and a high floor emptied those rows entirely.
    case "country":
      return [page({ with_origin_country: entry.code, sort_by: "popularity.desc", "vote_count.gte": 5 }, entry.take)];

    // A length **bucket**: floor and ceiling both, so "30–44 mins" is a row of
    // short films rather than "every popular film over half an hour", which is
    // what every other bucket already was.
    case "runtime": {
      const params = { "with_runtime.gte": entry.min, sort_by: "popularity.desc", "vote_count.gte": 20 };
      if (Number.isFinite(entry.max)) params["with_runtime.lte"] = entry.max;
      return [page(params, entry.take)];
    }

    // **More like what you watch**: TMDB's own recommendation list for each title
    // in your Watchlist — the ones you have finished first, then what you are on,
    // then what you planned — merged into one row by the paging pool. Nothing
    // pinned yet falls back to what is trending, so the card is never empty.
    case "recommend": {
      // A **For You** row carries the title it was built for: the row is that one
      // title's own recommendations.
      if (entry.seed) return [q(`/${t}/${entry.seed.id}/recommendations`, {}, entry.take)];
      const pinned = ["watched", "watching", "planned"]
        .flatMap((state) => watchlistState(state))
        .filter((i) => (media === "movie" ? i.type === "movie" : i.type === "series"))
        .map(tmdbIdOf)
        .filter((id) => /^\d+$/.test(id));
      if (!pinned.length) return [q(`/trending/${t}/week`, {}, entry.take)];
      return pinned.map((id) => q(`/${t}/${id}/recommendations`, {}, entry.take));
    }

    // Episode counts cannot be filtered by TMDB discover — the handler builds this
    // row from a pool of shows, keeping those whose count falls inside the bucket.
    // The bucket is a **range** (`min`..`max`), so the 4-episode row and the
    // 24-episode row can never open on the same titles.
    case "episodes":
      return [{ episodes: { min: Number.isFinite(entry.min) ? entry.min : 1, max: Number.isFinite(entry.max) ? entry.max : Infinity } }];

    // Keyword cards ("Books", "Zombie", …). The id is baked in from
    // `tmdb-verified.json` rather than searched at request time: TMDB's keyword
    // search is fuzzy and would answer "based on novel" with "based on visual
    // novel".
    case "keyword":
      // No vote floor: TMDB's keyword supply is thin ("epic" has only a handful
      // of titles with 10+ votes), and a floor left those rows nearly empty.
      // Popularity ordering keeps the recognisable titles at the front.
      return [page({ with_keywords: String(entry.id), sort_by: "popularity.desc", "vote_count.gte": 0 }, entry.take)];

    // An OTT service: a global platform (region = the configured one) or a
    // region's own service (JioHotstar in IN, Stan in AU, …).
    case "provider":
      return [
        page({
          with_watch_providers: entry.providerId,
          watch_region: entry.region || activeRegion(),
          with_watch_monetization_types: "flatrate",
          sort_by: "popularity.desc",
          "vote_count.gte": 10,
        }, entry.take),
      ];

    // A platform's originals: the titles its own studio made. TMDB has no network
    // search endpoint, so a company id is the handle that works for both row
    // types — `probe-originals.mjs` stores one per type where the platform uses
    // two studios (Disney's films come from Walt Disney Pictures, its shows from
    // Walt Disney Television).
    case "original": {
      const studio = entry.studio || {};
      const pick = media === "movie" ? studio.company || studio.tv : studio.tv || studio.company;
      if (!pick) return [];
      return [
        page({
          with_companies: pick.id,
          sort_by: "popularity.desc",
          "vote_count.gte": 10,
        }, entry.take),
      ];
    }

    // The watchlist is not a TMDB query: the handler serves it from the pins the
    // user stored, one row per state. It is still a catalog, so it publishes,
    // scrolls and shuffles like every other row.
    case "watchlist":
      return [{ watchlist: entry.state || "planned" }];

    // A custom row — the one you fill yourself. Same deal: served from the
    // stored titles, not from TMDB, but published and paged as a normal row.
    case "custom":
      return [{ custom: entry.row || "add-cards" }];

    default:
      return [];
  }
}

/**
 * The specs for one entry, with the request's language applied to every query.
 *
 * `opts.language` overrides the Settings language for this one request, so the
 * same catalog can be asked for in two languages at once — and a language switch
 * changes the URL, so it is never answered out of the browser cache. TMDB's own
 * response cache is keyed on the language, so two languages never share a page.
 */
export async function catalogSpecs(entry, media, opts = {}) {
  const specs = await specsFor(entry, media, opts);
  if (!opts.language) return specs;
  return specs.map((s) => (s.params ? { ...s, params: { ...s.params, language: opts.language } } : s));
}

/* ----------------------------------------------------------- catalog defs */

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function buildCatalogDefs(collections) {
  const defs = [];
  const recommendCards = [];
  for (const c of collections) {
    let wantsRecommend = false;
    for (const type of ["movie", "series"]) {
      for (const entry of catalogEntries(c, type === "movie" ? "movie" : "show")) {
        // The **For You** rows are built from your Watchlist — one row per title
        // you watched — so they cannot live in the cached static list. The card is
        // noted here and expanded per request (see `catalogDefs`).
        if (entry.kind === "recommend") {
          wantsRecommend = true;
          continue;
        }
        // A region-scoped service id carries its region, so two regions can never
        // collide on the same service name.
        const region = entry.region ? `-${String(entry.region).toLowerCase()}` : "";
        defs.push({
          id: `${CATALOG_ID_PREFIX}${c.key}--${slug(entry.name)}${region}`,
          type,
          key: c.key,
          entry,
          name: entry.name,
        });
      }
    }
    if (wantsRecommend) recommendCards.push(c);
  }
  return { defs, recommendCards };
}

/**
 * The titles the For You rows are built from: **watched first**, then what you are
 * on, then what you planned. One row per title, named after it.
 */
/**
 * A pinned title's numeric TMDB id.
 *
 * Pins are stored with the app's own namespaced id (`tmdb:73223`), which is what
 * the watchlist row and the title modal key on — so the numeric id the TMDB
 * endpoint needs has to be read out of it. Comparing the raw id against `/^\d+$/`
 * is what kept every For You row on its trending fallback: no pin ever matched.
 */
const tmdbIdOf = (item) => String(item?.id || "").replace(/^tmdb:/, "");

function recommendSeeds(type) {
  const seen = new Set();
  const out = [];
  for (const state of ["watched", "watching", "planned"]) {
    for (const item of watchlistState(state)) {
      const id = tmdbIdOf(item);
      if (item?.type !== type || !/^\d+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(item.name || "this title") });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/**
 * Whether the For You card has anything to be about.
 *
 * The card is a promise about *you* — "more like what you watch". With an empty
 * watchlist there is nothing to be like, so the card is not published at all
 * instead of being filled with trending titles that have nothing to do with anyone.
 */
export const hasRecommendSeeds = () => Boolean(recommendSeeds("movie").length || recommendSeeds("series").length);

const defsCache = new Map();

/**
 * Every catalog row the addon publishes for one country (movie + series).
 *
 * The static list is memoised per country — the regional OTT rows carry their
 * region in the id, so two countries never collide on the same catalog — but the
 * **For You** rows are rebuilt on every call: a title you just watched has to get
 * its own row without restarting the server.
 */
export function catalogDefs(code = activeCountry()) {
  const key = String(code || "US").toUpperCase();
  if (!defsCache.has(key)) defsCache.set(key, buildCatalogDefs(collectionsFor(key)));
  const { defs, recommendCards } = defsCache.get(key);
  if (!recommendCards.length) return defs;
  // Nothing pinned, nothing to say: the For You rows are not published and the
  // card itself is hidden (see `collectionsPayload`).
  if (!hasRecommendSeeds()) return defs;
  return [
    ...defs,
    ...recommendCards.flatMap((c) => {
      const rows = [];
      // **Per row type**, not per card: a watchlist holding only shows must still
      // leave the Movies row standing. Deciding this once for the whole card made
      // the Movies row vanish as soon as a single show was pinned.
      for (const type of ["movie", "series"]) {
        const seeds = recommendSeeds(type);
        if (seeds.length) {
          for (const seed of seeds) {
            rows.push({
              id: `${CATALOG_ID_PREFIX}${c.key}--${type}--${seed.id}`,
              type,
              key: c.key,
              entry: { kind: "recommend", seed },
              name: `More Like ${seed.name}`,
            });
          }
        } else {
          // Nothing pinned on this row yet: keep one row so the card is not empty —
          // it falls back to what is trending (see the `recommend` case in `specsFor`).
          const entry = catalogEntries(c, type === "movie" ? "movie" : "show").find((e) => e.kind === "recommend");
          if (entry) rows.push({ id: `${CATALOG_ID_PREFIX}${c.key}--${slug(entry.name)}`, type, key: c.key, entry, name: entry.name });
        }
      }
      return rows;
    }),
  ];
}

// Stremio identifies a catalog by (type, id) — the same id is used for the movie
// and series variants, so lookups must match on both.
export const findCatalog = (id, type) => catalogDefs().find((d) => d.id === id && d.type === type) || null;

export { genres };
