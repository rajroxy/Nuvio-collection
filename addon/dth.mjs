/**
 * The premium, DTH and operator catalogue — where Live TV's lineups come from.
 *
 * Live TV used to open on a **public free-TV directory** (every channel iptv-org
 * publishes in a category playlist). That is not what this profile is for: it is a
 * premium-television profile, and a premium channel's lineup is a **customer's**
 * lineup — a DTH dish, a cable box, an operator's app. So the built-in source is a
 * catalogue of those providers, per country.
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
 *            exists. Empty means the lineup is read from your own EPG URL
 *   guide    the provider's own public TV-guide page, to read the lineup by hand
 *
 * ## What this list is, and what it is not
 *
 * It is a **curated list of the well-known national operators** — the providers a
 * person in that country would actually subscribe to. It is **not** every operator
 * that exists: no such list does, and an invented one would be worse than an
 * honest short one. Coverage is broad (100+ countries, most with two to five
 * operators) but it is a **starting set**, and it is meant to be extended: adding
 * a provider is one line in this file.
 *
 * **Streams are never shipped.** A premium channel's stream is delivered to a
 * subscriber's box; it is not a public URL, and the app has no business inventing
 * one. What this catalogue gives Live TV is the *lineup and the guide*, and the
 * streams come from the playlist your own box exports (Settings → Source → My M3U
 * playlist, or an Xtream login). A channel's `tvg-id` marries the two.
 *
 * **`epg` is filled in only where a public XMLTV feed genuinely exists**, because an
 * invented URL fails on the first read and looks like a broken app. Three do:
 * Foxtel, Freeview Australia and Sky New Zealand publish their own. For every other
 * provider the lineup comes from the catalogue and the schedule from your EPG URL.
 */
import { COUNTRIES } from "../scripts/collections.mjs";

const p = (id, name, country, kind, epg = "", guide = "") => ({ id, name, country, kind, epg, guide });

/**
 * The catalogue. Grouped by region, then by country, so the picker reads the way a
 * country list does and a missing country is easy to spot and easy to add.
 */
