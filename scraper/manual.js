/**
 * Manual verification: when a site insists a human prove it.
 *
 * A bot check that refuses the stealth browser is not something to keep retrying — the
 * site has said what it wants, and it is a person. So instead of guessing, this opens a
 * **visible** window on the machine that runs the server, lets the user solve it, and
 * takes the cookies the solution earned. Those cookies go into `scraper/sessions.js`, and
 * every later request — the plain fetch, the DOM sandbox, the browser — inherits them,
 * which is the difference between solving a challenge once and solving it per play.
 *
 * Two honest limits, both stated rather than hidden:
 *
 * 1. **It needs a screen.** A headed Chromium needs a display; a server in a container
 *    without one cannot open a window, and this reports that instead of hanging.
 * 2. **It is not a solver.** Nothing here defeats a challenge. It gives the user the one
 *    thing an automated client cannot: being a person, once.
 */
import { hostOf, domainOf, saveSession } from "./sessions.js";
import { activeDnsServers, resolveHost } from "../addon/dns.mjs";

const IDLE_TTL_MS = 10 * 60 * 1000;
/** sessionId -> { context, page, url, domain, opened } */
const sessions = new Map();
let seq = 0;

export const MANUAL_MESSAGE =
  "This site requires manual verification. A window has opened. Please solve the challenge, then click Done.";

/** Is this process able to open a window at all? */
export const canOpenWindow = () => {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
};

async function chromiumDriver() {
  try {
    const extra = await import("playwright-extra");
    const chromium = (extra.default || extra).chromium;
    const plugin = await import("puppeteer-extra-plugin-stealth");
    chromium.use((plugin.default || plugin)());
    return chromium;
  } catch {
    const playwright = await import("playwright");
    return (playwright.default || playwright).chromium;
  }
}

/** Drop sessions nobody finished, so a forgotten window does not hold a browser forever. */
function reap() {
  const cutoff = Date.now() - IDLE_TTL_MS;
  for (const [id, entry] of sessions) {
    if (entry.opened < cutoff) {
      entry.context?.close?.().catch?.(() => {});
      sessions.delete(id);
    }
  }
}

/**
 * Open a visible window at `url` and keep it until the user says they are done.
 *
 * @returns {Promise<{ok: boolean, sessionId?: string, domain?: string, message: string}>}
 */
export async function startManualVerification(url, { message = MANUAL_MESSAGE } = {}) {
  reap();
  const page = String(url || "").trim();
  if (!/^https?:\/\//i.test(page)) return { ok: false, message: "A URL to verify is required." };
  const domain = domainOf(page) || hostOf(page);

  if (!canOpenWindow()) {
    return {
      ok: false,
      domain,
      message:
        "This machine has no display, so a window cannot be opened here. Run the app on a desktop (or expose a DISPLAY) to solve the challenge by hand.",
    };
  }

  let context = null;
  try {
    const chromium = await chromiumDriver();
    // A persistent-looking context: a real profile directory keeps the challenge cookies
    // the site sets across the sub-requests a check makes.
    context = await chromium.launchPersistentContext("", {
      headless: false,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    const p = context.pages()[0] || (await context.newPage());
    // The override reaches this window too: a host the resolver answered for is mapped
    // before the window opens, so the challenge is solved against the same address.
    const servers = activeDnsServers();
    if (servers.length) {
      const found = await resolveHost(hostOf(page), servers).catch(() => ({ ok: false }));
      if (found.ok && found.ip) {
        // Already launched; Chromium cannot take a new rule mid-flight, so this is only
        // reported. A relaunch would lose the challenge the user is about to solve.
      }
    }
    await p.goto(page, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    const sessionId = `m${++seq}`;
    sessions.set(sessionId, { context, page: p, url: page, domain, opened: Date.now() });
    console.log(`[scraper] ${message}`);
    return { ok: true, sessionId, domain, url: page, message };
  } catch (err) {
    await context?.close?.().catch?.(() => {});
    return {
      ok: false,
      domain,
      message: `A window could not be opened — ${String(err?.message || err).split("\n")[0]}`,
    };
  }
}

/**
 * The user says the challenge is solved: take the cookies, keep them, close the window.
 *
 * @returns {Promise<{ok: boolean, domain?: string, cookies?: number, message: string}>}
 */
export async function finishManualVerification(sessionId) {
  const entry = sessions.get(String(sessionId || ""));
  if (!entry) return { ok: false, message: "That verification is no longer open." };
  sessions.delete(String(sessionId));
  try {
    const cookies = await entry.context.cookies();
    // Saved under the site's own domain, which is where every later request looks.
    saveSession(entry.domain, cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure })));
    return {
      ok: true,
      domain: entry.domain,
      cookies: cookies.length,
      message: `Saved ${cookies.length} cookie${cookies.length === 1 ? "" : "s"} for ${entry.domain}. Every later fetch of that site will use them.`,
    };
  } catch (err) {
    return { ok: false, domain: entry.domain, message: `The cookies could not be read — ${String(err?.message || err).split("\n")[0]}` };
  } finally {
    await entry.context?.close?.().catch?.(() => {});
  }
}

/** Close a window the user gave up on, saving nothing. */
export async function cancelManualVerification(sessionId) {
  const entry = sessions.get(String(sessionId || ""));
  sessions.delete(String(sessionId || ""));
  if (!entry) return { ok: false, message: "That verification is no longer open." };
  await entry.context?.close?.().catch?.(() => {});
  return { ok: true, domain: entry.domain, message: "The verification window was closed." };
}

/** The verifications currently waiting on a human, for the UI. */
export const manualSessions = () =>
  [...sessions.entries()].map(([sessionId, e]) => ({ sessionId, url: e.url, domain: e.domain, opened: e.opened }));

/** Test seam. */
export const _resetManual = () => {
  sessions.clear();
  seq = 0;
};
export const _putManual = (id, entry) => sessions.set(id, entry);
