import { supabase } from "@/integrations/supabase/client";

export type LeadRow = {
  channel_type?: "SMS" | "EMAIL" | "BOTH";
  email_source_portal?: "PANORAMA_PKT" | "CEIDG_EMAIL" | "FACEBOOK_OSINT" | "GOOGLE_MAPS";
  email_domain_type?: "FREE_MAILBOX" | "CUSTOM_DOMAIN";
  email_sent_at?: string | null;
  email_subject_used?: string | null;
  email_combination_signature?: string | null;
  id: string;
  nazwa: string;
  ocena: number | null;
  liczba_opinii: number | null;
  adres: string | null;
  telefon: string | null;
  zrodlo: string;
  status: string;
  notatki: string | null;
  oferta: string | null;
  created_at: string;
  miasto?: string | null;
  kategoria?: string | null;
  nisza?: string | null;
  wojewodztwo?: string | null;
  godziny?: string | null;
  mapy_url?: string | null;
  opis?: string | null;
  email?: string | null;
  nip?: string | null;
  regon?: string | null;
  wlasciciel?: string | null;
  imie?: string | null;
  plec?: string | null;
  social?: string | null;
  strona?: string | null;
  /** Problem ze stroną wykryty przez audytor, np. „🚨 Strona wygasła / Błąd serwera". */
  strona_problem?: string | null;
  /** Typ problemu ze stroną — wybiera szablon SMS. Domyślnie NO_WEBSITE. */
  website_issue_type?: "NO_WEBSITE" | "EXPIRED_OR_ERROR" | "NO_SSL" | "NO_MOBILE" | "OLX_NO_WEBSITE" | null;
  dane_wzbogacone_at?: string | null;
  sms_sent_at?: string | null;
  replied_at?: string | null;
  status_changed_at?: string | null;
  telefon_status?: string | null;
  /** Atrybucja SMS: który szablon i która kombinacja Spintax poszła do klienta. */
  sms_template_id?: string | null;
  sms_combination_signature?: string | null;
  sms_exact_text?: string | null;
  /** Pierwsza odpowiedź klienta (z chat.db lub ręczne oznaczenie). */
  engaged_at?: string | null;
  /** Data zamknięcia sprzedaży (status „sukces”). */
  closed_at?: string | null;
  /** Kwota zamkniętego zlecenia w PLN. */
  deal_value?: number | null;
  /** Wolna domena .pl znaleziona przez asystenta domen (whois-json + DNS). */
  suggested_free_domain?: string | null;
  /** Adres e-mail przeszedł weryfikację składni i rekordów MX. */
  email_verified?: boolean;
} & Partial<SniperQualification> & {
  /** Moment kwalifikacji przez Snajpera Top 50 (ISO). */
  sniper_scanned_at?: string | null;
  /** Usługa, którą oferujemy temu leadowi (brak = strona www, jak dotychczas). */
  offer_type?: OfferId | null;
};

/** Rynek (kraj) — decyduje o kanale kontaktu, języku i regułach wysyłki. */
export type MarketId = "PL" | "US";

/** Usługa, pod którą szukamy klientów i piszemy SMS-y. */
export type OfferId = "website" | "video_ads";

/** Kategoria intencji zakupowej wyznaczona przez 5-stopniowe sito Snajpera. */
export type IntentCategory =
  | "EXPIRED_OR_BROKEN_SITE"
  | "PAID_AD_NO_SITE"
  | "SOCIAL_OR_FREE_BUILDER"
  | "HIGH_REVIEWS_NO_SITE"
  | "OUTDATED_NO_SSL_MOBILE"
  | "NEW_CEIDG_HIGH_TICKET"
  | "NO_WEBSITE"
  | "VIDEO_ACTIVE_ADVERTISER"
  | "VIDEO_PAID_PROMO"
  | "VIDEO_REVIEW_LEADER"
  | "VIDEO_SOCIAL_ACTIVE"
  | "VIDEO_VISUAL_NICHE";

