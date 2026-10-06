/**
 * The premium, DTH and operator catalogue — where Live TV's lineups come from.
 *
 * Live TV used to open on a **public free-TV directory** (every channel iptv-org
 * publishes in a category playlist). That is not what this profile is for: it is a
 * premium-television profile, and a premium channel's lineup is a **customer's**
 * lineup — a DTH dish, a cable box, an operator's app. So the built-in source is a
 * catalogue of those providers, per country, and the profile is drawn from the
 * providers you actually subscribe to.
 *
 * A provider entry is metadata only:
 *
 *   id       stable key, also the name of its guide
 *   name     the operator, as it is written
 *   country  ISO 3166-1 alpha-2
 *   kind     dth      direct-to-home satellite (a dish and a set-top box)
 *            cable    a wired operator
 *            premium  a premium broadcaster's own channels
 *            ott      a premium service delivered over the internet
 *   epg      an XMLTV URL for that provider's own lineup, where a public one
 *            exists. Empty means the lineup is read from your own EPG URL, or the
 *            provider's set-top box exports one (Settings → Guide & EPG)
 *   guide    the provider's own public TV-guide page, to read the lineup by hand
 *
 * **Streams are never shipped.** A premium channel's stream is delivered to a
 * subscriber's box; it is not a public URL, and the app has no business inventing
 * one. What this catalogue gives Live TV is the *lineup and the guide* — which
 * channels the provider carries, and what is on — and the streams come from the
 * playlist your own box exports (Settings → Source → My M3U playlist, or an Xtream
 * login). A channel's `tvg-id` is what marries the two: the guide is keyed on it, so
 * an exported playlist lands on the catalogue's lineup exactly.
 *
 * Ported from nothing: the ids are ours, the countries come from the same table the
 * rest of the app uses, and no list here is scraped from a streaming site.
 */
import { COUNTRIES } from "../scripts/collections.mjs";

const p = (id, name, country, kind, epg = "", guide = "") => ({ id, name, country, kind, epg, guide });

/**
 * The catalogue.
 *
 * Ordered by country so the picker reads the way a country list does. Every entry
 * is a real national operator or premium broadcaster; the `epg` is filled in only
 * where a **public** XMLTV feed for that lineup actually exists, because an
 * invented URL would fail on the first read and look like a broken app.
 */
