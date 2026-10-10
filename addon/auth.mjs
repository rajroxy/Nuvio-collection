/**
 * **Sign in — Google and GitHub, straight OAuth 2.0.**
 *
 * The app offers exactly two ways in, and neither of them is a password: the account lives
 * with Google or GitHub, and this module is only the half of the handshake a server can do
 * — send the browser to the provider, take the code back, exchange it for a token, read the
 * profile off that token, and remember who it is behind an HttpOnly cookie.
 *
 * ## What it needs
 *
 * A client id and secret from each provider, and a public URL to come back to:
 *
 *   NUVIO_GOOGLE_CLIENT_ID / NUVIO_GOOGLE_CLIENT_SECRET
 *   NUVIO_GITHUB_CLIENT_ID / NUVIO_GITHUB_CLIENT_SECRET
 *   NUVIO_PUBLIC_URL            (e.g. https://tv.example.com — the preview origin works too)
 *
 * The callback to register with each provider is `<NUVIO_PUBLIC_URL>/auth/<provider>/callback`.
 * Without these, signing in is *off* and the profile pane says so — it never pretends to
 * have a login it cannot finish. The endpoint URLs themselves can be overridden
 * (`NUVIO_GOOGLE_AUTHORIZE_URL`, … `_TOKEN_URL`, `_USERINFO_URL`) which is also how the
 * test suite points them at a local stand-in for the provider.
 *
 * ## What it is not
 *
 * - No password is ever stored, and no provider token is kept: only the profile it named.
 * - Sessions live in memory, so a server restart signs everyone out. That is the honest
 *   default for an app whose data still lives on this machine; the day the data moves to an
 *   account, the session store moves with it.
 * - Nothing here is used to *authorise* an API call to Google or GitHub. The token is spent
 *   on one request (who is this?) and dropped.
 */
import { randomBytes } from "node:crypto";

const env = (name, fallback = "") => process.env[name] || fallback;
/** `https://host/` → `https://host` (the callback path is appended to this). */
const trimSlash = (url) => String(url || "").replace(/\/+$/, "");

const PROVIDERS = {
  google: {
    label: "Google",
    id: () => env("NUVIO_GOOGLE_CLIENT_ID"),
    secret: () => env("NUVIO_GOOGLE_CLIENT_SECRET"),
    authorize: () => env("NUVIO_GOOGLE_AUTHORIZE_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    token: () => env("NUVIO_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    userinfo: () => env("NUVIO_GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo"),
    scope: "openid email profile",
    // The OpenID userinfo answer is already the shape we want.
    read: (info) => ({ id: String(info.sub || ""), name: info.name || info.email || "", email: info.email || "", picture: info.picture || "" }),
  },
  github: {
    label: "GitHub",
    id: () => env("NUVIO_GITHUB_CLIENT_ID"),
    secret: () => env("NUVIO_GITHUB_CLIENT_SECRET"),
    authorize: () => env("NUVIO_GITHUB_AUTHORIZE_URL", "https://github.com/login/oauth/authorize"),
    token: () => env("NUVIO_GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
    userinfo: () => env("NUVIO_GITHUB_USERINFO_URL", "https://api.github.com/user"),
    emails: () => env("NUVIO_GITHUB_EMAILS_URL", "https://api.github.com/user/emails"),
    scope: "read:user user:email",
    read: (info) => ({ id: String(info.id || ""), name: info.name || info.login || "", email: info.email || "", picture: info.avatar_url || "" }),
  },
};

/** The providers this build offers, and whether each one can actually finish a sign-in. */
export const authProviders = () =>
  Object.entries(PROVIDERS).map(([key, p]) => ({
    key,
    label: p.label,
    configured: Boolean(p.id() && p.secret()),
  }));

/** Is anything to sign in with set up at all? */
export const authConfigured = () => authProviders().some((p) => p.configured);

/**
 * In-flight sign-ins, by `state`.
 *
 * `state` is the anti-forgery half of the handshake: the value this server made is the
 * value that must come back, so a code from somewhere else cannot be replayed into a
 * session here. Each one is single-use and expires.
 */
const pending = new Map();
const STATE_MS = 10 * 60 * 1000;

/** Who is signed in, by session id. `expires` is a wall-clock time in ms. */
const sessions = new Map();
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const clean = () => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
};

/** The cookie the browser carries. HttpOnly, SameSite=Lax (the callback is a top-level GET). */
export const SESSION_COOKIE = "nuvio_session";

export function readSession(req) {
  clean();
  const raw = String(req.headers.cookie || "");
  const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!hit) return null;
  const id = hit.slice(SESSION_COOKIE.length + 1);
  const found = sessions.get(id);
  return found ? { ...found.user, expires: found.expires } : null;
}

