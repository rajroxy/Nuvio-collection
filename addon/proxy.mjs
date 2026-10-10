/**
 * The stream proxy: a play request that can carry a `Referer` and a visitor's cookies.
 *
 * ## Why a proxy is the only fix
 *
 * A scraped file very often plays only for a request that looks like it came from the
 * site's own player: it wants `Referer: https://site/watch/…`, and it wants the session
 * cookie that page earned. A browser's `<video>` element can set **neither** — `Referer`
 * is a forbidden header for script, and the app's own cookies are not the site's. hls.js
 * cannot help either, because a playlist's segments are fetched by the engine with the
 * same restriction.
 *
 * So the server fetches the media itself, on the page's behalf, and the browser points at
 * this server. That also solves the second half: a **playlist's own URIs** — segments, keys,
 * alternate renditions — are absolute URLs that would be requested from the browser with
 * no headers, so the manifest is rewritten on the way through and every line in it comes
 * back here. One cookie, one referer, the whole stream.
 *
 * Nothing is cached and nothing is stored: this is a pipe that adds two headers.
 */
import { BROWSER_UA } from "../scraper/tier1.js";
import { cookieHeader, saveFromResponse } from "../scraper/sessions.js";

const PLAYLIST_RE = /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl/i;

/** The path a URL is played through, with the page it came from as its referrer. */
export const proxyPath = (url, referer = "") =>
  `/stream/proxy?url=${encodeURIComponent(String(url))}${referer ? `&ref=${encodeURIComponent(String(referer))}` : ""}`;

/** An absolute `http(s)` URL, or nothing — this route must never be an SSRF to files. */
export function safeTarget(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

/**
 * Every URI inside an HLS manifest routed back through this proxy.
 *
 * Tags with a `URI="…"` attribute (keys, init maps, alternate renditions) and the bare
 * URI lines that follow `#EXT-X-STREAM-INF` are the whole of it. A `data:` URI is left
 * alone — it is inlined in the manifest and needs no request at all.
 */
export function rewriteManifest(text, baseUrl, referer = "") {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  const viaProxy = (u) => (/^(?:data|blob):/i.test(String(u)) ? u : proxyPath(abs(u), referer));
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (m, u) => `URI="${viaProxy(u)}"`);
      return viaProxy(t);
    })
    .join("\n");
}

/** Which headers are the connection's business rather than the file's. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailer", "content-encoding"]);

function outHeaders(headers) {
  const pairs = [];
  for (const [k, v] of Object.entries(headers)) {
    if (HOP.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) for (const one of v) pairs.push([k, String(one)]);
    else if (v !== undefined) pairs.push([k, String(v)]);
  }
  return new Headers(pairs);
}

/**
 * Fetch `url` for the browser, with the page as referrer and the site's cookies attached.
 *
 * @param {string} url
 * @param {{ referer?: string, method?: string, range?: string }} [options]
 * @returns {Promise<{ok: true, res: Response} | {ok: false, status: number, message: string}>}
 */
export async function fetchForPlayback(url, { referer = "", method = "GET", range = "" } = {}) {
  const target = safeTarget(url);
  if (!target) return { ok: false, status: 400, message: "That is not an http(s) URL." };
  const cookies = cookieHeader(target);
  let res;
  try {
    res = await fetch(target, {
      method: method === "HEAD" ? "HEAD" : "GET",
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "*/*",
        // Identity: a media stream cannot be double-encoded, and the browser needs real
        // byte offsets for seeking.
        "accept-encoding": "identity",
        ...(referer ? { referer: String(referer) } : {}),
        ...(cookies ? { cookie: cookies } : {}),
        ...(range ? { range: String(range) } : {}),
      },
    });
  } catch (err) {
    return { ok: false, status: 502, message: `Could not reach the stream — ${err?.message || err}` };
  }
  // A page that sets a fresh token while serving the file is telling us for next time.
  saveFromResponse(target, res.headers);
  return { ok: true, res, target };
}

/**
 * Answer one play request: pipe the bytes, or hand back a rewritten manifest.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleProxy(req, res, { url = "", ref = "" } = {}) {
  const got = await fetchForPlayback(url, { referer: ref, method: req.method, range: req.headers.range || "" });
  if (!got.ok) {
    res.writeHead(got.status, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(got.message);
    return;
  }
  const upstream = got.res;
  const type = upstream.headers.get("content-type") || "";
  const looksPlaylist = PLAYLIST_RE.test(type) || /\.m3u8(?:[?#]|$)/i.test(got.target);
  if (looksPlaylist && upstream.ok) {
    let text = "";
    try {
      text = await upstream.text();
    } catch (err) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Could not read the playlist — ${err?.message || err}`);
      return;
    }
    const body = rewriteManifest(text, got.target, ref);
    res.writeHead(200, {
      "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(body);
    return;
  }

  const headers = outHeaders(Object.fromEntries(upstream.headers));
  headers.delete("content-encoding");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  res.writeHead(upstream.status, Object.fromEntries(headers));
  if (!upstream.body || req.method === "HEAD") {
    res.end();
    return;
  }
  try {
    for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
  } catch {
    /* the client went away, or the origin did: either way the pipe is done */
  }
  res.end();
}
