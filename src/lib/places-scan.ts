import { blacklistKey, desktop } from "./leads-store";
import { getVoivodeship } from "./voivodeships";

/**
 * Skanowanie Google Maps uruchamiane lokalnie w aplikacji na Maca — bez kluczy API.
 * Proces główny Electrona otwiera niewidoczne okno z publicznymi Mapami Google,
 * scrolluje listę wyników i od razu odrzuca firmy ze stroną www lub bez telefonu.
 * Wyniki są buforowane na dysku (30 dni).
 */

export type PlaceReview = {
  author: string;
  rating: number;
  text: string;
};

export type PlaceLead = {
  id: string;
  name: string;
  rating: number;
  userRatingCount: number;
  address: string;
  phone: string | null;
  website: string | null;
  city: string;
  category: string | null;
  hours: string[];
  mapsUri: string | null;
  summary: string | null;
  priceLevel: string | null;
  businessStatus: string | null;
  reviews: PlaceReview[];
  /** Pola tylko dla wyników z CEIDG. */
  source?: "Google Maps" | "CEIDG" | "OLX";
  nip?: string | null;
  regon?: string | null;
  email?: string | null;
  owner?: string | null;
  firstName?: string | null;
  startDate?: string | null;
  /** Wynik audytora stron: null = brak strony. */
  websiteIssue?: string | null;
  phoneSource?: "CEIDG" | "OSINT Harvester" | "OLX opis" | "OLX auto-click" | null;
  /** Jawny typ problemu (np. OLX_NO_WEBSITE) — nadpisuje wyliczanie z websiteIssue. */
  issueType?: import("./issue-templates").WebsiteIssueType | null;
  /** Link do oryginalnego ogłoszenia OLX. */
  olxUrl?: string | null;
  /** W opisie ogłoszenia były tylko linki do social mediów. */
  socialOnly?: boolean;
};

