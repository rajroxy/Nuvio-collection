/**
 * Live TV & Sports — the premium/DTH lineups, and the guide.
 *
 * Sources, in the order the request asked for them:
 *
 *   dth      the **premium, DTH and operator catalogue** (`dth.mjs`): the providers
 *            you subscribe to, read as a lineup and a guide. This is the default,
 *            and it is what the profile is for.
 *   m3u      your own playlist (an M3U/M3U8 URL or a local file) — what your own
 *            box or operator app exports
 *   xtream   an Xtream Codes login (host + username + password)
 *
 * It used to default to a **public free-TV directory** (iptv-org's own category
 * playlists). That is gone: a premium-television profile opening on free public
 * streams is the wrong app, and the directory's channels are not the ones anyone
 * subscribes to. What replaced it is not another public list — it is a catalogue of
 * real DTH/cable/premium operators, per country, read for its **lineup and guide**.
 *
 * Streams are never invented and never shipped: a premium channel's stream is
 * delivered to a subscriber's box. Export it from your own box as an M3U (or log in
 * to your Xtream panel) and the two meet on `tvg-id`: the guide is keyed on it, so
 * your playlist's channel lands exactly on the catalogue's lineup.
 *
 * The guide is XMLTV (`live.epg`, or a picked provider's own public feed). With one
 * set the Guide draws real programmes; without one it still draws the lineup and
 * says so, rather than inventing a schedule.
 *
 * Everything is cached on disk (git-ignored) and re-read on the app's refresh clock.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { getSettings, activeRefreshMinutes } from "./settings.mjs";
import { DTH_PROVIDERS, countryTable, firstProviderEpg, pickedProviders } from "./dth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.NUVIO_LIVE_FILE || path.join(__dirname, "live-cache.json");

/**
 * Codes the catalogue and the country table spell differently.
 *
 * The table says `GB` (`United Kingdom`); a playlist's own channel ids may say
 * `UK`. Picking either has to mean the same country, so the equivalence is spelled
 * out once here instead of being guessed at in two places.
 */
const COUNTRY_EQUIVALENTS = [new Set(["UK", "GB"])];

/** Every spelling a picked code stands for, including its own. */
export function countrySpellings(code) {
  const upper = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return [];
  const group = COUNTRY_EQUIVALENTS.find((set) => set.has(upper));
  return group ? [...group] : [upper];
}

/** Hard caps so a 200 000-channel playlist cannot take the server down. */
const MAX_CHANNELS = 6000;
const MAX_BYTES = 24 * 1024 * 1024;
const FETCH_TIMEOUT = 25_000;

let cache = { at: 0, source: "", error: "", channels: [], groups: [], guide: null, countries: null, providers: null };

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (raw && Array.isArray(raw.channels)) cache = raw;
  } catch {
    /* no cache yet — the first request fills it */
  }
}

function writeCache() {
  try {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  } catch {
    /* read-only fs — keep the in-memory copy */
  }
}

