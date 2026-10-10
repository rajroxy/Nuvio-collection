/**
 * **A page under scraping must never be able to stop the app.**
 *
 * The scraper reads the user's Custom Websites by loading their real HTML and running
 * their real scripts (jsdom, and a real browser in the last tier). Those pages run *in
 * this process*: a promise their own script leaves rejected arrives here as Node's
 * `unhandledRejection`, and since Node 20 an unhandled rejection is **fatal** — the
 * process exits. The symptom is not "one site failed"; it is the whole app server gone.
 * The preview URL then answers **502** (nothing is listening) for *everything*: the
 * Custom Sites search, `/stream/torrent`, and the page's own module loads. That is what
 * "Custom Sites could not be searched — HTTP 502" was, and it is why pressing Play could
 * take the app down.
 *
 * So each of these is absorbed: logged once, counted, and kept for `/addon-status.json`
 * so the failure is **visible** rather than silent — but not fatal. A stack whose top
 * frame is an `http(s)://` URL is the scraped page's own code; anything else is this app,
 * and is logged in full so it can be fixed.
 */

const MAX_SAMPLES = 5;

const state = {
  installed: false,
  rejections: 0,
  exceptions: 0,
  pageFailures: 0,
  samples: [],
};

/** Is this stack the scraped page's own script rather than this app's code? */
function fromAPage(reason = "") {
  const isPageFrame = (line) => /https?:\/\/[^\s)]+:\d+:\d+/.test(line);
  if (typeof reason === "string") return isPageFrame(reason);
  const stack = String(reason?.stack || "");
  // The first *frame* decides it; the message line above it never names a file.
  const frame = stack.split("\n").find((l) => l.trim().startsWith("at "));
  return isPageFrame(frame || "");
}

function absorb(kind, reason) {
  const page = fromAPage(reason);
  if (kind === "rejection") state.rejections += 1;
  else state.exceptions += 1;
  if (page) state.pageFailures += 1;

  const label = kind === "rejection" ? "unhandled rejection" : "uncaught exception";
  const who = page ? "a page under scraping" : "this app";
  const detail = String(reason?.message || reason || "").split("\n")[0].slice(0, 200);
  console.error(`[addon] absorbed an ${label} from ${who} — ${detail}`);
  if (!page) console.error(reason?.stack || String(reason)); // ours: the whole trace, to be fixed

  state.samples.push({ kind, who: page ? "page" : "app", detail, at: Date.now() });
  if (state.samples.length > MAX_SAMPLES) state.samples.shift();
}

/** Install the guards once, for whichever entry point started the server. */
export function installProcessGuards() {
  if (state.installed) return;
  state.installed = true;
  // `process.setMaxListeners` is not needed: this is the only listener added, and a
  // second `install` call is a no-op.
  process.on("unhandledRejection", (reason) => absorb("rejection", reason));
  process.on("uncaughtException", (err) => absorb("exception", err));
}

/** What has been absorbed, for the diagnostics route. */
export const guardState = () => ({
  installed: state.installed,
  absorbed: { rejections: state.rejections, exceptions: state.exceptions, fromPages: state.pageFailures },
  samples: state.samples.map((s) => ({ ...s })),
});

export const _reset = () => {
  state.rejections = 0;
  state.exceptions = 0;
  state.pageFailures = 0;
  state.samples = [];
};
