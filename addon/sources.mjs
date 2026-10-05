/**
 * Source inspection — read what an add-on, plugin or repository actually offers.
 *
 * This runs **on the server**, not in the page. That is the fix for "addons,
 * plugins and repos not working": a browser cannot read `manifest.json` from an
 * arbitrary third-party host unless that host sends permissive CORS headers (most
 * do not), and a CloudStream repo lives on `raw.githubusercontent.com`, not at
 * the page's origin. Fetching here has no such restriction.
 *
 *   add-on        → GET <base>/manifest.json            → name + catalogs
 *   plugin/repo   → GET <base>/repo.json → pluginLists  → GET each plugins.json
 *
 * A GitHub URL is translated to its raw files (trying `main`, then `master`).
 */

const GITHUB = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i;

/** Where the files of a repo may live — a GitHub URL maps to raw.githubusercontent. */
export function repoBases(url) {
  const clean = String(url || "")
    .replace(/^stremio:\/\//i, "https://")
    .replace(/\/+$/, "")
    .replace(/\/(repo|plugins|manifest)\.json$/i, "");
  const gh = clean.match(GITHUB);
  const out = [];
  if (gh) {
    for (const branch of ["main", "master"]) out.push(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${branch}`);
  }
  out.push(clean);
  return [...new Set(out.filter(Boolean))];
}

async function getJSON(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/** Every plugin name a CloudStream-style repository publishes. */
async function cloudStreamRepo(url) {
  for (const base of repoBases(url)) {
    let repo;
    try {
      repo = await getJSON(`${base}/repo.json`);
    } catch {
      continue;
    }
    const lists = Array.isArray(repo?.pluginLists)
      ? repo.pluginLists
      : Array.isArray(repo?.plugins)
        ? repo.plugins
        : [];
    const urls = lists.map((l) => (typeof l === "string" ? l : l?.url || l?.list || "")).filter(Boolean);

    const providers = [];
    for (const listUrl of urls.slice(0, 5)) {
      try {
        const abs = /^https?:/i.test(listUrl) ? listUrl : `${base}/${String(listUrl).replace(/^\.?\//, "")}`;
        const data = await getJSON(abs);
        const items = Array.isArray(data) ? data : Array.isArray(data?.plugins) ? data.plugins : [];
        for (const p of items) {
          if (p?.name) providers.push(p.name);
          else if (typeof p === "string") providers.push(p);
        }
      } catch {
        /* one dead list must not sink the repository */
      }
    }
    return { name: repo?.name || null, description: repo?.description || "", providers: uniq(providers) };
  }
  throw new Error("no repo.json");
}

/** A Stremio/Nuvio add-on manifest → its catalogs (the providers it offers). */
async function addonManifest(url) {
  const clean = String(url || "").replace(/^stremio:\/\//i, "https://").replace(/\/+$/, "");
  const candidates = clean.endsWith("/manifest.json") ? [clean] : [`${clean}/manifest.json`];
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const manifest = await getJSON(candidate);
      return {
        name: manifest.name || null,
        description: manifest.description || "",
        providers: uniq((manifest.catalogs || []).map((c) => c.name)),
        resources: manifest.resources || [],
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("not reachable");
}

const ADDON_KINDS = new Set(["stremio", "nuvio"]);

/**
 * Inspect any source. Never throws — a failure is returned as `ok: false` with a
 * plain message, so the UI never shows a bare 404 for something that simply is
 * not an add-on.
 */
export async function inspectSource(type, url) {
  if (!url) return { ok: false, kind: type, message: "no url" };
  try {
    if (ADDON_KINDS.has(type)) {
      const { name, providers, resources } = await addonManifest(url);
      return { ok: true, kind: "addon", name, providers, resources, message: `${providers.length} catalogs` };
    }
    // Nuvio plugins and CloudStream repos are repositories, not add-ons — but a
    // Nuvio plugin may speak the manifest protocol, so try that first.
    if (type === "nuvio-plugin") {
      try {
        const { name, providers } = await addonManifest(url);
        return { ok: true, kind: "addon", name, providers, message: `${providers.length} catalogs` };
      } catch {
        /* fall through to the repo layout */
      }
    }
    const { name, providers, description } = await cloudStreamRepo(url);
    return { ok: true, kind: "repo", name, description, providers, message: `${providers.length} plugins` };
  } catch (err) {
    return {
      ok: false,
      kind: type,
      message: ADDON_KINDS.has(type) ? `not reachable — ${err.message}` : "no repo.json found — stored for the native app",
    };
  }
}
