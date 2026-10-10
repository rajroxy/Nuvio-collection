/**
 * Tier 3 — a real browser, when nothing else can read the page.
 *
 * The tiers below this one are honest attempts at being cheap: a fetch, then a DOM
 * sandbox. Both fail on the same class of page — one that only works in a real engine
 * (canvas, WebGL, a bot check) — and that is what this tier is: Chromium, driven over
 * CDP, waiting for the page to finish talking to the network, handing back the HTML a
 * visitor would have got.
 *
 * Two things make it usable rather than theoretical:
 *
 * 1. **The stealth plugin.** A default headless Chromium announces itself (navigator
 *    flags, missing plugins, a driver in the connection) and a site that checks for it
 *    serves a challenge instead of a video. The plugin removes those tells, so the page
 *    renders. Use this only on sites you are allowed to read: a site that asks not to be
 *    automated is telling you something, and it is your call whether you may anyway.
 * 2. **One browser, borrowed.** Launching Chromium costs a second and a few hundred
 *    megabytes; a page that needed tier 3 usually needs it again a moment later. The
 *    process is kept alive between calls and shut down after a minute of quiet.
 *
 * This tier is optional. If Playwright or its browser is not installed, the function
 * answers `null` with a reason, and the app keeps working exactly as it did.
 */
import { BROWSER_UA } from "./tier1.js";
import { playwrightCookies } from "./sessions.js";
import { activeDnsServers, resolveHost } from "../addon/dns.mjs";

const DEFAULT_TIMEOUT_MS = Number(process.env.NUVIO_SCRAPER_BROWSER_TIMEOUT_MS) || 30000;
const IDLE_SHUTDOWN_MS = 60000;
/** How many times a bot-check page is given a moment to hand over the real one. */
const CHALLENGE_RETRIES = 6;

/**
 * The words an interstitial uses. Deliberately narrow: a real article that mentions
 * "checking your browser" is not a challenge, and calling it one would make this tier
 * re-read a page it already has.
 */
const CHALLENGE_RE = /just a moment|checking your browser|enable javascript and cookies|cf-chl|_cf_chl_opt|attention required/i;
/** Is this the interoperable interstitial rather than the page? */
export const looksLikeChallenge = (html) => CHALLENGE_RE.test(String(html || ""));

let browserPromise = null;
let idleTimer = null;
let loadedStealth = false;
/** The resolver mapping the live browser was launched with, so a change relaunches it. */
let launchedWith = "";

/** Why the last attempt could not run, so the UI can say something true. */
let lastError = "";
export const browserUnavailableReason = () => lastError;

/**
 * The browser, launched once and reused.
 *
 * `playwright-extra` + the stealth plugin when they are installed; plain Chromium
 * otherwise. A plain headless browser still renders most pages — it is only the sites
 * that actively look for automation that need the disguise.
 */
async function browser(host = "") {
  // **The DNS override reaches the browser too.** Chromium has no "use this resolver"
  // flag, but `--host-resolver-rules` maps a host to an address after resolution — and
  // SNI still comes from the URL, so TLS is unaffected. A different host means a
  // different mapping, and a different mapping means a fresh browser.
  let rules = "";
  const servers = activeDnsServers();
  if (servers.length && host) {
    const found = await resolveHost(host, servers).catch(() => ({ ok: false }));
    if (found.ok && found.ip) rules = `MAP ${host} ${found.ip}`;
  }
  const key = `${rules}`;
  if (browserPromise && key !== launchedWith) {
    const old = browserPromise;
    browserPromise = null;
    try {
      await (await old)?.close();
    } catch {
      /* already gone */
    }
  }
  if (!browserPromise) {
    launchedWith = key;
    browserPromise = (async () => {
      let chromium;
      try {
        const extra = await import("playwright-extra");
        chromium = (extra.default || extra).chromium;
        if (!loadedStealth) {
          const plugin = await import("puppeteer-extra-plugin-stealth");
          chromium.use((plugin.default || plugin)());
          loadedStealth = true;
        }
      } catch {
        // No playwright-extra: the plain driver is still a real browser.
        const playwright = await import("playwright");
        chromium = (playwright.default || playwright).chromium;
      }
      return chromium.launch({
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          ...(rules ? [`--host-resolver-rules=${rules}`] : []),
        ],
      });
    })().catch((err) => {
      // A failed launch must not be cached: the next attempt deserves a fresh one.
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Close the browser once nobody has asked for it for a minute. */
function armIdleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const pending = browserPromise;
    browserPromise = null;
    try {
      const b = await pending;
      await b?.close();
    } catch {
      /* already gone */
    }
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.();
}

/**
 * Load a page in a real browser and return its final HTML.
 *
 * @param {string} url
 * @param {{ timeout?: number, cookies?: Array<object>, referer?: string, detailed?: boolean }} [options]
 * @returns {Promise<string|null|{html: string|null, challenge: boolean}>} the HTML, or —
 *   with `detailed: true` — the HTML and whether it is a bot-check interstitial.
 */
export async function fetchWithStealth(url, options = {}) {
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT_MS;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  lastError = "";
  let context = null;
  const done = (html) => {
    const challenge = Boolean(html) && looksLikeChallenge(html);
    return options.detailed ? { html: html || null, challenge } : html || null;
  };
  try {
    const b = await browser(host);
    armIdleShutdown();
    context = await b.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
    });
    // A session earned earlier (scraper/sessions.js) — a cookie-consent wall or an
    // age gate answered once should not have to be answered again.
    const cookies = Array.isArray(options.cookies) ? options.cookies : playwrightCookies(url);
    if (cookies.length) {
      await context.addCookies(cookies).catch(() => {});
    }
    const page = await context.newPage();
    try {
      // The page is its own referrer: a site that hands its player a file only to a
      // request from its own page is the common case, and the browser should look like
      // one that navigated rather than one that arrived from nowhere.
      if (options.referer) await page.setExtraHTTPHeaders({ referer: String(options.referer) }).catch(() => {});
      await page.goto(url, { waitUntil: "networkidle", timeout });
    } catch {
      // A page that never goes quiet (a poller, a websocket) still has a DOM worth
      // reading. The timeout is the deadline for *the page settling down*, not for the
      // tier failing; only an empty document is a failure.
    }
    /**
     * **A challenge page is not an answer.** Sites that put an interstitial in front of
     * the real page hand it over only after their own script has run; reading
     * `content()` the instant the network goes quiet catches the interstitial. This
     * waits, briefly and a bounded number of times, for the page to become a page —
     * and then reports whatever is there, challenge or not. Nothing here tries to
     * defeat a check that is refusing us: it waits for the site's own script to finish.
     */
    let html = await page.content();
    let unchanged = 0;
    for (let i = 0; i < CHALLENGE_RETRIES && looksLikeChallenge(html) && unchanged < 2; i += 1) {
      await page.waitForTimeout(1200);
      const next = await page.content();
      // A page that is not changing is not about to: two identical reads end the wait
      // rather than spending the whole budget on a site that has decided to refuse us.
      unchanged = next === html ? unchanged + 1 : 0;
      html = next;
    }
    return done(html);
  } catch (err) {
    lastError = String(err?.message || err).split("\n")[0];
    return done(null);
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
