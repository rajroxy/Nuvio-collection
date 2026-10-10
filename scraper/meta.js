/**
 * What a found stream *is*, in the words a stream list uses.
 *
 * A raw URL is not something a person can choose between. `…/a8f3c1d0-…?t=9` and
 * `…/show.s02e04.1080p.m3u8` are the same kind of thing to a regex and completely
 * different to an eye, so every stream this project returns is described before it is
 * offered:
 *
 *   quality  480p / 720p / 1080p / 1440p / 2160p / 4K, from the URL and the page
 *   format   HLS / MP4 / MKV / WEBM / DASH / other, from the extension
 *   protocol which tier found it — static, js-sandbox, browser, plugin
 *   domain   the site the page belongs to
 *   title    the page's own words for it, never a UUID
 *
 * `card` is the three-line shape the Sources list draws, matching what a Stremio add-on's
 * stream row looks like: the identity on the first line, the name on the second, the
 * provenance on the third. The domain appears **once** — it leads the first line and is
 * deliberately absent from the third, because a name printed twice is noise.
 */

/** tier name -> the protocol word the UI shows. */
const PROTOCOL = {
  static: "static",
  js: "js-sandbox",
  browser: "browser",
  plugin: "plugin",
  direct: "direct",
};

const FORMATS = {
  m3u8: "HLS",
  mpd: "DASH",
  mp4: "MP4",
  m4v: "MP4",
  webm: "WEBM",
  mkv: "MKV",
  mov: "MOV",
  ts: "TS",
};

const EMOJI = {
  HLS: "📺",
  DASH: "📼",
  MP4: "🎬",
  WEBM: "🎥",
  MKV: "🎞️",
  MOV: "🎥",
  TS: "📡",
  other: "▶️",
};

/** Quality, best-first, so the first token found in a name is the one that wins. */
const QUALITY_PATTERNS = [
  [/\b(?:2160p|4k|uhd)\b/i, "2160p"],
  [/\b1440p\b|\b(?:qhd|2k)\b/i, "1440p"],
  [/\b1080p\b|\b(?:fhd|fullhd|full\s?hd)\b/i, "1080p"],
  [/\b720p\b|\bhd\b/i, "720p"],
  [/\b(?:480p|sd)\b/i, "480p"],
  [/\b360p\b/i, "360p"],
  [/\b240p\b/i, "240p"],
  // A resolution written as pixels counts too — plenty of names carry 1920x1080 and no
  // "1080p" at all.
  [/\b3840\s?[x×]\s?2160\b/i, "2160p"],
  [/\b2560\s?[x×]\s?1440\b/i, "1440p"],
  [/\b1920\s?[x×]\s?1080\b/i, "1080p"],
  [/\b1280\s?[x×]\s?720\b/i, "720p"],
  [/\b854\s?[x×]\s?480\b/i, "480p"],
];

const extOf = (url) => {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    const m = String(url).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
  }
};

/** The site a URL belongs to, `www.` trimmed — never a full path. */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Is this string an opaque id rather than a name? Never show one. */
export function looksLikeId(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true; // UUID
  if (/^[0-9a-f]{16,}$/i.test(t)) return true; // a bare hash
  if (/^[A-Za-z0-9_-]{22,}$/.test(t) && !/\s/.test(t)) return true; // a token
  if (/^\d+$/.test(t)) return true; // a bare number
  return false;
}

