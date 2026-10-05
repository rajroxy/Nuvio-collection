/**
 * AI providers.
 *
 * The AI section in Settings used to be a handful of switches with nothing
 * behind them: "Ask" handed whatever you typed straight to the plain text search.
 * This module is the API that was missing — a real provider call, with a key you
 * paste in, from a provider that has a free tier.
 *
 * Every provider below is called with plain `fetch` from Node (no SDK to
 * install) and is free to start on:
 *
 *   groq        Groq Cloud        LPU inference, OpenAI-shaped, most generous free tier
 *   google      Google AI Studio  Gemini, free tier
 *   openrouter  OpenRouter        `:free` models, OpenAI-shaped
 *   cerebras    Cerebras Cloud    free tier, OpenAI-shaped
 *
 * The key lives next to the provider keys in `addon/settings.json` and, like
 * them, is never sent back to the browser — `publicSettings()` only reports
 * whether one is set. `hasAiKey()`/`aiReady()` are the server-side truth, so the
 * Ask box degrades to plain search instead of failing when no key is set.
 */
import { getSettings } from "./settings.mjs";

export const AI_PROVIDERS = {
  groq: {
    label: "Groq Cloud",
    free: true,
    // Verified with `node scripts/probe-ai.mjs`: Groq retired
    // `llama-3.1-8b-instant`, and this is what its key serves now.
    model: "openai/gpt-oss-20b",
    shape: "openai",
    chat: "https://api.groq.com/openai/v1/chat/completions",
    models: "https://api.groq.com/openai/v1/models",
    signup: "https://console.groq.com/keys",
    note: "Free tier, fastest responses — the default.",
  },
  google: {
    label: "Google AI Studio",
    free: true,
    model: "gemini-2.0-flash",
    shape: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    signup: "https://aistudio.google.com/app/apikey",
    note: "Free tier with a daily quota; Gemini models.",
  },
  openrouter: {
    label: "OpenRouter",
    free: true,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    shape: "openai",
    chat: "https://openrouter.ai/api/v1/chat/completions",
    models: "https://openrouter.ai/api/v1/key",
    signup: "https://openrouter.ai/keys",
    note: "One key for many models; the `:free` ones cost nothing.",
  },
  cerebras: {
    label: "Cerebras Cloud",
    free: true,
    model: "llama3.1-8b",
    shape: "openai",
    chat: "https://api.cerebras.ai/v1/chat/completions",
    models: "https://api.cerebras.ai/v1/models",
    signup: "https://cloud.cerebras.ai",
    note: "Free tier on wafer-scale hardware.",
  },
};

/** The provider the app will use, or "" for plain search. */
export const aiProviderName = () => {
  const name = String(getSettings().ai?.provider || "");
  return AI_PROVIDERS[name] ? name : "";
};

/** The key for a provider: the one pasted in Settings, else its environment key. */
export function aiKey(name = aiProviderName()) {
  const cfg = AI_PROVIDERS[name];
  if (!cfg) return "";
  return getSettings().ai?.keys?.[name] || process.env[`${name.toUpperCase()}_API_KEY`] || "";
}

export const hasAiKey = (name = aiProviderName()) => Boolean(aiKey(name));

/** An optional model override — providers rename models faster than this ships. */
export const aiModel = (name = aiProviderName()) => getSettings().ai?.model || AI_PROVIDERS[name]?.model || "";

/** Everything the UI needs to describe the AI configuration (never a key). */
export function aiState() {
  const s = getSettings().ai || {};
  const provider = aiProviderName();
  return {
    enabled: s.enabled !== false,
    provider,
    model: s.model || "",
    ready: Boolean(provider) && hasAiKey(provider),
    hasKey: Object.fromEntries(Object.keys(AI_PROVIDERS).map((k) => [k, Boolean(aiKey(k))])),
    providers: Object.fromEntries(
      Object.entries(AI_PROVIDERS).map(([slug, cfg]) => [slug, { label: cfg.label, free: cfg.free, model: cfg.model, note: cfg.note, signup: cfg.signup }]),
    ),
  };
}

const SYSTEM = [
  "You turn a viewer's request into ONE short search query for a movie and TV catalog search box.",
  "Answer with the query only — no quotes, no explanation, at most 6 words.",
  "Keep the genre, mood, decade, country and platform words that are in the request.",
  "If the request names a title, answer with that title.",
].join(" ");

