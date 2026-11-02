import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Banknote,
  FlaskConical,
  MessageSquareText,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { deleteLead, insertLeads, listLeads, type LeadRow } from "@/lib/leads-store";
import { VOIVODESHIPS } from "@/lib/voivodeships";
import { ISSUE_META, ISSUE_TYPES, issueTypeOf, type WebsiteIssueType } from "@/lib/issue-templates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Statusy liczone jako „zaangażowany klient”. */
const ENGAGED = new Set(["odpisal", "do_oferty", "oferta_wyslana", "sukces"]);

type Agg = {
  sent: number;
  engaged: number;
  closed: number;
  revenue: number;
  engRate: number;
  closeRate: number;
};

function aggregate(leads: LeadRow[]): Agg {
  const sent = leads.filter((l) => l.sms_sent_at);
  const engaged = sent.filter((l) => ENGAGED.has(l.status) || l.engaged_at);
  const closed = sent.filter((l) => l.status === "sukces");
  const revenue = closed.reduce((s, l) => s + (Number(l.deal_value) || 0), 0);
  return {
    sent: sent.length,
    engaged: engaged.length,
    closed: closed.length,
    revenue,
    engRate: sent.length > 0 ? (engaged.length / sent.length) * 100 : 0,
    closeRate: engaged.length > 0 ? (closed.length / engaged.length) * 100 : 0,
  };
}

const pln = (v: number) =>
  `${v.toLocaleString("pl-PL", { maximumFractionDigits: 0 })} zł`;

const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

function sourceOf(lead: LeadRow): string {
  return lead.zrodlo === "CEIDG" ? "CEIDG" : "Google Maps";
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string | undefined;
  tone?: "primary" | "success" | "warning" | "revenue";
}) {
  return (
    <Card className={`apple-glass-card kpi-tile kpi-${tone}`}>
      <CardContent className="flex flex-col items-start gap-4 p-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="kpi-icon size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="my-2 break-words text-3xl font-semibold tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className="kpi-rule" aria-hidden="true" />
      </CardContent>
    </Card>
  );
}

/* ---------- Generator danych demo (podgląd w przeglądarce) ---------- */

const DEMO_SIGNATURES = [
  "[Dzień dobry] + [Brak strony] + [Darmowy projekt]",
  "[Dzień dobry] + [Niska widoczność] + [Pokażę przykład]",
  "[Cześć] + [Brak strony] + [Krótka rozmowa]",
];
const DEMO_NICHES = ["Fryzjer", "Stolarz", "Hydraulik", "Prawnik", "Weterynarz", "Mechanik"];
const DEMO_CITIES = ["Kielce", "Radom", "Lublin", "Kraków", "Rzeszów", "Tarnów"];
const DEMO_DEALS = [1500, 2500, 4000];

function buildDemoLeads(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const now = Date.now();
  for (let i = 0; i < 42; i++) {
    const voiv = VOIVODESHIPS[Math.floor(Math.random() * VOIVODESHIPS.length)]!;
    const niche = DEMO_NICHES[Math.floor(Math.random() * DEMO_NICHES.length)]!;
    const source = Math.random() < 0.6 ? "Google Maps" : "CEIDG";
    const sig = DEMO_SIGNATURES[Math.floor(Math.random() * DEMO_SIGNATURES.length)]!;
    const sentDaysAgo = Math.floor(Math.random() * 30) + 1;
    const sentAt = new Date(now - sentDaysAgo * 86_400_000).toISOString();
    // Ważony los statusu: większość bez odpowiedzi, część zaangażowana, kilka sprzedaży.
    const roll = Math.random();
    const status =
      roll < 0.55 ? "wyslano_wiadomosc" : roll < 0.78 ? "odpisal" : roll < 0.86 ? "do_oferty" : roll < 0.92 ? "oferta_wyslana" : "sukces";
    const engaged = ENGAGED.has(status);
    const closed = status === "sukces";
    rows.push({
      nazwa: `Demo ${niche} ${i + 1}`,
      telefon: `5${String(10000000 + Math.floor(Math.random() * 89999999))}`,
      miasto: DEMO_CITIES[Math.floor(Math.random() * DEMO_CITIES.length)],
      wojewodztwo: voiv.name,
      nisza: niche,
      zrodlo: source,
      status,
      notatki: "DANE DEMO",
      sms_sent_at: sentAt,
      sms_template_id: "Podstawowy",
      sms_combination_signature: sig,
      sms_exact_text: `Dzień dobry, piszę do firmy Demo ${niche} ${i + 1}…`,
      engaged_at: engaged ? new Date(Date.parse(sentAt) + 86_400_000).toISOString() : null,
      closed_at: closed ? new Date(Date.parse(sentAt) + 3 * 86_400_000).toISOString() : null,
      deal_value: closed ? DEMO_DEALS[Math.floor(Math.random() * DEMO_DEALS.length)] : 0,
    });
  }
  return rows;
}

/* ---------- Zakładka Analityka ---------- */