export const DTH_PROVIDERS = [
  // ── North America ─────────────────────────────────────────────────────────
  p("directv-us", "DIRECTV", "US", "dth", "", "https://www.directv.com/guide/"),
  p("dish-us", "DISH Network", "US", "dth", "", "https://www.dish.com/tv-guide/"),
  p("xfinity", "Xfinity", "US", "cable", "", "https://www.xfinity.com/stream/guide"),
  p("spectrum", "Spectrum", "US", "cable", "", "https://www.spectrum.com/tv/guide"),
  p("hulu-live", "Hulu + Live TV", "US", "ott", "", "https://www.hulu.com/live-tv"),
  p("youtubetv", "YouTube TV", "US", "ott", "", "https://tv.youtube.com/"),
  p("sling", "Sling TV", "US", "ott", "", "https://www.sling.com/"),
  p("bell", "Bell Fibe", "CA", "cable", "", "https://www.bell.ca/"),
  p("rogers", "Rogers Ignite", "CA", "cable", "", "https://www.rogers.com/"),
  p("shaw", "Shaw Direct", "CA", "dth", "", "https://www.shawdirect.ca/"),
  p("telus", "TELUS Optik", "CA", "cable", "", "https://www.telus.com/"),
  p("izzi", "Izzi Telecom", "MX", "cable", "", "https://www.izzi.mx/"),
  p("sky-mx", "Sky México", "MX", "dth", "", "https://www.sky.com.mx/"),

  // ── South America ────────────────────────────────────────────────────────
  p("sky-br", "SKY Brasil", "BR", "dth", "", "https://www.sky.com.br/"),
  p("claro-br", "Claro TV+", "BR", "cable", "", "https://www.claro.com.br/"),
  p("vivo-play", "Vivo Play", "BR", "ott", "", "https://vivo.com.br/"),
  p("directv-ar", "DirecTV Argentina", "AR", "dth", "", "https://www.directv.com.ar/"),
  p("claro-co", "Claro Colombia", "CO", "cable", "", "https://www.claro.com.co/"),
  p("movistar-cl", "Movistar Chile", "CL", "cable", "", "https://ww2.movistar.cl/"),

  // ── United Kingdom, Ireland ──────────────────────────────────────────────
  p("sky-uk", "Sky", "GB", "dth", "", "https://www.sky.com/tv-guide"),
  p("virgin-uk", "Virgin Media", "GB", "cable", "", "https://www.virginmedia.com/"),
  p("bt-uk", "BT TV", "GB", "cable", "", "https://www.bt.com/tv/"),
  p("now-uk", "NOW", "GB", "ott", "", "https://www.nowtv.com/"),
  p("sky-ie", "Sky Ireland", "IE", "dth", "", "https://www.sky.com/ie/"),
  p("virgin-ie", "Virgin Media Ireland", "IE", "cable", "", "https://www.virginmedia.ie/"),

  // ── Western Europe ───────────────────────────────────────────────────────
  p("canal-fr", "Canal+", "FR", "dth", "", "https://www.canalplus.com/"),
  p("sfr-fr", "SFR TV", "FR", "cable", "", "https://www.sfr.fr/"),
  p("orange-fr", "Orange TV", "FR", "cable", "", "https://www.orange.fr/"),
  p("sky-de", "Sky Deutschland", "DE", "dth", "", "https://www.sky.de/"),
  p("vodafone-de", "Vodafone TV", "DE", "cable", "", "https://www.vodafone.de/"),
  p("waipu-de", "waipu.tv", "DE", "ott", "", "https://www.waipu.tv/"),
  p("sky-it", "Sky Italia", "IT", "dth", "", "https://www.sky.it/"),
  p("mediaset-it", "Mediaset Infinity", "IT", "ott", "", "https://mediasetinfinity.mediaset.it/"),
  p("movistar-es", "Movistar Plus+", "ES", "dth", "", "https://www.movistarplus.es/"),
  p("vodafone-es", "Vodafone TV España", "ES", "cable", "", "https://www.vodafone.es/"),
  p("nos-pt", "NOS", "PT", "cable", "", "https://www.nos.pt/"),
  p("meo-pt", "MEO", "PT", "cable", "", "https://www.meo.pt/"),
  p("ziggo", "Ziggo", "NL", "cable", "", "https://www.ziggo.nl/"),
  p("kpn", "KPN", "NL", "cable", "", "https://www.kpn.com/"),
  p("telenet", "Telenet", "BE", "cable", "", "https://www.telenet.be/"),
  p("proximus", "Proximus", "BE", "cable", "", "https://www.proximus.be/"),
  p("swisscom", "Swisscom blue TV", "CH", "cable", "", "https://www.swisscom.ch/"),
  p("sky-at", "Sky Österreich", "AT", "dth", "", "https://www.sky.at/"),

  // ── Nordics ──────────────────────────────────────────────────────────────
  p("canal-digital", "Allente", "SE", "dth", "", "https://www.allente.se/"),
  p("telenor-se", "Telenor TV", "SE", "cable", "", "https://www.telenor.se/"),
  p("telenor-no", "Telenor TV", "NO", "cable", "", "https://www.telenor.no/"),
  p("allente-no", "Allente", "NO", "dth", "", "https://www.allente.no/"),
  p("yousee", "YouSee", "DK", "cable", "", "https://www.yousee.dk/"),
  p("elisa-fi", "Elisa Viihde", "FI", "cable", "", "https://elisa.fi/"),
  p("viaplay", "Viaplay", "SE", "ott", "", "https://viaplay.com/"),

  // ── Central & Eastern Europe, Türkiye ────────────────────────────────────
  p("canal-pl", "Canal+ Polska", "PL", "dth", "", "https://www.canalplus.com/pl/"),
  p("polsat-box", "Polsat Box", "PL", "dth", "", "https://www.polsatbox.pl/"),
  p("orange-pl", "Orange TV Polska", "PL", "cable", "", "https://www.orange.pl/"),
  p("skylink", "Skylink", "CZ", "dth", "", "https://www.skylink.cz/"),
  p("digi-ro", "Digi TV", "RO", "cable", "", "https://www.digi.ro/"),
  p("orange-ro", "Orange România TV", "RO", "cable", "", "https://www.orange.ro/"),
  p("cosmote-gr", "Cosmote TV", "GR", "dth", "", "https://www.cosmotetv.gr/"),
  p("nova-gr", "Nova", "GR", "dth", "", "https://www.nova.gr/"),
  p("tivibu", "Tivibu", "TR", "dth", "", "https://www.tivibu.com.tr/"),
  p("dturk", "Digiturk", "TR", "dth", "", "https://www.digiturk.com.tr/"),
  p("turkcell-tv", "Turkcell TV+", "TR", "ott", "", "https://www.turkcell.com.tr/"),
  p("tricolor", "Tricolor TV", "RU", "dth", "", "https://www.tricolor.tv/"),
  p("mts-tv", "MTS TV", "RU", "cable", "", "https://www.mts.ru/"),
  p("kyivstar-tv", "Kyivstar TV", "UA", "cable", "", "https://tv.kyivstar.ua/"),

  // ── South Asia ───────────────────────────────────────────────────────────
  p("tata-play", "Tata Play", "IN", "dth", "", "https://www.tataplay.com/"),
  p("airtel-dth", "Airtel Digital TV", "IN", "dth", "", "https://www.airtel.in/digital-tv/"),
  p("dish-tv-in", "Dish TV", "IN", "dth", "", "https://www.dishtv.in/"),
  p("d2h", "d2h", "IN", "dth", "", "https://www.d2h.com/"),
  p("sun-direct", "Sun Direct", "IN", "dth", "", "https://www.sundirect.in/"),
  p("jiohotstar", "JioHotstar", "IN", "ott", "", "https://www.hotstar.com/"),
  p("zee5", "ZEE5", "IN", "ott", "", "https://www.zee5.com/"),
  p("sonyliv", "SonyLIV", "IN", "ott", "", "https://www.sonyliv.com/"),
  p("ptcl", "PTCL Smart TV", "PK", "dth", "", "https://www.ptcl.com.pk/"),
  p("tata-play-bd", "Tata Play Bangladesh", "BD", "dth", "", "https://www.tataplay.com/"),
  p("dialog-tv", "Dialog TV", "LK", "dth", "", "https://www.dialog.lk/"),
  p("dishhome", "DishHome", "NP", "dth", "", "https://www.dishhome.com.np/"),

  // ── Middle East & North Africa ───────────────────────────────────────────
  p("osn", "OSN", "AE", "premium", "", "https://www.osn.com/"),
  p("eand", "e& (Etisalat) eLife", "AE", "cable", "", "https://www.etisalat.ae/"),
  p("du", "du TV", "AE", "cable", "", "https://www.du.ae/"),
  p("stc-tv", "stc tv", "SA", "ott", "", "https://stc.tv/"),
  p("shahid", "Shahid", "SA", "ott", "", "https://shahid.mbc.net/"),
  p("beinsports", "beIN SPORTS", "QA", "premium", "", "https://www.beinsports.com/"),
  p("ooredoo-tv", "Ooredoo TV", "QA", "cable", "", "https://www.ooredoo.qa/"),
  p("osn-jo", "OSN Jordan", "JO", "premium", "", "https://www.osn.com/"),
  p("dgtv-eg", "DIGI TV Egypt", "EG", "cable", "", "https://www.digiteg.com/"),
  p("orange-ma", "Orange Maroc TV", "MA", "cable", "", "https://www.orange.ma/"),
  p("canal-alg", "Canal Algérie TV", "DZ", "dth", "", "https://www.canaldz.com/"),

  // ── Sub-Saharan Africa ───────────────────────────────────────────────────
  p("dstv-za", "DStv", "ZA", "dth", "", "https://www.dstv.com/"),
  p("dstv-ng", "DStv Nigeria", "NG", "dth", "", "https://www.dstv.com/"),
  p("gotv-ke", "GOtv Kenya", "KE", "dth", "", "https://www.gotvafrica.com/"),
  p("dstv-gh", "DStv Ghana", "GH", "dth", "", "https://www.dstv.com/"),
  p("startimes", "StarTimes", "KE", "dth", "", "https://www.startimes.com/"),
  p("canaal-afr", "Canal+ Afrique", "CI", "dth", "", "https://www.canalplus-afrique.com/"),

  // ── East & Southeast Asia ────────────────────────────────────────────────
  p("skyperfect", "Sky PerfecTV!", "JP", "dth", "", "https://www.skyperfectv.co.jp/"),
  p("jcom", "J:COM", "JP", "cable", "", "https://www.jcom.co.jp/"),
  p("kt-skylife", "KT SkyLife", "KR", "dth", "", "https://www.kt.com/"),
  p("skb-kr", "SK Broadband B tv", "KR", "cable", "", "https://www.skbroadband.com/"),
  p("china-dth", "China DTH (CBTV)", "CN", "dth", "", "https://www.cbtv.cn/"),
  p("chunghwa", "Chunghwa MOD", "TW", "cable", "", "https://www.cht.com.tw/"),
  p("now-tv-hk", "now TV", "HK", "cable", "", "https://nowtv.now.com/"),
  p("starhub", "StarHub TV", "SG", "cable", "", "https://www.starhub.com/"),
  p("singtel-tv", "Singtel TV", "SG", "cable", "", "https://www.singtel.com/"),
  p("astro", "Astro", "MY", "dth", "", "https://www.astro.com.my/"),
  p("unifi-tv", "Unifi TV", "MY", "cable", "", "https://unifi.com.my/"),
  p("vidio", "Vidio", "ID", "ott", "", "https://www.vidio.com/"),
  p("mnc-vision", "MNC Vision", "ID", "dth", "", "https://www.mncvision.id/"),
  p("truevisions", "TrueVisions", "TH", "dth", "", "https://www.truevisionsgroup.com/"),
  p("ais-play", "AIS Play", "TH", "ott", "", "https://www.ais.co.th/"),
  p("skycable-ph", "Sky Cable", "PH", "cable", "", "https://www.mysky.com.ph/"),
  p("cignal", "Cignal TV", "PH", "dth", "", "https://www.cignal.tv/"),
  p("vtvcab", "VTVCab", "VN", "cable", "", "https://www.vtvcab.vn/"),
  p("kplus-vn", "K+", "VN", "dth", "", "https://www.kplus.vn/"),

  // ── Oceania ──────────────────────────────────────────────────────────────
  // Foxtel and Freeview Australia and Sky New Zealand publish public XMLTV feeds
  // of their own lineups, so those three arrive with a guide already attached.
  p("foxtel", "Foxtel", "AU", "dth", "https://i.mjh.nz/Foxtel/epg.xml.gz", "https://www.foxtel.com.au/"),
  p("freeview-au", "Freeview Australia", "AU", "dth", "https://i.mjh.nz/Freeview/epg.xml.gz", "https://www.freeview.com.au/"),
  p("fetch-au", "Fetch TV", "AU", "cable", "", "https://www.fetchtv.com.au/"),
  p("sky-nz", "Sky New Zealand", "NZ", "dth", "https://i.mjh.nz/Sky/epg.xml.gz", "https://www.sky.co.nz/"),
  p("vodafone-nz", "One NZ TV", "NZ", "cable", "", "https://one.nz/"),
];

