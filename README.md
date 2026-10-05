# Nuvio — collection covers & catalog addon

Two things that ship together:

1. **Cover art** — landscape (16:9) covers for every Nuvio collection, in both the
   **movies** and **shows** rows, as animated SVG masters and 1920×1080 PNG exports.
2. **A catalog addon** — a Stremio/Nuvio addon that turns each cover into a live
   home-screen row, backed by TMDB.

```
covers/
  movies/<collection>.svg   animated SVG master (vector — crisp at any size)
  movies/<collection>.png   1920×1080 export (rendered with Inter)
  shows/<collection>.svg
  shows/<collection>.png
  manifest.json             machine-readable index (title, subtitle, row, paths)
  index.html                open this in a browser to preview every cover
addon/
  index.mjs                 addon handler: /manifest.json + /catalog/*
  catalogs.mjs              the plan: each collection → TMDB queries
  tmdb.mjs                  TMDB client (cache, genre resolution)
  watchlist.mjs             the pins: plan to watch / watching / watched
  watchlist.json            RUNTIME: your pinned titles (git-ignored)
  ai.mjs                    the free AI providers behind the Ask box
  selftest.mjs              runs the handler against a stubbed TMDB (`npm test`)
scripts/
  collections.mjs           the collection set — single source of truth
  tmdb-verified.json        GENERATED: provider ids, regional OTT services,
                            keyword ids — every one verified to return titles
  probe-tmdb.mjs            regenerates tmdb-verified.json against live TMDB
  regional-candidates.mjs   the OTT brands tried for each country
  probe-countries.mjs       adds only the new countries to the fact table
  probe-genre-decades.mjs   verifies the Genre from ◆ Decades rows, per row type
  probe-ott.mjs             every OTT row, and which filter empties one
  probe-ai.mjs              which AI provider answers, and which models it serves
  scan-rows.mjs             every published row, and how deep it can be scrolled
  audit-catalogs.mjs        asks TMDB for every row, reports the empty ones
  ui-smoke.mjs              runs the whole UI headless (jsdom) against the server
  generate-covers.mjs       renders the SVG masters and the PNG exports
desktop/                    Electron desktop app; ui/ is plain web so the same
                            UI ports to Android TV via Capacitor (see its README)
  android/                  the generated Capacitor Android TV project
desktop/android/            leanback manifest + Gradle wrapper (needs a JDK to build)
serve.mjs                   server: gallery + addon on one origin
```

All 21 collections × 2 rows = **42 covers**. In the app the order is **Watchlist
first**, then a vertical divider, then **Discover ◆ Top 10** and the rest:

| # | Collection | # | Collection |
|---|---|---|---|
| 1 | **Watchlist** ¦ divider | 12 | Regional OTT – Top 10 |
| 2 | **Discover ◆ Top 10** | 13 | **Popular Regional OTT** |
| 3 | On the Board | 14 | Regional OTT |
| 4 | Discover | 15 | Continental |
| 5 | Popular by Genre | 16 | Countries |
| 6 | Genres | 17 | Runtimes |
| 7 | Popular by Decade | 18 | Based on the |
| 8 | Decades | 19 | Moods & Vibes |
| 9 | Genre from Decades | 20 | Themes & Tags |
| 10 | Global OTT – Top 10 | 21 | |
| 11 | **Popular Global OTT** | | |

## Design

- **Vector scenes.** Every cover pairs the collection title with a scene drawn procedurally in
  SVG — stage beams, radar sweeps, contour lines, orbit rings and so on. One distinct scene per
  collection. No photographs, so the set is perfectly consistent and infinitely crisp.
- **Typography** — Inter throughout, weight 800, tight `-0.035em` tracking. Every cover title
  renders at one uniform size (the largest that fits every collection), so no card's text is
  smaller than another's.
