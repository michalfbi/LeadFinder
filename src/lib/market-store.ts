import countryRules from "../../country-rules.json";

/**
 * Rozpoznanie rynku po stronie interfejsu. Na Macu rozmawia z silnikiem
 * (electron/market.cjs). W przeglądarce pokazuje przykładowy ranking policzony
 * tym samym silnikiem z wymyślonych liczb i niczego nie pobiera.
 */

export type HitBasis = "pomiar" | "inne-miasta" | "inne-nisze" | "zalozenie";
export type CompetitionLevel = "low" | "mid" | "high";
export type MarketProbe = {
  sampled: number;
  noSite: number;
  socialOnly: number;
  builder: number;
  broken: number;
  noSsl: number;
  weak: number;
  modern: number;
  skipped: number;
  withEmail: number;
};
export type MarketRow = {
  id: string;
  niche: string;
  nicheLabel: string;
  geo: string;
  place: string;
  kind: "metro" | "micro";
  states: string[];
  probeCity: string | null;
  firms: number;
  per100k: number | null;
  payrollPerFirm: number | null;
  competition: { index: number; level: CompetitionLevel | null } | null;
  hit: {
    mean: number;
    low: number;
    high: number;
    basis: HitBasis;
    sampled: number;
    hits: number;
    at: number | null;
  };
  probe: MarketProbe | null;
  reachable: { mean: number; low: number; high: number };
  potential: number;
  optimistic: number;
  campaign: {
    sent: number;
    replies: number;
    positive: number;
    blocked: number;
  } | null;
  verified: boolean;
  exact: boolean;
  note: string | null;
};
export type MarketSettings = {
  keyConfigured: boolean;
  fetchedAt: number | null;
  year: number | null;
  notes: string[];
  keySignupUrl: string;
  geos: number;
  cells: number;
  probes: number;
};
export type MarketRanking = MarketSettings & {
  ready: boolean;
  rows: MarketRow[];
  recommended: MarketRow[];
  limits: string[];
  total: number;
};
export type MarketFilter = {
  niche?: string;
  state?: string;
  lowCompetition?: boolean;
  limit?: number;
};
export type MarketProgress = { index: number; total: number; label: string };

type MarketBridge = {
  settings: () => Promise<MarketSettings>;
  configure: (value: {
    key?: string;
    clearKey?: boolean;
  }) => Promise<MarketSettings>;
  test: () => Promise<{ ok: boolean; firms: number }>;
  ranking: (filter?: MarketFilter) => Promise<MarketRanking>;
  refresh: (
    onProgress?: (p: MarketProgress) => void,
  ) => Promise<MarketSettings>;
  probe: (
    payload: { nicheId: string; city: string },
    onProgress?: (p: MarketProgress) => void,
  ) => Promise<MarketProbe & { nicheId: string; cityKey: string }>;
};

export const US_NICHES = countryRules.markets.US.niches.map((n) => ({
  id: n.id,
  label: n.label,
}));
export const US_STATES = countryRules.markets.US.states.map((s) => ({
  code: s.code,
  name: s.name,
}));

export function marketBridge(): MarketBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { leadfinder?: { market?: MarketBridge } }).leadfinder
      ?.market ?? null
  );
}

/** Ranking: z silnika na Macu albo przykładowy w przeglądarce (filtrowany na miejscu). */
export async function loadRanking(
  filter: MarketFilter,
): Promise<MarketRanking> {
  const bridge = marketBridge();
  if (bridge) return bridge.ranking(filter);
  const sample = (await import("./market-preview.json"))
    .default as unknown as MarketRanking;
  const perGeo = new Map<string, number>();
  const rows = sample.rows.filter((r) => {
    if (filter.niche && r.niche !== filter.niche) return false;
    if (filter.state && !r.states.includes(filter.state)) return false;
    if (filter.lowCompetition && r.competition?.level !== "low") return false;
    if (filter.niche) return true;
    // Jak w silniku: bez wybranej niszy najwyżej trzy nisze na obszar.
    const n = (perGeo.get(r.geo) ?? 0) + 1;
    perGeo.set(r.geo, n);
    return n <= 3;
  });
  return {
    ...sample,
    rows: rows.slice(0, filter.limit ?? 50),
    total: rows.length,
  };
}