/** One chat completion, in whichever shape the provider speaks. */
async function complete(cfg, key, model, prompt, { maxTokens = 512 } = {}) {
  if (cfg.shape === "gemini") {
    const url = `${cfg.base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text || "").join("");
  }

  const res = await fetch(cfg.chat, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

/**
 * The models a provider will actually accept right now.
 *
 * Providers retire model names without warning — Groq answered a hard-coded
 * `llama-3.1-8b-instant` with HTTP 404 while the same key listed models fine. So
 * a name is never trusted on its own: it is tried, and if the provider rejects
 * it the list is fetched and a current model is used instead.
 */
async function listModels(cfg, key) {
  try {
    const url = cfg.shape === "gemini" ? `${cfg.base}/models?key=${encodeURIComponent(key)}` : cfg.models;
    const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return [];
    const data = await res.json();
    const ids = cfg.shape === "gemini"
      ? (data.models || []).map((m) => String(m.name || "").replace(/^models\//, ""))
      : (data.data || []).map((m) => m.id);
    return ids.filter(Boolean);
  } catch {
    return [];
  }
}

// Of the models a provider offers, the small fast ones are the right shape for
// "one sentence in, six words out".
const SMALL_AND_FAST = /instant|8b|mini|small|flash|oss-|20b|lite|qwen|gemini-\d/i;
// …and these are not general chat models at all: guards, transcribers, voices.
// Groq currently lists several of them, so picking "the first small model" lands
// on a safety classifier that rejects a chat completion.
const NOT_CHAT = /guard|safeguard|whisper|tts|orpheus|embed|rerank|moderation|speech|audio|image|vision/i;

/** Models worth trying, best first — small and fast, then the rest. */
async function chooseModels(cfg, key) {
  const ids = (await listModels(cfg, key)).filter((id) => !NOT_CHAT.test(id));
  return [...ids.filter((id) => SMALL_AND_FAST.test(id)), ...ids];
}

const isModelRejected = (err) => /HTTP (400|404)/.test(String(err?.message || ""));

const tidy = (text) =>
  String(text || "")
    .split("\n")[0]
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(search|query)\s*[:=-]\s*/i, "")
    .trim()
    .slice(0, 120);

/**
 * Turn a sentence into a search query. Never throws: a provider problem comes
 * back as `{ ok: false }` so the caller can fall back to the literal text.
 */
export async function askAI(prompt, opts = {}) {
  const provider = opts.provider || aiProviderName();
  const cfg = AI_PROVIDERS[provider];
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, text: "nothing to ask" };
  if (!cfg) return { ok: false, text: "no AI provider selected" };
  const key = opts.key ?? aiKey(provider);
  if (!key) return { ok: false, text: `no ${cfg.label} key saved` };
  let lastError = "no model answered";

  /** Ask with one model. Returns the successful answer, or the error it hit. */
  const attempt = async (candidate) => {
    try {
      const query = tidy(await complete(cfg, key, candidate, text));
      if (!query) {
        lastError = `${candidate} returned nothing`;
        return null;
      }
      return { ok: true, provider, model: candidate, query, text: `“${query}” · ${cfg.label}` };
    } catch (err) {
      lastError = `${candidate} → ${err.message}`;
      return err;
    }
  };

  const model = opts.model || aiModel(provider);
  const first = await attempt(model);
  if (first?.ok) return first;

  // Two things go wrong in practice: the model name was retired (Groq dropped
  // `llama-3.1-8b-instant` while its key still verified), or the model answers
  // with an empty `content` — which a reasoning model does when its token budget
  // runs out before it writes anything. Both are worth a second opinion, so the
  // provider is asked what it serves now and the best few are tried.
  if (!first || isModelRejected(first)) {
    for (const candidate of await chooseModels(cfg, key)) {
      if (candidate === model) continue;
      const next = await attempt(candidate);
      if (next?.ok) return next;
      if (lastError.includes("→ HTTP 400")) break; // a request problem, not the model
    }
  }
  return { ok: false, text: `${cfg.label} — ${lastError}` };
}

/** Verify a key by actually calling the provider with it. */
export async function verifyAI(name, key) {
  const cfg = AI_PROVIDERS[name];
  if (!cfg) return { ok: false, text: "unknown AI provider" };
  const useKey = key || aiKey(name);
  if (!useKey) return { ok: false, text: "no key saved" };
  try {
    const url = cfg.shape === "gemini"
      ? `${cfg.base}/models?key=${encodeURIComponent(useKey)}`
      : cfg.models;
    const res = await fetch(url, { headers: { authorization: `Bearer ${useKey}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, text: `connected · ${cfg.label}` };
  } catch (err) {
    return { ok: false, text: `${cfg.label} — ${err.message}` };
  }
}
