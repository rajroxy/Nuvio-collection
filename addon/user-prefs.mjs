/**
 * General preferences that are not a provider key or a catalog choice.
 *
 * Everything here is small, local and user-owned — whether search-on-play runs, whether
 * the Sources panel shows its summary line — and it lives in `user-preferences.json` so it
 * survives a restart. Nothing here is a secret, and nothing here is regenerated content:
 * extracted URLs, search answers and cached metadata are deliberately **not** stored
 * anywhere, because a stream URL expires and a cached row only ever goes stale.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.NUVIO_PREFS_FILE || path.join(__dirname, "user-preferences.json");

const DEFAULTS = {
  // Run the Custom Websites search when Play is pressed.
  searchOnPlay: true,
  // Show "Custom Sites: N streams" above the source list.
  sourcesSummary: true,
  // Remember which Custom Websites category the Settings pane last showed.
  lastCategory: "movies",
  // The subtitle language-picker choice is stored with the subtitle settings; this is a
  // place for the few remaining page-level switches.
  showTierBadges: true,
  updated: 0,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    cache = { ...DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(load(), null, 2) + "\n");
  } catch {
    /* read-only fs — the in-memory copy still applies for this run */
  }
}

export const getPrefs = () => ({ ...load() });

export function updatePrefs(patch = {}) {
  const next = load();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (typeof DEFAULTS[k] === "boolean") next[k] = v === true || v === "true";
    else next[k] = v;
  }
  next.updated = Date.now();
  cache = next;
  persist();
  return getPrefs();
}