/** The page's own name for itself: `<title>`, then `<h1>`. */
function fromMarkup(html) {
  const text = String(html || "");
  const grab = (re) =>
    (() => {
      const m = text.match(re);
      return m ? decodeEntities(m[1].replace(/\s+/g, " ").trim()) : "";
    })();
  const title = grab(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return title;
  return grab(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decodeEntities = (s) => String(s).replace(/&(#?\w+);/g, (m, k) => ENTITIES[k.toLowerCase()] ?? m);

/**
 * A page title into a name worth showing.
 *
 * Sites decorate: `Watch Dune (2021) Full Movie Online Free | SomeSite`. The decorations
 * are stripped — the trailing `| site`, the `Watch … Online Free` wrapper, the quality
 * and language tags — and what is left is the name. A candidate that turns out to be an id
 * is rejected, which is the whole reason this function exists rather than `slice(0, 40)`.
 */
export function cleanTitle(raw) {
  let t = decodeEntities(String(raw || "")).trim();
  if (!t) return "";
  // The site's own name after a separator is the site's name, not the title's.
  t = t.split(/\s+[|·—–]\s+/)[0].trim();
  t = t.replace(/^\s*(?:watch|download|stream|play)\s+/i, "");
  // **Stripped until it stops changing.** These decorations stack — "Watch Dune (2021)
  // Full Movie Online Free" ends in two of them, and a single anchored pass removes only
  // the last, leaving "… Full Movie" as the name.
  const decoration = /\s+(?:full\s+movie|full\s+episode|online\s+free|free\s+online|online|hd|full\s+hd)\s*$/i;
  for (let i = 0; i < 6 && decoration.test(t); i += 1) t = t.replace(decoration, "").trim();
  t = t.replace(/\.(?:mp4|m4v|mkv|webm|mov|m3u8|mpd|ts)$/i, "").trim();
  t = t.replace(/\b(?:2160p|1440p|1080p|720p|480p|360p|4k|uhd|fhd|web[-.]?dl|webrip|webrip|bluray|blu[-.]?ray|hdrip|dvdrip|x264|x265|hevc|aac|ac3|ddp?5\.?1|hdr|remux)\b/gi, " ");
  t = t.replace(/[._]+/g, " ").replace(/\s*-\s*$/, "").replace(/\s{2,}/g, " ").trim();
  if (looksLikeId(t)) return "";
  return t.slice(0, 90);
}

/** The filename inside a URL, without its extension. */
function fileNameOf(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return last.replace(/\.(?:mp4|m4v|mkv|webm|mov|m3u8|mpd|ts)$/i, "");
  } catch {
    return "";
  }
}

/** The last path segment, whatever it is — the weakest name there is, but still a name. */
function lastSegmentOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return "";
  }
}

/** Best-first: page title, h1, filename, last path segment, then "site stream". */
export function pickTitle({ url = "", pageHtml = "", explicit = "" } = {}) {
  const candidates = [
    cleanTitle(explicit),
    cleanTitle(fromMarkup(pageHtml)),
    cleanTitle(fileNameOf(url)),
    cleanTitle(lastSegmentOf(url)),
  ];
  for (const c of candidates) if (c) return c;
  const domain = domainOf(url);
  return domain ? `${domain} stream` : "Stream";
}

/** Quality from the URL, the file name and the page's own text. */
export function pickQuality({ url = "", pageHtml = "", explicit = "" } = {}) {
  if (explicit && String(explicit).toLowerCase() !== "unknown") return String(explicit);
  const haystack = `${url} ${currentSrcFromMarkup(pageHtml)} ${fileNameOf(url)} ${String(pageHtml || "").slice(0, 4000)}`;
  for (const [re, label] of QUALITY_PATTERNS) if (re.test(haystack)) return label;
  return "unknown";
}

/** The `<video src>` / first `<source src>` a page declares, for the quality sniff. */
function currentSrcFromMarkup(html) {
  const m = String(html || "").match(/<(?:video|source)\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : "";
}

/**
 * Describe one found stream.
 *
 * @param {string} url
 * @param {{ tier?: string, pageUrl?: string, pageHtml?: string, title?: string, quality?: string }} [options]
 */
export function describeStream(url, options = {}) {
  const tier = String(options.tier || "static");
  const format = FORMATS[extOf(url)] || "other";
  const quality = pickQuality({ url, pageHtml: options.pageHtml, explicit: options.quality });
  const protocol = PROTOCOL[tier] || tier;
  // The domain of the *page* when there is one: that is the site the user visited, which
  // is the useful fact, not the CDN the file happens to live on.
  const domain = domainOf(options.pageUrl || "") || domainOf(url);
  const title = pickTitle({ url, pageHtml: options.pageHtml, explicit: options.title });

  const line1 = [domain, quality, format].filter(Boolean).join(" · ");
  const line3 = [`${EMOJI[format] || EMOJI.other} ${format}`, protocol].filter(Boolean).join(" · ");
  return {
    quality,
    format,
    protocol,
    domain,
    title,
    tag: format === "other" ? "direct" : format,
    emoji: EMOJI[format] || EMOJI.other,
    card: { line1, line2: title, line3 },
    // The tier's own name stays on the row: existing callers and the trace lines use it.
    source: tier,
  };
}
