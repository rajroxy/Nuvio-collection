#!/usr/bin/env node
/**
 * Every published row, through the real addon route.
 *
 *   node scripts/scan-rows.mjs                 # all cards
 *   node scripts/scan-rows.mjs ott             # only card keys containing "ott"
 *   node scripts/scan-rows.mjs "" 0 300        # slice [0,300) of the row list
 *
 * Reports rows whose first window is empty or short, and the total depth a
 * scroll can reach, so "this row doesn't scroll" is measurable.
 */
const B = process.env.NUVIO_UI_BASE || "http://127.0.0.1:4173";
const filter = (process.argv[2] || "").toLowerCase();
const from = Number(process.argv[3] || 0);
const to = Number(process.argv[4] || Infinity);

const cards = await (await fetch(`${B}/collections.json`)).json();
const rowList = [];
for (const card of cards) {
  if (filter && !card.key.toLowerCase().includes(filter)) continue;
  for (const type of ["movie", "series"]) {
    for (const cat of card[type].catalogs) rowList.push({ card: card.title, key: card.key, type, cat });
  }
}

const slice = rowList.slice(from, to);
const empty = [];
const short = [];
const deep = [];

for (const r of slice) {
  let n = 0;
  try {
    n = (await (await fetch(`${B}/catalog/${r.type}/${r.cat.id}.json`)).json()).metas.length;
  } catch {
    n = -1;
  }
  if (n === 0) empty.push(r);
  else if (n < 20) short.push({ ...r, n });
  else deep.push({ ...r, n });
}

const show = (r) => `${r.type.padEnd(6)} ${r.cat.id}`;
console.log(`scanned ${slice.length} rows (${filter || "all cards"})`);
console.log(`EMPTY first window: ${empty.length}`);
empty.slice(0, 40).forEach((r) => console.log(`   ${show(r)}  (${r.card})`));
console.log(`SHORT first window (<20): ${short.length}`);
short.slice(0, 40).forEach((r) => console.log(`   ${String(r.n).padStart(2)}  ${show(r)}  (${r.card})`));
console.log(`OK rows: ${deep.length}`);