export type ScanParams = {
  /** Fraza wyszukiwania, np. „stolarz”. */
  keyword: string;
  voivodeship: string;
  maxCities: number;
  /** Łowca zepsutych stron: uwzględnij firmy z wygasłą / niezabezpieczoną / starą stroną. */
  auditSites?: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Losowa przerwa 4–8 s między miastami — ochrona przed blokadą przez Google. */
const cityDelay = () => 4000 + Math.floor(Math.random() * 4000);

export type ScanStage = "maps" | "retry" | "done";

export interface ScanProgress {
  stage: ScanStage;
  /** Krok w bieżącym etapie (1-based) i liczba kroków etapu. */
  step: number;
  stepTotal: number;
  /** Postęp całości 0–1. */
  overall: number;
  current: string;
  detail: string;
  found: number;
  rejected: number;
  kept: number;
  cachedHits: number;
  /** Numery stacjonarne / błędne odrzucone przez walidację komórkową. */
  rejectedPhones: number;
  log: { at: number; text: string; tone: "info" | "ok" | "warn" }[];
}

export async function scanLocally(
  params: ScanParams,
  onProgress?: (p: ScanProgress) => void,
) {
  const log: ScanProgress["log"] = [];
  const state: ScanProgress = {
    stage: "maps", step: 0, stepTotal: 0, overall: 0, current: "", detail: "",
    found: 0, rejected: 0, kept: 0, cachedHits: 0, rejectedPhones: 0, log,
  };
  const emit = (patch: Partial<ScanProgress>, line?: { text: string; tone?: "info" | "ok" | "warn" }) => {
    Object.assign(state, patch);
    if (line) {
      log.unshift({ at: Date.now(), text: line.text, tone: line.tone ?? "info" });
      if (log.length > 40) log.pop();
    }
    onProgress?.({ ...state, log: [...log] });
  };
  const bridge = desktop();
  if (!bridge?.gmaps) throw new Error("Skanowanie działa tylko w aplikacji na Maca.");

  const region = getVoivodeship(params.voivodeship);
  if (!region) throw new Error("Nieznane województwo.");

  let blacklisted = new Set<string>();
  try {
    blacklisted = new Set((await bridge.blacklist?.getAll()) ?? []);
  } catch {
    /* brak czarnej listy nie blokuje skanu */
  }
  let blocked = 0;

  const cities = region.cities.slice(0, params.maxCities);
  const found = new Map<string, PlaceLead>();
  let requests = 0;
  let cachedRequests = 0;
  let totalSeen = 0;
  let totalRejectedPhones = 0;
  let done = 0;

  for (const city of cities) {
    emit({
      stage: "maps", step: done + 1, stepTotal: cities.length, current: city,
      detail: `Przeglądam Mapy Google: „${params.keyword}”`,
      overall: done / cities.length,
    }, { text: `Szukam w mieście ${city}…` });
    let res: Awaited<ReturnType<NonNullable<typeof bridge.gmaps>["search"]>> | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await bridge.gmaps.search(params.keyword, city, { auditSites: params.auditSites === true });
      if (res.ok) break;
      if (res.status === 429) {
        if (found.size > 0) break;
        throw new Error(res.error ?? "Google tymczasowo blokuje zapytania.");
      }
      emit({ stage: "retry", detail: `Ponawiam (próba ${attempt + 2}/2)` },
        { text: `${city}: ${res.error ?? "błąd"} — ponawiam`, tone: "warn" });
      await sleep(5000);
    }
    if (!res?.ok) {
      emit({}, { text: `${city}: pominięto (${res?.error ?? "błąd"})`, tone: "warn" });
      if (res?.status === 429) break;
      done++;
      continue;
    }
    if (res.fromCache) cachedRequests++;
    else requests++;
    const cityTotal = res.total ?? 0;
    totalSeen += cityTotal;
    let cityKept = 0;
    for (const l of res.leads ?? []) {
      const key = blacklistKey(l.phone);
      if (key && blacklisted.has(key)) {
        blocked++;
        continue;
      }
      if (found.has(l.id)) continue;
      cityKept++;
      found.set(l.id, {
        id: l.id,
        name: l.name,
        rating: l.rating,
        userRatingCount: l.reviews,
        address: l.address,
        phone: l.phone,
        website: l.website ?? null,
        websiteIssue: l.issueTag ?? null,
        city: l.city,
        category: l.category ?? params.keyword,
        hours: [],
        mapsUri: l.mapsUrl,
        summary: null,
        priceLevel: null,
        businessStatus: null,
        reviews: [],
      });
    }
    totalRejectedPhones += res.rejectedPhones ?? 0;
    done++;
    emit({
      found: totalSeen, kept: found.size, rejected: totalSeen - found.size,
      cachedHits: cachedRequests, rejectedPhones: totalRejectedPhones, overall: done / cities.length,
    }, { text: `${city}: ${cityTotal} wizytówek, ${cityKept} bez strony${res.fromCache ? " (z pamięci)" : ""}`, tone: "ok" });
    if (!res.fromCache && done < cities.length) await sleep(cityDelay());
  }

  if (blocked > 0) emit({}, { text: `Pominięto ${blocked} firm z czarnej listy`, tone: "warn" });

  const leads = [...found.values()].sort(
    (a, b) => a.city.localeCompare(b.city, "pl") || b.userRatingCount - a.userRatingCount,
  );
  emit({ stage: "done", overall: 1, current: "", detail: "Gotowe", kept: leads.length },
    { text: `Zakończono — ${leads.length} leadów`, tone: "ok" });

  return {
    total: totalSeen,
    citiesScanned: done,
    requests,
    cached: cachedRequests,
    rejectedPhones: totalRejectedPhones,
    phrases: 1,
    warning: null as string | null,
    regionName: region.name,
    leads,
  };
}

/** Pobiera nowo założone firmy z CEIDG i mapuje je na wspólny format wyników. */
export async function searchCeidg(
  params: { days: number; pkd: string; voivodeshipName: string; enableDeepHarvest?: boolean },
  onProgress?: (p: import("./leads-store").CeidgProgress) => void,
) {
  const bridge = desktop();
  if (!bridge?.ceidg) throw new Error("Wyszukiwanie w CEIDG działa tylko w aplikacji na Maca.");
  const from = new Date(Date.now() - params.days * 86400000).toISOString().slice(0, 10);
  const res = await bridge.ceidg.search({
    dateFrom: from,
    pkd: params.pkd,
    voivodeship: params.voivodeshipName,
    enableDeepHarvest: params.enableDeepHarvest === true,
  }, onProgress);
  if (!res.ok) throw new Error(res.error ?? "CEIDG odrzucił zapytanie.");
  const blacklisted = new Set((await bridge.blacklist?.getAll().catch(() => [])) ?? []);
  const leads: PlaceLead[] = (res.leads ?? [])
    .filter((l) => !blacklisted.has(blacklistKey(l.telefon)))
    .map((l) => ({
      id: l.id,
      name: l.nazwa,
      rating: 0,
      userRatingCount: 0,
      address: l.adres,
      phone: l.telefon,
      website: null,
      city: l.miasto,
      category: l.kategoria,
      hours: [],
      mapsUri: null,
      summary: null,
      priceLevel: null,
      businessStatus: null,
      reviews: [],
      source: "CEIDG",
      nip: l.nip,
      regon: l.regon,
      email: l.email,
      owner: l.wlasciciel,
      firstName: l.imie,
      startDate: l.dataRozpoczecia,
      phoneSource: l.zrodlo_telefonu ?? "CEIDG",
    }));
  return { total: res.total ?? 0, from, leads, rejectedPhones: res.rejectedPhones ?? 0, harvested: res.harvested ?? 0 };
}

