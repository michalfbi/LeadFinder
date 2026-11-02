import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { isDesktop, syncReplies, type LeadRow } from "@/lib/leads-store";
import { normalizeNiche } from "@/lib/region-stats";

const SENT = new Set(["wyslano_wiadomosc", "odpisal", "do_oferty", "oferta_wyslana"]);
const REPLIED = new Set(["odpisal", "do_oferty", "oferta_wyslana"]);

export type NicheStat = { niche: string; sent: number; replies: number; rate: number };

export function computeNicheStats(leads: LeadRow[], minSent: number): NicheStat[] {
  const map = new Map<string, { sent: number; replies: number }>();
  for (const l of leads) {
    if (!SENT.has(l.status)) continue;
    const key = normalizeNiche(l.nisza);
    const s = map.get(key) ?? { sent: 0, replies: 0 };
    s.sent++;
    if (REPLIED.has(l.status)) s.replies++;
    map.set(key, s);
  }
  return [...map.entries()]
    .filter(([, s]) => s.sent >= minSent)
    .map(([niche, s]) => ({ niche, ...s, rate: (s.replies / s.sent) * 100 }))
    .sort((a, b) => b.rate - a.rate || b.sent - a.sent);
}

export function NicheStatsTab({ leads }: { leads: LeadRow[] }) {
  const queryClient = useQueryClient();
  const [minSent, setMinSent] = useState(5);
  const [syncing, setSyncing] = useState(false);
  const stats = useMemo(() => computeNicheStats(leads, minSent), [leads, minSent]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await syncReplies();
      toast.success(`Sprawdzono ${res.checked} rozmów, nowych odpowiedzi: ${res.updated}`);
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Błąd synchronizacji");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="glass rounded-3xl">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Trophy className="size-5 text-primary" /> Ranking nisz wg odpowiedzi
        </CardTitle>
        <Button onClick={sync} disabled={syncing || !isDesktop()} className="rounded-xl">
          <RefreshCw className={syncing ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />
          Synchronizuj odpowiedzi
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Pokazuj nisze z co najmniej <b className="text-foreground">{minSent}</b> wysłanymi wiadomościami
          </p>
          <Slider min={1} max={30} step={1} value={[minSent]} onValueChange={(v) => setMinSent(v[0] ?? 5)} />
        </div>
        {stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Za mało danych. Wyślij przynajmniej {minSent} wiadomości w jednej niszy.
          </p>
        ) : (
          <ol className="space-y-4">
            {stats.map((s, i) => (
              <li key={s.niche} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    <span className="mr-2 text-muted-foreground">#{i + 1}</span>
                    {s.niche}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.replies}/{s.sent} ·{" "}
                    <b className="text-foreground">{s.rate.toFixed(1)}%</b>
                  </span>
                </div>
                <Progress value={s.rate} className="h-2" />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
