#!/usr/bin/env node
/**
 * Which AI provider actually answers, and with which model?
 *
 * Providers retire model names without warning: Groq's key verifies fine while a
 * hard-coded model name comes back `HTTP 404`. This replays the two calls the
 * addon makes (`/models`, then a chat completion) for every provider that has a
 * key, and prints the model ids the provider currently serves — so the default in
 * `addon/ai.mjs` is a fact rather than a guess.
 *
 *   node scripts/probe-ai.mjs           # providers with a key
 *   node scripts/probe-ai.mjs groq      # just one
 *
 * Reads the key from Settings/the environment through the addon's own module, so
 * no key is ever printed or passed on the command line.
 */
import { AI_PROVIDERS, aiKey, askAI } from "../addon/ai.mjs";

const only = process.argv[2];
const list = Object.entries(AI_PROVIDERS).filter(([slug]) => !only || slug === only);

console.log(`probing ${list.length} AI provider(s)…\n`);

for (const [slug, cfg] of list) {
  const key = aiKey(slug);
  if (!key) {
    console.log(`${slug.padEnd(12)} no key saved`);
    continue;
  }

  const modelsUrl = cfg.shape === "gemini" ? `${cfg.base}/models?key=${encodeURIComponent(key)}` : cfg.models;
  let ids = [];
  try {
    const res = await fetch(modelsUrl, { headers: { authorization: `Bearer ${key}` } });
    const data = await res.json().catch(() => ({}));
    ids = cfg.shape === "gemini"
      ? (data.models || []).map((m) => String(m.name || "").replace(/^models\//, ""))
      : (data.data || []).map((m) => m.id);
    console.log(`${slug.padEnd(12)} models  HTTP ${res.status} · ${ids.length} available`);
    console.log(`${"".padEnd(12)}         ${ids.slice(0, 8).join(", ") || "(none listed)"}`);
  } catch (err) {
    console.log(`${slug.padEnd(12)} models  not reachable — ${err.message}`);
  }

  const ask = async (model) => {
    if (cfg.shape === "gemini") {
      const res = await fetch(`${cfg.base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }] }),
      });
      return { status: res.status, text: await res.text() };
    }
    const res = await fetch(cfg.chat, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 8 }),
    });
    return { status: res.status, text: await res.text() };
  };

  const configured = await ask(cfg.model);
  console.log(`${slug.padEnd(12)} chat    configured model ${cfg.model} → HTTP ${configured.status}`);
  if (configured.status !== 200) console.log(`${"".padEnd(12)}         ${configured.text.slice(0, 220)}`);

  const alternative = ids.find((id) => /instant|8b|mini|small|flash|oss-20b|lite/i.test(id)) || ids[0];
  if (alternative && alternative !== cfg.model) {
    const retry = await ask(alternative);
    console.log(`${slug.padEnd(12)} chat    live model ${alternative} → HTTP ${retry.status}`);
    if (retry.status !== 200) console.log(`${"".padEnd(12)}         ${retry.text.slice(0, 220)}`);
  }
  console.log("");
}

// The addon's own path, including its "the model was retired, find a live one"
// fallback — the thing this probe exists to keep honest.
const asked = await askAI("a cosy animated film for a rainy sunday");
console.log("askAI →", JSON.stringify(asked));

