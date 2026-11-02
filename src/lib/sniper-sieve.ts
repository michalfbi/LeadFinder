import rules from "../../sniper-rules.json";
import type {
  IntentCategory,
  LeadRow,
  NewLead,
  SieveStage,
  SniperDeepScanResult,
  SniperQualification,
  SniperRawLead,
  SniperScanParams,
  SniperScanProgress,
  TechAuditResult,
} from "./leads-store";
import { validateAndFormatPolishMobile } from "./phone-validator";
import { certainPersonFromCompany } from "./person-name";
import {
  extractFirstName,
  toPolishVocative,
  vocativeGender,
} from "./polish-vocative";
import { buildSniperMessage } from "./message-template";
import { suggestDomains } from "./domain-check";
import { findNiche } from "./niches-catalog";

export { toPolishVocative, extractFirstName } from "./polish-vocative";

/* ------------------------------------------------------------------ */
/* Konfiguracja                                                         */
/* ------------------------------------------------------------------ */

export const SNIPER_RULES = rules;
export const SNIPER_POINTS = rules.points;
export const SNIPER_THRESHOLDS = rules.thresholds;
export const SNIPER_DEFAULT_MIN_SCORE = rules.defaults.minScore;
export const SNIPER_TOP_LIMIT = rules.defaults.topLimit;
export const SNIPER_DAILY_SMS_LIMIT = rules.defaults.dailySmsLimit;
export const SNIPER_PILLS = rules.pills;

export type SniperGates = {
  /** Łowca awarii: martwe strony, brak SSL, przestarzałe strony. */
  brokenSites: boolean;
  /** Płacący za wyróżnienie ogłoszeń OLX. */
  paidAds: boolean;
  /** Lokalni liderzy 4.5⭐+ bez porządnej strony. */
  localLeaders: boolean;
  /** Świeże firmy z CEIDG w branżach high-ticket. */
  newCeidg: boolean;
};

export const DEFAULT_GATES: SniperGates = {
  brokenSites: true,
  paidAds: true,
  localLeaders: true,
  newCeidg: true,
};

export type SieveOptions = {
  minScoreThreshold?: number;
  limit?: number;
  gates?: Partial<SniperGates>;
  /** Numery z czarnej listy (dowolny format — porównujemy ostatnie 9 cyfr). */
  blacklist?: Iterable<string>;
  /** Numery już obecne w bazie leadów — do nich nie piszemy drugi raz. */
  existingPhones?: Iterable<string>;
  /** Czy skanowana nisza jest wysokomarżowa (high-ticket). */
  highTicket?: boolean;
  /** Etykieta niszy wstawiana do szablonów ({branza}). */
  nicheLabel?: string | null;
  /** Data odniesienia dla „świeżych” firm z CEIDG — przekazywana jawnie dla determinizmu. */
  now?: Date;
};

/** Lead po przejściu przez sito — gotowy do podglądu, zapisu i wysyłki. */
export type SniperLead = SniperRawLead &
  SniperQualification & {
    phone_e164: string | null;
    suggested_free_domain: string | null;
    /** Krótki opis wykrytego problemu technicznego do zmiennej {diagnoza_tech}. */
    tech_diagnosis: string | null;
    nisza: string | null;
  };

export type SieveFunnel = {
  totalScanned: number;
  passedStage1: number;
  passedStage2: number;
  passedStage3: number;
  passedStage4: number;
  finalTop50: number;
  averageScore: number;
  rejectedByStage: Record<SieveStage, number>;
};

export type SieveResult = {
  top: SniperLead[];
  rejected: SniperLead[];
  funnel: SieveFunnel;
};

/* ------------------------------------------------------------------ */
/* Pomocnicze                                                           */
/* ------------------------------------------------------------------ */

const lower = (value: string | null | undefined) =>
  String(value ?? "").toLocaleLowerCase("pl");

