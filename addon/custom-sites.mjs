/**
 * Custom Websites: the sites you watch that no add-on covers.
 *
 * An add-on knows its own catalogue; a site you found yourself knows nothing about this
 * app. So instead of a URL box in the player, a site is **added once** — with the search
 * form it uses detected from its homepage — and from then on pressing Play on a title
 * searches it, reads the best-matching page, runs the scraper's tiers over it, and adds
 * whatever it found to the Sources list, tagged with the site's own domain.
 *
 * ## What is written down, and what is not
 *
 * Written to `custom-sites.json`: the site URL, its domain, the search pattern, the
 * category and the date it was added. Written to `repositories.json`: the repository URLs
 * with their names, so one can be removed precisely.
 *
 * **Not written anywhere**: the extracted stream URLs, the search results, the content
 * page links. A stream URL carries a token and expires within hours; storing it is storing
 * a broken link. Everything past the site URL is regenerated at play time, on purpose —
 * that is why playing an old title finds a working stream rather than a dead one.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStaticHTML } from "../scraper/tier1.js";
import { renderJS } from "../scraper/tier2.js";
import { extractStreams } from "../scraper/index.js";
import { cookieHeader } from "../scraper/sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.NUVIO_CUSTOM_SITES_FILE || path.join(__dirname, "custom-sites.json");
const REPO_FILE = process.env.NUVIO_REPOSITORIES_FILE || path.join(__dirname, "repositories.json");

export const CATEGORIES = [
  ["movies", "Movies"],
  ["series", "Series"],
  ["anime", "Anime"],
  ["documentary", "Documentary"],
  ["sports", "Sports"],
  ["other", "Other"],
];
const CATEGORY_KEYS = CATEGORIES.map(([k]) => k);

const empty = () => Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []]));

/* ------------------------------------------------------------------- the stores */

let store = null;
function load() {
  if (store) return store;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const base = empty();
    for (const k of CATEGORY_KEYS) if (Array.isArray(parsed?.[k])) base[k] = parsed[k].filter((s) => s && s.url);
    store = base;
  } catch {
    store = empty();
  }
  return store;
}
const persist = () => {
  try {
    fs.writeFileSync(FILE, JSON.stringify(load(), null, 2) + "\n");
  } catch {
    /* read-only fs — the in-memory copy still applies for this run */
  }
};

let repos = null;
function loadRepos() {
  if (repos) return repos;
  try {
    const parsed = JSON.parse(fs.readFileSync(REPO_FILE, "utf8"));
    repos = { repositories: Array.isArray(parsed?.repositories) ? parsed.repositories : [] };
  } catch {
    repos = { repositories: [] };
  }
  return repos;
}
const persistRepos = () => {
  try {
    fs.writeFileSync(REPO_FILE, JSON.stringify(loadRepos(), null, 2) + "\n");
  } catch {
    /* read-only fs */
  }
};

/* ------------------------------------------------------------------ small helpers */

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};

/** A site URL without its hash, so the same site added twice is one entry. */
const normalizeUrl = (url) => {
  try {
    const u = new URL(String(url).trim());
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
};

const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "full", "movie", "movies", "series", "watch", "online", "free", "hd", "episode", "season", "sub", "subs", "eng", "english"]);
const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));

/** How well a link's text matches a title and year: 0 (nothing) to >1 (certain). */
export function matchScore(linkText, title, year = "") {
  const want = tokens(title);
  if (!want.length) return 0;
  const have = new Set(tokens(linkText));
  let score = want.filter((w) => have.has(w)).length / want.length;
  if (year && String(linkText).includes(String(year))) score += 0.35;
  if (/\b(?:movie|watch|episode|series|stream)\b/i.test(linkText)) score += 0.05;
  return score;
}

/** The links on a search-results page, newest-first in document order. */
function linksIn(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, base).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    out.push({ url: abs, text });
  }
  return out;
}

/** The best-matching page for a title, or nothing. */
export function pickPage(html, base, title, year = "", threshold = 0.6) {
  let best = null;
  for (const link of linksIn(html, base)) {
    const score = matchScore(link.text, title, year);
    if (score >= threshold && (!best || score > best.score)) best = { ...link, score };
  }
  return best;
}

/** The URL a site's own search form would produce for a query. */
export function buildSearchUrl(site, query) {
  const p = site?.searchPattern;
  if (p?.action && p?.input) {
    // A path template (`/search/{q}/top-results`) is filled in place, not as a query.
    if (p.style === "path" || p.action.includes("{q}")) {
      return p.action.replace(/\{q\}/g, encodeURIComponent(query));
    }
    try {
      const u = new URL(p.action, site.url);
      u.searchParams.set(p.input, query);
      return u.href;
    } catch {
      /* fall through to the guesses below */
    }
  }
  try {
    const u = new URL(site.url);
    // No detected form: the two parameter names the overwhelming majority of sites use.
    u.searchParams.set("s", query);
    return u.href;
  } catch {
    return "";
  }
}

