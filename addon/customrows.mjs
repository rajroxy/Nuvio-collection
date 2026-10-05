/**
 * Custom rows — the row that sits after the Watchlist card's three states.
 *
 * The first three rows of the Watchlist card are the states a pinned title moves
 * through (Plan to Watch → Watching → Watched), and they fill themselves as you
 * pin things. The row after them is deliberately different: it is a **custom
 * row**, and it holds exactly the titles you put in it. Nothing is added for you
 * and nothing is removed, so it is the place for the handful of things you want
 * to get to without calling them "Plan to Watch".
 *
 * Like the watchlist it lives on the server (`addon/customrows.json` — git
 * ignored, created at runtime, overridable with `NUVIO_CUSTOM_FILE` so tests
 * never touch the real file) and is served through the ordinary catalog route,
 * so it pages, scrolls and publishes in the manifest exactly like every other
 * row, and Nuvio shows it too.
 *
 * A stored title is keyed by `type + id`, the same key the watchlist uses: TMDB
 * numbers films and shows in one id space, so the type has to be part of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanItem } from "./watchlist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.NUVIO_CUSTOM_FILE || path.join(__dirname, "customrows.json");

/** The row the Watchlist card publishes after its three state rows. */
export const DEFAULT_ROW = "add-cards";

const keyOf = (item) => `${item?.type === "movie" ? "movie" : "series"}:${String(item?.id || "")}`;

let cache = null;

function load() {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const rows = raw?.rows && typeof raw.rows === "object" ? raw.rows : {};
    for (const [id, items] of Object.entries(rows)) {
      const kept = new Map();
      for (const item of Array.isArray(items) ? items : []) {
        if (item?.id) kept.set(keyOf(item), { ...item });
      }
      cache.set(id, kept);
    }
  } catch {
    /* no file yet — every custom row is empty */
  }
  return cache;
}

function save() {
  const rows = {};
  for (const [id, items] of load()) rows[id] = [...items.values()];
  try {
    fs.writeFileSync(FILE, JSON.stringify({ rows }, null, 2) + "\n");
  } catch {
    /* read-only fs — the in-memory copy still works for this run */
  }
}

/** The rows that hold something, with how many titles each one holds. */
export function rows() {
  return [...load().entries()]
    .map(([id, items]) => ({ id, count: items.size }))
    .filter((r) => r.count > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** How many titles each custom row holds. */
export function counts() {
  return Object.fromEntries(rows().map((r) => [r.id, r.count]));
}

/** Every stored title, tagged with the row it is in — what the app reads. */
export function items() {
  return [...load().entries()].flatMap(([row, map]) => [...map.values()].map((item) => ({ ...item, row })));
}

/** One row's titles, newest added first. */
export function list(rowId = DEFAULT_ROW) {
  const items = [...(load().get(String(rowId || DEFAULT_ROW))?.values() || [])];
  return items.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

const write = (rowId, map) => {
  const all = load();
  all.set(String(rowId || DEFAULT_ROW), map);
  save();
};

/**
 * Put a title in a row — or take it out again when it is already there.
 *
 * Toggling is what makes the modal's one button work as both "add" and "remove",
 * so a mis-click is one click to undo rather than a separate flow.
 */
export function add(rowId, item) {
  const id = String(rowId || DEFAULT_ROW);
  const next = cleanItem(item);
  if (!next) return { ok: false, message: "an item needs an id" };
  const map = new Map(load().get(id) || []);
  const key = keyOf(next);
  if (map.has(key)) {
    map.delete(key);
    write(id, map);
    return { ok: true, removed: true, inRow: false, count: map.size };
  }
  // Adding to a row that already holds it under another state keeps the state
  // off: a custom row is a list of titles, not a progress tracker.
  map.set(key, next);
  write(id, map);
  return { ok: true, removed: false, inRow: true, item: next, count: map.size };
}

/** Forget a title, whatever state it is in. */
export function remove(rowId, item) {
  const id = String(rowId || DEFAULT_ROW);
  const map = new Map(load().get(id) || []);
  const removed = map.delete(keyOf(item));
  if (removed) write(id, map);
  return { ok: true, removed, inRow: false, count: map.size };
}

/** The stored titles for one row, as catalog metas. */
export function metasFor(rowId, type, skip = 0, limit = 40) {
  return list(rowId)
    .filter((i) => i.type === type)
    .slice(skip, skip + limit)
    .map((i) => ({ ...i }));
}

/** Test/diagnostic helper — drop everything. */
export function clear() {
  cache = new Map();
  save();
}