- **Subtitles** — under the title, a card names the catalogs that live inside it (e.g. Discover
  → Latest · New Release · Trending · Popular · Top Rated; On the Board → Now Playing for movies,
  Airing Today · Airing This Week · On the Air for shows). Names wrap and shrink to fit. Never an
  editorial descriptor. A card with no catalogs is title-only.
- **Colour** — a single near-black field (`#08090C`, matching the Nuvio home background) with a
  panel of hairline ivory strokes and a soft champagne glow. One accent colour (`#C8A96A`) used
  sparingly; **no hue shifting anywhere**.
- **Rows** — the **shows** scene is mirrored horizontally so the two rows stay related but
  distinct, without rotating hue.
- **Animated** — the SVG masters breathe the champagne glow slowly. No hue rotation. Motion is
  disabled under `prefers-reduced-motion`.
- **Crisp** — the PNGs are rasterised straight from the vector at 1920×1080, so there is no
  upscaling blur. The SVGs stay sharp at any resolution.

## Catalog addon

`serve.mjs` serves the cover gallery **and** the addon from one origin:

| Route | What it returns |
|---|---|
| `/` | redirects to `/app/` — the web app (same UI as the desktop app) |
| `/app/` | the app UI: movies/shows, collections, live rows |
| `/app/...` | the app UI assets |
| `/gallery` | the cover gallery (every cover, with PNG/SVG downloads) |
| `/manifest.json` | addon manifest — one row per catalog (445 for the configured country) |
| `/catalog/{type}/{id}.json` | one live row of titles, e.g. `/catalog/movie/nuvio-discover--trending.json` |
| `/catalog/{type}/{id}/skip=100.json` | the same row, paged |
| `/catalog/{type}/{id}/shuffle=12.json` | a random sample of that row |
| `/collections.json` | every card + the catalogs it owns (used by the desktop app) |
| `/settings` | GET/POST the app's settings (profile, providers, tracking, AI, **content source**, **language**, **country**), plus the language and country lists the Content pane is built from |
| `/watchlist.json` | GET the pinned titles + per-state counts |
| `/watchlist` | POST `{item, state}` to pin/move, or `{item, remove:true}` to unpin |
| `/ai.json` | which free AI providers exist, which is chosen, whether a key is set |
| `/ai/ask` | POST `{prompt}` — turns a sentence into a search query via that provider |
| `/ai/verify` | POST `{provider}` — checks that provider's stored key live |
| `/search.json` | `?q=` — title search across movies and shows |
| `/providers.json` | the same, plus which provider is active |
| `/providers/verify` | POST `{name}` — checks that provider's stored key live |
| `/api/source` | POST `{type,url}` — reads an add-on's manifest or a repo's `repo.json` **server-side** |
| `/calendar/{type}/{YYYY-MM}.json` | every title releasing that month, each with its date |
| `/posters/check` | verifies the configured poster service returns an image |
| `/addon-status.json` | diagnostics (does it see a TMDB key, how many catalogs) |

Each catalog that lives inside a card is published as its own row — the same names
drawn on the cover:

