import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Flame,
  Mail,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";

type WidgetPlan = {
  scanTime: string;
  source: string;
  query: string;
  voivodeship: string;
  limit: number;
  channel: string;
};

type WidgetPending = {
  id: string;
  source: string;
  status: string;
  count: number;
  sendAt: string | null;
  channel: string;
};

type WidgetStats = {
  leadsSms: number;
  leadsEmail: number;
  hot: number;
  sentToday: number;
  sentTotal: number;
  plan: WidgetPlan | null;
  pending: WidgetPending[];
  autopilotActive: boolean;
};

// Dane demonstracyjne dla podglądu w przeglądarce (poza Electronem).
const MOCK_STATS: WidgetStats = {
  leadsSms: 128,
  leadsEmail: 46,
  hot: 7,
  sentToday: 23,
  sentTotal: 412,
  plan: {
    scanTime: "07:00",
    source: "CEIDG",
    query: "96.02.Z",
    voivodeship: "Świętokrzyskie",
    limit: 50,
    channel: "SMS",
  },
  pending: [
    { id: "demo-1", source: "Google Maps", status: "scheduled", count: 18, sendAt: null, channel: "SMS" },
    { id: "demo-2", source: "OLX", status: "pending", count: 9, sendAt: null, channel: "EMAIL" },
  ],
  autopilotActive: true,
};

type WidgetBridge = {
  getStats?: () => Promise<WidgetStats>;
  openMain?: () => Promise<void>;
};

function widgetBridge(): WidgetBridge | undefined {
  if (typeof window === "undefined") return undefined; // SSR — mostek istnieje tylko w Electronie
  return (window as unknown as { leadfinder?: { widget?: WidgetBridge } }).leadfinder?.widget;
}

export const Route = createFileRoute("/widget")({
  head: () => ({
    meta: [
      { title: "LeadFinder B2B — Widget pulpitowy" },
      {
        name: "description",
        content:
          "Pulpitowy widget LeadFinder B2B: gorące leady, wysyłka dnia i harmonogram Autopilota zawsze pod ręką.",
      },
      { property: "og:title", content: "LeadFinder B2B — Widget pulpitowy" },
      {
        property: "og:description",
        content: "Najważniejsze statystyki biznesowe i plan dnia w eleganckim widgetcie na pulpicie Maca.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WidgetPage,
});

const SOURCE_LABELS: Record<string, string> = {
  GOOGLE_MAPS: "Google Maps",
  CEIDG: "CEIDG",
  OLX: "OLX",
};

function WidgetPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<WidgetStats>(MOCK_STATS);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const isDesktop = Boolean(widgetBridge()?.getStats);

  const refresh = useCallback(async () => {
    const bridge = widgetBridge();
    if (!bridge?.getStats) return; // tryb przeglądarki — zostają dane demonstracyjne
    try {
      const data = await bridge.getStats();
      if (data) setStats(data);
      setLastRefresh(new Date());
    } catch {
      /* zachowaj ostatnie znane dane */
    }
  }, []);

  useEffect(() => {
    // Przezroczyste tło: okno widgetu jest bezramkowe, więc przez szkło
    // ma prześwitywać pulpit Maca, a nie ciemna plansza aplikacji.
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    if (widgetBridge()?.getStats) {
      document.body.style.background = "transparent";
      document.documentElement.style.background = "transparent";
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
      clearInterval(timer);
    };
  }, [refresh]);

  const openMain = () => {
    const bridge = widgetBridge();
    if (bridge?.openMain) void bridge.openMain();
    else void navigate({ to: "/" });
  };

  const refreshLabel = lastRefresh.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`widget-shell flex min-h-screen items-center justify-center p-3 select-none ${isDesktop ? "" : "bg-macos-canvas"}`}
    >
      <div className="apple-glass-panel w-[356px] max-w-full p-5 text-foreground tabular-nums">
        {/* Nagłówek — obszar przeciągania bezramkowego okna */}
        <header
          className="widget-drag mb-4 flex items-center gap-3"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
            <Sparkles className="h-5 w-5 text-warning" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">LeadFinder B2B</p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  stats.autopilotActive ? "bg-chart-2" : "bg-muted-foreground"
                }`}
              />
              {stats.autopilotActive ? "Autopilot aktywny" : "Autopilot wstrzymany"}
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground">{refreshLabel}</span>
        </header>

        {/* Główny kafel statystyk */}
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-secondary p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-warning">
              <Flame className="h-3.5 w-3.5" />
              Gorące leady
            </div>
            <p className="text-3xl font-semibold">{stats.hot}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">odpisali — do obsługi</p>
          </div>
          <div className="rounded-2xl border border-border bg-secondary p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <Send className="h-3.5 w-3.5" />
              Wysłane dziś
            </div>
            <p className="text-3xl font-semibold">{stats.sentToday}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">łącznie: {stats.sentTotal}</p>
          </div>
        </div>

        {/* Baza leadów */}
        <div className="mb-3 flex gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-muted px-3 py-2.5">
            <MessageSquare className="h-4 w-4 shrink-0 text-chart-2" />
            <div>
              <p className="text-sm font-semibold leading-tight">{stats.leadsSms}</p>
              <p className="text-[10px] text-muted-foreground">baza SMS</p>
            </div>
          </div>
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-muted px-3 py-2.5">
            <Mail className="h-4 w-4 shrink-0 text-chart-4" />
            <div>
              <p className="text-sm font-semibold leading-tight">{stats.leadsEmail}</p>
              <p className="text-[10px] text-muted-foreground">baza e-mail</p>
            </div>
          </div>
        </div>

        {/* Plany i harmonogram */}
        <section className="mb-4 rounded-2xl border border-border bg-muted p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Plany i harmonogram
          </p>
          <ul className="space-y-1.5 text-[12px]">
            {stats.plan ? (
              <li className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">
                  {stats.plan.scanTime} · Skan {SOURCE_LABELS[stats.plan.source] ?? stats.plan.source}
                  {stats.plan.query ? ` — ${stats.plan.query}` : ""}
                </span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  {stats.plan.voivodeship}
                </span>
              </li>
            ) : (
              <li className="text-muted-foreground">Brak zaplanowanego skanu na dziś</li>
            )}
            {stats.pending.map((batch) => (
              <li key={batch.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">
                  {batch.status === "scheduled" ? "⏰" : "🕓"}{" "}
                  {batch.channel === "EMAIL" ? "Paczka e-mail" : "Wysyłka SMS"} ·{" "}
                  {SOURCE_LABELS[batch.source] ?? batch.source}
                </span>
                <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
                  {batch.count} w poczekalni
                </span>
              </li>
            ))}
            {!stats.plan && stats.pending.length === 0 && (
              <li className="text-muted-foreground">Poczekalnia jest pusta</li>
            )}
          </ul>
        </section>

        {/* Przycisk akcji */}
        <Button
          variant="secondary"
          onClick={openMain}
          className="widget-no-drag h-auto w-full whitespace-normal py-3"
        >
          {isDesktop ? "Otwórz na drugim ekranie" : "Otwórz aplikację główną"}
          <ArrowUpRight className="h-4 w-4" />
        </Button>
        {!isDesktop && (
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Podgląd w przeglądarce — dane demonstracyjne
          </p>
        )}
      </div>
    </div>
  );
}
