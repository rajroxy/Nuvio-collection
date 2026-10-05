# Nuvio Collections — desktop app

An Electron shell around the collection covers and catalog rows. It boots the
same server the web preview uses (`../serve.mjs`) on a random local port and
opens the app UI.

```
desktop/
  package.json      Electron app (devDependency: electron)
  main.js           main process — starts the embedded server, opens the window
  preload.cjs       tiny context bridge (flags the desktop shell)
  ui/               THE APP UI — plain web code (HTML/CSS/JS)
    index.html
    style.css
    app.js          home (icon boxes) · collection · settings
    config.js       API base override for the browser / Android TV builds
```

## Run

```sh
cd desktop
npm install
npm start
```

Requires **Electron ≥ 28** (the main process is an ES module).

**The first run needs a TMDB key.** `addon/settings.json` is git-ignored, so a
fresh clone has none and every row comes up empty. Put it in the environment
(`TMDB_API_KEY=your_key npm start`) or paste it once in the app under **Settings →
Providers → TMDB**, which writes it to `addon/settings.json` for every later run —
the Electron app, the browser preview and the addon all share that file.

Installing only the Capacitor CLI? `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`
skips Electron's ~100MB binary.

## Screens

Routing mirrors Nuvio:

| Screen | Route | Shows |
|---|---|---|
| Switch profile | `#/profiles` | **where the app starts** — pick `Movies & Shows` or `Live TV & Sports` |
| Home | `#/` | a **hero** panel, then **Movies / Shows** buttons, then the cards |
| Collection | `#/c/<key>` | the collection's cover + **its catalogs as rows**, each with **Shuffle** and **Explore** |
| Explore | `#/x/<key>/<catalogId>` | **one shuffled row** on top, then a divider, then the catalog **scrolling endlessly** — a **watchlist** catalog is just its header and your titles |
| Sources | `#/s/<id>/<name>` | providers as a **graph**, grouped by add-on / plugin / repo |
| Calendar | `#/calendar` | a real **month calendar** of releases (films *and* shows) |
| Search | `#/search` | searches **titles**, collections and catalogs |
| Settings | `#/settings` | grouped: **What you see** (Content · Layout · Posters · Appearance) · **Where it comes from** (Providers · Add-ons · Plugins) · **Tracking & assistant** (Tracking · AI) · **This app** (Profile · Server) |

