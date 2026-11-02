import { desktop } from "./leads-store";
import { extractPerson, type Gender } from "./person-name";
import { findWebsiteInHtml } from "./website-check";

/**
 * Darmowe wzbogacanie danych o firmie.
 * Aplikacja na Macu pobiera publiczne strony (profil w Google Maps, wizytówka
 * na Facebooku, strona firmowa) i wyciąga z nich kontakt oraz dane rejestrowe.
 */

export type EnrichResult = {
  email: string | null;
  nip: string | null;
  regon: string | null;
  social: string | null;
  imie: string | null;
  wlasciciel: string | null;
  plec: Gender;
  /** Strona znaleziona w internecie, choć nie było jej w wizytówce Google. */
  strona: string | null;
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const NIP_RE = /\b(?:NIP[:\s]*)?((?:\d[ -]?){10})\b/gi;
const REGON_RE = /\bREGON[:\s]*((?:\d[ -]?){9,14})\b/gi;
const SOCIAL_RE =
  /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com)\/[^\s"'<>)]+/gi;

const BAD_EMAIL = /(example|sentry|wixpress|\.png|\.jpg|\.webp|@2x|godaddy|schema\.org)/i;

function digits(value: string) {
  return value.replace(/\D/g, "");
}

/** Kontrola sumy kontrolnej NIP — odsiewa przypadkowe ciągi cyfr. */
export function isValidNip(value: string): boolean {
  const n = digits(value);
  if (n.length !== 10) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(n[i]), 0);
  return sum % 11 === Number(n[9]);
}

export function extractFromHtml(html: string): EnrichResult {
  const text = html.replace(/&#64;|&commat;/g, "@");

  const emails = [...text.matchAll(EMAIL_RE)]
    .map((m) => m[0].toLowerCase())
    .filter((e) => !BAD_EMAIL.test(e));

  let nip: string | null = null;
  for (const m of text.matchAll(NIP_RE)) {
    const candidate = digits(m[1] ?? "");
    if (isValidNip(candidate)) {
      nip = candidate;
      break;
    }
  }

  let regon: string | null = null;
  for (const m of text.matchAll(REGON_RE)) {
    const candidate = digits(m[1] ?? "");
    if (candidate.length === 9 || candidate.length === 14) {
      regon = candidate;
      break;
    }
  }

  const social = [...new Set([...text.matchAll(SOCIAL_RE)].map((m) => m[0]))]
    .filter((u) => !/\/(sharer|share|plugins|tr\?)/i.test(u))
    .slice(0, 3)
    .join(" ");

  const person = extractPerson(html);

  return {
    email: emails[0] ?? null,
    nip,
    regon,
    social: social || null,
    imie: person.imie,
    wlasciciel: person.wlasciciel,
    plec: person.plec,
    strona: null,
  };
}

function merge(a: EnrichResult, b: EnrichResult): EnrichResult {
  return {
    email: a.email ?? b.email,
    nip: a.nip ?? b.nip,
    regon: a.regon ?? b.regon,
    social: a.social ?? b.social,
    imie: a.imie ?? b.imie,
    wlasciciel: a.wlasciciel ?? b.wlasciciel,
    plec: a.plec ?? b.plec,
    strona: a.strona ?? b.strona,
  };
}

const EMPTY: EnrichResult = {
  email: null,
  nip: null,
  regon: null,
  social: null,
  imie: null,
  wlasciciel: null,
  plec: null,
  strona: null,
};

/** Pobiera dane z kilku publicznych źródeł i łączy w jeden wynik. */
export async function enrichLead(input: {
  nazwa: string;
  miasto?: string | null | undefined;
  adres?: string | null | undefined;
  mapy_url?: string | null | undefined;
}): Promise<EnrichResult> {
  const bridge = desktop();
  if (!bridge?.enrich) {
    throw new Error("Wzbogacanie danych działa tylko w aplikacji na Maca.");
  }

  const query = encodeURIComponent(`${input.nazwa} ${input.miasto ?? input.adres ?? ""}`.trim());
  const sources = [
    input.mapy_url ?? null,
    `https://duckduckgo.com/html/?q=${query}`,
    `https://duckduckgo.com/html/?q=${query}+kontakt+email`,
    `https://duckduckgo.com/html/?q=${query}+NIP`,
    `https://duckduckgo.com/html/?q=${query}+właściciel`,
    `https://www.bing.com/search?q=${query}+facebook`,
  ].filter((u): u is string => Boolean(u));

  // imię często siedzi już w samej nazwie firmy (np. „Fryzjer Anna Kowalska”)
  let result = merge(EMPTY, {
    ...EMPTY,
    ...extractPerson(input.nazwa),
  });

  for (const url of sources) {
    if (result.email && result.nip && result.social && result.imie && result.strona) break;
    try {
      const res = await bridge.enrich(url);
      if (res.ok && res.html) {
        result = merge(result, extractFromHtml(res.html));
        // sprawdzamy w wynikach wyszukiwania, czy firma ma jednak własną stronę
        if (!result.strona && !url.includes("google.com/maps")) {
          result = { ...result, strona: findWebsiteInHtml(res.html, input.nazwa) };
        }
      }
    } catch {
      /* pojedyncze źródło może nie odpowiedzieć — próbujemy dalej */
    }
  }
  return result;
}
