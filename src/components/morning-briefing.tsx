import { useEffect, useMemo, useState } from "react";
import { differenceInDays, differenceInHours } from "date-fns";
import { Clock, Flame, MessageSquareReply, PartyPopper, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leads-store";

export type BriefingFilter = "hot" | "cooling" | "followup";

const parse = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Gorące: lead odpisał. */
export const isHot = (l: LeadRow) => l.status === "odpisal";

/** Stygnące: do_dzwonienia / do_oferty dłużej niż 48 h. */
export function isCooling(l: LeadRow, now = new Date()) {
  if (l.status !== "do_dzwonienia" && l.status !== "do_oferty") return false;
  const since = parse(l.status_changed_at) ?? parse(l.created_at);
  return !!since && differenceInHours(now, since) > 48;
}

/** Follow-up: wysłano wiadomość co najmniej 3 dni temu i brak odpowiedzi. */
export function isFollowUp(l: LeadRow, now = new Date()) {
  if (l.status !== "wyslano_wiadomosc") return false;
  const sent = parse(l.sms_sent_at) ?? parse(l.status_changed_at);
  return !!sent && differenceInDays(now, sent) >= 3;
}

export function matchesBriefing(l: LeadRow, f: BriefingFilter, now = new Date()) {
  return f === "hot" ? isHot(l) : f === "cooling" ? isCooling(l, now) : isFollowUp(l, now);
}

function greeting(h: number) {
  if (h < 12) return "Dzień dobry";
  if (h < 18) return "Miłego popołudnia";
  return "Dobry wieczór";
}

export function MorningBriefing({
  leads,
  active,
  onFilterChange,
}: {
  leads: LeadRow[];
  active: BriefingFilter | null;
  onFilterChange: (f: BriefingFilter | null) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(
    () => ({
      hot: leads.filter(isHot).length,
      cooling: leads.filter((l) => isCooling(l, now)).length,
      followup: leads.filter((l) => isFollowUp(l, now)).length,
    }),
    [leads, now],
  );
  const total = stats.hot + stats.cooling + stats.followup;

  const tiles: {
    id: BriefingFilter;
    label: string;
    hint: string;
    count: number;
    Icon: typeof Flame;
    tone: string;
  }[] = [
    { id: "hot", label: "Gorące", hint: "Odpisali — odpowiedz teraz", count: stats.hot, Icon: Flame, tone: "destructive" },
    { id: "cooling", label: "Stygnące", hint: "Czekają ponad 48 godz.", count: stats.cooling, Icon: Clock, tone: "warning" },
    { id: "followup", label: "Follow-upy", hint: "3+ dni od SMS — wyślij przypomnienie", count: stats.followup, Icon: MessageSquareReply, tone: "primary" },
  ];

  return (
    <div className="relative mb-6 border-b border-border pb-6">
      <div className="relative z-10">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Poranny przegląd · {now.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h2 className="text-lg font-semibold">
              {greeting(now.getHours())}!{" "}
              {total > 0
                ? `Masz ${total} ${total === 1 ? "akcję" : total < 5 ? "akcje" : "akcji"} do wykonania.`
                : ""}
            </h2>
          </div>
          {active && (
            <Button variant="ghost"
              type="button"
              onClick={() => onFilterChange(null)}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/80"
            >
              <X className="size-3" /> Pokaż wszystkie
            </Button>
          )}
        </div>

        {total === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-primary/10 p-4">
            <PartyPopper className="size-8 shrink-0 text-primary" />
            <p className="text-sm">
              <span className="font-semibold">Czysta karta!</span> Wszystkie leady obsłużone. Świetny moment na
              przeskanowanie nowego miasta.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map(({ id, label, hint, count, Icon, tone }) => {
              const isActive = active === id;
              return (
                <Button variant="ghost"
                  key={id}
                  type="button"
                  disabled={count === 0}
                  onClick={() => onFilterChange(isActive ? null : id)}
                  className={cn(
                    "group flex h-auto items-center justify-start gap-3 whitespace-normal rounded-2xl border p-4 text-left transition-all",
                    "disabled:cursor-default disabled:opacity-45",
                    "enabled:hover:-translate-y-0.5 enabled:hover:shadow-lg",
                    tone === "destructive" && "border-destructive/30 bg-destructive/10",
                    tone === "warning" && "border-warning/30 bg-warning/10",
                    tone === "primary" && "border-primary/30 bg-primary/10",
                    isActive && tone === "destructive" && "ring-2 ring-destructive",
                    isActive && tone === "warning" && "ring-2 ring-warning",
                    isActive && tone === "primary" && "ring-2 ring-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-xl",
                      tone === "destructive" && "bg-destructive/15 text-destructive",
                      tone === "warning" && "bg-warning/15 text-warning",
                      tone === "primary" && "bg-primary/15 text-primary",
                    )}
                  >
                    <Icon className={cn("size-5", id === "hot" && count > 0 && "animate-pulse")} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tabular-nums">{count}</span>
                      <span className="text-sm font-semibold">{label}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