/** Realistyczny symulator wyników OLX dla podglądu w przeglądarce (brak aplikacji na Maca). */
const OLX_MOCK: Array<{ nazwa: string; miasto: string; zrodlo_telefonu: "OLX opis" | "OLX auto-click"; socialOnly: boolean }> = [
  { nazwa: "FotoŚlub — Magda Krawczyk", miasto: "Kielce", zrodlo_telefonu: "OLX opis", socialOnly: true },
  { nazwa: "DJ Bocian — oprawa muzyczna wesel", miasto: "Radom", zrodlo_telefonu: "OLX auto-click", socialOnly: false },
  { nazwa: "Fotobudka 360 EventLand", miasto: "Tarnów", zrodlo_telefonu: "OLX auto-click", socialOnly: true },
  { nazwa: "Mobilny Drink Bar — Pan Kieliszek", miasto: "Lublin", zrodlo_telefonu: "OLX opis", socialOnly: false },
  { nazwa: "Dekoracje Ślubne „Piwonia”", miasto: "Rzeszów", zrodlo_telefonu: "OLX auto-click", socialOnly: true },
  { nazwa: "Mikrocement & Posadzki Żywiczne ArtBeton", miasto: "Kraków", zrodlo_telefonu: "OLX opis", socialOnly: false },
];

const OLX_MOCK_PHONES = ["601234567", "512345678", "723456789", "884567890", "696123456", "455667788"];

/**
 * Skaner ogłoszeń OLX (Branża Ślubna & Usługi High-Ticket).
 * Na Macu: API OLX + auto-clicker „Pokaż numer”. W przeglądarce: symulowane wyniki.
 */
export async function searchOlx(
  params: { query: string; voivodeshipName: string; maxResults?: number; checkDuckDuckGo?: boolean },
  onProgress?: (p: import("./leads-store").OlxProgress) => void,
) {
  const bridge = desktop();

  // Podgląd w przeglądarce — symulacja, żeby można przetestować pigułki, zapis i wysyłkę.
  if (!bridge?.olx) {
    const total = OLX_MOCK.length;
    for (let i = 0; i < total; i++) {
      await sleep(350);
      onProgress?.({
        phase: i % 2 === 0 ? "description" : "click",
        index: i + 1,
        total,
        name: OLX_MOCK[i]?.nazwa ?? "",
        harvested: i,
      });
    }
    const leads: PlaceLead[] = OLX_MOCK.map((m, i) => ({
      id: `olx-mock-${i}`,
      name: m.nazwa,
      rating: 0,
      userRatingCount: 0,
      address: m.miasto,
      phone: `+48${OLX_MOCK_PHONES[i]}`,
      website: null,
      city: m.miasto,
      category: params.query,
      hours: [],
      mapsUri: null,
      summary: null,
      priceLevel: null,
      businessStatus: null,
      reviews: [],
      source: "OLX",
      issueType: "OLX_NO_WEBSITE",
      phoneSource: m.zrodlo_telefonu,
      olxUrl: `https://www.olx.pl/d/oferta/mock-${i}`,
      socialOnly: m.socialOnly,
    }));
    return { total, leads, rejectedPhones: 1, clicked: 3, skippedSite: 2, fromMock: true };
  }

  const res = await bridge.olx.search(
    {
      query: params.query,
      voivodeship: params.voivodeshipName,
      maxResults: params.maxResults ?? 50,
      checkDuckDuckGo: params.checkDuckDuckGo === true,
    },
    onProgress,
  );
  if (!res.ok) throw new Error(res.error ?? "OLX odrzucił zapytanie.");
  const blacklisted = new Set((await bridge.blacklist?.getAll().catch(() => [])) ?? []);
  const leads: PlaceLead[] = (res.leads ?? [])
    .filter((l) => !blacklisted.has(blacklistKey(l.telefon)))
    .map((l) => ({
      id: l.id,
      name: l.nazwa,
      rating: 0,
      userRatingCount: 0,
      address: l.adres,
      phone: l.telefon,
      website: null,
      city: l.miasto,
      category: l.kategoria,
      hours: [],
      mapsUri: null,
      summary: null,
      priceLevel: null,
      businessStatus: null,
      reviews: [],
      source: "OLX",
      issueType: "OLX_NO_WEBSITE",
      phoneSource: l.zrodlo_telefonu,
      olxUrl: l.olxUrl,
      socialOnly: l.socialOnly,
    }));
  return {
    total: res.total ?? 0,
    leads,
    rejectedPhones: res.rejectedPhones ?? 0,
    clicked: res.clicked ?? 0,
    skippedSite: res.skippedSite ?? 0,
    fromMock: false,
  };
}
