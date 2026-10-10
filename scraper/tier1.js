/**
 * Tier 1 — the plain fetch.
 *
 * Most media pages are ordinary HTML: the file is in the markup the server sent, and
 * nothing has to be executed to see it. That is the whole of this tier — one request,
 * the real User-Agent a browser sends, and a deadline.
 *
 * **The deadline is the point.** A page that hangs used to hang the caller with it;
 * ten seconds is long enough for a slow origin and short enough that the tiers above
 * this one still get their turn while the user is still waiting.
 *
 * It is also the only tier that sees raw response headers, so it is where a site's
 * cookies are harvested (scraper/sessions.js) and where the next tier inherits them.
 */
import { cookieHeader, saveFromResponse } from "./sessions.js";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIMEOUT_MS = 10000;

/**
 * Fetch a page as static HTML.
 *
 * @param {string} url
 * @param {{ timeout?: number, headers?: Record<string, string>, cookies?: string, referer?: string }} [options]
 * @returns {Promise<string|null>} the HTML, or `null` on any failure
 */
export async function fetchStaticHTML(url, options = {}) {
  const timeout = Number(options.timeout) || TIMEOUT_MS;
  // The caller's cookies when it has them, the saved session for this domain otherwise.
  const cookies = typeof options.cookies === "string" ? options.cookies : cookieHeader(url);
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeout);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: control.signal,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        // **The page is the referrer.** Plenty of sites serve a file only to a request
        // that claims to come from their own player page, and a fetch that says nothing
        // about where it came from gets the door. Setting it costs nothing and is the
        // single most common reason an extracted URL plays for the browser and not for
        // anything else.
        ...(options.referer ? { referer: String(options.referer) } : {}),
        // The cookies a previous visit earned for this domain (scraper/sessions.js).
        ...(cookies ? { cookie: cookies } : {}),
        ...options.headers,
      },
    });
    // **Harvest first.** A challenge page answers 403 *and* hands out the cookie that
    // proves the visitor is a visitor; throwing that away with the response is how a
    // page stays unreadable on every later attempt.
    saveFromResponse(url, res.headers);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // A timeout, a DNS failure, a refused connection, a redirect loop: all of them are
    // "this tier could not answer", which is what `null` means here.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
