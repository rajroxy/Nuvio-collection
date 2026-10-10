/**
 * Tier 1's other half: everything in a page that could be a video.
 *
 * A media URL on a page is one of three things — a link that ends in a file extension,
 * a `<video src>`, or a `<source src>` inside one — so those are what this looks for.
 * It is deliberately dumb: no scoring, no guessing, no second request. Anything that
 * needs the DOM built or a script run belongs to a later tier, not to a regex.
 *
 * Duplicates are collapsed, because the same file is routinely named twice (once in
 * the `<video>` and once in a `<source>` beside it).
 *
 * **A `blob:` URL is not a stream.** A site that builds its video in JavaScript hands the
 * element a `blob:` object URL, which exists only inside that page's process — nothing
 * outside the browser can fetch it, so offering it in a source list is offering a row that
 * can never play. Those are counted and dropped, and the caller reports how many it
 * ignored rather than pretending it found nothing.
 */

/** A URL whose path ends in a file this project can play. */
const MEDIA_EXT_RE = /\.(mp4|m4v|webm|mkv|mov|m3u8|mpd)(?=[?#"'\s]|$)/gi;
/**
 * Whether the text recovered around an extension is a URL at all.
 *
 * The extension scan walks raw page text, and raw page text is full of fragments like
 * `".m3u8"` inside a script — offered as streams, those become `.m3u8` in the player's
 * source list. A candidate has to look like a way to reach a file: a scheme, a
 * protocol-relative host, an absolute path, or a relative path with a directory in it.
 */
const LOOKS_LIKE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|\/|[\w.~-]+\/)/i;
/** `<video src="…">` and `<source src="…">`, in either quote style. */
const TAG_SRC_RE = /<(?:video|source)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;

const shape = (url) => ({ url, quality: "unknown", title: "Stream", source: "static" });

/** A URL no other client can fetch: a page-local object, not an address. */
const UNPLAYABLE_RE = /^(?:blob|data|filesystem):/i;
export const isUnplayable = (url) => UNPLAYABLE_RE.test(String(url || "").trim());

/** The page-local URLs a page offers, so the caller can say it skipped them. */
export function unplayableInHTML(html) {
  if (typeof html !== "string" || !html) return [];
  const out = new Set();
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)) {
    if (isUnplayable(m[1])) out.add(m[1].trim());
  }
  for (const m of html.matchAll(/(?:blob|data):[^"'\s<>)]+/gi)) out.add(m[0]);
  return [...out];
}

/**
 * @param {string} html
 * @returns {Array<{url: string, quality: string, title: string, source: string}>}
 */
export function findStreamsInHTML(html) {
  if (typeof html !== "string" || !html) return [];
  const found = new Set();

  for (const m of html.matchAll(TAG_SRC_RE)) {
    const url = m[1].trim();
    if (url) found.add(url);
  }
  for (const m of html.matchAll(MEDIA_EXT_RE)) {
    // The regex matches the extension; the URL around it is recovered from the
    // attribute, the quote, or the start of the text.
    const end = m.index + m[0].length;
    let start = m.index;
    while (start > 0 && !/[\s"'<>(),]/.test(html[start - 1])) start -= 1;
    const url = html.slice(start, end);
    if (url && LOOKS_LIKE_URL_RE.test(url)) found.add(url);
  }

  // A page-local object URL is dropped here rather than offered and left to fail.
  for (const u of [...found]) if (isUnplayable(u)) found.delete(u);

  // **The same file, found twice.** A `<video src>` carries the URL the site actually
  // plays (`…/stream.m3u8?token=abc`), while the text scan can recover the same address
  // without its query string — which is the version that does not work, since the token
  // is usually in it. When one candidate is a prefix of another, the longer one wins.
  const all = [...found];
  return all.filter((u) => !all.some((other) => other !== u && other.startsWith(u))).map(shape);
}