/** The kinds, as the picker spells them. */
export const KIND_LABEL = { dth: "DTH satellite", cable: "Cable / fibre", premium: "Premium channels", ott: "Premium streaming" };

const BY_ID = new Map(DTH_PROVIDERS.map((prov) => [prov.id, prov]));

export const providerById = (id) => BY_ID.get(String(id || "")) || null;

/** Every provider, or only the ones in the given ISO codes. */
export function providersFor(codes = []) {
  const wanted = new Set(codes.map((c) => String(c).toUpperCase()).filter(Boolean));
  return wanted.size ? DTH_PROVIDERS.filter((prov) => wanted.has(prov.country)) : DTH_PROVIDERS;
}

/** The picked providers, resolved — unknown ids are dropped, not guessed at. */
export const pickedProviders = (ids = []) =>
  (Array.isArray(ids) ? ids : []).map((id) => providerById(id)).filter(Boolean);

/** The first picked provider that ships a public XMLTV feed for its lineup. */
export const firstProviderEpg = (ids = []) => pickedProviders(ids).find((prov) => prov.epg)?.epg || "";

/**
 * The country table the pickers use — the same one the rest of the app draws its
 * country rows from, shaped as `{ code, name }` for the settings screen.
 */
export function countryTable() {
  const seen = new Map();
  for (const prov of DTH_PROVIDERS) {
    if (seen.has(prov.country)) continue;
    const row = COUNTRIES.find(([, code]) => code === prov.country);
    seen.set(prov.country, { code: prov.country, name: row ? row[0] : prov.country });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Codes the catalogue covers, for the "which countries have providers" question. */
export const catalogueCountries = () => [...new Set(DTH_PROVIDERS.map((prov) => prov.country))].sort();
