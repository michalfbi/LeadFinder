import { useCallback, useEffect, useState } from "react";
import { VOIVODESHIPS } from "@/lib/voivodeships";

const KEY = "leadfinder.region-stats";
const EVENT = "leadfinder:region-stats-change";

/** { nisza: { idWojewodztwa: liczbaWyslanych } } */
export type RegionStats = Record<string, Record<string, number>>;

const CITY_TO_REGION: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const v of VOIVODESHIPS) {
    for (const city of v.cities) map[city.toLowerCase()] = v.id;
  }
  return map;
})();

export function regionNameOf(id: string): string {
  return VOIVODESHIPS.find((v) => v.id === id)?.name ?? id;
}

/** Ustala województwo na podstawie zapisanego pola, miasta lub adresu. */
export function resolveRegion(input: {
  wojewodztwo?: string | null;
  miasto?: string | null;
  adres?: string | null;
}): string | null {
  const direct = input.wojewodztwo?.trim();
  if (direct) {
    const byId = VOIVODESHIPS.find(
      (v) => v.id === direct || v.name.toLowerCase() === direct.toLowerCase(),
    );
    if (byId) return byId.id;
  }
  const city = input.miasto?.trim().toLowerCase();
  if (city && CITY_TO_REGION[city]) return CITY_TO_REGION[city];
  const address = input.adres?.toLowerCase();
  if (address) {
    for (const [name, id] of Object.entries(CITY_TO_REGION)) {
      if (address.includes(name)) return id;
    }
  }
  return null;
}

export function normalizeNiche(value?: string | null): string {
  const text = (value ?? "").trim();
  return text === "" ? "Inne" : text;
}

export function readStats(): RegionStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RegionStats;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function write(stats: RegionStats) {
  window.localStorage.setItem(KEY, JSON.stringify(stats));
  window.dispatchEvent(new Event(EVENT));
}

/** Zapisuje wysłaną wiadomość w statystykach niszy i województwa. */
export function recordSentMessage(input: {
  nisza?: string | null;
  wojewodztwo?: string | null;
  miasto?: string | null;
  adres?: string | null;
}) {
  if (typeof window === "undefined") return;
  const region = resolveRegion(input);
  if (!region) return;
  const niche = normalizeNiche(input.nisza);
  const stats = readStats();
  const forNiche = { ...(stats[niche] ?? {}) };
  forNiche[region] = (forNiche[region] ?? 0) + 1;
  write({ ...stats, [niche]: forNiche });
}

/** Dopisuje niszę do listy (nawet bez wysłanych wiadomości). */
export function registerNiche(niche?: string | null) {
  if (typeof window === "undefined") return;
  const name = normalizeNiche(niche);
  if (name === "Inne") return;
  const stats = readStats();
  if (stats[name]) return;
  write({ ...stats, [name]: {} });
}

export function resetStats() {
  write({});
}

export function useRegionStats() {
  const [stats, setStats] = useState<RegionStats>({});

  useEffect(() => {
    const sync = () => setStats(readStats());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const reset = useCallback(() => resetStats(), []);
  return { stats, niches: Object.keys(stats).sort((a, b) => a.localeCompare(b)), reset };
}