export const DTH_PROVIDERS = [
  // ─────────────────────────────────────────────────────────── North America ──
  p("directv-us", "DIRECTV", "US", "dth", "", "https://www.directv.com/guide/"),
  p("dish-us", "DISH Network", "US", "dth", "", "https://www.dish.com/tv-guide/"),
  p("xfinity", "Xfinity", "US", "cable", "", "https://www.xfinity.com/stream/guide"),
  p("spectrum", "Spectrum", "US", "cable", "", "https://www.spectrum.com/tv/guide"),
  p("cox", "Cox Contour", "US", "cable", "", "https://www.cox.com/"),
  p("optimum", "Optimum", "US", "cable", "", "https://www.optimum.com/"),
  p("hulu-live", "Hulu + Live TV", "US", "ott", "", "https://www.hulu.com/live-tv"),
  p("youtubetv", "YouTube TV", "US", "ott", "", "https://tv.youtube.com/"),
  p("sling", "Sling TV", "US", "ott", "", "https://www.sling.com/"),
  p("fubo", "Fubo", "US", "ott", "", "https://www.fubo.tv/"),
  p("philo", "Philo", "US", "ott", "", "https://www.philo.com/"),
  p("bell", "Bell Fibe TV", "CA", "cable", "", "https://www.bell.ca/"),
  p("rogers", "Rogers Ignite", "CA", "cable", "", "https://www.rogers.com/"),
  p("shaw", "Shaw Direct", "CA", "dth", "", "https://www.shawdirect.ca/"),
  p("telus", "TELUS Optik TV", "CA", "cable", "", "https://www.telus.com/"),
  p("videotron", "Videotron Helix", "CA", "cable", "", "https://videotron.com/"),
  p("cogeco", "Cogeco", "CA", "cable", "", "https://www.cogeco.ca/"),
  p("izzi", "Izzi Telecom", "MX", "cable", "", "https://www.izzi.mx/"),
  p("sky-mx", "Sky México", "MX", "dth", "", "https://www.sky.com.mx/"),
  p("dish-mx", "Dish México", "MX", "dth", "", "https://www.dish.com.mx/"),
  p("megacable", "Megacable", "MX", "cable", "", "https://www.megacable.com.mx/"),
  p("totalplay", "Totalplay", "MX", "cable", "", "https://totalplay.mx/"),

  // ─────────────────────────────────────────────────────────── South America ──
  p("sky-br", "SKY Brasil", "BR", "dth", "", "https://www.sky.com.br/"),
  p("claro-br", "Claro TV+", "BR", "cable", "", "https://www.claro.com.br/"),
  p("vivo-play", "Vivo Play", "BR", "ott", "", "https://vivo.com.br/"),
  p("oi-tv", "Oi TV", "BR", "dth", "", "https://www.oi.com.br/"),
  p("directv-ar", "DirecTV Argentina", "AR", "dth", "", "https://www.directv.com.ar/"),
  p("flow-ar", "Cablevisión Flow", "AR", "cable", "", "https://www.cablevisionfibertel.com.ar/"),
  p("movistar-ar", "Movistar TV Argentina", "AR", "cable", "", "https://www.movistar.com.ar/"),
  p("telecentro", "Telecentro", "AR", "cable", "", "https://www.telecentro.com.ar/"),
  p("claro-co", "Claro Colombia", "CO", "cable", "", "https://www.claro.com.co/"),
  p("movistar-co", "Movistar Colombia", "CO", "cable", "", "https://www.movistar.com.co/"),
  p("directv-co", "DirecTV Colombia", "CO", "dth", "", "https://www.directv.com.co/"),
  p("tigo-co", "Tigo UNE", "CO", "cable", "", "https://www.tigo.com.co/"),
  p("movistar-cl", "Movistar Chile", "CL", "cable", "", "https://ww2.movistar.cl/"),
  p("vtr-cl", "VTR", "CL", "cable", "", "https://www.vtr.com/"),
  p("directv-cl", "DirecTV Chile", "CL", "dth", "", "https://www.directv.cl/"),
  p("entel-cl", "Entel TV", "CL", "cable", "", "https://www.entel.cl/"),
  p("movistar-pe", "Movistar TV Perú", "PE", "cable", "", "https://www.movistar.com.pe/"),
  p("claro-pe", "Claro Perú", "PE", "cable", "", "https://www.claro.com.pe/"),
  p("directv-pe", "DirecTV Perú", "PE", "dth", "", "https://www.directv.com.pe/"),
  p("cnt-ec", "CNT TV", "EC", "cable", "", "https://www.cnt.gob.ec/"),
  p("directv-ec", "DirecTV Ecuador", "EC", "dth", "", "https://www.directv.com.ec/"),
  p("directv-uy", "DirecTV Uruguay", "UY", "dth", "", "https://www.directv.com.uy/"),
  p("antel-tv", "Antel TV", "UY", "cable", "", "https://www.antel.com.uy/"),
  p("directv-ve", "DirecTV Venezuela", "VE", "dth", "", "https://www.directv.com.ve/"),
  p("inter-ve", "Inter", "VE", "cable", "", "https://www.inter.com.ve/"),
  p("tigo-bo", "Tigo Bolivia", "BO", "cable", "", "https://www.tigo.com.bo/"),
  p("entel-bo", "Entel TV Bolivia", "BO", "cable", "", "https://www.entel.bo/"),
  p("tigo-py", "Tigo Star", "PY", "cable", "", "https://www.tigo.com.py/"),
  p("claro-py", "Claro Paraguay", "PY", "cable", "", "https://www.claro.com.py/"),

  // ──────────────────────────────── United Kingdom, Ireland, Isle of Man ──
  p("sky-uk", "Sky", "GB", "dth", "", "https://www.sky.com/tv-guide"),
  p("virgin-uk", "Virgin Media", "GB", "cable", "", "https://www.virginmedia.com/"),
  p("bt-uk", "BT TV", "GB", "cable", "", "https://www.bt.com/tv/"),
  p("ee-tv", "EE TV", "GB", "cable", "", "https://ee.co.uk/"),
  p("now-uk", "NOW", "GB", "ott", "", "https://www.nowtv.com/"),
  p("sky-ie", "Sky Ireland", "IE", "dth", "", "https://www.sky.com/ie/"),
  p("virgin-ie", "Virgin Media Ireland", "IE", "cable", "", "https://www.virginmedia.ie/"),
  p("eir-tv", "Eir TV", "IE", "cable", "", "https://www.eir.ie/"),

  // ───────────────────────────────────────────────────── Western Europe ──
  p("canal-fr", "Canal+", "FR", "dth", "", "https://www.canalplus.com/"),
  p("sfr-fr", "SFR TV", "FR", "cable", "", "https://www.sfr.fr/"),
  p("orange-fr", "Orange TV", "FR", "cable", "", "https://www.orange.fr/"),
  p("free-fr", "Free", "FR", "cable", "", "https://www.free.fr/"),
  p("bouygues-fr", "Bbox", "FR", "cable", "", "https://www.bouyguestelecom.fr/"),
  p("sky-de", "Sky Deutschland", "DE", "dth", "", "https://www.sky.de/"),
  p("vodafone-de", "Vodafone TV", "DE", "cable", "", "https://www.vodafone.de/"),
  p("magenta-de", "MagentaTV", "DE", "cable", "", "https://www.telekom.de/"),
  p("waipu-de", "waipu.tv", "DE", "ott", "", "https://www.waipu.tv/"),
  p("sky-it", "Sky Italia", "IT", "dth", "", "https://www.sky.it/"),
  p("now-it", "NOW Italia", "IT", "ott", "", "https://www.nowtv.it/"),
  p("dazn-it", "DAZN Italia", "IT", "ott", "", "https://www.dazn.com/"),
  p("mediaset-it", "Mediaset Infinity", "IT", "ott", "", "https://mediasetinfinity.mediaset.it/"),
  p("movistar-es", "Movistar Plus+", "ES", "dth", "", "https://www.movistarplus.es/"),
  p("vodafone-es", "Vodafone TV España", "ES", "cable", "", "https://www.vodafone.es/"),
  p("orange-es", "Orange TV España", "ES", "cable", "", "https://www.orange.es/"),
  p("dazn-es", "DAZN España", "ES", "ott", "", "https://www.dazn.com/"),
  p("nos-pt", "NOS", "PT", "cable", "", "https://www.nos.pt/"),
  p("meo-pt", "MEO", "PT", "cable", "", "https://www.meo.pt/"),
  p("nowo-pt", "NOWO", "PT", "cable", "", "https://www.nowo.pt/"),
  p("ziggo", "Ziggo", "NL", "cable", "", "https://www.ziggo.nl/"),
  p("kpn", "KPN", "NL", "cable", "", "https://www.kpn.com/"),
  p("odido", "Odido TV", "NL", "cable", "", "https://www.odido.nl/"),
  p("canaldigitaal", "Canal Digitaal", "NL", "dth", "", "https://www.canaldigitaal.nl/"),
  p("telenet", "Telenet", "BE", "cable", "", "https://www.telenet.be/"),
  p("proximus", "Proximus", "BE", "cable", "", "https://www.proximus.be/"),
  p("voo", "VOO", "BE", "cable", "", "https://www.voo.be/"),
  p("swisscom", "Swisscom blue TV", "CH", "cable", "", "https://www.swisscom.ch/"),
  p("sunrise-ch", "Sunrise TV", "CH", "cable", "", "https://www.sunrise.ch/"),
  p("sky-at", "Sky Österreich", "AT", "dth", "", "https://www.sky.at/"),
  p("magenta-at", "Magenta TV Österreich", "AT", "cable", "", "https://www.magenta.at/"),
  p("lu-eltrona", "Eltrona", "LU", "cable", "", "https://www.eltrona.lu/"),

  // ───────────────────────────────────────────────────────────── Nordics ──
  p("allente-se", "Allente", "SE", "dth", "", "https://www.allente.se/"),
  p("telenor-se", "Telenor TV", "SE", "cable", "", "https://www.telenor.se/"),
  p("telia-se", "Telia TV", "SE", "cable", "", "https://www.telia.se/"),
  p("boxer-se", "Boxer", "SE", "dth", "", "https://www.boxer.se/"),
  p("telenor-no", "Telenor TV", "NO", "cable", "", "https://www.telenor.no/"),
  p("allente-no", "Allente", "NO", "dth", "", "https://www.allente.no/"),
  p("altibox", "Altibox", "NO", "cable", "", "https://www.altibox.no/"),
  p("rikstv", "RiksTV", "NO", "dth", "", "https://www.rikstv.no/"),
  p("yousee", "YouSee", "DK", "cable", "", "https://www.yousee.dk/"),
  p("norlys", "Norlys TV", "DK", "cable", "", "https://www.norlys.dk/"),
  p("boxer-dk", "Boxer Danmark", "DK", "dth", "", "https://www.boxer.dk/"),
  p("elisa-fi", "Elisa Viihde", "FI", "cable", "", "https://elisa.fi/"),
  p("dna-fi", "DNA TV", "FI", "cable", "", "https://www.dna.fi/"),
  p("telia-fi", "Telia TV Finland", "FI", "cable", "", "https://www.telia.fi/"),
  p("siminn", "Síminn", "IS", "cable", "", "https://www.siminn.is/"),
  p("vodafone-is", "Vodafone Ísland", "IS", "cable", "", "https://www.vodafone.is/"),

  // ─────────────────────────── Central & Eastern Europe, Balkans, Türkiye ──
  p("canal-pl", "Canal+ Polska", "PL", "dth", "", "https://www.canalplus.com/pl/"),
  p("polsat-box", "Polsat Box", "PL", "dth", "", "https://www.polsatbox.pl/"),
  p("orange-pl", "Orange TV Polska", "PL", "cable", "", "https://www.orange.pl/"),
  p("play-pl", "Play Now TV", "PL", "cable", "", "https://www.play.pl/"),
  p("skylink-cz", "Skylink", "CZ", "dth", "", "https://www.skylink.cz/"),
  p("o2tv-cz", "O2 TV", "CZ", "cable", "", "https://www.o2.cz/"),
  p("tmobile-cz", "T-Mobile TV", "CZ", "cable", "", "https://www.t-mobile.cz/"),
  p("skylink-sk", "Skylink SK", "SK", "dth", "", "https://www.skylink.sk/"),
  p("magio-sk", "Magio TV", "SK", "cable", "", "https://www.telekom.sk/"),
  p("telekom-hu", "Telekom TV", "HU", "cable", "", "https://www.telekom.hu/"),
  p("vodafone-hu", "Vodafone TV Hungary", "HU", "cable", "", "https://www.vodafone.hu/"),
  p("digi-hu", "Digi TV Hungary", "HU", "cable", "", "https://www.digi.hu/"),
  p("digi-ro", "Digi TV", "RO", "cable", "", "https://www.digi.ro/"),
  p("orange-ro", "Orange România TV", "RO", "cable", "", "https://www.orange.ro/"),
  p("focus-sat", "Focus Sat", "RO", "dth", "", "https://www.focussat.ro/"),
  p("a1-bg", "A1 Xplore TV", "BG", "cable", "", "https://www.a1.bg/"),
  p("vivacom", "Vivacom EON", "BG", "cable", "", "https://www.vivacom.bg/"),
  p("bulsatcom", "Bulsatcom", "BG", "dth", "", "https://www.bulsatcom.bg/"),
  p("cosmote-gr", "Cosmote TV", "GR", "dth", "", "https://www.cosmotetv.gr/"),
  p("nova-gr", "Nova", "GR", "dth", "", "https://www.nova.gr/"),
  p("vodafone-gr", "Vodafone TV Greece", "GR", "cable", "", "https://www.vodafone.gr/"),
  p("a1-hr", "A1 Hrvatska", "HR", "cable", "", "https://www.a1.hr/"),
  p("maxtv-hr", "MAXtv", "HR", "cable", "", "https://www.hrvatski-telekom.hr/"),
  p("telemach-hr", "Telemach Hrvatska", "HR", "cable", "", "https://telemach.hr/"),
  p("sbb-rs", "SBB EON", "RS", "cable", "", "https://sbb.rs/"),
  p("mts-rs", "mts TV", "RS", "cable", "", "https://mts.rs/"),
  p("yettel-rs", "Yettel TV", "RS", "cable", "", "https://www.yettel.rs/"),
  p("telemach-si", "Telemach Slovenija", "SI", "cable", "", "https://telemach.si/"),
  p("telekom-si", "Telekom Slovenije", "SI", "cable", "", "https://www.telekom.si/"),
  p("telemach-ba", "Telemach BiH", "BA", "cable", "", "https://telemach.ba/"),
  p("mtel-ba", "m:tel", "BA", "cable", "", "https://www.mtel.ba/"),
  p("digitalb", "DigitAlb", "AL", "dth", "", "https://www.digitalb.al/"),
  p("tring", "Tring TV", "AL", "dth", "", "https://www.tring.al/"),
  p("maktel", "Makedonski Telekom MaxTV", "MK", "cable", "", "https://www.telekom.mk/"),
  p("tivibu", "Tivibu", "TR", "dth", "", "https://www.tivibu.com.tr/"),
  p("digiturk", "Digiturk", "TR", "dth", "", "https://www.digiturk.com.tr/"),
  p("turkcell-tv", "Turkcell TV+", "TR", "ott", "", "https://www.turkcell.com.tr/"),
  p("dsmart", "D-Smart", "TR", "dth", "", "https://www.dsmart.com.tr/"),
  p("tricolor", "Tricolor TV", "RU", "dth", "", "https://www.tricolor.tv/"),
  p("mts-tv-ru", "MTS TV", "RU", "cable", "", "https://www.mts.ru/"),
  p("ntvplus", "NTV-Plus", "RU", "dth", "", "https://www.ntvplus.ru/"),
  p("beeline-ru", "Beeline TV", "RU", "cable", "", "https://moskva.beeline.ru/"),
  p("kyivstar-tv", "Kyivstar TV", "UA", "cable", "", "https://tv.kyivstar.ua/"),
  p("volia", "Volia", "UA", "cable", "", "https://volia.com/"),
  p("olltv", "OLL.TV", "UA", "ott", "", "https://oll.tv/"),
  p("byfly", "Byfly TV", "BY", "cable", "", "https://beltelecom.by/"),
  p("moldtelecom", "Moldtelecom TV", "MD", "cable", "", "https://www.moldtelecom.md/"),
  p("telia-lt", "Telia TV Lietuva", "LT", "cable", "", "https://www.telia.lt/"),
  p("init-lt", "Init TV", "LT", "cable", "", "https://www.init.lt/"),
  p("tet-lv", "Tet TV", "LV", "cable", "", "https://www.tet.lv/"),
  p("baltcom", "Baltcom", "LV", "cable", "", "https://www.baltcom.lv/"),
  p("telia-ee", "Telia TV Eesti", "EE", "cable", "", "https://www.telia.ee/"),
  p("elisa-ee", "Elisa TV Eesti", "EE", "cable", "", "https://www.elisa.ee/"),
  p("cyta-cy", "CytaVision", "CY", "cable", "", "https://www.cyta.com.cy/"),
  p("nova-cy", "Nova Cyprus", "CY", "dth", "", "https://www.nova.com.cy/"),
  p("go-mt", "GO TV", "MT", "cable", "", "https://www.go.com.mt/"),
  p("melita", "Melita", "MT", "cable", "", "https://www.melita.com/"),

  // ────────────────────────────────────────────────────── South Asia ──
  p("tata-play", "Tata Play", "IN", "dth", "", "https://www.tataplay.com/"),
  p("airtel-dth", "Airtel Digital TV", "IN", "dth", "", "https://www.airtel.in/digital-tv/"),
  p("dish-tv-in", "Dish TV", "IN", "dth", "", "https://www.dishtv.in/"),
  p("d2h", "d2h", "IN", "dth", "", "https://www.d2h.com/"),
  p("sun-direct", "Sun Direct", "IN", "dth", "", "https://www.sundirect.in/"),
  p("jiohotstar", "JioHotstar", "IN", "ott", "", "https://www.hotstar.com/"),
  p("zee5", "ZEE5", "IN", "ott", "", "https://www.zee5.com/"),
  p("sonyliv", "SonyLIV", "IN", "ott", "", "https://www.sonyliv.com/"),
  p("ptcl", "PTCL Smart TV", "PK", "dth", "", "https://www.ptcl.com.pk/"),
  p("jazz-pk", "Jazz TV", "PK", "ott", "", "https://www.jazz.com.pk/"),
  p("toffee-bd", "Grameenphone Toffee", "BD", "ott", "", "https://www.grameenphone.com/"),
  p("dialog-tv", "Dialog TV", "LK", "dth", "", "https://www.dialog.lk/"),
  p("peotv", "SLT Peo TV", "LK", "cable", "", "https://www.slt.lk/"),
  p("dishhome", "DishHome", "NP", "dth", "", "https://www.dishhome.com.np/"),
  p("nettv-np", "NetTV Nepal", "NP", "cable", "", "https://www.nettv.com.np/"),
  p("dhiraagu", "Dhiraagu TV", "MV", "cable", "", "https://www.dhiraagu.com.mv/"),

  // ───────────────────────────────────────────── Middle East & Türkiye ──
  p("osn", "OSN", "AE", "premium", "", "https://www.osn.com/"),
  p("eand", "e& eLife", "AE", "cable", "", "https://www.etisalat.ae/"),
  p("du", "du TV", "AE", "cable", "", "https://www.du.ae/"),
  p("starzplay", "STARZPLAY", "AE", "ott", "", "https://www.starzplay.com/"),
  p("stc-tv", "stc tv", "SA", "ott", "", "https://stc.tv/"),
  p("shahid", "Shahid", "SA", "ott", "", "https://shahid.mbc.net/"),
  p("beinsports", "beIN SPORTS", "QA", "premium", "", "https://www.beinsports.com/"),
  p("ooredoo-qa", "Ooredoo TV", "QA", "cable", "", "https://www.ooredoo.qa/"),
  p("ooredoo-kw", "Ooredoo Kuwait", "KW", "cable", "", "https://www.ooredoo.com.kw/"),
  p("zain-kw", "Zain TV", "KW", "ott", "", "https://www.zain.com/"),
  p("batelco", "Batelco TV", "BH", "cable", "", "https://www.batelco.com/"),
  p("ooredoo-om", "Ooredoo Oman TV", "OM", "cable", "", "https://www.ooredoo.om/"),
  p("omantel", "Omantel TV", "OM", "cable", "", "https://www.omantel.om/"),
  p("hot-il", "HOT", "IL", "cable", "", "https://www.hot.net.il/"),
  p("yes-il", "yes", "IL", "dth", "", "https://www.yes.co.il/"),
  p("cellcom-il", "Cellcom TV", "IL", "cable", "", "https://cellcom.co.il/"),
  p("partner-il", "Partner TV", "IL", "cable", "", "https://www.partner.co.il/"),
  p("osn-jo", "OSN Jordan", "JO", "premium", "", "https://www.osn.com/"),
  p("cablevision-lb", "Cablevision", "LB", "cable", "", "https://www.cablevision.com.lb/"),
  p("dgtv-eg", "DIGI TV Egypt", "EG", "cable", "", "https://www.digiteg.com/"),
  p("osn-eg", "OSN Egypt", "EG", "premium", "", "https://www.osn.com/"),
  p("orange-ma", "Orange Maroc TV", "MA", "cable", "", "https://www.orange.ma/"),
  p("iam-ma", "Maroc Telecom TV", "MA", "cable", "", "https://www.iam.ma/"),
  p("inwi-ma", "inwi TV", "MA", "cable", "", "https://www.inwi.ma/"),
  p("canal-alg", "Canal Algérie TV", "DZ", "dth", "", "https://www.canaldz.com/"),
  p("tunisie-tv", "Tunisie Telecom TV", "TN", "cable", "", "https://www.tunisietelecom.tn/"),
  p("ooredoo-tn", "Ooredoo Tunisia", "TN", "cable", "", "https://www.ooredoo.tn/"),
  p("magti-ge", "Magti TV", "GE", "cable", "", "https://www.magticom.ge/"),
  p("silknet", "Silknet TV", "GE", "cable", "", "https://silknet.com/"),
  p("ucom-am", "Ucom TV", "AM", "cable", "", "https://www.ucom.am/"),

  // ──────────────────────────────────────────── East & Southeast Asia ──
  p("skyperfect", "Sky PerfecTV!", "JP", "dth", "", "https://www.skyperfectv.co.jp/"),
  p("jcom", "J:COM", "JP", "cable", "", "https://www.jcom.co.jp/"),
  p("hikaritv", "Hikari TV", "JP", "cable", "", "https://www.hikaritv.net/"),
  p("kt-skylife", "KT SkyLife", "KR", "dth", "", "https://www.kt.com/"),
  p("skb-kr", "SK Broadband B tv", "KR", "cable", "", "https://www.skbroadband.com/"),
  p("lgu-kr", "LG U+ TV", "KR", "cable", "", "https://www.lguplus.com/"),
  p("china-dth", "China DTH (CBTV)", "CN", "dth", "", "https://www.cbtv.cn/"),
  p("bestv", "BesTV", "CN", "ott", "", "https://www.bestv.com.cn/"),
  p("chunghwa", "Chunghwa MOD", "TW", "cable", "", "https://www.cht.com.tw/"),
  p("kbro", "kbro", "TW", "cable", "", "https://www.kbro.com.tw/"),
  p("taiwanmobile", "Taiwan Mobile TV", "TW", "cable", "", "https://www.taiwanmobile.com/"),
  p("now-tv-hk", "now TV", "HK", "cable", "", "https://nowtv.now.com/"),
  p("mytvsuper", "myTV SUPER", "HK", "ott", "", "https://www.mytvsuper.com/"),
  p("starhub", "StarHub TV", "SG", "cable", "", "https://www.starhub.com/"),
  p("singtel-tv", "Singtel TV", "SG", "cable", "", "https://www.singtel.com/"),
  p("astro", "Astro", "MY", "dth", "", "https://www.astro.com.my/"),
  p("unifi-tv", "Unifi TV", "MY", "cable", "", "https://unifi.com.my/"),
  p("mnc-vision", "MNC Vision", "ID", "dth", "", "https://www.mncvision.id/"),
  p("vidio", "Vidio", "ID", "ott", "", "https://www.vidio.com/"),
  p("indihome", "IndiHome TV", "ID", "cable", "", "https://www.indihome.co.id/"),
  p("firstmedia", "First Media", "ID", "cable", "", "https://www.firstmedia.com/"),
  p("truevisions", "TrueVisions", "TH", "dth", "", "https://www.truevisionsgroup.com/"),
  p("ais-play", "AIS Play", "TH", "ott", "", "https://www.ais.co.th/"),
  p("3bb-tv", "3BB GIGA TV", "TH", "cable", "", "https://www.3bb.co.th/"),
  p("skycable-ph", "Sky Cable", "PH", "cable", "", "https://www.mysky.com.ph/"),
  p("cignal", "Cignal TV", "PH", "dth", "", "https://www.cignal.tv/"),
  p("pldt-ph", "PLDT Home TV", "PH", "cable", "", "https://pldthome.com/"),
  p("vtvcab", "VTVCab", "VN", "cable", "", "https://www.vtvcab.vn/"),
  p("kplus-vn", "K+", "VN", "dth", "", "https://www.kplus.vn/"),
  p("fpt-play", "FPT Play", "VN", "ott", "", "https://fptplay.vn/"),
  p("sctv-vn", "SCTV", "VN", "cable", "", "https://www.sctv.com.vn/"),
  p("otau-kz", "OTAU TV", "KZ", "dth", "", "https://otau.tv/"),

  // ──────────────────────────────────────────────────────── Africa ──
  p("dstv-za", "DStv", "ZA", "dth", "", "https://www.dstv.com/"),
  p("dstv-ng", "DStv Nigeria", "NG", "dth", "", "https://www.dstv.com/"),
  p("gotv-ng", "GOtv Nigeria", "NG", "dth", "", "https://www.gotvafrica.com/"),
  p("startimes-ng", "StarTimes Nigeria", "NG", "dth", "", "https://www.startimes.com/"),
  p("dstv-ke", "DStv Kenya", "KE", "dth", "", "https://www.dstv.com/"),
  p("gotv-ke", "GOtv Kenya", "KE", "dth", "", "https://www.gotvafrica.com/"),
  p("startimes-ke", "StarTimes Kenya", "KE", "dth", "", "https://www.startimes.com/"),
  p("zuku", "Zuku", "KE", "cable", "", "https://www.zuku.co.ke/"),
  p("dstv-gh", "DStv Ghana", "GH", "dth", "", "https://www.dstv.com/"),
  p("gotv-gh", "GOtv Ghana", "GH", "dth", "", "https://www.gotvafrica.com/"),
  p("startimes-gh", "StarTimes Ghana", "GH", "dth", "", "https://www.startimes.com/"),
  p("dstv-tz", "DStv Tanzania", "TZ", "dth", "", "https://www.dstv.com/"),
  p("azam-tv", "Azam TV", "TZ", "dth", "", "https://www.azamtv.co.tz/"),
  p("dstv-ug", "DStv Uganda", "UG", "dth", "", "https://www.dstv.com/"),
  p("gotv-ug", "GOtv Uganda", "UG", "dth", "", "https://www.gotvafrica.com/"),
  p("dstv-zm", "DStv Zambia", "ZM", "dth", "", "https://www.dstv.com/"),
  p("topstar-zm", "TopStar", "ZM", "dth", "", "https://www.topstar.com.zm/"),
  p("dstv-zw", "DStv Zimbabwe", "ZW", "dth", "", "https://www.dstv.com/"),
  p("dstv-ao", "DStv Angola", "AO", "dth", "", "https://www.dstv.com/"),
  p("zap-ao", "ZAP", "AO", "dth", "", "https://www.zap.co.ao/"),
  p("dstv-mz", "DStv Moçambique", "MZ", "dth", "", "https://www.dstv.com/"),
  p("dstv-na", "DStv Namibia", "NA", "dth", "", "https://www.dstv.com/"),
  p("dstv-bw", "DStv Botswana", "BW", "dth", "", "https://www.dstv.com/"),
  p("canal-sn", "Canal+ Sénégal", "SN", "dth", "", "https://www.canalplus-afrique.com/"),
  p("orange-sn", "Orange TV Sénégal", "SN", "cable", "", "https://www.orange.sn/"),
  p("canal-ci", "Canal+ Côte d'Ivoire", "CI", "dth", "", "https://www.canalplus-afrique.com/"),
  p("canal-cm", "Canal+ Cameroun", "CM", "dth", "", "https://www.canalplus-afrique.com/"),
  p("camtel-cm", "Camtel TV", "CM", "cable", "", "https://www.camtel.cm/"),
  p("canal-cd", "Canal+ RDC", "CD", "dth", "", "https://www.canalplus-afrique.com/"),
  p("myt-mu", "my.t", "MU", "cable", "", "https://www.myt.mu/"),
  p("ethio-tv", "Ethio Telecom TV", "ET", "cable", "", "https://www.ethiotelecom.et/"),
  p("canal-afr", "Canal+ Afrique", "BF", "dth", "", "https://www.canalplus-afrique.com/"),

  // ──────────────────────────────────────────────────────── Oceania ──
  // Foxtel, Freeview Australia and Sky New Zealand publish public XMLTV feeds of
  // their own lineups, so those three arrive with a guide already attached.
  p("foxtel", "Foxtel", "AU", "dth", "https://i.mjh.nz/Foxtel/epg.xml.gz", "https://www.foxtel.com.au/"),
  p("freeview-au", "Freeview Australia", "AU", "dth", "https://i.mjh.nz/Freeview/epg.xml.gz", "https://www.freeview.com.au/"),
  p("fetch-au", "Fetch TV", "AU", "cable", "", "https://www.fetchtv.com.au/"),
  p("binge-au", "Binge", "AU", "ott", "", "https://binge.com.au/"),
  p("kayo-au", "Kayo Sports", "AU", "ott", "", "https://kayosports.com.au/"),
  p("sky-nz", "Sky New Zealand", "NZ", "dth", "https://i.mjh.nz/Sky/epg.xml.gz", "https://www.sky.co.nz/"),
  p("onen-z", "One NZ TV", "NZ", "cable", "", "https://one.nz/"),
];

/** The kinds, as the picker spells them. */
export const KIND_LABEL = {
  dth: "DTH satellite",
  cable: "Cable / fibre",
  premium: "Premium channels",
  ott: "Premium streaming",
};

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