| Card | Catalogs (movies / shows) |
|---|---|
| Watchlist | `Plan to Watch` · `Watching` · `Watched` (both) — served from your pins, not from TMDB |
| Discover ◆ Top 10 | Latest/New Release/Trending/Popular/Top Rated, each **Top 10** (both) |
| On the Board | Now Playing / Airing Today · Airing This Week · On the Air |
| Discover | Latest · New Release · Trending · Popular · Top Rated (both) |
| Popular by ◆ Genre | `Popular in <Genre>` — movie genres / TV genres |
| Genres | `<Genre>` — movie genres / TV genres |
| Popular by ◆ Decade | `Popular in <decade>s` (both) |
| Decades | `<decade>s`, 1950s–2020s (both) |
| Genre from ◆ Decades | `<Genre> ◆ 1950 → Present` — movie genres / TV genres (both) |
| Global OTT ◆ Top 10 | `<Platform> ◆ Top 10` — Netflix, Prime Video, Disney+, Max, Apple TV+, Paramount+ (both) |
| Popular Global OTT | `Popular <Platform>` — that platform's most popular right now (both) |
| Global OTT | `<Platform>` — everything on that platform (both) |
| Regional OTT Top 10 | `<Service> ◆ Top 10` — **your country's** services (both) |
| Popular Regional OTT | `Popular <Service>` — **your country's** services (both) |
| Regional OTT | `<Service>` — everything on your country's own services (both) |
| Continental | continent names (both) |
| Countries | 60 country names (movies) / 59 (shows — Ghana has no series on TMDB) |
| Runtimes | `30+ mins … 120+ mins` (**movies**) / `4 · 6 · 8 · 10 Episodes` (**shows**) |
| Based on the | Books · Comics · Graphic Novels · Video Games · True Stories · Plays · Short Stories (both) |
| Moods & Vibes | Adrenaline Rush · Mind Bending · Cozy & Comforting · Epic & Sweeping · Feel Good · Slow Burn · Tearjerkers · Dark & Gritty · Nostalgic · Suspenseful · Whimsical · Romantic (both) |
| Themes & Tags | Detective · Gangster · Superhero · Time Loop · Animal Attack · Slasher · Possession · Zombie · Heist · Spy · Dystopia · Artificial Intelligence · Vampire · Werewolf · Witch · Alien · Amnesia · Courtroom · Sports · Survival · Revenge · Cursed · Road Trip (both) — **not Documentary**: that is a genre, not a theme |

The three **Regional OTT** cards follow the **country** set in Settings: the rows
are that country's own services, verified to return titles in `tmdb-verified.json`
(US → Hulu · Peacock Premium · Pluto TV, IN → JioHotstar · Zee5 · aha, GB → BBC
iPlayer · ITVX · Channel 4, …). They used to publish *every* region's services —
107 rows per card, almost all of them unwatchable from where you are — so the
cards are now title-only on the cover as well: the card is the same everywhere,
and the services inside it are yours. A country with no verified service (Ghana)
publishes an empty card rather than an invented one, and the Content pane says so
before you pick it. Each regional row id carries its region
(`nuvio-regional-ott--jiohotstar-in`), so two countries can never collide on one
catalog id.

**Watchlist** is a real card with a real row. A shared addon cannot know your
account, so the rows are served from the pins stored in `addon/watchlist.json`
(runtime state, git-ignored) rather than from TMDB — pin a title in the app and it
appears in `Plan to Watch`, `Watching` or `Watched`, and it appears in Nuvio too,
because the addon publishes those three catalogs like any other.

