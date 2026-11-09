import { useCallback, useEffect, useState } from "react";
import countryRules from "../../country-rules.json";
import type {
  MarketId,
  SniperRawLead,
  SniperScanParams,
  TechAuditResult,
} from "./leads-store";
import { fillTemplate, spinSpintaxSeeded } from "./message-template";
import type { SniperLead } from "./sniper-sieve";

/**
 * Rynki (kraje): kanał kontaktu, język i reguły wysyłki mają jedno źródło
 * w country-rules.json, wspólne dla interfejsu i silnika e-mail w Electronie.
 */

export type { MarketId } from "./leads-store";

export const MARKET_IDS: MarketId[] = ["PL", "US"];
export const MARKETS = countryRules.markets;
export const US = countryRules.markets.US;

export type UsNiche = (typeof US.niches)[number];
export type UsState = (typeof US.states)[number];

export function usNiche(id: string): UsNiche | undefined {
  return US.niches.find((n) => n.id === id);
}

export function usState(code: string): UsState | undefined {
  return US.states.find((s) => s.code === code);
}

export const US_PILLS: UsNiche[] = US.pills
  .map((id) => usNiche(id))
  .filter((n): n is UsNiche => Boolean(n));

/* ------------------------------------------------------------------ */
/* Ustawienia: aktywny rynek i cena w wiadomości                        */
/* ------------------------------------------------------------------ */

const MARKET_KEY = "leadfinder.active-market";
const PRICE_KEY = "leadfinder.market-prices";
const EVENT = "leadfinder:market-change";

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* tryb prywatny lub pełny magazyn — ustawienie działa do odświeżenia */
  }
}

export function isMarketId(value: unknown): value is MarketId {
  return value === "PL" || value === "US";
}

export function readActiveMarket(): MarketId {
  const raw = safeGet(MARKET_KEY);
  return isMarketId(raw) ? raw : "PL";
}

export function readUsPrice(): string {
  const raw = safeGet(PRICE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { US?: unknown };
      if (typeof parsed.US === "string") return parsed.US.trim();
    } catch {
      /* uszkodzony wpis — zostaje cena domyślna */
    }
  }
  return US.defaultPrice;
}

