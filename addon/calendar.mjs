/**
 * Release calendar — what actually comes out in a given month.
 *
 * A calendar is not "Latest" or "New Release": those are catalogs. This asks
 * TMDB discover for a date range and returns one entry per title with the date
 * it lands on, so the UI can draw a real month grid.
 *
 *   movies  → primary_release_date
 *   series  → first_air_date
 */
import { get, toMeta, tmdbPath } from "./tmdb.mjs";

const PAGE_SIZE = 20;
const MAX_PAGES = 3;

const dedupe = (items) => {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
};

/** First and last day of a `YYYY-MM` month, as ISO dates. */
export function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) return null;
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${match[1]}-${match[2]}-01`, end: `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`, days: last };
}

/**
 * Every title releasing in `month` for one row type, each carrying
 * `releaseDate` (YYYY-MM-DD). Sorted by date.
 */
export async function calendarMonth(media, month, { adult = false } = {}) {
  const range = monthRange(month);
  if (!range) return null;
  const t = tmdbPath(media);
  const field = media === "movie" ? "primary_release_date" : "first_air_date";
  const params = {
    [`${field}.gte`]: range.start,
    [`${field}.lte`]: range.end,
    sort_by: `${field}.asc`,
    ...(adult ? { include_adult: true } : {}),
  };

  const pages = await Promise.all(
    Array.from({ length: MAX_PAGES }, (_, i) =>
      get(`/discover/${t}`, { ...params, page: i + 1 }).catch(() => ({ results: [] })),
    ),
  );

  // TMDB's list endpoint sometimes omits the date we filtered on — pass
  // `release_date.*` through when present, otherwise fall back to the field.
  const metas = dedupe(pages.flatMap((p) => p.results ?? []))
    // `include_adult` is a hint, and the calendar asks for a date range rather
    // than a list endpoint, so the `adult` flag is honoured here as well.
    .filter((item) => adult || !item.adult)
    .map((item) => {
      const date = (media === "movie" ? item.release_date : item.first_air_date) || null;
      return { ...toMeta(item, media), releaseDate: date };
    })
    .filter((m) => m && m.releaseDate);

  return { month, type: media, days: range.days, metas };
}
