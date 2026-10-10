/**
 * Tier 2 — run the page's own scripts, without a browser.
 *
 * Plenty of media pages ship an empty `<video>` and fill it in with JavaScript, so the
 * markup tier 1 reads is not the page a visitor sees. This tier executes that JavaScript
 * in a **sandboxed DOM** and returns the DOM it ended up with.
 *
 * Why a DOM sandbox rather than a headless browser: it is megabytes instead of hundreds,
 * it starts in milliseconds instead of seconds, and it is the right tool for "let the page
 * build itself". A page that genuinely needs an engine — canvas, WebGL, a bot check — is
 * what tier 3 is for.
 *
 * The sandbox is deliberately closed: **scripts run, everything else is skipped.** This
 * tier is looking for a media URL, not a pixel-perfect render, and fetching every image,
 * font and stylesheet of a stranger's page buys nothing and costs the caller's time.
 */
import { fetchStaticHTML, BROWSER_UA } from "./tier1.js";
import { activeDnsServers } from "../addon/dns.mjs";

const DEFAULT_WAIT_MS = 2500;
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Render a page and return the HTML it settled on.
 *
 * @param {string} url
 * @param {{ wait?: number, timeout?: number, cookies?: string }} [options]
 * @returns {Promise<string|null>} the rendered HTML, or `null` if the page could not be read
 */
export async function renderJS(url, options = {}) {
  const wait = Number(options.wait) || DEFAULT_WAIT_MS;
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT_MS;

  // The page is fetched by tier 1's reader, so this tier inherits the same User-Agent,
  // the same deadline and the same cookies the caller passed in.
  // Only a cookie *string* is passed on; an array is Playwright's shape and belongs to
  // tier 3. Left undefined, tier 1 fills it from the saved session for this domain.
  const html = await fetchStaticHTML(url, {
    cookies: typeof options.cookies === "string" ? options.cookies : undefined,
    referer: options.referer,
    timeout,
  });
  if (!html) return null;

  let jsdom;
  try {
    jsdom = await import("jsdom");
  } catch {
    // jsdom is optional: without it this tier simply cannot answer, and the tiers below
    // still can. It must never be the reason a plain page fails to resolve.
    return null;
  }
  const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

  // jsdom 30 replaced its `ResourceLoader` class with interceptor functions. Both shapes
  // are supported here because the app ships against whichever version is installed —
  // and "usable" (load everything) is the safe older behaviour.
  let resources = "usable";
  if (typeof requestInterceptor === "function") {
    // **When a DNS override is in force, the sandbox's own script loads go through the
    // app's fetch**, which is the only thing that knows the resolver. Returning a
    // Response for every script keeps jsdom from dialling out itself; without an override
    // the request goes through jsdom's own loader, exactly as before.
    const viaDns = activeDnsServers().length > 0;
    resources = {
      userAgent: BROWSER_UA,
      interceptors: [
        requestInterceptor(async (request, context) => {
          const asScript = context?.element?.tagName === "SCRIPT" || /\.m?js(\?|$)/i.test(request.url);
          // A non-script resource is not needed to find a video; an empty response stops it.
          if (!asScript) return new Response("", { status: 204 });
          if (!viaDns) return undefined;
          try {
            const res = await fetch(request.url, {
              headers: {
                "user-agent": BROWSER_UA,
                ...(options.referer ? { referer: options.referer } : {}),
                ...(options.cookies ? { cookie: options.cookies } : {}),
              },
            });
            return new Response(res.body, { status: res.status, headers: res.headers });
          } catch {
            return new Response("", { status: 204 });
          }
        }),
      ],
    };
  }

  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources,
    // A broken page must not print its console into the app's log at full volume.
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      // jsdom is a DOM, not a browser: a page that loads its video with `fetch` would
      // otherwise stop at "fetch is not defined". The sandbox gets a real one, carrying
      // the caller's cookies.
      window.fetch = (input, init = {}) =>
        fetch(new URL(String(input), url).href, {
          ...init,
          headers: { ...(init.headers || {}), ...(options.cookies ? { cookie: options.cookies } : {}) },
        });
      window.alert = () => {};
    },
  });

  try {
    // `load` is the honest moment: inline scripts have run and every script this tier
    // fetched has executed. The extra wait covers the page that starts working only after
    // its own timers, promises or data requests have settled.
    await Promise.race([
      new Promise((resolve) => {
        if (dom.window.document.readyState === "complete") return resolve();
        dom.window.addEventListener("load", resolve, { once: true });
      }),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return dom.serialize();
  } catch {
    return null;
  } finally {
    try {
      dom.window.close();
    } catch {
      /* already gone */
    }
  }
}