**Content** is one switch: SFW / NSFW. **Both pickers are gone.** The language one
read as if it moved the regional cards (it never did — rows are served in English
and the server's `language` still rides on every catalog URL as `?lang=`), and the
country one only ever named the regional OTT services. The country is still real
server state and the cards still follow it (`POST /settings {"country":"NZ"}`), it
is just not a switch in the app.

**Content source lives under Providers.** TMDB and TVDB are providers; which one
supplies the titles inside a row belongs next to their keys, not in a second
section that drifts from them.

**Profile** also holds **what this profile shows**: *pick the rows, cards and
catalogs for this profile*, off by default. On, it gives one switch for Movies and
Shows, one per card, and one per catalog row inside each card (indented under it),
remembered per profile in `localStorage` (`nuvio.visibility`). The editor is split
into a **Media rows** section and a **Cards** section, and inside *Cards* each card
is its own bordered block with its catalog rows in it — so "which rows belong to
this card?" is answered by the box they sit in, and the block's own switch reports
how many of its rows are on. The same master switch is drawn in **Settings → AI** as
*Pick the cards for you*.

**Appearance** is the accent colour (the whole app is tinted from `--accent-rgb` /
`--accent-deep`, so one pick re-tints buttons, chips, borders and highlights
together — Gold is the default, not the only colour) and **Motion** (*Follow
system* / *Always animate* / *No animation*, covering the screen transition, hover
lifts and the row highlight).

**Profile picks the app up.** A launch with no specific link lands on the
**switch-profile screen** (`#/profiles`), listing the two profiles as tiles; picking
one enters Home. At any time the **profile icon** in the top-left reopens that
screen; the picker carries no *Manage profiles* button.

**Settings → Profile** shows **only the profile you are on** (its initial and name,
marked *Current profile*) — it lists no other profile and offers no switch. Switching
happens on the switch-profile screen, which the top-bar icon opens.

**Top bar:** no app logo or label, **no Movies/Shows tabs** and **no counts** (the
old `Movies & Shows · 21 collections · 534 catalogs` line is gone). Left: a **profile
icon**, the **calendar** button, then a **vertical divider**. Middle: **Home**. Right:
**search** and **Settings**. Every one of those controls is the same drawn 24px
stroke icon (no emoji glyphs), and both dividers are painted lines, not faint
near-transparent ones.

**Movies and Shows are buttons under the hero banner.** Movies is selected by
default; picking Shows swaps both the cards *and* the hero banner to that row. The
banner shows no counters — only its **Explore** action.

**Watchlist comes first, then a vertical divider**, then **Discover ◆ Top 10** and
the rest of the cards. The cards are always in the published order, and every card
appears — there is no picked subset on Home any more.

The **Watchlist** card holds the three states a pinned title moves through:
**Plan to Watch**, **Watching**, **Watched** — and nothing else: the *Add cards in
watchlist* row is gone from the card, from the title modal and from the addon, so
no *add cards* catalog is published at all. Open any title and pick a state in its
modal to pin it there (picking the state it is already in unpins it), and the card
updates. The pins live on the server (`/watchlist` → `addon/watchlist.json`) so
Nuvio sees the same rows. Those rows are requested with a cache-busting `_=<n>` and
answered `cache-control: no-store`, so a removed title is gone the moment you come
back — an ordinary catalog row keeps its `max-age` and is not re-fetched pointlessly.

**Catalog labels are clickable** — in the hero banner and on a collection page each
catalog name is a chip that opens that catalog inside the card.

**Explore** shows only the card label and the catalog label in its header (with a
catalog switcher) and a **Shuffle** that redraws its sample rows with fresh random
draws — requested with a cache-busting `_=<n>` parameter and answered
`cache-control: no-store`, because a cached identical URL is what made Shuffle look
like a button that did nothing.

**The wheel moves the row, never the page.** Pointing at a strip and scrolling
scrolls that strip sideways; at either end the row simply stops, so the page cannot
be dragged away while the cursor is on the titles. The page scrolls normally
anywhere the cursor is not over a row, and strips draw no scrollbar. Under the
header sits **one sample row**, drawing a random 12 titles from that catalog. It is
drawn **exactly like a normal row**: no label of its own and no control of its own.
A **horizontal divider** closes it off from the catalog below, and there is **one
Shuffle button at the top right of the header** which draws a fresh sample. A
**watchlist** catalog has none of the three: there is no random twelve to draw from
your own pins, so its Explore page is the header and the titles.
Everything below the divider is the normal, endlessly scrolling catalog.

The depth comes from the server: it reads TMDB 20 titles at a time into a growing,
10-minute cache per catalog, so each 40-title window continues where the last
stopped, repeats are free, and a row can serve up to 300 titles. `◆ Top 10` rows
stop at ten by design — and **nothing else is capped**: the OTT cards' rows used to
carry a `take` of 30/40, which is why an OTT row ended while every other row kept
going. A strip in a collection also loads the next window as you scroll it to the
end.

**Calendar** is a real month grid: pick a day to see what releases on it, with
previous/next month navigation — not a list of Latest/New Release rows. A day
lists **films and shows together** (each card is tagged with which it is), clicking
the selected day again **deselects** it, and the grid carries no caption text.
Every release has its own **Plan to Watch** pin, and it is not a watchlist row: it
is plan-only and the *Recently planned* list under the grid is recent-only (last
30 days), while the Watchlist card scans every state whatever the date. Calendar
plans live in their own stored row (`calendar-plans`, via `/customrows`) and are
never published as a catalog, so pinning a release never fills the Watchlist card.
*Recently planned* is a heading and its cards — no explanatory paragraph.

A tile is entered by clicking its **artwork** — not the whole tile. Back (Escape /
← button) returns home; Escape in Explore goes back to the collection. A
collection with no catalogs yet opens to a "cover art only" message.

Each catalog row carries its own **Explore** button on the label line. There is no
shuffle icon there: reordering a card's catalogs is not what "shuffle" means — the
only shuffle lives in Explore, over the titles.

**AI** (Settings) starts with the providers: **Groq Cloud** (the default),
**Google AI Studio**, **OpenRouter** and **Cerebras Cloud** — all free-tier, each
with its own key box, a **Test connection** button, a **Load models** button that
lists the models the provider actually serves as pickable chips, and a link to get
a key, plus an
optional **model** override. Paste a key and the ask box stops being a text box:
the server calls the provider, turns "a lonely detective in the rain" into a search
query, and hands it to the title search. With no key it searches the words you
typed, so it still works. Keys never reach the page (`/settings` and `/ai.json` say
only whether one is set), and every call is plain `fetch` from Node — no SDK.

The section also requests the next-bigger artwork size for classic posters and
banners, and takes a typed or spoken sentence in its ask box (*pick the cards for
you* is gone: the cards Home shows are the published set, in the published order).
Speech uses the browser's
`SpeechRecognition` when the build has it; otherwise the ask box falls back to
typing.

**Posters** is where the poster service lives: it is **on by default** and upgrades
every poster through a URL pattern (`{imdb_id}` / `{tmdb_id}` are filled in per
title). The upgrade is silent — no `BTTR` badge is drawn on the cards. There is an
API-key box and a **Check service** button that verifies the
pattern really returns an image.

**Providers** (TMDB / TVDB / MDBList — plus the content-source switch) and
**Tracking** (Trakt / SIMKL / MyAnimeList / AniList / Letterboxd, then a divider,
MyDramaList)
take a key and an enable toggle. Keys are POSTed to the server's `/settings`, which
stores them in `addon/settings.json` (git-ignored); the response never returns a
key, only whether one is set, and **Check connection** verifies it. TMDB is the
live catalog source — pasting a key changes the rows immediately, with unchanged
names — and MDBList replaces each title's rating.

**Content source** (top of the Content section) is a separate, explicit choice:
**TMDB** (default) or **TVDB**. TMDB is the only provider that can build a row —
its discover endpoint answers "90s action on Netflix" — while TVDB supplies a
title's name, translation, year and artwork. So choosing **TVDB** makes every
catalog show TVDB's content in the Settings language, while the rows themselves
stay TMDB's. It needs the TVDB provider enabled *with a key*; without one the
option says so in place and the app keeps serving TMDB content rather than empty
rows (`/addon-status.json` reports `contentSource`, `contentSourceActive` and
`contentSourceStats`). Title ids stay `tmdb:`, so watchlist pins and the modal do
not move when the source does.

**Add-ons** and **Plugins** are separate sections, and both are read **through the
server** (`POST /api/source`). That is what fixes third-party sources: the browser
cannot read a foreign host's `manifest.json` because of CORS. Add-ons are read via
their manifest (name + catalogs); a CloudStream repo is read via `repo.json` →
`plugins.json` and every plugin is listed as a provider.

**Home layout**, profile, providers, tracking and the AI options persist in
`localStorage` (`nuvio.layout`, `nuvio.profile`, `nuvio.providers`,
`nuvio.tracking`, `nuvio.ai`). Keys — including the AI ones — are mirrored to the
server so the addon can use them; the watchlist is server-side state, not stored in
the page.

## How it gets data

`main.js` calls `startServer()` (exported by `../serve.mjs`) with `port: 0`, so
the OS picks a free port, then loads `ui/index.html?api=http://127.0.0.1:<port>`.
The UI reads:

| Endpoint | Used for |
|---|---|
| `/collections.json` | every card, its cover, and the catalogs it owns |
| `/catalog/{type}/{id}.json` | one live row of titles (TMDB) |
| `/settings` (GET/POST) | profile, provider/tracking/AI keys, AI options, the **content source**, **language** and **country**, plus the language/country `options` the Content pane is built from |
| `/watchlist` (GET/POST) | your pins and their states (`Plan to Watch` / `Watching` / `Watched`) |
| `/ai/ask`, `/ai/verify` | the Ask box and its key check |
| `/search.json` | title search (what the Ask box feeds) |
| `/addon-status.json` | diagnostics: keys present, catalog count, region, language, content source + how many titles it upgraded |

## Android TV — the Capacitor project is generated and TV-ready

A real Android project now exists at `desktop/android/` (Capacitor 6), and it is
configured as an **Android TV (leanback) app**:

- `AndroidManifest.xml` declares `android.software.leanback`, drops the
  touchscreen requirement, adds the `LEANBACK_LAUNCHER` intent-filter (so it
  appears on the TV home screen), pins landscape, and sets a banner
- `cap sync` embeds the whole UI into
  `android/app/src/main/assets/public/`
- D-pad navigation is already in `app.js` (arrows + Enter + Escape/Back)

```sh
cd desktop
npm install
npm run android:sync      # copies ui/ into the APK assets
# then, on a machine with a JDK + Android SDK:
npm run android:build     # → android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk       # release build
npm run android:open      # opens the project in Android Studio
```

**Or let CI build it**: `.github/workflows/android-apk.yml` builds the debug APK on
a runner with a JDK and the Android SDK and uploads it as the
`nuvio-collections-debug-apk` artifact (Actions → Android TV APK → Run workflow).
Set the repository variable `NUVIO_HOST` to bake the server host in.

**This build cannot be compiled on the Freebuff sandbox**: there is no `java`,
no `gradle` and no Android SDK (`ANDROID_HOME` is unset). Running the build there
fails at the first step with:

```
ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
```

That is the only missing piece — the project, the TV manifest, the embedded UI
and the Gradle wrapper are all in place, so a machine with the Android toolchain
produces the APK with the two commands above.

### Standalone vs thin client

The APK is a **thin client**: Capacitor's WebView renders the UI, but the catalog
server is Node (`serve.mjs`), which cannot run inside an Android APK without
bundling Node (`nodejs-mobile`). So before building, set the host in
`ui/config.js`:

```js
window.NUVIO_HOST = "https://your-addon-host.example.com";
```

Use an **https** host: Android blocks cleartext HTTP. `serve.mjs` already
advertises `https://` for any non-local host, so a deployed copy works directly —
and so does the Freebuff preview url (`https://<preview-host>`), which is the
quickest way to try the APK. With `NUVIO_HOST` empty the app starts and reports
that it cannot reach the server rather than failing silently.

Then build and install:

```sh
npm run android:sync     # after setting NUVIO_HOST — it is copied into the APK
npm run android:build    # debug APK
adb connect <tv-ip>:5555
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to a USB stick and install it from a file manager on the device.
It appears in the Android TV **Apps** row; the D-pad drives the UI.

## Notes

- The UI **is verified headlessly**: `npm run test:ui` (at the repo root) runs
  `desktop/ui` in jsdom against the running server and walks every screen — top
  bar, the switch-profile screen, Home/Movies/Shows, a collection, Explore, the title modal,
  the sources screen, Calendar, Search and Settings — failing on any uncaught
  error. That check caught real crashes (a null `props` in Settings, a spread of
  an element, and tiles rendering `<img>` with no `src`).
- The Electron window and the APK cannot be *launched* in the Freebuff sandbox
  (headless, no JDK/SDK), but the Android project is generated and TV-configured.
- `npm install` here downloads the Electron binary; set
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1` when you only need the Capacitor CLI.
- `desktop/android/app/src/main/assets/public/` is generated by `android:sync`
  and git-ignored, so the UI is never committed twice.