/* --------------------------------------------------------- search-form detection */

/**
 * Find a site's own search form: its action and the name of its query input.
 *
 * Detection is honest about failure — a site whose search box is drawn by JavaScript has
 * no form in its markup, and inventing one produces a URL that returns nothing. When it
 * cannot tell, the caller asks for a sample search URL instead of guessing.
 */
export async function detectSearchPattern(url) {
  const page = await fetchStaticHTML(url, { referer: url });
  if (!page) return { ok: false, message: "The homepage could not be fetched. Paste a sample search URL instead." };
  const candidates = [];
  for (const form of page.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = form[1];
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "get").toLowerCase();
    for (const input of form[2].matchAll(/<input\b([^>]*)>/gi)) {
      const a = input[1];
      const type = (/type\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? "text").toLowerCase();
      const name = /name\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? "";
      if (!name || ["hidden", "submit", "button", "checkbox", "radio", "file", "image", "reset", "color", "range"].includes(type)) continue;
      candidates.push({ action, input: name, method });
    }
  }
  const preferred =
    candidates.find((c) => /^(?:q|s|search|query|keyword|keywords|k|term|searchtext|text)$/i.test(c.input)) || candidates[0];
  if (!preferred) return { ok: false, message: "No search box was found on that homepage. Paste a sample search URL instead.", candidates: [] };
  return { ok: true, pattern: preferred, candidates: candidates.slice(0, 6), message: "" };
}

/** A sample search URL into a pattern: the action and input name of a real search. */
/** The words a site uses for the search segment itself, not for what was searched. */
const SEARCH_WORDS = /^(?:search|s|find|query|q|browse|explore|keyword|results?)$/i;

export function patternFromSample(sampleUrl, title = "") {
  try {
    const u = new URL(sampleUrl);
    const params = [...u.searchParams.entries()];
    if (params.length) {
      // Prefer a parameter that carried the query term, else the first non-empty one.
      const wanted = params.find(([, v]) => v && title && v.toLowerCase().includes(String(title).toLowerCase().slice(0, 6))) || params.find(([, v]) => v) || params[0];
      u.searchParams.delete(wanted[0]);
      return { action: `${u.origin}${u.pathname}`, input: wanted[0], method: "get" };
    }
    // **The term can be in the path instead of the query string.** A site like
    // dailymotion searches with `…/search/<words>/top-results` — no `?q=` anywhere — and
    // this used to answer "no query parameters", which is why a perfectly good search URL
    // was refused. The segment is found by looking for the word `search` and taking the
    // one after it, or by matching the title that was actually searched for.
    const segments = u.pathname.split("/");
    const want = String(title || "").trim().toLowerCase();
    let at = -1;
    if (want && want.length > 2) {
      at = segments.findIndex((seg) => seg && !SEARCH_WORDS.test(seg) && seg.toLowerCase().includes(want));
    }
    if (at < 0) {
      const anchor = segments.findIndex((seg) => SEARCH_WORDS.test(seg));
      if (anchor >= 0 && segments[anchor + 1]) at = anchor + 1;
    }
    if (at < 0) return null;
    const head = segments.slice(0, at).join("/");
    const tail = segments.slice(at + 1).filter(Boolean).join("/");
    return {
      action: `${u.origin}${head}/{q}${tail ? `/${tail}` : ""}`,
      input: "q",
      method: "get",
      // How the placeholder is used: `query` (the default) sets `?q=`, `path` substitutes
      // into the path itself.
      style: "path",
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- the sites store */

export const listSites = () => {
  const s = load();
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, s[k].map((x) => ({ ...x }))]));
};

export const allSites = () => CATEGORY_KEYS.flatMap((k) => load()[k].map((x) => ({ ...x, category: k })));

export const publicSites = () => ({
  categories: CATEGORIES.map(([key, label]) => ({ key, label, sites: load()[key].map((x) => ({ ...x })) })),
  repositories: listRepositories(),
});

export const listRepositories = () => loadRepos().repositories.map((r) => ({ ...r }));

/**
 * Add one site to a category.
 *
 * The search pattern is detected from the homepage unless one is given; a site whose form
 * cannot be read is **not** stored, because a site that can never be searched is a row
 * that only produces failures. The caller gets `needPattern` and asks for a sample URL.
 */