/** Wynik audytu technicznego strony (DOM/TLS/WHOIS) z procesu głównego Electrona. */
export interface TechAuditResult {
  httpStatus: number | null;
  hasSsl: boolean;
  hasMobileViewport: boolean;
  /** np. "Wix Free", "Oferteo Subdomain", "Only Facebook/IG", "WordPress Old", "Brak". */
  detectedCmsOrBuilder: string | null;
  /** Meta Pixel (fbq / fbevents.js) lub Google Ads (gtag AW-) w kodzie strony. */
  hasAdPixels: boolean;
  /** Rok z noty copyright w stopce, np. 2015. */
  copyrightYear: number | null;
  responseTimeMs: number | null;
  /** Wolna domena .pl potwierdzona przez DNS/WHOIS. */
  whoisFreeDomain: string | null;
}

export type SieveStage = 1 | 2 | 3 | 4 | 5;

export interface SniperQualification {
  hot_score: number;
  sieve_passed: boolean;
  sieve_stage_reached: SieveStage;
  rejection_reason?: string | null;
  intent_category: IntentCategory;
  score_reasons: string[];
  owner_first_name?: string | null;
  owner_vocative?: string | null;
  local_competitor?: string | null;
  is_promoted_ad?: boolean;
  google_rating?: number | null;
  google_reviews_count?: number | null;
  tech_audit?: TechAuditResult | null;
}

/** Surowy rekord z Map Google / OLX / CEIDG po audycie w Electronie — wejście sita. */
export type SniperRawLead = {
  id: string;
  source: "GOOGLE_MAPS" | "OLX" | "CEIDG";
  nazwa: string;
  telefon: string | null;
  miasto: string | null;
  adres: string | null;
  kategoria: string | null;
  website: string | null;
  email: string | null;
  /** Imię lub pełne „Imię Nazwisko” osoby kontaktowej z ogłoszenia/rejestru. */
  owner_name: string | null;
  rating: number | null;
  reviews: number | null;
  is_promoted_ad: boolean;
  /** Ogłoszenie OLX z linkami tylko do social mediów. */
  social_only: boolean;
  /** Data rozpoczęcia działalności z CEIDG (YYYY-MM-DD). */
  ceidg_start_date: string | null;
  nip: string | null;
  mapy_url: string | null;
  olx_url: string | null;
  tech_audit: TechAuditResult | null;
  whois_free_domain: string | null;
};

export type SniperScanParams = {
  nicheId: string;
  keyword: string;
  pkd: string;
  city: string;
  voivodeship: string;
  sources: { maps: boolean; olx: boolean; ceidg: boolean };
  /** Oferta wpływa na to, które firmy warto badać (np. wideo: także firmy ze sprawną stroną). */
  offer?: OfferId;
  /** Rynek: poza Polską skan używa tylko Map Google i szuka adresu e-mail na stronie firmy. */
  market?: MarketId;
};

export type SniperScanProgress = {
  phase: "collect" | "audit" | "domains" | "done";
  label: string;
  index: number;
  total: number;
};

export type SniperDeepScanResult = {
  ok: boolean;
  raw?: SniperRawLead[];
  notes?: string[];
  error?: string;
};

export type NewLead = Record<string, unknown>;

export type CeidgLead = {
  id: string;
  nazwa: string;
  wlasciciel: string | null;
  imie: string | null;
  adres: string;
  miasto: string;
  telefon: string;
  email: string | null;
  nip: string | null;
  regon: string | null;
  kategoria: string | null;
  dataRozpoczecia: string | null;
  zrodlo: "CEIDG";
  zrodlo_telefonu?: "CEIDG" | "OSINT Harvester" | null;
};

export type CeidgProgress = { index: number; total: number; name: string; harvested: number; phase: "searching" | "found" | "miss" };