/**
 * A bounded text fetch: a playlist or an EPG is data, not a page to parse.
 *
 * `.gz` is decompressed here. **XMLTV feeds are published gzipped far more often
 * than not** — a full country's guide is tens of megabytes of XML — and a gzip body
 * read as text is binary noise, which is why a perfectly good EPG URL used to look
 * like an empty guide.
 */
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const isGzip = /\.gz(\?|#|$)/i.test(url) || /gzip/i.test(res.headers.get("content-encoding") || "");
    if (isGzip && !/gzip/i.test(res.headers.get("content-encoding") || "")) {
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BYTES) throw new Error("document too large");
      return zlib.gunzipSync(body).toString("utf8");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("document too large");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const titleCase = (s) =>
  String(s || "")
    .split(/[;\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * An M3U/M3U8 playlist → channels.
 *
 * `#EXTINF:-1 tvg-id="…" tvg-logo="…" group-title="Sports",Name` followed by the
 * stream URL. Attributes are optional and every playlist spells them a little
 * differently, so a channel is built from whatever is actually there — the name
 * is the last comma-separated part, and the trailing quality marker
 * ("(1080p)") is dropped from it.
 */
export function parseM3U(text, fallbackGroup = "") {
  const channels = [];
  const lines = String(text).split(/\r?\n/);
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const attrs = {};
      for (const [, key, value] of line.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[key] = value;
      const comma = line.indexOf(",");
      const name = (comma === -1 ? "" : line.slice(comma + 1)).replace(/\s*\([^)]*\)\s*$/, "").trim();
      // The group-title is a `;`-separated list of categories, not a sentence.
      const groups = String(attrs["group-title"] || fallbackGroup)
        .split(";")
        .map((g) => g.trim())
        .filter(Boolean);
      pending = {
        id: attrs["tvg-id"] || "",
        name: name || attrs["tvg-id"] || "Channel",
        logo: attrs["tvg-logo"] || attrs.logo || "",
        groups: groups.length ? groups : ["General"],
        country: (String(attrs["tvg-id"] || "").match(/\.([a-zA-Z]{2})@/) || [])[1]?.toUpperCase() || "",
        url: "",
        epgId: attrs["tvg-id"] || "",
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;
    pending.url = line;
    channels.push(pending);
    pending = null;
    if (channels.length >= MAX_CHANNELS) break;
  }
  return channels;
}

/** Xtream Codes: one login answers with the live streams and their metadata. */
async function xtreamChannels(live) {
  const host = String(live.host || "").replace(/\/$/, "");
  const base = `${host}/player_api.php?username=${encodeURIComponent(live.username || "")}&password=${encodeURIComponent(
    live.password || "",
  )}`;
  const data = JSON.parse(await fetchText(`${base}&action=get_live_streams`));
  if (!Array.isArray(data)) throw new Error("Xtream returned no streams");
  return data.slice(0, MAX_CHANNELS).map((c) => ({
    id: `xc-${c.stream_id}`,
    name: String(c.name || "Channel").trim(),
    logo: c.stream_icon || "",
    groups: [String(c.category_name || "General").trim()],
    country: "",
    url: `${host}/live/${encodeURIComponent(live.username || "")}/${encodeURIComponent(live.password || "")}/${c.stream_id}.m3u8`,
    epgId: c.epg_channel_id || "",
  }));
}

/** A channel name as the guide spells it: "101 Sky Sports Main Event" → "Sky Sports Main Event". */
const cleanChannelName = (value) =>
  String(value || "")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/^\s*\d{1,4}[\s.\-–|]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * An XMLTV document's own **lineup** — one channel per `<channel>` element.
 *
 * This is the half of XMLTV nobody reads: a guide file also declares every channel
 * it carries, with the id the programmes are keyed on, a display name and usually a
 * logo. For a DTH provider that declaration *is* the channel list — the operator's
 * own lineup — so the premium catalogue needs no separate channel data: its EPG
 * feed answers with the lineup and the schedule in one read.
 */
export function epgLineup(text, provider = {}) {
  const out = [];
  const seen = new Set();
  const re = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  let match;
  while ((match = re.exec(String(text)))) {
    const id = (match[1].match(/id="([^"]*)"/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const names = [...match[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => m[1]);
    const icon = (match[2].match(/<icon[^>]*src="([^"]*)"/) || [])[1] || "";
    const name = cleanChannelName(names.find((n) => n && cleanChannelName(n)) || id);
    out.push({
      id,
      epgId: id,
      name: name || id,
      logo: icon,
      groups: [provider.name || "Channels"],
      country: provider.country || "",
      url: "",
    });
    if (out.length >= MAX_CHANNELS) break;
  }
  return out;
}

/**
 * The premium/DTH catalogue, read as a lineup.
 *
 * One read per picked provider, its own EPG feed doing double duty: the `<channel>`
 * elements are the lineup, the `<programme>` elements are the guide. A provider with
 * no public feed still contributes its **name** as a category, so the Categories card
 * says what the catalogue holds even before an EPG URL is set for it.
 *
 * `live.m3u` is your own box's export. It is read once and matched on `tvg-id`, which
 * is what puts a stream URL on the catalogue's channel — the guide never has one.
 */
async function dthChannels(live) {
  const picked = pickedProviders(live.providers);
  if (!picked.length) throw new Error("no providers picked — choose your DTH or operator under Settings → Source");

  const feed = picked.find((prov) => prov.epg)?.epg || String(live.epg || "").trim();
  const streams = String(live.m3u || "").trim()
    ? parseM3U(/^https?:/i.test(live.m3u) ? await fetchText(live.m3u) : fs.readFileSync(live.m3u, "utf8"))
    : [];
  const byEpgId = new Map();
  for (const channel of streams) {
    if (channel.epgId && !byEpgId.has(channel.epgId)) byEpgId.set(channel.epgId, channel.url);
  }

  let lineup = [];
  if (feed) {
    const provider = picked.find((prov) => prov.epg === feed) || picked[0];
    lineup = epgLineup(await fetchText(feed), provider);
  }
  // No public feed (or an empty one): the catalogue's own supplier names are the
  // lineup, so the profile is never an empty screen while a stream source exists.
  if (!lineup.length) {
    lineup = picked.map((prov) => ({
      id: prov.id,
      epgId: "",
      name: prov.name,
      logo: "",
      groups: [prov.name],
      country: prov.country,
      url: "",
    }));
  }
  return lineup.map((channel) => ({ ...channel, url: byEpgId.get(channel.epgId) || channel.url || "" }));
}

/**
 * The country table and the provider catalogue, for the settings screen.
 *
 * Read from the shipped catalogue rather than a third-party directory API, so the
 * pickers work with no network at all.
 */
export function liveCountries() {
  return { countries: countryTable(), providers: DTH_PROVIDERS };
}

/** The groups a channel belongs to, as a flat unique list. */
const groupsOf = (channels) => {
  const counts = new Map();
  for (const c of channels) for (const g of c.groups || []) counts.set(g, (counts.get(g) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
};

/**
 * The channel list, read from the configured source.
 *
 * `force` re-reads it now (the Refresh now button); otherwise a cache younger
 * than the refresh interval is served as-is, which is what makes this update
 * itself on the same clock as every other row.
 */
export async function liveChannels({ force = false } = {}) {
  const live = getSettings().live || {};
  const mode = ["dth", "m3u", "xtream"].includes(live.mode) ? live.mode : "dth";
  const countries = (Array.isArray(live.countries) ? live.countries : []).flatMap((c) => countrySpellings(c)).sort();
  const providers = (Array.isArray(live.providers) ? live.providers : []).map(String).sort();
  const source = `${mode}|${live.m3u || ""}|${live.host || ""}|${live.username || ""}|${providers.join(",")}|${countries.join(",")}`;
  const minutes = Number(live.refreshMinutes) || activeRefreshMinutes();
  const lifetime = minutes > 0 ? minutes * 60_000 : 6 * 3600_000;
  readCache();
  if (!force && cache.channels?.length && cache.source === source && Date.now() - cache.at < lifetime) {
    return cache;
  }
  try {
    const channels =
      mode === "m3u"
        ? parseM3U(/^https?:/i.test(live.m3u || "") ? await fetchText(live.m3u) : fs.readFileSync(live.m3u, "utf8"))
        : mode === "xtream"
          ? await xtreamChannels(live)
          : await dthChannels(live);
    if (!channels.length) throw new Error("no channels in that lineup");
    cache = {
      at: Date.now(),
      source,
      error: "",
      channels,
      groups: groupsOf(channels),
      guide: cache.guide || null,
      countries: cache.countries || null,
      providers: cache.providers || null,
    };
    writeCache();
  } catch (err) {
    // A failed source keeps the last good list rather than emptying Live TV.
    cache = { ...cache, source, error: err.message, at: cache.channels?.length ? cache.at : Date.now() };
  }
  return cache;
}

/* ------------------------------------------------------------------- guide */

/** "20240101120000 +0000" → epoch ms (XMLTV's own timestamp format). */
export function xmltvTime(value) {
  const m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s = "00", tz] = m;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!tz) return base;
  const sign = tz.startsWith("-") ? -1 : 1;
  const offset = (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60_000;
  return base - sign * offset;
}

/**
 * An XMLTV document → programmes per channel.
 *
 * Deliberately a scan rather than a DOM parse: an XMLTV file is tens of
 * megabytes of one flat element, and this only needs the start, the stop, the
 * channel and the title — the four fields the grid draws.
 */
export function parseXMLTV(text, { from, to, limit = 400_000 } = {}) {
  const programmes = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let match;
  let seen = 0;
  while ((match = re.exec(text)) && seen < limit) {
    seen += 1;
    const attrs = {};
    for (const [, key, value] of match[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[key] = value;
    const start = xmltvTime(attrs.start);
    const stop = xmltvTime(attrs.stop);
    if (!attrs.channel || !start) continue;
    if (to && start > to) continue;
    if (from && stop && stop < from) continue;
    const title = (match[2].match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || "";
    const desc = (match[2].match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || "";
    const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    (programmes[attrs.channel] ||= []).push({
      start,
      stop: stop || start + 1800_000,
      title: clean(title) || "Programme",
      desc: clean(desc).slice(0, 200),
    });
  }
  for (const list of Object.values(programmes)) list.sort((a, b) => a.start - b.start);
  return programmes;
}

/**
 * The guide for the next `hours`, keyed by channel id.
 *
 * The URL is your own (`live.epg`) when you have set one, and otherwise the first
 * picked provider's **own** public feed — a DTH provider's guide is its lineup, so
 * picking Tata Play or Sky is enough to get a real schedule. With neither, the
 * answer is empty and the app draws the lineup with "no guide data" rather than a
 * fake schedule.
 */
export async function liveGuide({ hours = 6, force = false, countries = "" } = {}) {
  const live = getSettings().live || {};
  const wanted = String(countries || "")
    .split(",")
    .flatMap((c) => countrySpellings(c))
    .filter(Boolean);
  const all = await liveChannels({ force });
  // The Guide draws the lineup it is given, so scoping it to the picked countries
  // happens here rather than in the grid.
  const channels = wanted.length
    ? (all.channels || []).filter((c) => wanted.includes(String(c.country || "").toUpperCase()))
    : all.channels || [];
  const url = String(live.epg || "").trim() || (live.mode === "m3u" || live.mode === "xtream" ? "" : firstProviderEpg(live.providers));
  if (!url) return { start: Date.now(), end: Date.now() + hours * 3600_000, programmes: {}, channels, epg: false };
  const minutes = Number(live.refreshMinutes) || activeRefreshMinutes();
  const lifetime = minutes > 0 ? minutes * 60_000 : 6 * 3600_000;
  readCache();
  if (!force && cache.guide?.at && cache.guide.url === url && Date.now() - cache.guide.at < lifetime && cache.guide.programmes) {
    return { ...cache.guide.data, channels, epg: true };
  }
  try {
    const now = Date.now();
    const programmes = parseXMLTV(await fetchText(url), { from: now - 6 * 3600_000, to: now + 24 * 3600_000 });
    const data = { start: now, end: now + hours * 3600_000, programmes };
    if (!Object.keys(programmes).length) throw new Error("that EPG answered with no programmes");
    cache = { ...cache, guide: { at: now, url, data } };
    writeCache();
    return { ...data, channels, epg: true };
  } catch (err) {
    return { start: Date.now(), end: Date.now() + hours * 3600_000, programmes: {}, channels, epg: false, error: err.message };
  }
}

/** What the Live TV settings screen reports back about the source. */
export async function liveStatus() {
  const live = getSettings().live || {};
  const list = await liveChannels();
  return {
    mode: ["dth", "m3u", "xtream"].includes(live.mode) ? live.mode : "dth",
    hasEpg: Boolean(String(live.epg || "").trim()) || Boolean(firstProviderEpg(live.providers)),
    hasPassword: Boolean(live.password),
    providers: Array.isArray(live.providers) ? live.providers : [],
    providerNames: pickedProviders(live.providers).map((prov) => prov.name),
    channels: list.channels?.length || 0,
    groups: (list.groups || []).slice(0, 24),
    updated: list.at || 0,
    error: list.error || "",
  };
}