export async function addSite({ url, category = "movies", searchPattern = null } = {}) {
  const clean = normalizeUrl(url);
  if (!clean) return { ok: false, message: "Enter a full site URL (https://…)." };
  const cat = CATEGORY_KEYS.includes(category) ? category : "other";
  const domain = domainOf(clean);
  let pattern = searchPattern;
  if (!pattern) {
    const detected = await detectSearchPattern(clean);
    if (!detected.ok) return { ok: false, needPattern: true, domain, message: detected.message, candidates: detected.candidates || [] };
    pattern = detected.pattern;
  }
  const s = load();
  const entry = { url: clean, domain, category: cat, searchPattern: pattern, added: Date.now() };
  const existing = CATEGORY_KEYS.flatMap((k) => s[k]).find((x) => x.url === clean);
  if (existing) {
    for (const k of CATEGORY_KEYS) s[k] = s[k].filter((x) => x.url !== clean);
  }
  s[cat].push(entry);
  persist();
  return { ok: true, site: entry, detected: !searchPattern, message: `Added ${domain} to ${cat}.` };
}

/** Change a site's URL or category, or give it a search pattern. */
export function updateSite({ url, category = "", patch = {} } = {}) {
  const s = load();
  const clean = normalizeUrl(url) || url;
  if (category && CATEGORY_KEYS.includes(category)) {
    for (const k of CATEGORY_KEYS) {
      const at = s[k].findIndex((x) => x.url === clean);
      if (at >= 0) {
        const [entry] = s[k].splice(at, 1);
        s[category].push({ ...entry, ...patch, category, url: patch.url ? normalizeUrl(patch.url) || entry.url : entry.url, domain: patch.url ? domainOf(patch.url) : entry.domain });
      }
    }
  } else {
    for (const k of CATEGORY_KEYS) {
      const at = s[k].findIndex((x) => x.url === clean);
      if (at >= 0) s[k][at] = { ...s[k][at], ...patch, url: patch.url ? normalizeUrl(patch.url) || s[k][at].url : s[k][at].url, domain: patch.url ? domainOf(patch.url) : s[k][at].domain };
    }
  }
  persist();
  return { ok: true, sites: listSites() };
}

export function removeSite({ url } = {}) {
  const s = load();
  const clean = normalizeUrl(url) || String(url || "");
  let removed = 0;
  for (const k of CATEGORY_KEYS) {
    const before = s[k].length;
    s[k] = s[k].filter((x) => x.url !== clean);
    removed += before - s[k].length;
  }
  if (removed) persist();
  return { ok: removed > 0, removed, sites: listSites() };
}

/* ------------------------------------------------------------------ repositories */

/**
 * Add every site a repository lists.
 *
 * A repository is a JSON document `{ name, version, websites: [{ url, category }] }`. The
 * sites are added exactly as if they had been typed one at a time — detection and all —
 * and the repository is remembered by name so it can be removed as a unit.
 */
export async function addRepository({ url } = {}) {
  const clean = normalizeUrl(url);
  if (!clean) return { ok: false, message: "Enter the repository's JSON URL." };
  let doc;
  try {
    const res = await fetch(clean, { headers: { accept: "application/json", "user-agent": "NuvioCollections/1.0" } });
    if (!res.ok) return { ok: false, message: `The repository answered HTTP ${res.status}.` };
    doc = await res.json();
  } catch (err) {
    return { ok: false, message: `The repository could not be read — ${err?.message || err}` };
  }
  const websites = Array.isArray(doc?.websites) ? doc.websites : Array.isArray(doc) ? doc : [];
  if (!websites.length) return { ok: false, message: "That document has no `websites` array." };
  const name = String(doc?.name || domainOf(clean) || "repository").slice(0, 60);
  const results = { added: 0, failed: 0, sites: [] };
  // **The URLs, not the domains.** Removal takes a repository's sites out again by
  // matching this list against `site.url` — and a domain is not a URL, so recording
  // domains here meant "Remove Repository" never actually removed anything.
  const addedUrls = [];
  for (const site of websites) {
    const target = typeof site === "string" ? site : site?.url;
    const cat = (typeof site === "object" && site?.category) || "other";
    if (!target) continue;
    // eslint-disable-next-line no-await-in-loop
    const one = await addSite({ url: target, category: cat });
    if (one.ok) {
      results.added += 1;
      results.sites.push(one.site.domain);
      addedUrls.push(one.site.url);
    } else {
      results.failed += 1;
    }
  }
  const repos2 = loadRepos();
  repos2.repositories = repos2.repositories.filter((r) => r.url !== clean);
  repos2.repositories.push({ url: clean, name, version: String(doc?.version || ""), count: results.added, added: Date.now(), sites: addedUrls });
  persistRepos();
  // `sites` goes back as well: a repository's whole point is the sites it just added, and
  // the pane that asked for it draws the categories from this answer.
  return { ok: true, name, ...results, repositories: listRepositories(), sites: listSites(), message: `${name}: added ${results.added} site${results.added === 1 ? "" : "s"}${results.failed ? `, ${results.failed} could not be read` : ""}.` };
}