export const signOut = (req) => {
  const raw = String(req.headers.cookie || "");
  const hit = raw.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (hit) sessions.delete(hit.slice(SESSION_COOKIE.length + 1));
};

/**
 * Where to send the browser to sign in.
 *
 * `origin` is where this request came in — the preview origin, a LAN address, the desktop
 * app's own localhost. It is only used when `NUVIO_PUBLIC_URL` is not set, and it is
 * **built from the request**, never from a query parameter: a redirect target a stranger
 * can choose is an open redirect.
 */
export function startUrl(providerKey, origin, next = "") {
  const p = PROVIDERS[providerKey];
  if (!p || !p.id() || !p.secret()) return null;
  clean();
  const state = randomBytes(18).toString("base64url");
  pending.set(state, { provider: providerKey, expires: Date.now() + STATE_MS, next });
  const redirectUri = `${trimSlash(env("NUVIO_PUBLIC_URL") || origin)}/auth/${providerKey}/callback`;
  const url = new URL(p.authorize());
  url.searchParams.set("client_id", p.id());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("state", state);
  // Google needs both to hand back a refresh-less offline-free code; harmless on others.
  if (providerKey === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }
  return { url: url.toString(), state, redirectUri };
}

/**
 * Finish the handshake: code in, session out.
 *
 * Returns the signed-in user, or throws with something worth showing on the page. The
 * `state` is checked *before* the code is spent, and single-use either way.
 */
export async function finish(providerKey, { code = "", state = "", origin = "" } = {}) {
  const p = PROVIDERS[providerKey];
  if (!p) throw new Error("That sign-in is not one this app offers.");
  if (!p.id() || !p.secret()) throw new Error(`${p.label} sign-in is not configured on this server.`);
  clean();
  // **The state is the anti-forgery half.** Only a value this server minted, for this
  // provider, and not yet spent, can finish a sign-in — a code delivered to someone else's
  // browser cannot become a session here.
  const held = pending.get(String(state || ""));
  if (!held || held.provider !== providerKey) throw new Error("This sign-in link has expired — start again.");
  pending.delete(state);
  if (!code) throw new Error("The provider did not return a code.");

  const redirectUri = `${trimSlash(env("NUVIO_PUBLIC_URL") || origin)}/auth/${providerKey}/callback`;
  const body = new URLSearchParams({
    client_id: p.id(),
    client_secret: p.secret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch(p.token(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const tokenText = await tokenRes.text();
  let token = {};
  try {
    token = JSON.parse(tokenText);
  } catch {
    // GitHub answers form-encoded unless asked for JSON; `accept` above asks, but a proxy
    // can still hand back the old shape.
    token = Object.fromEntries(new URLSearchParams(tokenText));
  }
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(token.error_description || token.error || `The provider refused the sign-in (HTTP ${tokenRes.status}).`);
  }

  const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "Nuvio" };
  const info = await (await fetch(p.userinfo(), { headers })).json();
  let user = p.read(info);
  // **GitHub keeps the address private.** `/user` answers `email: null` for anyone whose
  // address is not public, and the address is worth having — it is what names the account.
  if (providerKey === "github" && !user.email) {
    const list = await (await fetch(p.emails(), { headers })).json().catch(() => []);
    const primary = Array.isArray(list) ? list.find((e) => e.primary) || list[0] : null;
    if (primary?.email) user = { ...user, email: primary.email };
  }
  if (!user.id) throw new Error(`The provider did not say who this is.`);

  const sessionId = randomBytes(24).toString("base64url");
  const record = { user: { ...user, provider: providerKey }, expires: Date.now() + SESSION_MS };
  sessions.set(sessionId, record);
  return { user: record.user, sessionId, next: held.next };
}

/** The `Set-Cookie` for a finished sign-in. */
export const sessionCookie = (id, secure) =>
  `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure ? "; Secure" : ""}`;

/** The `Set-Cookie` that ends one. */
export const clearCookie = (secure) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

/** For tests and for a server that wants to know it is empty. */
export const sessionCount = () => sessions.size;
