import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MapPin, RotateCw } from "lucide-react";
import type { ScanProgress } from "@/lib/places-scan";
import { cn } from "@/lib/utils";

const STAGES = [
  { id: "maps", label: "Mapy Google", icon: MapPin },
  { id: "done", label: "Gotowe", icon: CheckCircle2 },
] as const;

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

export function ScanProgressPanel({ p }: { p: ScanProgress }) {
  const start = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = now - start.current;
  const pct = Math.round(p.overall * 100);
  const eta = p.overall > 0.03 && p.overall < 1 ? (elapsed / p.overall) * (1 - p.overall) : null;
  const stages = STAGES;
  const activeStage = p.stage === "retry" ? "maps" : p.stage;
  const activeIdx = stages.findIndex((s) => s.id === activeStage);

  return (
    <div className="space-y-4 rounded-2xl border border-border/60 bg-background/40 p-4 backdrop-blur-xl">
      {/* Etapy */}
      <div className="flex items-center gap-2">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <div key={s.id} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "active" && "border-primary text-primary",
                  state === "todo" && "border-border text-muted-foreground",
                )}
              >
                {state === "active" && s.id !== "done" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Icon className="size-3.5" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  state === "todo" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {s.label}
              </span>
              {i < stages.length - 1 && (
                <div className="h-px flex-1 bg-border">
                  <div
                    className="h-px bg-primary transition-all duration-500"
                    style={{ width: state === "done" ? "100%" : "0%" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pasek */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {fmt(elapsed)} minęło{eta !== null && ` · ok. ${fmt(eta)} do końca`}
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="relative h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(2, pct)}%` }}
          >
            <div className="absolute inset-0 animate-pulse bg-primary-foreground/20" />
          </div>
        </div>
      </div>

      {/* Bieżące zadanie */}
      <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
        {p.stage === "retry" ? (
          <RotateCw className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
        ) : (
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{p.current || "Przygotowuję…"}</p>
          <p className="text-xs text-muted-foreground">{p.detail}</p>
        </div>
        {p.stepTotal > 0 && p.stage !== "done" && (
          <span className="shrink-0 rounded-md bg-background/60 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {p.step} / {p.stepTotal}
          </span>
        )}
      </div>

      {/* Liczniki */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Wizytówki", p.found],
          ["Bez strony", p.kept],
          ["Odrzucone", p.rejected],
          ["Stacjonarne / błędne", p.rejectedPhones],
          ["Miasta z pamięci", p.cachedHits],
        ].map(([label, v]) => (
          <div key={label} className="rounded-xl border border-border/50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {/* Dziennik */}
      {p.log.length > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto pr-1 font-mono text-[11px]">
          {p.log.map((l, i) => (
            <div key={l.at + "-" + i} className={cn("flex gap-2", i === 0 ? "opacity-100" : "opacity-60")}>
              <span className="tabular-nums text-muted-foreground">
                {new Date(l.at).toLocaleTimeString("pl-PL")}
              </span>
              <span
                className={cn(
                  l.tone === "ok" && "text-primary",
                  l.tone === "warn" && "text-destructive",
                )}
              >
                {l.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
