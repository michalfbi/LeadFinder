/**
 * Sprawdzanie, czy firma ma jednak stronę internetową (choć nie ma jej w wizytówce).
 * Analizujemy linki z wyników wyszukiwania i szukamy domeny pasującej do nazwy firmy.
 */

// katalogi, media społecznościowe i agregatory — to nie jest własna strona firmy
const NOT_OWN_SITE =
  /(facebook|instagram|linkedin|tiktok|youtube|twitter|x\.com|google\.|goo\.gl|maps\.app|duckduckgo|bing\.com|yahoo|wikipedia|allegro|olx|otomoto|gumtree|pkt\.pl|panoramafirm|aleo\.com|gowork|oferia|fixly|booksy|moja-ostroleka|ceneo|yelp|tripadvisor|zumi|targeo|firmy\.net|biznesfinder|bazafirm|dobryslusarz|w-blogu|wordpress\.com|blogspot|wix\.com\/website|sites\.google|linktr\.ee|nip24|rejestr\.io|krs-pol|bizin\.pl|pkd|infoveriti|imoje|apple\.com|microsoft|cloudflare|schema\.org|gstatic|googleapis|w3\.org)/i;

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;

const STOPWORDS = new Set([
  "spolka","spółka","sp","zoo","z","o","sc","s","c","firma","zaklad","zakład",
  "uslugi","usługi","studio","salon","serwis","pracownia","centrum","group","grupa",
  "pl","com","the","and","i","oraz","krakow","kraków","warszawa","warsaw",
]);

function norm(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(name: string) {
  return name
    .split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]+/)
    .map((t) => norm(t))
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Wyciąga hostname bez "www." albo null, gdy adres jest niepoprawny. */
function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Rozkodowuje linki wyników DuckDuckGo (/l/?uddg=...). */
function decodeSearchLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/uddg=([^&"'<>]+)/gi)) {
    try {
      out.push(decodeURIComponent(m[1]!));
    } catch {
      /* pomijamy */
    }
  }
  for (const m of html.matchAll(URL_RE)) out.push(m[0]);
  return out;
}

/**
 * Zwraca adres własnej strony firmy, jeśli któryś z linków wygląda na jej domenę.
 * Dopasowanie: znaczące słowo z nazwy firmy występuje w nazwie domeny.
 */
export function findWebsiteInHtml(html: string, nazwa: string): string | null {
  const words = tokens(nazwa);
  if (words.length === 0) return null;

  for (const url of decodeSearchLinks(html)) {
    const h = host(url);
    if (!h || NOT_OWN_SITE.test(h)) continue;
    const domain = norm(h.split(".").slice(0, -1).join("")) || norm(h);
    if (words.some((w) => domain.includes(w) || w.includes(domain))) {
      return `https://${h}`;
    }
  }
  return null;
}