export type OlxLead = {
  id: string;
  nazwa: string;
  telefon: string;
  miasto: string;
  adres: string;
  kategoria: string | null;
  olxUrl: string;
  zrodlo: "OLX";
  /** Skąd pozyskano numer: wprost z opisu albo auto-clickerem przycisku „Pokaż numer”. */
  zrodlo_telefonu: "OLX opis" | "OLX auto-click" | null;
  /** W opisie były tylko linki do social mediów (FB/IG) — brak własnej strony. */
  socialOnly: boolean;
};

export type OlxProgress = {
  phase: "list" | "description" | "click" | "done";
  index: number;
  total: number;
  name: string;
  harvested: number;
};

type DesktopBridge = {
  leads: {
    list: () => Promise<LeadRow[]>;
    insert: (rows: NewLead[]) => Promise<void>;
    update: (id: string, patch: NewLead) => Promise<void>;
    remove: (id: string) => Promise<void>;
    replaceAll?: (rows: LeadRow[]) => Promise<void>;
    deleteAll?: () => Promise<{ ok: boolean; removed: number; error?: string }>;
  };
  verifyPhone?: (phone: string) => Promise<{
    ok: boolean;
    domains: number;
    directories: number;
    verdict: "direct" | "shared" | "unknown";
  }>;
  website?: {
    check: (lead: { nazwa: string; miasto?: string | null; telefon?: string | null }) => Promise<{
      ok: boolean;
      hasSite: boolean;
      url: string | null;
    }>;
    verifyDDG: (
      nazwa: string,
      miasto: string,
    ) => Promise<{ ok: boolean; hasSite: boolean; url: string | null; error?: string }>;
    purge: (
      ids: string[],
      onProgress?: (data: { index: number; total: number }) => void,
    ) => Promise<{
      ok: boolean;
      checked: number;
      removed: number;
      hits: Array<{ id: string; nazwa: string; url: string }>;
    }>;
  };
  messages?: {
    historyStatus: () => Promise<{ available: boolean; error?: string }>;
    syncReplies?: () => Promise<{ ok: boolean; checked: number; updated: number; error?: string }>;
  };
  prefs?: {
    get: () => Promise<Record<string, string>>;
    set: (values: Record<string, string>) => Promise<void>;
  };
  settings: {
    get: () => Promise<{ googleApiKey: string; ceidgApiKey?: string }>;
    set: (value: { googleApiKey?: string; ceidgApiKey?: string }) => Promise<void>;
  };
  blacklist?: {
    add: (phone: string) => Promise<{ ok: boolean; phone?: string; error?: string }>;
    getAll: () => Promise<string[]>;
  };
  ceidg?: {
    search: (
      params: { dateFrom: string; pkd: string; voivodeship: string; enableDeepHarvest?: boolean },
      onProgress?: (p: CeidgProgress) => void,
    ) => Promise<{
      ok: boolean;
      status?: number;
      total?: number;
      error?: string;
      leads?: CeidgLead[];
      rejectedPhones?: number;
      harvested?: number;
    }>;
  };
  gmaps?: {
    search: (
      keyword: string,
      city: string,
      options?: { auditSites?: boolean },
    ) => Promise<{
      ok: boolean;
      status?: number;
      total?: number;
      leads?: Array<{
        id: string;
        name: string;
        phone: string;
        address: string;
        city: string;
        rating: number;
        reviews: number;
        category: string | null;
        mapsUrl: string;
        website?: string | null;
        issueTag?: string | null;
      }>;
      audited?: number;
      error?: string;
      fromCache?: boolean;
      rejectedPhones?: number;
    }>;
  };
  olx?: {
    search: (
      params: { query: string; city?: string; voivodeship?: string; maxResults?: number; checkDuckDuckGo?: boolean },
      onProgress?: (p: OlxProgress) => void,
    ) => Promise<{
      ok: boolean;
      total?: number;
      leads?: OlxLead[];
      rejectedPhones?: number;
      clicked?: number;
      skippedSite?: number;
      error?: string;
    }>;
  };
  cache?: {
    stats: () => Promise<{ available: boolean; entries: number; hits: number }>;
    clear: () => Promise<{ ok: boolean; error?: string }>;
  };
  enrich?: (url: string) => Promise<{ ok: boolean; html?: string }>;
  bulkSend?: unknown;
  store?: {
    status: () => Promise<StoreStatus>;
    backup: () => Promise<StoreStatus & { file: string }>;
    openBackups: () => Promise<string>;
    events: (kind?: "sms" | "email", id?: string) => Promise<StoreEvent[]>;
  };
  sniper?: {
    runDeepScan: (
      params: SniperScanParams,
      onProgress?: (p: SniperScanProgress) => void,
    ) => Promise<SniperDeepScanResult>;
  };
};