export function AnalyticsTab() {
  const queryClient = useQueryClient();
  const { data: leads } = useQuery({ queryKey: ["leads"], queryFn: listLeads });
  const [demoBusy, setDemoBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"ALL" | WebsiteIssueType>("ALL");

  const all = useMemo(() => leads ?? [], [leads]);
  const totals = useMemo(() => aggregate(all), [all]);

  /** Ranking kombinacji SMS (podpis Spintax / szablon). */
  const byType = useMemo(() => {
    const out = {} as Record<WebsiteIssueType, ReturnType<typeof aggregate>>;
    for (const t of ISSUE_TYPES) out[t] = aggregate(all.filter((l) => l.sms_sent_at && issueTypeOf(l) === t));
    return out;
  }, [all]);

  const combos = useMemo(() => {
    const groups = new Map<string, LeadRow[]>();
    for (const l of all) {
      if (!l.sms_sent_at) continue;
      if (typeFilter !== "ALL" && issueTypeOf(l) !== typeFilter) continue;
      const key =
        l.sms_combination_signature ||
        (l.sms_template_id ? `Szablon: ${l.sms_template_id}` : "Starsze wysyłki (bez podpisu)");
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    const rows = [...groups.entries()].map(([signature, rows]) => ({
      signature,
      ...aggregate(rows),
    }));
    rows.sort((a, b) => b.closed - a.closed || b.engRate - a.engRate);
    const maxClosed = Math.max(0, ...rows.filter((r) => r.sent >= 10).map((r) => r.closed));
    return rows.map((r) => ({
      ...r,
      verdict:
        r.sent < 10
          ? ("🧪 Za mało danych" as const)
          : maxClosed > 0 && r.closed === maxClosed
            ? ("🔥 Zwycięska kombinacja" as const)
            : r.engRate < 5
              ? ("⚠️ Słaby wynik" as const)
              : ("✅ Solidny wynik" as const),
    }));
  }, [all, typeFilter]);

  /** Wyniki per województwo (wszystkie 16 + ewentualne nieznane). */
  const regions = useMemo(() => {
    const names = new Set(VOIVODESHIPS.map((v) => v.name));
    const groups = new Map<string, LeadRow[]>();
    for (const l of all) {
      const key = l.wojewodztwo?.trim() || "Nieznane";
      names.add(key);
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, "pl"))
      .map((name) => {
        const rows = groups.get(name) ?? [];
        const agg = aggregate(rows);
        // Najlepsza nisza = najwięcej zaangażowanych w tym województwie.
        const byNiche = new Map<string, number>();
        for (const l of rows) {
          if (!ENGAGED.has(l.status) && !l.engaged_at) continue;
          const niche = l.nisza?.trim() || l.kategoria?.trim() || "Inne";
          byNiche.set(niche, (byNiche.get(niche) ?? 0) + 1);
        }
        const bestNiche =
          [...byNiche.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        return { name, ...agg, bestNiche };
      });
  }, [all]);

  const chartData = useMemo(
    () =>
      regions
        .filter((r) => r.sent > 0)
        .map((r) => ({ name: r.name, Zaangażowani: r.engaged, Sprzedaże: r.closed })),
    [regions],
  );

  /** Porównanie źródeł i nisz. */
  const sources = useMemo(() => {
    const groups = new Map<string, LeadRow[]>();
    for (const l of all) {
      const key = sourceOf(l);
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return ["Google Maps", "CEIDG"].map((name) => ({ name, ...aggregate(groups.get(name) ?? []) }));
  }, [all]);

  const niches = useMemo(() => {
    const groups = new Map<string, LeadRow[]>();
    for (const l of all) {
      if (!l.sms_sent_at) continue;
      const key = l.nisza?.trim() || l.kategoria?.trim() || "Inne";
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return [...groups.entries()]
      .map(([name, rows]) => ({ name, ...aggregate(rows) }))
      .sort((a, b) => b.closed - a.closed || b.engaged - a.engaged)
      .slice(0, 12);
  }, [all]);

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      await insertLeads(buildDemoLeads());
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Załadowano 42 przykładowe leady z danymi analitycznymi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się załadować danych demo");
    } finally {
      setDemoBusy(false);
    }
  };

  const clearDemo = async () => {
    setDemoBusy(true);
    try {
      const demoRows = all.filter((l) => l.notatki === "DANE DEMO");
      for (const row of demoRows) await deleteLead(row.id);
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`Usunięto ${demoRows.length} leadów demo`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się usunąć danych demo");
    } finally {
      setDemoBusy(false);
    }
  };

  const demoCount = all.filter((l) => l.notatki === "DANE DEMO").length;

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={MessageSquareText}
          label="Wysłane SMS-y"
          value={String(totals.sent)}
          sub={`z ${all.length} leadów w bazie`}
        />
        <KpiCard
          icon={Users}
          label="Zaangażowani ludzie"
          tone="success"
          value={String(totals.engaged)}
          sub={`${pct(totals.engRate)} wysłanych`}
        />
        <KpiCard
          icon={TrendingUp}
          label="Zamknięte sprzedaże"
          tone="warning"
          value={String(totals.closed)}
          sub={`${pct(totals.closeRate)} zaangażowanych`}
        />
        <KpiCard
          icon={Banknote}
          label="Łączny przychód"
          tone="revenue"
          value={pln(totals.revenue)}
          sub={totals.closed > 0 ? `śr. ${pln(totals.revenue / totals.closed)} / zlecenie` : undefined}
        />
      </div>

      {/* Kombinacje SMS */}
      <Card className="glass-soft rounded-2xl border-0">
        <CardHeader className="space-y-3 pb-2">
          <CardTitle className="text-base">Skuteczność kombinacji SMS</CardTitle>
          <div className="flex flex-wrap gap-2">
            {(["ALL", ...ISSUE_TYPES] as const).map((t) => {
              const agg = t === "ALL" ? null : byType[t];
              return (
                <Button
                  key={t}
                  size="sm"
                  variant={typeFilter === t ? "default" : "outline"}
                  className="rounded-xl"
                  onClick={() => setTypeFilter(t)}
                >
                  {t === "ALL" ? "Wszystkie typy" : `${ISSUE_META[t].emoji} ${ISSUE_META[t].short}`}
                  {agg && agg.sent > 0 && (
                    <span className="ml-1.5 text-xs opacity-75">
                      {agg.engaged}/{agg.sent} · {agg.closed} sprz.
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kombinacja SMS</TableHead>
                <TableHead className="text-right">Wysłano</TableHead>
                <TableHead className="text-right">Zaangażowani</TableHead>
                <TableHead className="text-right">Sprzedaże</TableHead>
                <TableHead className="text-right">Przychód</TableHead>
                <TableHead>Werdykt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combos.map((c) => (
                <TableRow key={c.signature}>
                  <TableCell className="max-w-64">
                    <span className="line-clamp-2 text-xs" title={c.signature}>
                      {c.signature}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.engaged} <span className="text-xs text-muted-foreground">({pct(c.engRate)})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.closed} <span className="text-xs text-muted-foreground">({pct(c.closeRate)})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pln(c.revenue)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={c.verdict.startsWith("🔥") ? "default" : "outline"}
                      className="whitespace-nowrap rounded-full text-xs font-normal"
                    >
                      {c.verdict}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {combos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Brak wysłanych wiadomości — wyślij pierwszą serię SMS, aby zobaczyć wyniki.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Województwa */}
      <Card className="glass-soft rounded-2xl border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Wyniki według województw</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {chartData.length > 0 && (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -20, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="Zaangażowani" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Sprzedaże" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Województwo</TableHead>
                  <TableHead className="text-right">Wysłano</TableHead>
                  <TableHead>Zaangażowani</TableHead>
                  <TableHead className="text-right">Sprzedaże</TableHead>
                  <TableHead className="text-right">Przychód</TableHead>
                  <TableHead>Najlepsza nisza</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regions.map((r) => (
                  <TableRow key={r.name} className={r.sent === 0 ? "opacity-40" : undefined}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sent}</TableCell>
                    <TableCell className="min-w-36">
                      <div className="flex items-center gap-2">
                        <Progress value={r.engRate} className="h-1.5 flex-1" />
                        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {r.engaged} ({pct(r.engRate)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.closed} <span className="text-xs text-muted-foreground">({pct(r.closeRate)})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pln(r.revenue)}</TableCell>
                    <TableCell className="text-xs">{r.bestNiche}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Źródła i nisze */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass-soft rounded-2xl border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Źródło leadów: Mapy Google vs CEIDG</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.map((s) => (
              <div key={s.name} className="glass-soft space-y-1.5 rounded-xl p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="tabular-nums text-muted-foreground">{s.sent} wysłanych</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Progress value={s.engRate} className="h-1.5 flex-1" />
                  <span className="tabular-nums">
                    {s.engaged} zaangażowanych ({pct(s.engRate)})
                  </span>
                </div>
                <p className="text-xs tabular-nums">
                  {s.closed} sprzedaży · {pln(s.revenue)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="glass-soft rounded-2xl border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Nisze z najlepszą konwersją</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {niches.map((n) => (
              <div key={n.name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate font-medium" title={n.name}>
                  {n.name}
                </span>
                <Progress value={n.engRate} className="h-1.5 flex-1" />
                <span className="w-40 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {n.engaged}/{n.sent} · {n.closed} sprz. · {pln(n.revenue)}
                </span>
              </div>
            ))}
            {niches.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Brak danych — wyślij wiadomości, aby porównać nisze.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dane demo do podglądu */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={demoBusy}
          onClick={loadDemo}
        >
          <FlaskConical className="mr-2 size-4" /> Załaduj przykładowe dane analityczne (Demo)
        </Button>
        {demoCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl text-destructive"
            disabled={demoBusy}
            onClick={clearDemo}
          >
            <Trash2 className="mr-2 size-4" /> Usuń dane demo ({demoCount})
          </Button>
        )}
      </div>
    </div>
  );
}