export function removeRepository({ url } = {}) {
  const clean = normalizeUrl(url) || String(url || "");
  const repos2 = loadRepos();
  const at = repos2.repositories.findIndex((r) => r.url === clean);
  if (at < 0) return { ok: false, message: "That repository is not in the list." };
  const [entry] = repos2.repositories.splice(at, 1);
  persistRepos();
  // Its sites go with it: they were added as a unit, so they are removed as one.
  const s = load();
  let removed = 0;
  for (const k of CATEGORY_KEYS) {
    const before = s[k].length;
    s[k] = s[k].filter((x) => !(entry.sites || []).includes(x.url));
    removed += before - s[k].length;
  }
  if (removed) persist();
  return { ok: true, name: entry.name, removed, repositories: listRepositories(), sites: listSites() };
}

/* ------------------------------------------------------------------- play time */

/** Follow a site's redirects for real: a moved site should not need re-adding. */
async function refreshSite(site, timeoutMs = 6000) {
  try {
    // **A deadline on this one too.** This fetch had none, so a site that accepted the
    // connection and then said nothing held the whole search open until the browser (or
    // the tunnel in front of it) gave up with an HTTP 502 — which is what the player
    // showed as "Custom Sites could not be searched".
    const res = await fetch(site.url, {
      redirect: "follow",
      headers: { "user-agent": "NuvioCollections/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const final = res.url;
    if (final && final !== site.url) {
      return { ...site, url: normalizeUrl(final) || site.url, domain: domainOf(final) || site.domain, moved: true };
    }
    if (!res.ok) return { ...site, error: `HTTP ${res.status}` };
    return site;
  } catch (err) {
    // A redirect we could not follow at all is worth remembering, but not worth refusing
    // the whole search over: the stored URL is still tried.
    return { ...site, error: String(err?.message || err) };
  }
}

/**
 * Search every site in a title's category and extract what they hold.
 *
 * `streams` are tagged with the site's domain; `sites` reports one line per site so a
 * failure is visible instead of silent. A site that throws is logged and skipped — a
 * Custom Website must never be able to take the Play button down with it.
 */
export async function searchOnPlay({ title = "", year = "", type = "movie", trace = null, limitPerSite = 4, budgetMs = 18000, onSite = null } = {}) {
  const say = (m) => trace?.push(m);
  const name = String(title || "").trim();
  if (!name) return { ok: false, streams: [], sites: [], message: "No title to search with." };
  const category = type === "series" ? "series" : "movies";
  const s = load();
  // The title's own category, plus `other` — the home of everything the user would not
  // call a film or a show.
  const candidates = [...s[category], ...s.other];
  if (!candidates.length) return { ok: true, streams: [], sites: [], message: "No Custom Websites are added for this category yet." };

  // **Every site at once, and each one on a clock.**
  //
  // The sites were asked one after another, each with its own unbounded waits, so four
  // sites could hold the Play press open for a minute — long past the point where the
  // tunnel in front of the app answers 502. They run together now, each site gets a slice
  // of the budget, and the extraction is told its deadline and its highest tier. A site
  // with **no verified session** is not sent to tier 3 at all: a browser launch per site
  // per play is minutes of work for a page that usually answers to a plain fetch.
  const deadline = Date.now() + budgetMs;
  const perSite = Math.max(1500, Math.round(budgetMs / 2));
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const streams = [];
      let site = candidate;
      try {
        site = await refreshSite(candidate, perSite);
        if (site.moved) {
          updateSite({ url: candidate.url, patch: { url: site.url } });
          say(`${site.domain} moved to ${site.url} — the stored URL was updated`);
        }
        const searchUrl = buildSearchUrl(site, name);
        if (!searchUrl) return { streams, report: { domain: site.domain, count: 0, error: "no search URL could be built" } };
        const html = await fetchStaticHTML(searchUrl, { referer: site.url, timeout: perSite });
        if (!html) return { streams, report: { domain: site.domain, count: 0, error: "the search page could not be fetched" } };
        let hit = pickPage(html, searchUrl, name, year);
        // **A search page that draws its own results.** Plenty of sites ship a search page
        // whose list is built by JavaScript, so the markup a plain fetch reads has no
        // result links at all — every play then reports "no matching result", which reads
        // as "your site has nothing" when the truth is "this page needs its scripts run".
        // The sandbox tier runs them (and finishes in about a second), so a search page
        // gets the same treatment a content page has always had here.
        let rendered = false;
        if (!hit && Date.now() < deadline) {
          const dom = await renderJS(searchUrl, { referer: site.url, wait: 1200, timeout: Math.min(perSite, 8000) });
          if (dom) {
            rendered = true;
            hit = pickPage(dom, searchUrl, name, year);
          }
        }
        if (!hit) {
          // Say which of the two it is: a page with no links whatever is drawn by script
          // and needs the browser tier the scraper keeps for exactly that; a page with
          // links is a search that simply has no such title on it.
          const linkless = linksIn(html, searchUrl).length === 0;
          const error = linkless && rendered
            ? "the search page draws its results with JavaScript — no result links in the markup"
            : "no matching result on the search page";
          return { streams, report: { domain: site.domain, count: 0, error } };
        }
        const verified = Boolean(cookieHeader(hit.url));
        const rows = await extractStreams(hit.url, {
          trace: null,
          timeout: perSite,
          deadline: Math.min(deadline, Date.now() + perSite * 2),
          maxTier: verified ? "browser" : "js",
        });
        const tagged = rows.slice(0, limitPerSite).map((r) => ({ ...r, site: site.domain, domain: site.domain }));
        streams.push(...tagged);
        const out = Date.now() > deadline && !tagged.length;
        const report = {
          domain: site.domain,
          count: tagged.length,
          page: hit.url,
          error: tagged.length ? "" : out ? "ran out of time" : "the page held no playable stream",
        };
        // **Handed over the moment this site is done**, so a caller can show results as
        // they arrive instead of waiting for the slowest site.
        try { onSite?.(report, tagged); } catch { /* a listener must not fail the search */ }
        return { streams, report };
      } catch (err) {
        const report = { domain: site.domain, count: 0, error: String(err?.message || err) };
        try { onSite?.(report, []); } catch { /* as above */ }
        return { streams, report };
      }
    }),
  );
  const sites = results.map((r) => r.report);
  const streams = results.flatMap((r) => r.streams);
  const message = streams.length
    ? `Custom Sites: ${streams.length} stream${streams.length === 1 ? "" : "s"} from ${sites.filter((x) => x.count).map((x) => x.domain).join(", ")}`
    : "Custom Sites: nothing found on the sites you added.";
  return { ok: true, streams, sites, message, category };
}

