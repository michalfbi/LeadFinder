import type { LeadRow } from "./leads-store";

/**
 * Asystent wolnych domen .pl — na Macu odpytuje WHOIS/DNS przez proces
 * główny Electrona, w przeglądarce (podgląd Lovable) symuluje wynik,
 * żeby interfejs działał płynnie bez prawdziwych zapytań sieciowych.
 */

export type DomainCheckResult = {
  ok: boolean;
  domain: string | null;
  available: boolean;
  suggestions?: { domain: string; available: boolean; method?: string }[];
  error?: string;
};

export type DomainProgress = { index: number; total: number; name: string; found: number };

type DomainBridge = {
  check: (nazwa: string, miasto: string) => Promise<DomainCheckResult>;
  checkBulk: (ids: string[], onProgress?: (p: DomainProgress) => void) => Promise<{ ok: boolean; checked: number; found: number }>;
};

export const domainBridge = (): DomainBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { leadfinder?: { domain?: DomainBridge } }).leadfinder?.domain;

const PL_DIACRITICS: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
const stripPl = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch);

const DOMAIN_STOPWORDS =
  /\b(sp\.?\s*z\s*o\.?o\.?|spolka|s\.?\s*c\.?|f\.?\s*h\.?\s*u\.?|p\.?\s*h\.?\s*u\.?|uslugi|usluga|firma|przedsiebiorstwo|handlowa|handel|produkcja|i\s*wspolnicy|wspolnicy|polska|pol)\b/gi;

function domainTokens(value: string): string[] {
  return stripPl(value)
    .replace(DOMAIN_STOPWORDS, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2);
}

/** Te same reguły propozycji co w procesie głównym — podgląd pokazuje realne kandydatki. */
export function suggestDomains(companyName: string, city: string): string[] {
  const tokens = domainTokens(companyName);
  const cityToken = domainTokens(city)[0] ?? "";
  const suggestions: string[] = [];
  if (tokens.length >= 2) suggestions.push(tokens.slice(0, 3).join(""));
  if (tokens.length === 1) suggestions.push(tokens[0]!);
  const last = tokens[tokens.length - 1] ?? "";
  if (last && cityToken) suggestions.push(`${last}-${cityToken}`);
  else if (tokens.length >= 2) suggestions.push(`${tokens[0]}-${tokens[tokens.length - 1]}`);
  return [...new Set(suggestions.filter((s) => s.length >= 3 && s.length <= 63))].slice(0, 2);
}

/** Deterministyczna symulacja dostępności w podglądzie (ok. połowa domen „wolna”). */
function mockAvailability(domain: string): boolean {
  let hash = 0;
  for (const ch of domain) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 2 === 0;
}

export async function checkDomainForLead(lead: Pick<LeadRow, "nazwa" | "miasto">): Promise<DomainCheckResult> {
  const bridge = domainBridge();
  if (bridge) return bridge.check(lead.nazwa, lead.miasto ?? "");
  const candidates = suggestDomains(lead.nazwa, lead.miasto ?? "");
  const suggestions = candidates.map((s) => ({ domain: `${s}.pl`, available: mockAvailability(`${s}.pl`), method: "symulacja" }));
  const free = suggestions.find((s) => s.available);
  return { ok: true, domain: free?.domain ?? null, available: Boolean(free), suggestions };
}

/**
 * Masowe sprawdzanie dla listy leadów bez strony WWW. W podglądzie zwraca
 * mapę id → wolna domena, żeby wywołujący mógł zaktualizować leady lokalnie.
 */
export async function checkDomainsBulk(
  leads: LeadRow[],
  onProgress?: (p: DomainProgress) => void,
): Promise<{ checked: number; found: number; results: Map<string, string> }> {
  const targets = leads.filter((l) => !l.strona && !l.suggested_free_domain && l.channel_type !== "EMAIL");
  const bridge = domainBridge();
  if (bridge) {
    const res = await bridge.checkBulk(targets.map((l) => l.id), onProgress);
    return { checked: res.checked, found: res.found, results: new Map() };
  }
  const results = new Map<string, string>();
  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i]!;
    onProgress?.({ index: i + 1, total: targets.length, name: lead.nazwa, found: results.size });
    const check = await checkDomainForLead(lead);
    if (check.available && check.domain) results.set(lead.id, check.domain);
    await new Promise((r) => setTimeout(r, 120));
  }
  return { checked: targets.length, found: results.size, results };
}