export function phoneKey9(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

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

export function isSocialUrl(url: string | null | undefined): boolean {
  const host = hostOf(url);
  return (
    Boolean(host) &&
    rules.socialHosts.some((h) => host === h || host.endsWith(`.${h}`))
  );
}

export function isFreeBuilderUrl(url: string | null | undefined): boolean {
  const host = hostOf(url);
  return Boolean(host) && rules.freeBuilderHosts.some((h) => host.includes(h));
}

export function isFreeMailbox(email: string | null | undefined): boolean {
  const domain = lower(email).split("@")[1] ?? "";
  return Boolean(domain) && rules.freeMailDomains.includes(domain);
}

/** Słowa korporacyjne dopasowujemy jako całe tokeny, żeby „Supermarketing” nie odpadał przez „Market”. */
export function isCorporateName(name: string | null | undefined): boolean {
  const text = ` ${lower(name).replace(/\s+/g, " ")} `;
  return rules.corporateWords.some((word) => {
    const w = lower(word);
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^a-ząćęłńóśźż0-9])${escaped}(?=$|[^a-ząćęłńóśźż0-9])`,
      "i",
    ).test(text);
  });
}

function normCity(city: string | null | undefined): string {
  return lower(city)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .trim();
}

function daysBetween(
  dateIso: string | null | undefined,
  now: Date,
): number | null {
  if (!dateIso) return null;
  const t = Date.parse(String(dateIso).slice(0, 10));
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Strona działa, ma SSL, viewport, jest szybka i nie ma starej noty copyright. */
export function isModernSite(
  audit: TechAuditResult | null | undefined,
): boolean {
  if (!audit) return false;
  const working = audit.httpStatus !== null && audit.httpStatus < 400;
  const fast =
    audit.responseTimeMs !== null &&
    audit.responseTimeMs < rules.thresholds.fastSiteMs;
  const fresh =
    audit.copyrightYear === null ||
    audit.copyrightYear >= rules.thresholds.outdatedBeforeYear;
  return working && audit.hasSsl && audit.hasMobileViewport && fast && fresh;
}

function ownerFirstName(raw: SniperRawLead): string | null {
  const fromContact = extractFirstName(raw.owner_name);
  if (fromContact) return fromContact;
  return certainPersonFromCompany(raw.nazwa)?.imie ?? null;
}

function pushReason(reasons: string[], label: string, points: number): number {
  reasons.push(`${label} (+${points})`);
  return points;
}

function websiteIssueType(
  intent: IntentCategory,
  audit: TechAuditResult | null,
): LeadRow["website_issue_type"] {
  if (intent === "EXPIRED_OR_BROKEN_SITE") return "EXPIRED_OR_ERROR";
  if (intent === "OUTDATED_NO_SSL_MOBILE")
    return audit && !audit.hasSsl ? "NO_SSL" : "NO_MOBILE";
  if (intent === "PAID_AD_NO_SITE") return "OLX_NO_WEBSITE";
  return "NO_WEBSITE";
}

/* ------------------------------------------------------------------ */
/* Pięć bramek                                                          */
/* ------------------------------------------------------------------ */

type Draft = {
  raw: SniperRawLead;
  score: number;
  reasons: string[];
  stage: SieveStage;
  rejection: string | null;
  phone: string | null;
  firstName: string | null;
  vocative: string;
  site: "none" | "social" | "builder" | "own";
  broken: boolean;
  noSsl: boolean;
  outdated: boolean;
  promoted: boolean;
  leader: boolean;
  newCeidg: boolean;
  diagnosis: string | null;
  competitor: string | null;
};

function stageOne(
  d: Draft,
  blocked: Set<string>,
  existing: Set<string>,
  seen: Set<string>,
): void {
  if (!String(d.raw.telefon ?? "").replace(/\D/g, "")) {
    d.rejection = "Brak numeru telefonu";
    return;
  }
  const check = validateAndFormatPolishMobile(d.raw.telefon ?? "");
  const key = check.nineDigits ?? phoneKey9(d.raw.telefon);
  if (!check.isValidMobile || (key && blocked.has(key))) {
    d.rejection = "Numer stacjonarny lub zablokowany";
    return;
  }
  if (existing.has(key)) {
    d.rejection = "Numer jest już w bazie — firma była kontaktowana";
    return;
  }
  if (seen.has(key)) {
    d.rejection = "Duplikat numeru w tej paczce";
    return;
  }
  seen.add(key);
  if (
    isCorporateName(d.raw.nazwa) ||
    (d.raw.reviews ?? 0) > rules.thresholds.maxReviews
  ) {
    d.rejection = "Zbyt duża firma (ryzyko sekretariatu/call center)";
    return;
  }
  d.phone = check.formatted;
  d.firstName = ownerFirstName(d.raw);
  d.vocative = toPolishVocative(d.firstName);
  if (d.firstName && d.vocative) {
    d.score += pushReason(
      d.reasons,
      `👤 Decydent: ${d.vocative}`,
      rules.points.owner,
    );
  } else {
    d.firstName = null;
    d.vocative = "";
  }
}

function stageTwo(d: Draft, gates: SniperGates): void {
  d.stage = 2;
  const url = d.raw.website;
  if (d.raw.social_only || isSocialUrl(url) || isFreeBuilderUrl(url)) {
    d.site = isFreeBuilderUrl(url) ? "builder" : "social";
    d.diagnosis =
      d.site === "builder"
        ? `na darmową podstronę w kreatorze (${hostOf(url)})`
        : "tylko na profil w mediach społecznościowych";
    d.score += pushReason(
      d.reasons,
      "📱 Tylko Facebook / Darmowy kreator zamiast własnej domeny",
      rules.points.socialOrFreeBuilder,
    );
    return;
  }
  if (!url) {
    d.site = "none";
    d.score += pushReason(
      d.reasons,
      "🚫 Brak strony WWW",
      rules.points.noWebsite,
    );
    return;
  }
  d.site = "own";
  const audit = d.raw.tech_audit;
  if (!audit) {
    d.rejection = "Nie udało się zbadać strony — nie zgadujemy diagnozy";
    return;
  }
  if (isModernSite(audit)) {
    d.rejection = "Posiada nowoczesną, sprawną stronę WWW";
    return;
  }
  d.broken = audit.httpStatus === null || audit.httpStatus >= 400;
  const weak = d.broken || !audit.hasMobileViewport || !audit.hasSsl;
  if (d.broken) {
    d.diagnosis =
      audit.httpStatus === null
        ? "strona nie odpowiada (błąd DNS lub serwera)"
        : `strona zwraca błąd ${audit.httpStatus}`;
    if (gates.brokenSites)
      d.score += pushReason(
        d.reasons,
        "🚨 Awaria strony WWW (Błąd HTTP/DNS)",
        rules.points.brokenSite,
      );
  } else {
    if (!audit.hasSsl) {
      d.noSsl = true;
      d.diagnosis =
        "przeglądarki oznaczają stronę jako „Niezabezpieczona” (brak SSL)";
      if (gates.brokenSites)
        d.score += pushReason(
          d.reasons,
          "🔓 Brak certyfikatu SSL (Komunikat: Niezabezpieczona)",
          rules.points.noSsl,
        );
    }
    const oldCopyright =
      audit.copyrightYear !== null &&
      audit.copyrightYear < rules.thresholds.outdatedBeforeYear;
    if (!audit.hasMobileViewport || oldCopyright) {
      d.outdated = true;
      d.diagnosis ??= !audit.hasMobileViewport
        ? "strona nie ma wersji na telefony"
        : `strona nie była odświeżana od ${audit.copyrightYear} r.`;
      if (gates.brokenSites)
        d.score += pushReason(
          d.reasons,
          "🕰️ Przestarzała strona / Brak wersji mobilnej",
          rules.points.outdated,
        );
    }
    const slow =
      audit.responseTimeMs !== null &&
      audit.responseTimeMs >= rules.thresholds.fastSiteMs;
    if (slow) {
      d.diagnosis ??= `strona ładuje się ${(audit.responseTimeMs! / 1000).toFixed(1).replace(".", ",")} s`;
      if (gates.brokenSites)
        d.score += pushReason(
          d.reasons,
          `🐢 Wolna strona (${(audit.responseTimeMs! / 1000).toFixed(1)} s)`,
          rules.points.slowSite,
        );
    }
  }
  if (audit.hasAdPixels && weak && gates.brokenSites) {
    d.score += pushReason(
      d.reasons,
      "🎯 Aktywne piksele reklamowe na słabej stronie",
      rules.points.adPixelsOnWeakSite,
    );
  }
  if (!gates.brokenSites) {
    d.rejection = "Bramka „Łowca Awarii” wyłączona — firma ma własną stronę";
  }
}

function stageThree(
  d: Draft,
  gates: SniperGates,
  now: Date,
  highTicket: boolean,
): void {
  d.stage = 3;
  const reviews = d.raw.reviews ?? 0;
  const rating = d.raw.rating ?? 0;
  const age =
    d.raw.source === "CEIDG" ? daysBetween(d.raw.ceidg_start_date, now) : null;
  const isNew =
    age !== null && age >= 0 && age <= rules.thresholds.newCompanyDays;
  const activeOlx = d.raw.source === "OLX";
  if (reviews < rules.thresholds.minReviewsAlive && !activeOlx && !isNew) {
    d.rejection = "Brak śladów aktywności rynkowej (Zombie)";
    return;
  }
  if (d.raw.is_promoted_ad) {
    d.promoted = true;
    if (gates.paidAds)
      d.score += pushReason(
        d.reasons,
        "💸 Płaci za promowanie ogłoszenia na OLX",
        rules.points.promotedAd,
      );
  }
  const leader =
    reviews >= rules.thresholds.leaderMinReviews &&
    reviews <= rules.thresholds.leaderMaxReviews &&
    rating >= rules.thresholds.leaderMinRating;
  if (leader) {
    d.leader = true;
    if (gates.localLeaders) {
      const siteNote =
        d.site === "own" ? "ze słabą stroną" : "bez porządnej strony";
      d.score += pushReason(
        d.reasons,
        `⭐ Lokalny lider: ${reviews} opinii (${rating.toFixed(1)}⭐) ${siteNote}`,
        rules.points.localLeader,
      );
    }
  }
  if (isNew && highTicket && d.phone) {
    d.newCeidg = true;
    if (gates.newCeidg)
      d.score += pushReason(
        d.reasons,
        `🆕 Nowa firma z CEIDG (${age} dni) w branży high-ticket`,
        rules.points.newCeidgHighTicket,
      );
  }
  if (isFreeMailbox(d.raw.email)) {
    d.score += pushReason(
      d.reasons,
      "📫 Darmowa skrzynka e-mail",
      rules.points.freeMailbox,
    );
  }
}

function stageFour(d: Draft, competitors: Map<string, SniperRawLead[]>): void {
  d.stage = 4;
  const domain =
    d.raw.whois_free_domain ?? d.raw.tech_audit?.whoisFreeDomain ?? null;
  if (domain)
    d.score += pushReason(
      d.reasons,
      `🌐 Wolna domena: ${domain}`,
      rules.points.freeDomain,
    );
  const pool = competitors.get(normCity(d.raw.miasto)) ?? [];
  const rival = pool.find(
    (c) =>
      c.id !== d.raw.id && phoneKey9(c.telefon) !== phoneKey9(d.raw.telefon),
  );
  d.competitor = rival ? rival.nazwa : null;
}

function intentOf(d: Draft): IntentCategory {
  if (d.broken) return "EXPIRED_OR_BROKEN_SITE";
  if (d.promoted && d.site !== "own") return "PAID_AD_NO_SITE";
  if (d.site === "social" || d.site === "builder")
    return "SOCIAL_OR_FREE_BUILDER";
  if (d.leader && d.site === "none") return "HIGH_REVIEWS_NO_SITE";
  if (d.site === "own") return "OUTDATED_NO_SSL_MOBILE";
  if (d.newCeidg) return "NEW_CEIDG_HIGH_TICKET";
  return "NO_WEBSITE";
}

function buildCompetitorPool(
  rawLeads: SniperRawLead[],
): Map<string, SniperRawLead[]> {
  const pool = new Map<string, SniperRawLead[]>();
  for (const raw of rawLeads) {
    if (!isModernSite(raw.tech_audit)) continue;
    if ((raw.rating ?? 0) < rules.thresholds.competitorMinRating) continue;
    if (isCorporateName(raw.nazwa)) continue;
    const city = normCity(raw.miasto);
    if (!city) continue;
    const list = pool.get(city) ?? [];
    list.push(raw);
    pool.set(city, list);
  }
  for (const list of pool.values()) {
    list.sort(
      (a, b) =>
        (b.reviews ?? 0) - (a.reviews ?? 0) ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        a.nazwa.localeCompare(b.nazwa, "pl"),
    );
  }
  return pool;
}

function finalize(
  d: Draft,
  passed: boolean,
  nicheLabel: string | null,
): SniperLead {
  const intent = intentOf(d);
  const domain =
    d.raw.whois_free_domain ?? d.raw.tech_audit?.whoisFreeDomain ?? null;
  return {
    ...d.raw,
    hot_score: Math.min(100, d.score),
    sieve_passed: passed,
    sieve_stage_reached: d.stage,
    rejection_reason: passed ? null : d.rejection,
    intent_category: intent,
    score_reasons: d.reasons,
    owner_first_name: d.firstName,
    owner_vocative: d.vocative || null,
    local_competitor: d.competitor,
    is_promoted_ad: d.raw.is_promoted_ad,
    google_rating: d.raw.rating,
    google_reviews_count: d.raw.reviews,
    tech_audit: d.raw.tech_audit,
    phone_e164: d.phone,
    suggested_free_domain: domain,
    tech_diagnosis: d.diagnosis,
    nisza: nicheLabel,
  };
}

function compareLeads(a: SniperLead, b: SniperLead): number {
  return (
    b.hot_score - a.hot_score ||
    (b.google_reviews_count ?? 0) - (a.google_reviews_count ?? 0) ||
    a.nazwa.localeCompare(b.nazwa, "pl") ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Pięciostopniowe sito Snajpera. Czysta, deterministyczna funkcja: ta sama
 * paczka i te same opcje zawsze dają ten sam wynik i tę samą kolejność.
 */
export function runFiveStageSieve(
  rawLeads: SniperRawLead[],
  options: SieveOptions = {},
): SieveResult {
  const gates: SniperGates = { ...DEFAULT_GATES, ...options.gates };
  const minScore = Math.max(
    0,
    Math.min(100, options.minScoreThreshold ?? SNIPER_DEFAULT_MIN_SCORE),
  );
  const limit = Math.max(1, options.limit ?? SNIPER_TOP_LIMIT);
  const now = options.now ?? new Date();
  const nicheLabel = options.nicheLabel ?? null;
  const blocked = new Set(
    [...(options.blacklist ?? [])].map(phoneKey9).filter(Boolean),
  );
  const existing = new Set(
    [...(options.existingPhones ?? [])].map(phoneKey9).filter(Boolean),
  );
  const seen = new Set<string>();
  const competitors = buildCompetitorPool(rawLeads);

  const rejected: SniperLead[] = [];
  const candidates: SniperLead[] = [];
  const rejectedByStage: Record<SieveStage, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let passed1 = 0;
  let passed2 = 0;
  let passed3 = 0;
  let passed4 = 0;

  for (const raw of rawLeads) {
    const d: Draft = {
      raw,
      score: 0,
      reasons: [],
      stage: 1,
      rejection: null,
      phone: null,
      firstName: null,
      vocative: "",
      site: "none",
      broken: false,
      noSsl: false,
      outdated: false,
      promoted: false,
      leader: false,
      newCeidg: false,
      diagnosis: null,
      competitor: null,
    };
    const steps: Array<() => void> = [
      () => stageOne(d, blocked, existing, seen),
      () => stageTwo(d, gates),
      () => stageThree(d, gates, now, options.highTicket === true),
      () => stageFour(d, competitors),
    ];
    let failed = false;
    for (let i = 0; i < steps.length; i++) {
      steps[i]!();
      if (d.rejection) {
        rejectedByStage[d.stage]++;
        rejected.push(finalize(d, false, nicheLabel));
        failed = true;
        break;
      }
      if (i === 0) passed1++;
      if (i === 1) passed2++;
      if (i === 2) passed3++;
      if (i === 3) passed4++;
    }
    if (failed) continue;
    d.stage = 5;
    candidates.push(finalize(d, true, nicheLabel));
  }

  candidates.sort(compareLeads);
  const top: SniperLead[] = [];
  for (const lead of candidates) {
    if (lead.hot_score < minScore) {
      rejectedByStage[5]++;
      rejected.push({
        ...lead,
        sieve_passed: false,
        rejection_reason: `Za niski Hot Score (${lead.hot_score} < ${minScore})`,
      });
    } else if (top.length >= limit) {
      rejectedByStage[5]++;
      rejected.push({
        ...lead,
        sieve_passed: false,
        rejection_reason: `Poza Top ${limit} (Hot Score ${lead.hot_score})`,
      });
    } else {
      top.push(lead);
    }
  }

  const averageScore = top.length
    ? Math.round(top.reduce((s, l) => s + l.hot_score, 0) / top.length)
    : 0;
  return {
    top,
    rejected,
    funnel: {
      totalScanned: rawLeads.length,
      passedStage1: passed1,
      passedStage2: passed2,
      passedStage3: passed3,
      passedStage4: passed4,
      finalTop50: top.length,
      averageScore,
      rejectedByStage,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Zapis do bazy                                                        */
/* ------------------------------------------------------------------ */

const SOURCE_LABEL: Record<SniperRawLead["source"], string> = {
  GOOGLE_MAPS: "Google Maps",
  OLX: "OLX",
  CEIDG: "CEIDG",
};

/** Wiersz do insertLeads/addLeadsBulk — zachowuje dotychczasowe pola i dokłada diagnozę sita. */
export function sniperLeadToRow(
  lead: SniperLead,
  wojewodztwo: string | null,
  scannedAt: string,
): NewLead {
  const audit = lead.tech_audit ?? null;
  return {
    nazwa: lead.nazwa,
    telefon: lead.phone_e164 ?? lead.telefon,
    miasto: lead.miasto,
    adres: lead.adres,
    kategoria: lead.kategoria,
    nisza: lead.nisza,
    wojewodztwo,
    ocena: lead.google_rating ?? null,
    liczba_opinii: lead.google_reviews_count ?? null,
    email: lead.email,
    nip: lead.nip,
    mapy_url: lead.mapy_url ?? lead.olx_url,
    strona: lead.website,
    imie: lead.owner_first_name ?? null,
    zrodlo: `${SOURCE_LABEL[lead.source]} · Snajper`,
    status: "nowy",
    channel_type: "SMS",
    website_issue_type: websiteIssueType(lead.intent_category, audit),
    strona_problem: lead.tech_diagnosis,
    suggested_free_domain: lead.suggested_free_domain,
    hot_score: lead.hot_score,
    sieve_passed: lead.sieve_passed,
    sieve_stage_reached: lead.sieve_stage_reached,
    rejection_reason: lead.rejection_reason ?? null,
    intent_category: lead.intent_category,
    score_reasons: lead.score_reasons,
    owner_first_name: lead.owner_first_name ?? null,
    owner_vocative: lead.owner_vocative ?? null,
    local_competitor: lead.local_competitor ?? null,
    is_promoted_ad: lead.is_promoted_ad ?? false,
    google_rating: lead.google_rating ?? null,
    google_reviews_count: lead.google_reviews_count ?? null,
    tech_audit: audit,
    sniper_scanned_at: scannedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Symulator dla podglądu w przeglądarce                                */
/* ------------------------------------------------------------------ */

/** Mulberry32 — mały, deterministyczny PRNG. */
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

const SIM_FIRST_NAMES = [
  "Marek",
  "Tomasz",
  "Łukasz",
  "Piotr",
  "Krzysztof",
  "Paweł",
  "Michał",
  "Jan",
  "Kamil",
  "Dawid",
  "Grzegorz",
  "Rafał",
  "Adam",
  "Jakub",
  "Anna",
  "Katarzyna",
  "Magdalena",
  "Agnieszka",
  "Monika",
  "Joanna",
];
const SIM_SURNAMES = [
  "Nowak",
  "Kowalski",
  "Wiśniewski",
  "Wójcik",
  "Kamiński",
  "Lewandowski",
  "Zieliński",
  "Szymański",
  "Woźniak",
  "Dąbrowski",
  "Kozłowski",
  "Jankowski",
  "Mazur",
  "Krawczyk",
  "Piotrowski",
  "Grabowski",
  "Pawlak",
  "Michalski",
  "Król",
  "Wieczorek",
];
/** Krótkie rzeczowniki branżowe do realistycznych nazw firm w symulatorze. */
const SIM_TRADES: Record<string, string> = {
  "meble-kuchnie": "Stolarstwo",
  "klima-pompy": "Klimatyzacja",
  mikrocement: "Posadzki",
  "foto-slub": "Fotografia",
  "fotobudka-360": "Fotobudka",
  "wrapping-ppf": "Detailing",
  minikoparka: "Minikoparki",
  glamping: "Domki",
};
const SIM_CORPORATE = [
  "Polska Sp. z o.o.",
  "Group S.A.",
  "Market",
  "Sieć Salonów",
  "Holding",
];
const SIM_BUILDERS = [
  "wixsite.com",
  "oferteo.pl",
  "blogspot.com",
  "webnode.page",
];

function femaleSurname(surname: string): string {
  if (surname.endsWith("ski")) return `${surname.slice(0, -3)}ska`;
  if (surname.endsWith("cki")) return `${surname.slice(0, -3)}cka`;
  return surname;
}

function simDomain(nazwa: string, city: string): string {
  const [first] = suggestDomains(nazwa, city);
  return `${first ?? "firma-lokalna"}.pl`;
}

function simMobile(rand: () => number): string {
  const prefixes = [
    "50",
    "51",
    "53",
    "57",
    "60",
    "66",
    "69",
    "72",
    "73",
    "78",
    "79",
    "88",
  ];
  const p = prefixes[Math.floor(rand() * prefixes.length)]!;
  let rest = "";
  for (let i = 0; i < 7; i++) rest += Math.floor(rand() * 10);
  return `+48${p}${rest}`;
}

function simLandline(rand: () => number): string {
  const areas = ["22", "12", "41", "61", "71", "58", "42", "32"];
  let rest = "";
  for (let i = 0; i < 7; i++) rest += Math.floor(rand() * 10);
  return `+48${areas[Math.floor(rand() * areas.length)]}${rest}`;
}

function simAudit(
  rand: () => number,
  kind: "modern" | "broken" | "nossl" | "outdated" | "slow",
): TechAuditResult {
  const pixels = rand() < 0.3;
  switch (kind) {
    case "broken":
      return {
        httpStatus:
          rand() < 0.5 ? null : [404, 500, 502, 503][Math.floor(rand() * 4)]!,
        hasSsl: false,
        hasMobileViewport: false,
        detectedCmsOrBuilder: "Brak",
        hasAdPixels: pixels,
        copyrightYear: null,
        responseTimeMs: null,
        whoisFreeDomain: null,
      };
    case "nossl":
      return {
        httpStatus: 200,
        hasSsl: false,
        hasMobileViewport: rand() < 0.5,
        detectedCmsOrBuilder: rand() < 0.5 ? "WordPress Old" : "Joomla",
        hasAdPixels: pixels,
        copyrightYear: 2012 + Math.floor(rand() * 10),
        responseTimeMs: 900 + Math.floor(rand() * 2600),
        whoisFreeDomain: null,
      };
    case "outdated":
      return {
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: rand() < 0.4,
        detectedCmsOrBuilder: "WordPress Old",
        hasAdPixels: pixels,
        copyrightYear: 2011 + Math.floor(rand() * 8),
        responseTimeMs: 1200 + Math.floor(rand() * 2400),
        whoisFreeDomain: null,
      };
    case "slow":
      return {
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: true,
        detectedCmsOrBuilder: "WordPress",
        hasAdPixels: pixels,
        copyrightYear: 2021 + Math.floor(rand() * 5),
        responseTimeMs: 2600 + Math.floor(rand() * 3000),
        whoisFreeDomain: null,
      };
    case "modern":
    default:
      return {
        httpStatus: 200,
        hasSsl: true,
        hasMobileViewport: true,
        detectedCmsOrBuilder: rand() < 0.5 ? "WordPress" : "Własny kod",
        hasAdPixels: pixels,
        copyrightYear: 2023 + Math.floor(rand() * 4),
        responseTimeMs: 400 + Math.floor(rand() * 1800),
        whoisFreeDomain: null,
      };
  }
}

/**
 * Generuje ok. 450 realistycznych surowych rekordów dla niszy i miasta.
 * Deterministyczny: ta sama nisza + miasto + dzień → te same firmy.
 */
export function generateSimulatedRawLeads(
  params: SniperScanParams,
  now: Date = new Date(),
  count = 450,
): SniperRawLead[] {
  const niche = findNiche(params.nicheId);
  const trade =
    SIM_TRADES[params.nicheId] ??
    (niche?.label ?? params.keyword ?? "Usługi").split(/[&,/ ]/)[0]!.trim();
  const city = params.city || "Kielce";
  const rand = prng(
    hashSeed(`${params.nicheId}|${city}|${now.toISOString().slice(0, 10)}`),
  );
  const out: SniperRawLead[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    const source: SniperRawLead["source"] =
      r < 0.62 ? "GOOGLE_MAPS" : r < 0.88 ? "OLX" : "CEIDG";
    const female = rand() < 0.3;
    const first =
      SIM_FIRST_NAMES[
        female ? 14 + Math.floor(rand() * 6) : Math.floor(rand() * 14)
      ]!;
    const surnameBase = SIM_SURNAMES[Math.floor(rand() * SIM_SURNAMES.length)]!;
    const surname = female ? femaleSurname(surnameBase) : surnameBase;
    const corporate = rand() < 0.08;
    const nameStyle = rand();
    const nazwa = corporate
      ? `${trade} ${SIM_CORPORATE[Math.floor(rand() * SIM_CORPORATE.length)]}`
      : nameStyle < 0.35
        ? `${trade} ${first} ${surname}`
        : nameStyle < 0.7
          ? `${trade} ${surname}`
          : `${surname} ${trade.toLowerCase()} ${city}`;
    const landline = rand() < 0.22;
    const telefon = landline ? simLandline(rand) : simMobile(rand);
    const siteRoll = rand();
    let website: string | null = null;
    let audit: TechAuditResult | null = null;
    const domain = simDomain(nazwa, city);
    if (source === "CEIDG") {
      website = null;
    } else if (source === "OLX") {
      website =
        siteRoll < 0.2
          ? `https://www.facebook.com/${domain.replace(/\.pl$/, "")}`
          : null;
    } else if (siteRoll < 0.3) {
      website = `https://www.${domain}`;
      audit = simAudit(rand, "modern");
    } else if (siteRoll < 0.38) {
      website = `https://${domain}`;
      audit = simAudit(rand, "broken");
    } else if (siteRoll < 0.46) {
      website = `http://${domain}`;
      audit = simAudit(rand, "nossl");
    } else if (siteRoll < 0.53) {
      website = `https://${domain}`;
      audit = simAudit(rand, "outdated");
    } else if (siteRoll < 0.57) {
      website = `https://${domain}`;
      audit = simAudit(rand, "slow");
    } else if (siteRoll < 0.66) {
      website = `https://www.facebook.com/${domain.replace(/\.pl$/, "")}`;
    } else if (siteRoll < 0.7) {
      const builder = SIM_BUILDERS[Math.floor(rand() * SIM_BUILDERS.length)]!;
      website = `https://${domain.replace(/\.pl$/, "")}.${builder}`;
    }
    const reviewsRoll = rand();
    const reviews =
      source === "CEIDG"
        ? 0
        : reviewsRoll < 0.25
          ? Math.floor(rand() * 3)
          : reviewsRoll < 0.85
            ? 3 + Math.floor(rand() * 95)
            : 100 + Math.floor(rand() * 220);
    const rating =
      reviews === 0 ? null : Math.round((3.6 + rand() * 1.4) * 10) / 10;
    const startDaysAgo = source === "CEIDG" ? Math.floor(rand() * 30) : null;
    const startDate =
      startDaysAgo === null
        ? null
        : new Date(now.getTime() - startDaysAgo * 86_400_000)
            .toISOString()
            .slice(0, 10);
    const freeDomain =
      website && audit && audit.httpStatus !== null && audit.httpStatus < 400
        ? null
        : rand() < 0.55
          ? domain
          : null;
    const emailRoll = rand();
    const email =
      emailRoll < 0.45
        ? `${surnameBase.toLowerCase().replace(/[^a-z]/g, "")}${Math.floor(rand() * 90 + 10)}@${["gmail.com", "wp.pl", "onet.pl", "interia.pl", "o2.pl"][Math.floor(rand() * 5)]}`
        : emailRoll < 0.6 && website
          ? `kontakt@${domain}`
          : null;
    out.push({
      id: `sim-${params.nicheId}-${i}`,
      source,
      nazwa,
      telefon,
      miasto: rand() < 0.88 ? city : `${city} okolice`,
      adres: `ul. ${["Długa", "Polna", "Leśna", "Sienkiewicza", "Kościuszki", "Ogrodowa"][Math.floor(rand() * 6)]} ${1 + Math.floor(rand() * 120)}, ${city}`,
      kategoria: niche?.label ?? params.keyword,
      website,
      email,
      owner_name:
        source === "GOOGLE_MAPS"
          ? null
          : rand() < 0.75
            ? source === "OLX"
              ? first
              : `${first} ${surname}`
            : null,
      rating: source === "GOOGLE_MAPS" ? rating : null,
      reviews:
        source === "GOOGLE_MAPS"
          ? reviews
          : source === "OLX"
            ? Math.floor(rand() * 6)
            : 0,
      is_promoted_ad: source === "OLX" && rand() < 0.28,
      social_only: source === "OLX" && website !== null,
      ceidg_start_date: startDate,
      nip:
        source === "CEIDG"
          ? String(6_000_000_000 + Math.floor(rand() * 999_999_999))
          : null,
      mapy_url:
        source === "GOOGLE_MAPS"
          ? `https://www.google.com/maps/search/${encodeURIComponent(nazwa)}`
          : null,
      olx_url:
        source === "OLX"
          ? `https://www.olx.pl/d/oferta/${domain.replace(/\.pl$/, "")}-ID${i}.html`
          : null,
      tech_audit: audit ? { ...audit, whoisFreeDomain: freeDomain } : null,
      whois_free_domain: freeDomain,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Wejście dla UI: prawdziwy skan na Macu albo symulacja                */
/* ------------------------------------------------------------------ */

type SniperBridge = {
  runDeepScan: (
    params: SniperScanParams,
    onProgress?: (p: SniperScanProgress) => void,
  ) => Promise<SniperDeepScanResult>;
};

export function sniperBridge(): SniperBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    leadfinder?: { sniper?: SniperBridge };
    electron?: { sniper?: SniperBridge };
  };
  return w.leadfinder?.sniper ?? w.electron?.sniper ?? null;
}

export function isHighTicketNiche(nicheId: string): boolean {
  return rules.highTicketNicheIds.includes(nicheId);
}

export type SniperRunOptions = Omit<
  SieveOptions,
  "highTicket" | "nicheLabel"
> & {
  onProgress?: (p: SniperScanProgress) => void;
};

export type SniperRunResult = SieveResult & {
  simulated: boolean;
  notes: string[];
  scannedAt: string;
};

/**
 * Skan Snajpera: na Macu prawdziwe zapytania (Mapy/OLX/CEIDG + audyt HTTP/DOM/DNS)
 * przez most Electrona, w przeglądarce realistyczny symulator. Wynik zawsze
 * przechodzi przez tę samą funkcję runFiveStageSieve().
 */
export async function runSniperScan(
  params: SniperScanParams,
  options: SniperRunOptions = {},
): Promise<SniperRunResult> {
  const now = options.now ?? new Date();
  const niche = findNiche(params.nicheId);
  const bridge = sniperBridge();
  let raw: SniperRawLead[];
  let notes: string[] = [];
  let simulated = false;
  if (bridge?.runDeepScan) {
    const res = await bridge.runDeepScan(params, options.onProgress);
    if (!res?.ok)
      throw new Error(res?.error ?? "Skan Snajpera nie powiódł się.");
    raw = res.raw ?? [];
    notes = res.notes ?? [];
  } else {
    simulated = true;
    const total = 450;
    for (const [phase, label] of [
      ["collect", "Pobieram firmy z Map Google, OLX i CEIDG (symulacja)"],
      ["audit", "Audyt stron: HTTP, SSL, viewport, piksele (symulacja)"],
      ["domains", "Sprawdzam wolne domeny .pl (symulacja)"],
    ] as const) {
      options.onProgress?.({ phase, label, index: 0, total });
      await new Promise((r) => setTimeout(r, 350));
    }
    raw = generateSimulatedRawLeads(params, now, total);
    notes = [
      "Podgląd w przeglądarce: dane są symulowane, żadne zapytanie ani SMS nie wychodzi.",
    ];
  }
  options.onProgress?.({
    phase: "done",
    label: "Sito gotowe",
    index: raw.length,
    total: raw.length,
  });
  const result = runFiveStageSieve(raw, {
    ...options,
    now,
    highTicket: isHighTicketNiche(params.nicheId),
    nicheLabel: niche?.label ?? params.keyword,
  });
  return { ...result, simulated, notes, scannedAt: now.toISOString() };
}

/* ------------------------------------------------------------------ */
/* SMS dla leada                                                        */
/* ------------------------------------------------------------------ */

/** Hiper-precyzyjny SMS dla leada ze sita; ziarnem Spintax jest id leada. */
export function sniperMessageFor(
  lead: SniperLead,
  options: { optOut?: boolean; vocativeOverride?: string | null } = {},
): { body: string; signature: string; templateId: string } {
  const vocative =
    options.vocativeOverride !== undefined
      ? options.vocativeOverride
      : lead.owner_vocative;
  const city = (lead.miasto ?? "").replace(/\s+okolice$/i, "").trim();
  const nameHasCity =
    Boolean(city) &&
    lead.nazwa.toLocaleLowerCase("pl").includes(city.toLocaleLowerCase("pl"));
  const gender = vocative
    ? /^Pani\b/.test(vocative)
      ? "kobieta"
      : /^Panie\b/.test(vocative)
        ? "mezczyzna"
        : vocativeGender(lead.owner_first_name)
    : null;
  return buildSniperMessage({
    intent: lead.intent_category,
    gender,
    optOut: options.optOut,
    seed: lead.id,
    vars: {
      nazwa: lead.nazwa,
      miasto: nameHasCity ? "" : city,
      branza: (lead.nisza ?? lead.kategoria ?? "usługi")
        .toLocaleLowerCase("pl")
        .replace(/\s*&\s*/g, " i "),
      zwrot: vocative ? `, ${vocative}` : "",
      wolna_domena: lead.suggested_free_domain,
      ocena: lead.google_rating
        ? lead.google_rating.toFixed(1).replace(".", ",")
        : "",
      liczba_opinii: lead.google_reviews_count ?? "",
      konkurent: lead.local_competitor ?? null,
      diagnoza_tech: lead.tech_diagnosis,
    },
  });
}