/** Test seam. */
export const _reset = () => {
  store = empty();
  repos = { repositories: [] };
};

/**
 * A search-on-play the caller does not have to wait for.
 *
 * **Why this exists.** The search asks the user's own sites, and a site is allowed its
 * slice of an 18-second budget — so the *request* could be open for twenty seconds or
 * more. A proxy in front of this server gives up long before that and answers **HTTP
 * 502**, which is what "Custom Sites could not be searched — HTTP 502" was: the search
 * was working, the request carrying it was not. The search runs in the background now and
 * the page watches it, so every request is short.
 */
const JOBS = new Map();
const JOB_TTL_MS = 5 * 60 * 1000;

function sweepJobs() {
  const now = Date.now();
  for (const [id, job] of JOBS) if (!job.running && now - job.at > JOB_TTL_MS) JOBS.delete(id);
}

/** Start a search and return its handle **at once**. */
export function startSearchOnPlay(options = {}) {
  sweepJobs();
  const id = `sop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, running: true, streams: [], sites: [], message: "Searching your sites…", category: "", at: Date.now() };
  JOBS.set(id, job);
  searchOnPlay({
    ...options,
    onSite: (report, streams) => {
      job.sites.push(report);
      job.streams.push(...streams);
    },
  })
    .then((res) => {
      job.running = false;
      job.streams = res.streams || [];
      job.sites = res.sites || [];
      job.message = res.message || "";
      job.category = res.category || "";
      job.ok = res.ok !== false;
    })
    .catch((err) => {
      job.running = false;
      job.ok = false;
      job.message = `Custom Sites could not be searched — ${String(err?.message || err)}`;
    })
    .finally(() => { job.at = Date.now(); });
  return job;
}

/** Where a job has got to, as the page reads it. */
export function searchJob(id) {
  const job = JOBS.get(String(id || ""));
  if (!job) return null;
  return {
    id: job.id,
    ok: job.ok !== false,
    running: job.running,
    streams: job.streams,
    sites: job.sites,
    message: job.message,
    category: job.category,
  };
}
