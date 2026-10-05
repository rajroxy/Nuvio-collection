/**
 * Candidate OTT services per country, best-known first.
 *
 * Used only by `scripts/probe-tmdb.mjs`. TMDB's raw region provider lists are
 * noisy — they advertise services that do not actually operate in the region
 * (Sun Nxt shows up in the US and Germany) — so "Regional OTT" is built from
 * these known brands instead, and the probe verifies each one against TMDB
 * before it is written into `tmdb-verified.json`.
 *
 * A name that does not resolve simply contributes nothing; the probe reports it.
 */
export const REGIONAL_CANDIDATES = {
  // Hulu is a US service, so it belongs here rather than in the global set.
  US: ["Hulu", "Peacock Premium", "Peacock", "Pluto TV", "Tubi TV"],
  GB: ["BBC iPlayer", "ITVX", "Channel 4", "NOW", "Sky Go", "BritBox"],
  IN: ["JioHotstar", "Zee5", "SonyLIV", "Aha", "Sun Nxt", "Hoichoi", "Eros Now"],
  JP: ["U-NEXT", "Hulu", "AbemaTV", "DMM TV", "WOWOW", "TVer"],
  KR: ["TVING", "Wavve", "Watcha", "Coupang Play", "Kocowa", "Viki"],
  FR: ["Canal+", "Arte", "M6+", "Molotov", "Salto", "France TV"],
  DE: ["Sky Go", "WOW", "RTL+", "Joyn", "ARD"],
  ES: ["Movistar Plus+", "Filmin", "FlixOlé", "Atresplayer"],
  IT: ["Sky Go", "NOW", "RaiPlay", "Mediaset Infinity", "TIMvision"],
  NL: ["Videoland", "NLZIET", "Pathé Thuis"],
  SE: ["Viaplay", "SVT Play", "TV4 Play"],
  NO: ["Viaplay", "NRK TV", "TV 2 Play"],
  DK: ["Viaplay", "DR TV", "TV 2 Play"],
  PL: ["Canal+ Online", "Player", "TVP VOD"],
  TR: ["BluTV", "Exxen", "Gain", "TOD"],
  BR: ["Globoplay", "Telecine", "Looke"],
  MX: ["ViX", "Claro Video", "Blim"],
  AR: ["ViX", "Claro Video", "Flow"],
  CO: ["ViX", "Claro Video"],
  CL: ["ViX", "Claro Video"],
  PE: ["ViX", "Claro Video"],
  NG: ["Showmax", "DStv Now"],
  ZA: ["Showmax", "DStv Now"],
  KE: ["Showmax", "DStv Now"],
  EG: ["Shahid VIP", "OSN", "WATCH iT"],
  MA: ["Shahid VIP", "OSN"],
  SA: ["Shahid VIP", "OSN", "STARZPLAY"],
  AE: ["Shahid VIP", "OSN", "STARZPLAY"],
  IL: ["Yes+", "HOT VOD", "Cellcom tv"],
  ID: ["Vidio", "Viu", "Catchplay", "Vision+", "Iflix"],
  TH: ["TrueID", "Viu", "Iflix", "MONO MAX"],
  PH: ["Viu", "Iflix", "Vivamax"],
  AU: ["Stan", "Binge", "Neon", "7plus", "ABC iview"],
  CA: ["Crave", "CBC Gem", "Tubi TV"],
  IE: ["RTE Player", "Virgin Media Play", "NOW"],
  PT: ["Opto", "RTP Play"],
  GR: ["Vodafone TV", "Ertflix", "Cinobo"],
  RU: ["Kinopoisk", "Ivi", "Okko"],
  TW: ["KKTV", "myVideo", "Catchplay", "friDay"],
  HK: ["Viu", "MyTV SUPER", "iQIYI"],
  // Countries added for the wider Countries card — each contributes regional
  // OTT rows only for the services the probe can actually resolve.
  MY: ["iQIYI", "Viu", "Astro Go", "Tonton"],
  SG: ["Viu", "iQIYI", "meWATCH"],
  VN: ["FPT Play", "VieON", "Galaxy Play", "FPT Play"],
  PK: ["Tubi TV", "Zee5", "Tamasha"],
  BD: ["Chorki", "Hoichoi", "Zee5", "Bongo"],
  LK: ["Sun Nxt", "Zee5", "Lionsgate Play"],
  NZ: ["Neon", "TVNZ", "ThreeNow", "Sky Go"],
  UA: ["Sweet.tv", "Megogo", "Kyivstar TV"],
  CZ: ["Voyo", "Prima+", "SkyShowtime", "Oneplay"],
  HU: ["Voyo", "RTL+", "TV2 Play"],
  RO: ["Voyo", "SkyShowtime", "AntenaPLAY"],
  FI: ["Yle Areena", "Elisa Viihde", "Ruutu", "Viaplay"],
  CH: ["Play Suisse", "Blue TV", "SkyShowtime"],
  BE: ["VRT MAX", "Streamz", "Pickx"],
  AT: ["ORF ON", "Joyn", "SkyShowtime"],
  BG: ["Voyo", "SkyShowtime"],
  RS: ["Voyo", "SkyShowtime"],
  HR: ["Voyo", "SkyShowtime"],
};
