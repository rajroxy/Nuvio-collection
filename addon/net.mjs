/**
 * The app's network door: one `fetch` that can be told which resolver to ask.
 *
 * Node's `fetch` has no per-request DNS. What it does have is `http.request`'s `lookup`
 * option, which is a drop-in for `dns.lookup` — so the override is built from that: the
 * host is resolved through the resolver configured in `addon/dns.mjs`, and the request is
 * dialled at that address with the original host still in the URL (so TLS SNI and the
 * `Host` header stay correct).
 *
 * `installDnsFetch()` wraps the global `fetch` **once**, and the wrapper consults the DNS
 * config on every call. When the override is off it hands straight over to the platform
 * `fetch` — the default path is byte-for-byte what it was before this file existed, which
 * is why every suite that existed before still passes. When the override is on, the whole
 * app — metadata, catalogs, add-ons, subtitles, debrid, the scraper, the stream proxy —
 * goes through the custom resolver without a single call site changing.
 *
 * A resolver that cannot answer falls back to the system one for that lookup, because a
 * mistyped resolver should make the setting ineffective, not make the app unusable; the
 * Settings button reports which resolver actually answered.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { activeDnsServers, resolver } from "./dns.mjs";

/** The platform fetch, captured the moment the wrapper goes in. */
let nativeFetch = null;
let installed = false;

/** The lookup function `http.request` will use: the configured resolver, then the system. */
function lookupWith(servers) {
  const custom = resolver(servers);
  return (hostname, options, callback) => {
    let opts = options;
    let cb = callback;
    if (typeof opts === "function") {
      cb = opts;
      opts = {};
    }
    const wantAll = Boolean(opts?.all);
    const family = Number(opts?.family) || 0;
    const attempt = async () => {
      if (family === 6) return [await custom.resolve6(hostname), 6];
      if (family === 4) return [await custom.resolve4(hostname), 4];
      // IPv4 first: an override is usually chosen for reachability, and an IPv6 address
      // the host cannot route to reads as a hang rather than as a failure.
      try {
        const [ip] = await custom.resolve4(hostname);
        if (ip) return [ip, 4];
      } catch {
        /* try IPv6 below */
      }
      return [await custom.resolve6(hostname), 6];
    };
    attempt()
      .then(([ip, fam]) => {
        if (!ip) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
        if (wantAll) cb(null, [{ address: ip, family: fam }]);
        else cb(null, ip, fam);
      })
      .catch(() => {
        // The configured resolver failed. The system one gets the request rather than the
        // app getting a hard failure — reported by Settings → DNS → Test.
        dns.lookup(hostname, { family: family || 0 }, (err, address, fam) => {
          if (err) return cb(err);
          if (wantAll) cb(null, [{ address, family: fam }]);
          else cb(null, address, fam);
        });
      });
  };
}

/** One hop, with no redirect handling. */
function requestOnce(u, { method, headers, body, signal, lookup }) {
  return new Promise((resolve, reject) => {
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        lookup,
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** A Node response as a real `Response`, `Set-Cookie` list intact. */
function toResponse(res) {
  const pairs = [];
  for (const [key, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) for (const one of value) pairs.push([key, String(one)]);
    else if (value !== undefined) pairs.push([key, String(value)]);
  }
  const empty = res.statusCode === 204 || res.statusCode === 304 || res.statusCode < 200;
  const body = empty ? null : Readable.toWeb(res);
  return new Response(body, { status: res.statusCode, headers: new Headers(pairs) });
}

const flatHeaders = (h) => {
  if (!h) return {};
  if (typeof Headers !== "undefined" && h instanceof Headers) return Object.fromEntries(h);
  if (Array.isArray(h)) return Object.fromEntries(h.map(([k, v]) => [k, v]));
  return { ...h };
};

/**
 * Encode the body the way `fetch` would, so a `FormData` body keeps its boundary and a
 * `URLSearchParams` body keeps its content type. `Request` already knows both.
 */
async function encode(url, init) {
  const rawMethod = String(init.method || "GET").toUpperCase();
  if (init.body == null || rawMethod === "GET" || rawMethod === "HEAD") {
    return { method: rawMethod, headers: flatHeaders(init.headers), body: undefined };
  }
  try {
    const req = new Request(url, { method: rawMethod, headers: init.headers, body: init.body, duplex: "half" });
    return { method: req.method, headers: Object.fromEntries(req.headers), body: Buffer.from(await req.arrayBuffer()) };
  } catch {
    return { method: rawMethod, headers: flatHeaders(init.headers), body: Buffer.from(String(init.body)) };
  }
}

/**
 * `fetch` through the configured resolver. Redirects are followed by hand because
 * `http.request` has no such thing, and the fetching code here relies on it.
 */
export async function dnsFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (!url) return nativeFetch(input, init);
  const servers = activeDnsServers();
  if (!servers.length) return nativeFetch(input, init);

  const { method, headers, body } = await encode(url, init);
  const lookup = lookupWith(servers);
  let current = new URL(url);
  let useMethod = method;
  let useBody = body;
  let useHeaders = headers;
  const redirect = init.redirect || "follow";
  for (let hop = 0; hop <= 5; hop += 1) {
    const res = await requestOnce(current, { method: useMethod, headers: useHeaders, body: useBody, signal: init.signal, lookup });
    const code = res.statusCode;
    const location = res.headers.location;
    if (redirect === "follow" && location && [301, 302, 303, 307, 308].includes(code)) {
      res.resume();
      if (code === 303 || ((code === 301 || code === 302) && !["GET", "HEAD"].includes(useMethod))) {
        useMethod = "GET";
        useBody = undefined;
        useHeaders = { ...useHeaders };
        delete useHeaders["content-length"];
        delete useHeaders["content-type"];
      }
      current = new URL(location, current);
      continue;
    }
    return toResponse(res);
  }
  throw new Error("too many redirects");
}

/**
 * Point the global `fetch` at `dnsFetch`. Called once, at server start.
 *
 * When no resolver is configured the wrapper is a pass-through, so nothing that worked
 * before behaves differently.
 */
export function installDnsFetch() {
  if (installed) return;
  nativeFetch = globalThis.fetch.bind(globalThis);
  installed = true;
  globalThis.fetch = (input, init) => {
    if (!activeDnsServers().length) return nativeFetch(input, init);
    return dnsFetch(input, init);
  };
}

/** Test seam: restore the platform fetch. */
export const _uninstallDnsFetch = () => {
  if (installed && nativeFetch) globalThis.fetch = nativeFetch;
  installed = false;
};