export function desktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { leadfinder?: Partial<DesktopBridge> }).leadfinder;
  return bridge && bridge.leads ? (bridge as DesktopBridge) : null;
}

export const isDesktop = () => desktop() !== null;

export async function listLeads(): Promise<LeadRow[]> {
  const bridge = desktop();
  if (bridge) return (await bridge.leads.list()).filter(l => l.channel_type !== "EMAIL");
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as LeadRow[]).filter(l => l.channel_type !== "EMAIL");
}

export async function insertLeads(rows: NewLead[]): Promise<void> {
  const bridge = desktop();
  if (bridge) return bridge.leads.insert(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from("leads").insert(rows as any);
  if (error) throw new Error(error.message);
}

export async function updateLead(id: string, patch: NewLead): Promise<void> {
  const bridge = desktop();
  if (bridge) return bridge.leads.update(id, patch);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from("leads").update(patch as any).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteLead(id: string): Promise<void> {
  const bridge = desktop();
  if (bridge) return bridge.leads.remove(id);
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Usuwa wszystkie leady z bazy. */
export async function deleteAllLeads(): Promise<number> {
  const bridge = desktop();
  if (bridge?.leads.deleteAll) {
    const res = await bridge.leads.deleteAll();
    if (!res.ok) throw new Error(res.error ?? "Nie udało się wyczyścić bazy");
    return res.removed;
  }
  const rows = await listLeads();
  if (bridge) {
    for (const row of rows) await bridge.leads.remove(row.id);
    return rows.length;
  }
  const { error } = await supabase.from("leads").delete().neq("id", "");
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Sprawdza w internecie, czy numer nie krąży po katalogach firmowych. */
export async function verifyPhone(phone: string) {
  const bridge = desktop();
  if (!bridge?.verifyPhone) return null;
  try {
    return await bridge.verifyPhone(phone);
  } catch {
    return null;
  }
}

/** Sprawdza w wynikach wyszukiwania, czy firma ma własną stronę z tym numerem. */
export async function checkWebsite(lead: {
  nazwa: string;
  miasto?: string | null;
  telefon?: string | null;
}) {
  const bridge = desktop();
  if (!bridge?.website) return null;
  try {
    return await bridge.website.check(lead);
  } catch {
    return null;
  }
}

/** Sprawdza listę firm i usuwa z bazy te, które mają już stronę internetową. */
export async function purgeLeadsWithWebsite(
  ids: string[],
  onProgress?: (data: { index: number; total: number }) => void,
) {
  const bridge = desktop();
  if (!bridge?.website) {
    throw new Error("Weryfikacja stron działa tylko w aplikacji na Maca.");
  }
  return bridge.website.purge(ids, onProgress);
}

/** Czy aplikacja ma dostęp do historii rozmów w aplikacji Wiadomości. */
export async function messagesHistoryStatus(): Promise<{
  available: boolean;
  error?: string;
} | null> {
  const bridge = desktop();
  if (!bridge?.messages) return null;
  try {
    return await bridge.messages.historyStatus();
  } catch {
    return { available: false };
  }
}

/** Oznacza jako „odpisał” leady, od których przyszła odpowiedź w Wiadomościach. */
export async function syncReplies() {
  const bridge = desktop();
  if (!bridge?.messages?.syncReplies) {
    throw new Error("Synchronizacja odpowiedzi działa tylko w aplikacji na Maca.");
  }
  const res = await bridge.messages.syncReplies();
  if (!res.ok) throw new Error(res.error ?? "Nie udało się odczytać historii Wiadomości");
  return res;
}

/** Kopia zapasowa całej bazy do pliku JSON. */
export async function exportBackup(): Promise<void> {
  const rows = await listLeads();
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leadfinder-kopia-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Dogrywa leady z kopii lub pliku CSV, pomijając duplikaty. */
export async function importLeads(rows: NewLead[]): Promise<number> {
  if (rows.length === 0) return 0;
  const existing = await listLeads();
  const seen = new Set(
    existing.flatMap((l) => [
      l.nazwa.toLowerCase().trim(),
      l.telefon ? l.telefon.replace(/\D/g, "").slice(-9) : "",
    ]),
  );
  const fresh = rows.filter((row) => {
    const nazwa = String(row["nazwa"] ?? "").toLowerCase().trim();
    const tel = String(row["telefon"] ?? "").replace(/\D/g, "").slice(-9);
    if (!nazwa) return false;
    if (seen.has(nazwa) || (tel && seen.has(tel))) return false;
    seen.add(nazwa);
    if (tel) seen.add(tel);
    return true;
  });
  if (fresh.length > 0) await insertLeads(fresh);
  return fresh.length;
}

/** Ostatnie 9 cyfr numeru (bez spacji, +48, 0048 itp.) — klucz czarnej listy. */
export function blacklistKey(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
}

export async function blacklistPhone(phone: string): Promise<void> {
  const bridge = desktop();
  if (!bridge?.blacklist) throw new Error("Czarna lista działa tylko w aplikacji na Maca.");
  const res = await bridge.blacklist.add(phone);
  if (!res.ok) throw new Error(res.error ?? "Nie udało się zablokować numeru");
}

/**
 * Masowy zapis wyników wyszukiwania. Pomija numery (ostatnie 9 cyfr), które są
 * już w bazie lub na czarnej liście, oraz duplikaty w samej paczce.
 */
export async function addLeadsBulk(
  rows: NewLead[],
): Promise<{ addedCount: number; skippedCount: number; addedPhones: string[] }> {
  if (rows.length === 0) return { addedCount: 0, skippedCount: 0, addedPhones: [] };
  const bridge = desktop();
  const existing = await listLeads();
  let blocked: string[] = [];
  try {
    blocked = (await bridge?.blacklist?.getAll?.()) ?? [];
  } catch {
    blocked = [];
  }
  const seen = new Set<string>([
    ...existing.map((l) => blacklistKey(l.telefon)).filter(Boolean),
    ...blocked.map((p) => blacklistKey(p) || p).filter(Boolean),
  ]);
  const fresh: NewLead[] = [];
  const addedPhones: string[] = [];
  for (const row of rows) {
    const key = blacklistKey(row["telefon"] as string | null);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(row);
    addedPhones.push(key);
  }
  if (fresh.length > 0) await insertLeads(fresh);
  return { addedCount: fresh.length, skippedCount: rows.length - fresh.length, addedPhones };
}

/** Stan bazy danych na Macu (electron/store.cjs). */
export type StoreStatus = {
  engine: "sqlite" | "json" | "broken";
  error: string | null;
  file?: string;
  migratedAt?: string | null;
  lastBackupAt?: string | null;
  backups?: number;
  leads?: { sms: number; email: number };
  events?: number;
  suppression?: number;
};

/** Wpis dziennika zdarzeń leada. */
export type StoreEvent = {
  kind?: "sms" | "email";
  lead_id?: string;
  type: string;
  from_value: string | null;
  to_value: string | null;
  data: string | null;
  at: number;
};