**Genre from ◆ Decades** used to publish the movie genres only, which left the
shows row empty. It publishes both now, each from its own verified list: TV
genres are a different set (there is no "Science Fiction", there is "Sci-Fi &
Fantasy"), and `scripts/probe-genre-decades.mjs` checks every combination
returns titles from 1950 before it is published — all 18 movie genres and all 16
show genres pass, so nothing is dropped.

### No empty rows — and how that is guaranteed

TMDB data drifts (HBO Max became Max; Paramount+ in the US became "Paramount Plus
Premium"; its keyword search answers "based on novel" with "based on visual
novel"; Ghana has films but no series; the "uplifting" keyword has films but no
series). Guessing any of that produces a catalog row that is permanently empty.

So nothing in `collections.mjs` is guessed. `scripts/probe-tmdb.mjs` asks TMDB
for the real provider ids, each region's real OTT services and each keyword id,
**verifies every one returns titles — per media type** — and writes
`scripts/tmdb-verified.json`. `scripts/audit-catalogs.mjs` then asks TMDB for
every single published row and reports any that come back empty:

```sh
node scripts/probe-tmdb.mjs      # re-verify provider ids / keywords (needs a key)
node scripts/probe-countries.mjs # add just the newest countries to the table
node scripts/probe-genre-decades.mjs # re-verify the Genre from ◆ Decades rows
node scripts/probe-ott.mjs      # every OTT row, and which filter empties one
node scripts/audit-catalogs.mjs # every row, against live TMDB
```

Run the probe again when TMDB renames or moves a service. `probe-countries.mjs`
probes **only** the countries missing from the fact table and merges them in, so
the list (now **60 countries**) can grow without a full re-probe.

A catalog is identified by `(type, id)`, and TMDB paths map the Stremio `series`
type to TMDB's `tv`. Three entry kinds need care: **genre** names are resolved to
TMDB ids at request time (movie and TV genre sets differ), **keywords** resolve each
candidate name and use the first hit, and **episodes** cannot be filtered by TMDB
discover — those rows are built from a pool of newest + popular shows and kept to
`<= N` episodes.

**Keyword rows carry no vote floor.** TMDB's keyword tagging is thin — `epic` has
barely a dozen films even with no floor — and a `vote_count` floor left rows like
*Epic & Sweeping* with three titles. Dropping it (popularity ordering still leads)
widened the thinnest rows — measured *Epic & Sweeping* 3 → 11, *Adrenaline Rush*
4 → 9, *Cozy & Comforting* 14 → 40 — and left the busy ones at 40.

**Paging.** Rows read TMDB 20 titles at a time into a growing, cached pool, so a
window of 40 continues where the last stopped. A row serves up to 300 titles; the
`◆ Top 10` rows stop at ten.

**Nothing else is capped.** The OTT cards' `Popular`/everything rows used to carry
a `take` of 30/40, which made an OTT card the one place whose rows ended after a
couple of screens while every other card kept going — the reported "OTT cards
don't scroll". They are uncapped now, like the rest. In the app a row also keeps
loading as you scroll it: reaching the end of a strip asks the server for the next
window, so a row behaves the same whether you scroll it sideways or open it in
Explore.

### Symbols on the covers

Covers render with the bundled Inter fonts and system fonts disabled, so a glyph
Inter lacks becomes an empty box. `◆`, `→`, `★`, `·`, `•`, `–` and `—` are all
present and safe to use — and, per the design, are used to set off `Top 10`,
`from … to` ranges and separators. Avoid `✦`, `➜` and other decorative arrows:
Inter does not contain them.

Only the `catalog` resource is advertised — **no search, no discover**. Rows are refreshed from
TMDB and cached in memory for 30 minutes (`TMDB_CACHE_TTL_MS` to change it).

**Install it in Nuvio:** add `https://<your-host>/manifest.json` as an addon. Each catalog's
`name` is the same string drawn as the cover subtitle, so you can pair each row with its art.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `TMDB_API_KEY` | — | **Required.** TMDB v3 key or v4 read token. Catalogs stay empty without it. |
| `NUVIO_REGION` | `US` | Default for the **country** setting: the region the three Regional OTT cards and the global platform rows are scoped to. |
| `NUVIO_LANGUAGE` | `en-US` | Default for the **language** setting: the language every row is served in, and the primary subtitle language. |
| `TMDB_CACHE_TTL_MS` | `1800000` | Catalog cache window. |

### Watchlist

A shared addon can't know your account, so the Watchlist is backed by
`addon/watchlist.json` — runtime state, written by the app, git-ignored. A title
is pinned **from the app**: open any title and choose `Plan to Watch`, `Watching`
or `Watched`. Choosing the state it is already in unpins it, so a mis-tap is one
click to undo, and a pin moves between rows as you progress through it. A pin is
keyed by type *and* id — TMDB numbers films and shows in one id space, so
`tmdb:550` as a film and as a show are two different pins.

```sh
curl localhost:4173/watchlist.json
curl -X POST localhost:4173/watchlist -H 'content-type: application/json' \
  -d '{"item":{"id":"tmdb:550","type":"movie","name":"Fight Club"},"state":"planned"}'
```

### AI providers (free)

The Ask box in **Settings → AI** is a real integration, not a text box. Pick one of
the free-tier providers, paste its key, and "tell me what to watch" is turned into
a search query by the model; `POST /ai/ask` does the call, `POST /ai/verify` checks
the key, and the answer is handed to the title search (`/search.json`).

| Provider | Key | Free tier |
|---|---|---|
| **Groq Cloud** (default) | `GROQ_API_KEY` | yes — LPU inference, OpenAI-shaped |
| **Google AI Studio** | `GOOGLE_API_KEY` | yes — Gemini |
| **OpenRouter** | `OPENROUTER_API_KEY` | yes — its `:free` models |
| **Cerebras Cloud** | `CEREBRAS_API_KEY` | yes |

Every call is plain `fetch` from Node, so there is no SDK to install, and the key
is stored beside the provider keys in `addon/settings.json` — never returned to
the browser (`/settings` and `/ai.json` report only *whether* a key is set). With
no key the Ask box still works: it searches the words you typed. The model can be
overridden in the same section, since providers rename models faster than this
ships.

**A retired model name is a hiccup, not an outage.** Groq dropped
`llama-3.1-8b-instant` while the same key still verified fine, so the model is
never trusted on its own: if a model is rejected the provider's own model list is
read and the small, general-chat ones (never a guard model or a transcriber) are
tried in turn. `node scripts/probe-ai.mjs` prints what each provider answers and
which models it currently serves, so the defaults stay facts rather than guesses.

### SFW / NSFW

The app's Content setting rides along as `?adult=1` on a catalog request; the
addon maps it to TMDB's `include_adult`. TMDB excludes adult titles by default,
so the switch is only ever able to add them. The three `/now_playing`,
`/airing_today` and `/on_the_air` endpoints take no such parameter and are
unaffected.

### Verify

```sh
npm test                        # addon handler against a stubbed TMDB — no key needed
npm run test:ui                 # the whole UI, headless in jsdom, against the server
node scripts/probe-ai.mjs       # which AI providers answer (needs a key)
node scripts/scan-rows.mjs ott  # how deep each OTT row can be scrolled
node scripts/audit-catalogs.mjs # every catalog row against live TMDB (needs a key)
```

`npm run test:ui` boots `desktop/ui` in jsdom against the running server and walks
every screen, failing on any uncaught error — it stands in for "look at it in a
browser" on a headless sandbox.

### Better posters (on by default)

Every poster is upgraded through [BetterPosters](https://btttr.cc/), silently —
no `BTTR` badge is drawn on the cards. Its URL pattern is keyed by **IMDb id**: `https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg`.
A TMDB list item has no IMDb id, so one is resolved from TMDB's `external_ids`
endpoint and cached for a day. A title with no IMDb id keeps its original
artwork, and the AI setting *"give the same treatment to posters without a better
poster"* upscales exactly those by requesting the next-bigger TMDB size. The
pattern and an optional API key live in **Settings → Posters**, so another service
can be used without touching code; `GET /posters/check` verifies the pattern
really returns an image.

### Second metadata provider

TMDB is the only source that can answer the discover queries, so it backs every
row. **MDBList** is wired as a real metadata provider: enable it with a key and
each title's rating is replaced by MDBList's aggregated one — the catalog names
are unchanged, the contents are richer. `POST /providers/verify {name}` checks a
stored key against the provider (TMDB, MDBList or TVDB) so "enabled" means
connected. Keys are stored in `addon/settings.json` (git-ignored) and are never
returned by any endpoint.

### Content source: TMDB or TVDB

**Settings → Content** picks which provider supplies what a row *shows*:

| Source | Rows are chosen by | Names, translations, artwork come from |
|---|---|---|
| **TMDB** (default) | TMDB discover | TMDB |
| **TVDB** | TMDB discover | **TVDB** |

TMDB is the only provider that can *generate* a row at all — its discover endpoint
is what answers "90s action on Netflix", and TVDB has no equivalent filter engine.
TVDB does have authoritative per-title content (name, translations, year,
artwork), keyed by the IMDb id every row already resolves for its poster. So with
the content source on **TVDB**, every catalog in the app and in Nuvio shows TVDB's
titles in the language set in Settings; the rows themselves — which titles are in
them — stay TMDB's.

Details that make it safe to switch:

- The title's `id` stays `tmdb:` — row membership, watchlist pins and the title
  modal do not move when the source does.
- TVDB needs to be enabled **with a key** (Settings → Providers). Asking for TVDB
  without one falls back to TMDB content rather than serving blank rows, and
  `/addon-status.json` says what is actually in force: `contentSource` (asked),
  `contentSourceActive` (in force) and `contentSourceStats` (how many titles were
  upgraded).
- Lookups are bounded to the first 8 titles of a row, cached for a day, and fail
  soft — a title TVDB cannot answer for keeps its TMDB content instead of dropping
  out of the row.
- When TVDB is the source it owns the artwork too: it runs after the poster
  service, so the poster pattern only stands for titles TVDB had no art for.

TVDB's own API shape is stubbed in `npm test`; no live TVDB key was available when
this shipped, so `contentSourceStats` is the thing to look at on a real key.

### Sources are read on the server

`POST /api/source` fetches an add-on's `manifest.json` (or a repository's
`repo.json` → `plugins.json`) **from the server**, which is what makes third-party
sources work: a browser is blocked by CORS from reading another host's manifest,
and a CloudStream repo lives on `raw.githubusercontent.com`. A GitHub URL is
translated to its raw files (trying `main`, then `master`), and every plugin in a
repo is listed as a provider. Verified against live hosts — Cinemeta returns its
5 catalogs, and `recloudstream/extensions` returns its 5 plugins.

## Desktop app

An Electron shell around the covers and catalogs, sharing the same server via
`startServer()` from `serve.mjs`:

```sh
cd desktop
npm install
npm start
```

`desktop/ui/` is plain web code, so the **same UI is also the web app** — it is
served at `/` (redirects to `/app/`) by `serve.mjs`, where it talks to the server
on the same origin.

### Test it as an Electron app

```sh
cd desktop
npm install          # installs electron (~100MB; needs network)
npm start            # boots the embedded server on a free port, opens the window
```

- `main.js` calls `startServer({ port: 0 })`, so the app picks its own free port
  and never fights the preview server. Nothing to configure.
- **First run needs a TMDB key.** `addon/settings.json` is git-ignored, so a fresh
  clone has no key and the rows come up empty. Either put the key in the
  environment before starting:

  ```sh
  TMDB_API_KEY=your_key npm start
  ```

  or paste it once in the running app under **Settings → Providers → TMDB**,
  which writes it to `addon/settings.json` for every later run (the Electron app
  and the preview share that file).
- **A headless machine cannot launch the window** — Electron needs a display. On a
  desktop OS it just opens; over SSH/X-forwarding you get a blank
  `Missing X server` style failure, which is the environment, not the app.
- Only the Capacitor CLI is needed for the Android target, so you can skip
  Electron's binary download with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`.

### Android TV APK

The Android project at `desktop/android/` is a **Capacitor 6 Android TV (leanback)
app**, already generated and TV-configured (`android.software.leanback`, no
touchscreen requirement, a `LEANBACK_LAUNCHER` intent-filter so it appears on the
TV home screen, landscape pinned, D-pad navigation in the UI).

**1 — point the app at a server.** The APK is a *thin client*: the catalog server
is Node (`serve.mjs`) and cannot run inside an APK, so the app needs a host. Set it
in `desktop/ui/config.js`:

```js
window.NUVIO_HOST = "https://4173-your-preview-host.e2b.app";  // the preview url works
```

Use **https** — Android blocks cleartext HTTP, and `serve.mjs` advertises `https`
for any non-local host, so a deployed copy works as-is. With it empty the app
starts and says it cannot reach the server instead of failing silently.

**2 — build.** This needs a JDK 17 and the Android SDK (`ANDROID_HOME` set) — it
**cannot** be built on the Freebuff sandbox, which has no `java` and no SDK:

```sh
cd desktop
npm install
npm run android:sync    # embeds desktop/ui into the APK assets (run after step 1)
npm run android:build   # debug → android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk     # release build
npm run android:open    # open the project in Android Studio instead
```

On the sandbox `npm run android:build` stops on the first line with
`ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH` —
that is the only missing piece; the project, TV manifest, embedded UI and Gradle
wrapper are all in place.

**3 — install it on the TV.** Either sideload the APK:

```sh
adb connect <tv-ip>:5555
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

or copy the APK to a USB stick and install it with a file manager on the device.
It then appears in the Android TV **Apps** row (leanback launcher), and the D-pad
(arrows, Enter, Back/Escape) drives the whole UI.

The UI is Nuvio-shaped:

- **Start-up** — the app opens on the **switch-profile screen** (`#/profiles`) with
  the two profiles as tiles: **Movies & Shows** and **Live TV & Sports**. Picking one
  enters Home; the **profile icon** in the top bar reopens the screen at any time
  (the picker itself has no *Manage profiles* button).
- **Top bar** — no app logo/label, **no Movies/Shows tabs** and **no counts line**.
  On the left, a **profile icon** (a person glyph — no name pill, no dropdown), the
  **calendar** button, then a **vertical divider**; on the right, a **search** button
  and **Settings**.
- **Home** — a **hero** panel, then **Movies** and **Shows** buttons below it.
  Movies is the default; picking Shows swaps both the cards *and* the hero banner.
  The banner carries no counters — just its **Explore** action.
  A tile is opened by clicking its **artwork**, not the whole tile.
  The cards are always in the published order: *pick the cards for you* chooses
  **which** cards appear, never their order, so Home never looks shuffled.
- **Watchlist** — the first card, holding the three states a title moves through:
  **Plan to Watch**, **Watching**, **Watched**. Pin a title from its modal (open any
  title and pick a state; picking the current state unpins it) and it lands in the
  matching row, tagged with its state. Same rows the addon publishes, so Nuvio sees
them too.
- **Collection** — its cover, then its catalogs as rows. Each row names its catalog
  and has a **Shuffle** icon and an **Explore** button *on the label line* — the
  shuffle is per collection, and it keeps newest-first catalogs (`◆ Top 10`,
  Airing Today, Airing This Week, On the Air, Now Playing, Latest, New Release,
  Trending) and the Watchlist states in their own order pinned. **Explore** scrolls endlessly, and
  its header carries only the card label and the catalog label. Under that header
  sit **three sample rows** — each a random 12-title draw from the catalog — drawn
exactly like a normal row: **no `Shuffle 1/2/3` labels and no controls of their
own**. A **horizontal divider** closes them off from the row below, and there is
**one Shuffle button, at the top right of the header**, which redraws all three at
once.
- **How deep a row goes** — the addon reads TMDB 20 titles at a time and keeps a
  growing, cached pool per catalog, so each window of 40 continues where the last
  stopped and repeat requests cost nothing. A row can serve up to **300 titles**
  (15 TMDB pages per query); the `◆ Top 10` rows stop at **ten**, because that is
  what they claim — and nothing else is capped, OTT cards included. Episode-cap
  rows are bounded by what TMDB actually has — the `4 Episodes` row is short
  because few shows are that short. A strip in a collection keeps loading too:
  scrolling it to the end asks for the next window instead of stopping.
- **Sources** — opening a title's **Find sources** draws the providers as a graph:
  provider nodes linked to the add-on, plugin or repository that returns them, and
  the sources interlinked.
- **Calendar** — a real **month grid**: pick a day to see what releases on it,
  with previous/next month navigation (not a list of Latest/New Release rows).
  A day lists **films and shows together** (each card says which it is), clicking the
  selected day again **deselects** it, and the grid carries no captions — no
  "everything releasing this month", no "N titles" line over the results.
- **Search** — searches **titles** (TMDB, through the server) as well as collections
  and catalogs in the current row. This is what the Ask box feeds.
- **Settings**, in sections: **Profile** (shows only the profile you are on —
  switching happens on the switch-profile screen), **Posters**, **Providers**
  (TMDB / TVDB / MDBList — paste a key, enable it), **Tracking** (SIMKL / Trakt /
  Letterboxd), **AI** (the free providers — Groq Cloud, Google AI Studio,
  OpenRouter, Cerebras Cloud — each with its key box and a *Check key*, an optional
  model override, plus enable, *classic posters & banners → high quality*, the
  fallback for posters without a better poster, *pick the cards for you*, and a
  text/voice ask box), **Content** (which provider supplies the row **content** —
  TMDB or TVDB — the **app language**, the **country**, and SFW / NSFW),
  **Add-ons**, **Plugins**, **Layout**, **Server**.

**Settings → Content** holds the three settings that change *what* you see:

- **Content source** — TMDB (default) or TVDB. See *Content source* above: TMDB
  builds the rows either way, TVDB supplies their titles, translations and art.
  Choosing TVDB without a TVDB key says so in place, and the app keeps serving
  TMDB content rather than empty rows.
- **App language** — one setting with two jobs, because you want your subtitles in
  the language you browse in: every row is served in it (TMDB's `language`, so
  titles, names and overviews are translated — `सीआईडी` instead of `C.I.D.`), and
  it is the **primary subtitle language** a player should prefer. 43 languages,
  with an English fallback where a title has no translation. It rides on the
  catalog URL as `?lang=`, so switching is also a different URL for the browser
  cache — a switch can never be answered out of the previous language.
- **Country** — where you are. The three **Regional OTT** cards show this
  country's own services, and the global platform rows report availability for it.
  The list carries how many services each country fills the cards with, and says
  so when a country has none. Changing it re-reads the card list immediately, so
  the regional cards change under you.

All three persist server-side through `POST /settings` (they are read by the
addon, not just the page), and mirror into `localStorage` for instant feedback.

**Add-ons** and **Plugins & repositories** are two separate sections. Stremio/Nuvio
add-ons (which this project is) are checked live — the app fetches `manifest.json`
and reports the add-on name and its providers. Nuvio plugins and CloudStream
repositories are stored and listed but not fetched (that is what used to show a
false "not reachable — HTTP 404"): CloudStream plugins are Android APKs and Nuvio
plugins run inside Nuvio, so only a native build can run them.

Provider and tracking keys are written to `addon/settings.json` (git-ignored) so
the server can use them; the public response never returns a key, only whether one
is set, and **Check connection** verifies it against the provider. Pasting a TMDB
key changes the live catalogs immediately with the same names; enabling MDBList
enriches every row's ratings from MDBList.

**CloudStream repositories are read live**: a repo URL is resolved to its
`repo.json` → `plugins.json` and each plugin is listed as a provider, so a repo
no longer reports a bare "not reachable — HTTP 404" for not being an add-on.

**Android TV target: a standalone installable app (not a browser).** The UI is
built to be wrapped into an APK; standalone means the server must run inside the
app (bundled Node) or be supplied by a host — see `desktop/README.md`.

## Use

Reference a PNG for maximum app compatibility, or an SVG where vector is welcome:

```
covers/movies/on-the-board.png
covers/shows/watchlist.svg
```

`covers/manifest.json` lists every cover with its title, subtitle (catalog name), row and paths.

A side-by-side exploration of alternative imagery directions lives in `covers/_options/` and is
regenerated with `node scripts/preview-imagery.mjs`.

## Regenerate

```sh
npm run generate   # cd scripts && npm install && npm run generate
```

The generator reads the bundled Inter fonts from `scripts/fonts/`, writes every SVG and PNG,
and fails the run if any title would overflow the frame. The collection list lives in
`scripts/collections.mjs` — the cover generator **and** the addon both read it, so the art and
the rows can never drift apart. Fonts: Inter by Rasmus Andersson (SIL Open Font License, see
`scripts/fonts/Inter-LICENSE.txt`).