export function useMarketSettings() {
  const [market, setMarketState] = useState<MarketId>("PL");
  const [usPrice, setUsPriceState] = useState<string>(US.defaultPrice);

  useEffect(() => {
    const sync = () => {
      setMarketState(readActiveMarket());
      setUsPriceState(readUsPrice());
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("leadfinder:prefs-change", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("leadfinder:prefs-change", sync);
    };
  }, []);

  const setMarket = useCallback((next: MarketId) => {
    safeSet(MARKET_KEY, next);
    setMarketState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const setUsPrice = useCallback((text: string) => {
    safeSet(PRICE_KEY, JSON.stringify({ US: text.trim() }));
    setUsPriceState(text.trim());
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { market, meta: MARKETS[market], usPrice, setMarket, setUsPrice };
}

/* ------------------------------------------------------------------ */
/* E-mail po angielsku                                                  */
/* ------------------------------------------------------------------ */

function hostOf(url: string | null | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Diagnoza po angielsku wyłącznie z faktów zmierzonych przez audytor.
 * Zwraca null, gdy nie ma czego twierdzić — wtedy idzie szablon ogólny.
 */
export function englishDiagnosis(lead: {
  intent_category: SniperLead["intent_category"];
  website: string | null;
  tech_audit?: TechAuditResult | null | undefined;
}): string | null {
  const audit = lead.tech_audit ?? null;
  if (lead.intent_category === "SOCIAL_OR_FREE_BUILDER") {
    const host = hostOf(lead.website);
    return host
      ? `it runs on a free ${host} page rather than your own domain`
      : null;
  }
  if (!audit) return null;
  if (lead.intent_category === "EXPIRED_OR_BROKEN_SITE") {
    return audit.httpStatus === null
      ? "it didn't load at all"
      : `it returned a server error (${audit.httpStatus})`;
  }
  if (!audit.hasSsl)
    return 'browsers mark it as "Not Secure" because there is no SSL certificate';
  if (!audit.hasMobileViewport)
    return "it isn't set up for phones, so visitors have to pinch and zoom";
  if (audit.copyrightYear !== null && audit.copyrightYear < 2020)
    return `it doesn't seem to have been updated since ${audit.copyrightYear}`;
  if (audit.responseTimeMs !== null && audit.responseTimeMs >= 2500)
    return `it takes about ${(audit.responseTimeMs / 1000).toFixed(1)} seconds to load`;
  return null;
}

export type OutreachEmail = {
  subject: string;
  body: string;
  signature: string;
  templateId: string;
};

type TemplateKey = keyof typeof US.templates.body;

/**
 * Buduje e-mail po angielsku dla leada z rynku USA. Ziarnem Spintax jest id
 * leada, więc podgląd w Snajperze jest dokładnie tym, co zostanie wysłane.
 * Stopkę (firma, adres pocztowy, rezygnacja) dopisuje silnik wysyłki.
 */
export function buildUsEmail(
  lead: Pick<
    SniperLead,
    | "id"
    | "nazwa"
    | "miasto"
    | "website"
    | "intent_category"
    | "tech_audit"
    | "google_rating"
    | "google_reviews_count"
  >,
  options: { trade: string; price?: string; senderName?: string },
): OutreachEmail {
  const diagnosis = englishDiagnosis(lead);
  const wanted = lead.intent_category as string;
  const key: TemplateKey =
    diagnosis && wanted in US.templates.body
      ? (wanted as TemplateKey)
      : "DEFAULT";
  const reviews = Number(lead.google_reviews_count ?? 0);
  const rating = Number(lead.google_rating ?? 0);
  const priceText = (options.price ?? US.defaultPrice)
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  const city = String(lead.miasto ?? "").trim();
  const vars = {
    name: lead.nazwa,
    greeting: "",
    city: city ? ` in ${city}` : "",
    trade: options.trade,
    price: priceText ? ` (${priceText})` : "",
    diagnosis: diagnosis ?? "",
    // „Nie znalazłem strony” tylko wtedy, gdy firma naprawdę jej nie ma.
    nosite:
      !lead.website ||
      /facebook\.com|instagram\.com|linktr\.ee/i.test(lead.website)
        ? " and couldn't find a website for the business"
        : "",
    reviews:
      reviews >= 5 && rating >= 4
        ? ` Your Google reviews are great (${reviews} reviews, ${rating.toFixed(1)} stars), so the work clearly speaks for itself.`
        : "",
  };
  const fill = (template: string) =>
    fillTemplate(
      template,
      vars as unknown as Parameters<typeof fillTemplate>[1],
    );
  const subject = spinSpintaxSeeded(
    fill(US.templates.subject[key]),
    `${lead.id}|subject`,
  );
  const body = spinSpintaxSeeded(fill(US.templates.body[key]), lead.id);
  const sender = (options.senderName ?? "").trim();
  const text =
    body.text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([,.!?])/g, "$1")
      .trim() + (sender ? `\n\nBest,\n${sender}` : "");
  return {
    subject: subject.text.replace(/[\r\n]+/g, " ").trim(),
    body: text,
    signature: `[US · ${key}] ${subject.signature} ${body.signature}`.trim(),
    templateId: `🇺🇸 E-mail · ${key}`,
  };
}

/** Stopka dopisywana przez silnik — tu tylko do podglądu w interfejsie. */
export function usFooterPreview(sender: {
  company?: string;
  address?: string;
}): string {
  const company = sender.company?.trim() || "[nazwa firmy z ustawień]";
  const address = sender.address?.trim() || "[adres pocztowy z ustawień]";
  return US.email.footer
    .map((line) =>
      line.replaceAll("{company}", company).replaceAll("{address}", address),
    )
    .join("\n");
}

/** Czy odpowiedź jest odmową lub wyrazem nieufności — wtedy adres trafia na listę blokad. */
export function isRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return US.refusalKeywords.some((k) => lower.includes(k));
}

/* ------------------------------------------------------------------ */
/* Symulator rynku USA dla podglądu w przeglądarce                      */
/* ------------------------------------------------------------------ */

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SIM_SURNAMES = [
  "Miller",
  "Johnson",
  "Carter",
  "Bennett",
  "Hayes",
  "Sullivan",
  "Brooks",
  "Foster",
  "Morgan",
  "Reed",
  "Coleman",
  "Parker",
  "Ward",
  "Hughes",
  "Dawson",
  "Ellis",
];
const SIM_PREFIXES = [
  "Premier",
  "Reliable",
  "Hometown",
  "Summit",
  "Liberty",
  "All-Pro",
  "Precision",
  "Blue Ridge",
];
const SIM_CORPORATE = ["Corp", "Holdings", "Nationwide Group"];

/** Realistyczne surowe rekordy dla niszy i miasta w USA (deterministyczne). */
export function generateSimulatedUsLeads(
  params: SniperScanParams,
  now: Date = new Date(),
  count = 240,
): SniperRawLead[] {
  const niche = usNiche(params.nicheId);
  const trade = niche?.trade ?? "home services";
  const tradeTitle = trade.replace(/\b\w/g, (c) => c.toUpperCase());
  const city = params.city || "Tulsa, OK";
  const rand = prng(
    hashSeed(`US|${params.nicheId}|${city}|${now.toISOString().slice(0, 10)}`),
  );
  const out: SniperRawLead[] = [];
  for (let i = 0; i < count; i++) {
    const surname = SIM_SURNAMES[Math.floor(rand() * SIM_SURNAMES.length)]!;
    const corporate = rand() < 0.06;
    const style = rand();
    const nazwa = corporate
      ? `${tradeTitle} ${SIM_CORPORATE[Math.floor(rand() * SIM_CORPORATE.length)]}`
      : style < 0.5
        ? `${surname} ${tradeTitle}`
        : style < 0.8
          ? `${SIM_PREFIXES[Math.floor(rand() * SIM_PREFIXES.length)]} ${tradeTitle}`
          : `${surname} & Sons ${tradeTitle}`;
    const slug = nazwa
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "");
    const siteRoll = rand();
    let website: string | null = null;
    let audit: TechAuditResult | null = null;
    const base = {
      detectedCmsOrBuilder: "WordPress",
      hasAdPixels: rand() < 0.25,
      whoisFreeDomain: null,
    };
    if (siteRoll < 0.42) {
      website = `https://www.${slug}.com`;
      audit = {
        ...base,
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: true,
        copyrightYear: 2023 + Math.floor(rand() * 4),
        responseTimeMs: 400 + Math.floor(rand() * 1700),
      };
    } else if (siteRoll < 0.52) {
      website = `http://${slug}.com`;
      audit = {
        ...base,
        detectedCmsOrBuilder: "WordPress Old",
        httpStatus: 200,
        hasSsl: false,
        hasMobileViewport: rand() < 0.5,
        copyrightYear: 2011 + Math.floor(rand() * 9),
        responseTimeMs: 900 + Math.floor(rand() * 2600),
      };
    } else if (siteRoll < 0.64) {
      website = `https://${slug}.com`;
      audit = {
        ...base,
        detectedCmsOrBuilder: "WordPress Old",
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: rand() < 0.35,
        copyrightYear: 2010 + Math.floor(rand() * 9),
        responseTimeMs: 1200 + Math.floor(rand() * 2400),
      };
    } else if (siteRoll < 0.7) {
      website = `https://${slug}.com`;
      audit = {
        ...base,
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: true,
        copyrightYear: 2021 + Math.floor(rand() * 4),
        responseTimeMs: 2700 + Math.floor(rand() * 3000),
      };
    } else if (siteRoll < 0.76) {
      website = `https://${slug}.wixsite.com/home`;
    } else if (siteRoll < 0.84) {
      website = `https://www.facebook.com/${slug}`;
    }
    // Adres e-mail da się znaleźć tylko wtedy, gdy firma ma działającą stronę.
    const reachable =
      website !== null && !website.includes("facebook.com") && rand() < 0.72;
    const emailRoll = rand();
    const email = !reachable
      ? null
      : emailRoll < 0.55
        ? `info@${slug}.com`
        : emailRoll < 0.8
          ? `${slug}@gmail.com`
          : `${surname.toLowerCase()}@${slug}.com`;
    const reviewsRoll = rand();
    const reviews =
      reviewsRoll < 0.15
        ? Math.floor(rand() * 3)
        : reviewsRoll < 0.9
          ? 3 + Math.floor(rand() * 110)
          : 140 + Math.floor(rand() * 400);
    out.push({
      id: `sim-us-${params.nicheId}-${i}`,
      source: "GOOGLE_MAPS",
      nazwa,
      telefon: `+1${200 + Math.floor(rand() * 700)}${5550100 + Math.floor(rand() * 99)}`,
      miasto: city,
      adres: `${100 + Math.floor(rand() * 8900)} ${["Main St", "Oak Ave", "Maple Dr", "Elm St", "Cedar Ln"][Math.floor(rand() * 5)]}, ${city}`,
      kategoria: niche?.label ?? params.keyword,
      website,
      email,
      owner_name: null,
      rating: reviews === 0 ? null : Math.round((3.7 + rand() * 1.3) * 10) / 10,
      reviews,
      is_promoted_ad: false,
      social_only: false,
      ceidg_start_date: null,
      nip: null,
      mapy_url: `https://www.google.com/maps/search/${encodeURIComponent(`${nazwa} ${city}`)}`,
      olx_url: null,
      tech_audit: audit,
      whois_free_domain: null,
    });
  }
  return out;
}
