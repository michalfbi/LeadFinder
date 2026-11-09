import { LeadIssuePicker } from "@/components/issue-type-picker";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { Ban, Clock, GripVertical, PartyPopper, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LeadRow } from "@/lib/leads-store";

export type KanbanColumn = {
  id: string;
  title: string;
  /** Status ustawiany po upuszczeniu karty w kolumnie. */
  target: string;
  statuses: string[];
  accent: string;
};

export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "nowy",
    title: "Znalezione",
    target: "nowy",
    statuses: ["nowy"],
    accent: "var(--chart-1)",
  },
  {
    id: "dzwon",
    title: "Do dzwonienia",
    target: "do_dzwonienia",
    statuses: ["do_dzwonienia"],
    accent: "var(--chart-2)",
  },
  {
    id: "sms",
    title: "Wysłano SMS",
    target: "wyslano_wiadomosc",
    statuses: ["wyslano_wiadomosc"],
    accent: "var(--chart-3)",
  },
  {
    id: "odp",
    title: "Odpisali / Do oferty",
    target: "odpisal",
    statuses: ["odpisal", "do_oferty"],
    accent: "var(--chart-4)",
  },
  {
    id: "ok",
    title: "Sukces",
    target: "sukces",
    statuses: ["oferta_wyslana", "sukces"],
    accent: "var(--chart-5)",
  },
];

/** Kolumna dla statusu; nieznane statusy trafiają do „Znalezione”. */
export function columnForStatus(status: string): string {
  return KANBAN_COLUMNS.find((c) => c.statuses.includes(status))?.id ?? "nowy";
}

const HOUR = 60 * 60 * 1000;

/** Data ostatniego kontaktu / zmiany etapu, od której liczymy „stygnięcie”. */
export function lastContactDate(lead: LeadRow): string | null {
  if (lead.status === "odpisal")
    return (
      lead.replied_at ?? lead.status_changed_at ?? lead.sms_sent_at ?? null
    );
  if (lead.status === "wyslano_wiadomosc")
    return lead.sms_sent_at ?? lead.status_changed_at ?? null;
  return lead.status_changed_at ?? lead.sms_sent_at ?? lead.created_at ?? null;
}

export type Staleness = "hot" | "warn" | "ok";

/** odpisal > 24 h → hot (czerwony); nowy / do_dzwonienia > 3 dni → warn; reszta ok. */
export function staleness(
  status: string,
  iso: string | null,
  now = Date.now(),
): Staleness {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "ok";
  const age = now - t;
  if (status === "odpisal" && age > 24 * HOUR) return "hot";
  if ((status === "nowy" || status === "do_dzwonienia") && age > 72 * HOUR)
    return "warn";
  return "ok";
}

/** Wymusza re-render co minutę, żeby „10 min temu” było aktualne. */
function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function TimeSinceContact({
  iso,
  level,
}: {
  iso: string | null;
  level: Staleness;
}) {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return (
    <span
      title={new Date(iso).toLocaleString("pl-PL")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground",
        level === "hot" && "bg-destructive/10 text-destructive",
        level === "warn" && "bg-warning/15 text-warning",
      )}
    >
      <Clock className="size-3" />
      {formatDistanceToNow(new Date(iso), { addSuffix: true, locale: pl })}
    </span>
  );
}

export function LeadKanban({
  leads,
  onMove,
  onBlock,
  onCloseDeal,
}: {
  leads: LeadRow[];
  onMove: (id: string, status: string) => void;
  onBlock: (lead: LeadRow) => void;
  /** Klik „🎉 Zamknij sprzedaż” na karcie — otwiera modal z kwotą. */
  onCloseDeal?: (lead: LeadRow) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const now = useMinuteTick();

  return (
    <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const items = leads.filter((l) => columnForStatus(l.status) === col.id);
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== col.id) setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              setOver(null);
              setDragId(null);
              const lead = leads.find((l) => l.id === id);
              if (lead && !col.statuses.includes(lead.status))
                onMove(lead.id, col.target);
            }}
            className="flex max-h-[70vh] min-h-48 flex-col rounded-lg border-t-2 p-2 transition-colors"
            style={{
              borderTopColor: col.accent,
              backgroundColor:
                over === col.id
                  ? `color-mix(in oklch, ${col.accent} 14%, transparent)`
                  : undefined,
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">{col.title}</span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
                style={{
                  backgroundColor: `color-mix(in oklch, ${col.accent} 22%, transparent)`,
                }}
              >
                {items.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {items.map((lead) => {
                const since = lastContactDate(lead);
                const level = staleness(lead.status, since, now);
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(lead.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    className={cn(
                      "apple-glass-card group cursor-grab p-3 active:cursor-grabbing",
                      level === "hot" &&
                        "border-destructive/50 shadow-destructive/10",
                      level === "warn" && "border-warning/50",
                      dragId === lead.id && "opacity-40",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-medium"
                          title={lead.nazwa}
                        >
                          {lead.nazwa}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[lead.miasto, lead.nisza]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {lead.telefon && (
                          <p className="mt-2 flex items-center gap-1 font-mono text-sm tabular-nums text-foreground">
                            <Phone className="size-3" /> {lead.telefon}
                          </p>
                        )}
                        <div className="mt-1">
                          {lead.offer_type === "video_ads" ? (
                            <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs">
                              🎬 Reklama wideo AI
                              {lead.hot_score ? ` · ${lead.hot_score}/100` : ""}
                            </span>
                          ) : (
                            <LeadIssuePicker lead={lead} />
                          )}
                        </div>
                        {lead.suggested_free_domain && (
                          <p
                            className="mt-1 truncate text-xs text-amber-600 dark:text-amber-400"
                            title={lead.suggested_free_domain}
                          >
                            🌐 Wolna domena: {lead.suggested_free_domain}
                          </p>
                        )}
                        <div className="mt-1.5">
                          <TimeSinceContact iso={since} level={level} />
                        </div>
                        {lead.notatki && (
                          <p className="mt-1 line-clamp-2 text-xs text-primary/90">
                            {lead.notatki}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-0.5">
                        {onCloseDeal && lead.status !== "sukces" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="secondary-lead-action size-7 rounded-lg"
                            title="Zamknij sprzedaż"
                            aria-label="Zamknij sprzedaż"
                            onClick={() => onCloseDeal(lead)}
                          >
                            <PartyPopper className="size-3.5 text-primary" />
                          </Button>
                        )}
                        {lead.telefon && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="secondary-lead-action size-7 rounded-lg"
                            title="Zablokuj"
                            aria-label="Zablokuj"
                            onClick={() => onBlock(lead)}
                          >
                            <Ban className="size-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Przeciągnij tutaj
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
