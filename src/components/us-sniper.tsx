import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Crosshair,
  Eye,
  Flame,
  Inbox,
  Loader2,
  Mail,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FunnelStep,
  GLASS,
  INTENT_LABEL,
  ScoreRing,
} from "@/components/sniper-tab";
import {
  SNIPER_TOP_LIMIT,
  runSniperScan,
  type SniperLead,
  type SniperRunResult,
} from "@/lib/sniper-sieve";
import {
  US,
  US_PILLS,
  buildUsEmail,
  usFooterPreview,
  usNiche,
  usState,
  useMarketSettings,
} from "@/lib/market-outreach";
import {
  addEmails,
  emailBridge,
  listEmails,
  type EmailLead,
} from "@/lib/email-store";
import type { SniperScanProgress } from "@/lib/leads-store";

type Sender = { senderName?: string; company?: string; address?: string };

const FREE_MAILBOXES = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
]);

function UsLeadCard({
  lead,
  selected,
  onToggle,
  trade,
  price,
  sender,
}: {
  lead: SniperLead;
  selected: boolean;
  onToggle: (value: boolean) => void;
  trade: string;
  price: string;
  sender: Sender;
}) {
  const [open, setOpen] = useState(false);
  const mail = useMemo(
    () =>
      buildUsEmail(lead, {
        trade,
        price,
        ...(sender.senderName ? { senderName: sender.senderName } : {}),
      }),
    [lead, trade, price, sender.senderName],
  );
  return (
    <article className={`${GLASS} p-4 ${selected ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggle(v === true)}
          aria-label={`Uwzględnij ${lead.nazwa}`}
          className="mt-1"
        />
        <ScoreRing score={lead.hot_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold">{lead.nazwa}</h4>
            <Badge variant="outline" className="text-[10px]">
              {INTENT_LABEL[lead.intent_category]}
            </Badge>
          </div>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">
            {lead.miasto ?? "—"} · {lead.email}
            {lead.website ? ` · ${lead.website}` : ""}
          </p>
          {lead.google_reviews_count && lead.google_rating ? (
            <p className="mt-1 text-xs">
              ⭐ {lead.google_rating.toFixed(1)} ({lead.google_reviews_count}{" "}
              opinii)
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.score_reasons.map((reason) => (
              <span
                key={reason}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px]"
              >
                {reason}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-primary"
            aria-expanded={open}
          >
            <Mail className="size-3.5" /> Podgląd e-maila
            <ChevronDown
              className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          {open && (
            <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-relaxed">
              <p className="font-medium">Temat: {mail.subject}</p>
              <p className="mt-2 whitespace-pre-wrap">{mail.body}</p>
              <p className="mt-3 whitespace-pre-wrap border-t border-white/10 pt-2 text-xs text-muted-foreground">
                {usFooterPreview(sender)}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function UsSniper({
  onGo,
}: {
  onGo?: ((tab: string) => void) | undefined;
}) {
  const { usPrice, setUsPrice } = useMarketSettings();
  const [nicheId, setNicheId] = useState<string>(US_PILLS[0]!.id);
  const [stateCode, setStateCode] = useState<string>("OK");
  const state = usState(stateCode) ?? US.states[0]!;
  const [city, setCity] = useState<string>(state.cities[0] ?? "");
  const [minScore, setMinScore] = useState<number>(US.defaultMinScore);
  const [priceDraft, setPriceDraft] = useState(usPrice);
  useEffect(() => setPriceDraft(usPrice), [usPrice]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SniperScanProgress | null>(null);
  const [result, setResult] = useState<SniperRunResult | null>(null);
  const [view, setView] = useState<"top" | "rejected">("top");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sender, setSender] = useState<Sender>({});
  const [adding, setAdding] = useState(false);
  const niche = usNiche(nicheId) ?? US.niches[0]!;

  useEffect(() => {
    emailBridge()
      ?.settings()
      .then((s) =>
        setSender({
          senderName: String(s["senderName"] ?? ""),
          company: String(s["company"] ?? ""),
          address: String(s["address"] ?? ""),
        }),
      )
      .catch(() => {});
  }, []);

  const scan = async () => {
    setRunning(true);
    setProgress(null);
    try {
      const existing = (await listEmails()).map((l) => l.email);
      let blocked: string[] = [];
      try {
        blocked = (await emailBridge()?.blocked?.()) ?? [];
      } catch {
        blocked = [];
      }
      const res = await runSniperScan(
        {
          nicheId,
          keyword: niche.query,
          pkd: "",
          city: `${city}, ${state.code}`,
          voivodeship: state.code,
          sources: { maps: true, olx: false, ceidg: false },
          market: "US",
        },
        {
          market: "US",
          minScoreThreshold: minScore,
          existingEmails: existing,
          blacklistEmails: blocked,
          onProgress: setProgress,
        },
      );
      setResult(res);
      setExcluded(new Set());
      setView("top");
      if (res.top.length === 0)
        toast.warning(
          "Żaden lead nie przekroczył progu. Obniż próg Hot Score albo zmień miasto.",
        );
      else
        toast.success(
          `Znaleziono ${res.top.length} firm · średni Hot Score ${res.funnel.averageScore}/100`,
        );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Skan nie powiódł się.");
    } finally {
      setRunning(false);
    }
  };

  const selected = result ? result.top.filter((l) => !excluded.has(l.id)) : [];

  const addToBase = async () => {
    if (!result || selected.length === 0) return;
    setAdding(true);
    try {
      const rows: EmailLead[] = selected.map((lead) => {
        const mail = buildUsEmail(lead, {
          trade: niche.trade,
          price: usPrice,
          ...(sender.senderName ? { senderName: sender.senderName } : {}),
        });
        const email = String(lead.email);
        return {
          id: lead.id,
          nazwa: lead.nazwa,
          email,
          telefon: null,
          channel_type: "EMAIL",
          miasto: lead.miasto ?? "",
          kategoria: niche.label,
          email_source_portal: "GOOGLE_MAPS_SITE",
          portal_label: "Mapy Google · USA",
          email_domain_type: FREE_MAILBOXES.has(email.split("@")[1] ?? "")
            ? "FREE_MAILBOX"
            : "CUSTOM_DOMAIN",
          website_issue_type: lead.intent_category,
          status: "nowy",
          market: "US",
          timezone: state.tz,
          strona: lead.website,
          mapy_url: lead.mapy_url,
          hot_score: lead.hot_score,
          intent_category: lead.intent_category,
          score_reasons: lead.score_reasons,
          email_prepared_subject: mail.subject,
          email_prepared_body: mail.body,
          email_prepared_signature: mail.signature,
        };
      });
      const res = await addEmails(rows);
      toast.success(
        `Dodano ${res.added} firm do bazy e-mail${res.skipped ? ` (${res.skipped} już było)` : ""}.${result.simulated ? " To dane symulowane z podglądu." : ""}`,
      );
      setExcluded(new Set(result.top.map((l) => l.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const rejectedGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of result?.rejected ?? []) {
      const key = (r.rejection_reason ?? "Inny powód")
        .replace(/\(\d+ < \d+\)|\(Hot Score \d+\)/, "")
        .trim();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  const f = result?.funnel;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.index / progress.total) * 100)
      : null;

  return (
    <div className="space-y-6 pb-28">
      <section className={`${GLASS} space-y-5 p-5`} aria-label="Skan rynku USA">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Crosshair className="size-5 text-amber-400" /> Snajper USA · Strony
            WWW
          </h3>
          <span className="text-xs text-muted-foreground">
            Źródło: Mapy Google · kontakt: e-mail ze strony firmy
          </span>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Nisza (klienci szukają tych usług w Google)
          </Label>
          <div className="flex flex-wrap gap-2">
            {US_PILLS.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setNicheId(pill.id)}
                aria-pressed={nicheId === pill.id}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  nicheId === pill.id
                    ? "border-amber-400/60 bg-amber-400/15 text-foreground"
                    : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
                }`}
              >
                {pill.label}
              </button>
            ))}
            <Select value={nicheId} onValueChange={setNicheId}>
              <SelectTrigger
                className="h-8 w-56 rounded-full text-xs"
                aria-label="Inna nisza"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {US.niches.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.label} ({n.query})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Stan</Label>
            <Select
              value={stateCode}
              onValueChange={(code) => {
                setStateCode(code);
                setCity(usState(code)?.cities[0] ?? "");
              }}
            >
              <SelectTrigger aria-label="Stan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {US.states.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Miasto</Label>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger aria-label="Miasto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="us-price" className="text-xs text-muted-foreground">
              Cena w e-mailu (po angielsku, puste = bez ceny)
            </Label>
            <Input
              id="us-price"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              onBlur={() => {
                if (priceDraft.trim() !== usPrice) setUsPrice(priceDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder={US.defaultPrice}
            />
          </div>
        </div>

        <div className="max-w-md space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              Minimalny Hot Score
            </Label>
            <span className="text-sm font-semibold tabular-nums text-amber-400">
              {minScore} pkt
            </span>
          </div>
          <Slider
            min={30}
            max={95}
            step={5}
            value={[minScore]}
            onValueChange={(v) => setMinScore(v[0] ?? US.defaultMinScore)}
            aria-label="Minimalny Hot Score"
          />
        </div>

        <Button
          size="lg"
          className="h-auto min-h-12 w-full whitespace-normal rounded-xl bg-amber-400 py-3 text-center text-base font-semibold text-black hover:bg-amber-300"
          disabled={running || !city}
          onClick={() => void scan()}
        >
          {running ? <Loader2 className="animate-spin" /> : <Crosshair />}
          🎯 Znajdź firmy ze słabą stroną w {city}, {state.code}
        </Button>
        {running && progress && (
          <div className="space-y-1.5" role="status">
            <p className="text-xs text-muted-foreground">{progress.label}</p>
            {pct !== null && <Progress value={pct} />}
          </div>
        )}
        {result?.notes.length ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {result.notes.map((n) => (
              <li key={n}>ℹ️ {n}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {f && result && (
        <section aria-label="Lejek odsiewu" className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <FunnelStep
              title="Etap 0: Pobrano z Map"
              value={f.totalScanned}
              note="firm w mieście"
            />
            <FunnelStep
              title="Sito 1: Adres e-mail firmy"
              value={f.passedStage1}
              note={`−${f.rejectedByStage[1]} bez e-maila / sieciówki / duplikaty`}
            />
            <FunnelStep
              title="Sito 2: Audyt strony"
              value={f.passedStage2}
              note={`−${f.rejectedByStage[2]} ma nowoczesną stronę`}
            />
            <FunnelStep
              title="Sito 3 & 4: Aktywność i opinie"
              value={f.passedStage4}
              note={`−${f.rejectedByStage[3] + f.rejectedByStage[4]} martwych wpisów`}
            />
            <FunnelStep
              title={`🔥 Sito 5: Top ${SNIPER_TOP_LIMIT} (Score ≥ ${minScore})`}
              value={f.finalTop50}
              note={`Średni Score: ${f.averageScore}/100`}
              highlight
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={view === "top" ? "secondary" : "ghost"}
              size="sm"
              className="h-auto min-h-8 whitespace-normal text-left"
              onClick={() => setView("top")}
            >
              <Eye /> Zakwalifikowane ({result.top.length})
            </Button>
            <Button
              variant={view === "rejected" ? "secondary" : "ghost"}
              size="sm"
              className="h-auto min-h-8 whitespace-normal text-left"
              onClick={() => setView("rejected")}
            >
              <Trash2 /> Odrzucone przez sito ({result.rejected.length})
            </Button>
            {result.simulated && (
              <Badge
                variant="outline"
                className="ml-auto self-center text-[11px]"
              >
                Podgląd: dane symulowane
              </Badge>
            )}
          </div>
        </section>
      )}

      {result && view === "top" && (
        <section className="space-y-3" aria-label="Zakwalifikowane firmy">
          {result.top.map((lead) => (
            <UsLeadCard
              key={lead.id}
              lead={lead}
              trade={niche.trade}
              price={usPrice}
              sender={sender}
              selected={!excluded.has(lead.id)}
              onToggle={(value) =>
                setExcluded((prev) => {
                  const next = new Set(prev);
                  if (value) next.delete(lead.id);
                  else next.add(lead.id);
                  return next;
                })
              }
            />
          ))}
        </section>
      )}

      {result && view === "rejected" && (
        <section className={`${GLASS} p-4`} aria-label="Powody odrzucenia">
          <h4 className="mb-2 text-sm font-semibold">Powody odrzucenia</h4>
          <ul className="space-y-1 text-sm">
            {rejectedGroups.map(([reason, count]) => (
              <li key={reason} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{reason}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && result.top.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div
            className={`${GLASS} flex flex-wrap items-center justify-between gap-3 !bg-background/95 p-3 shadow-2xl`}
          >
            <p className="text-xs text-muted-foreground">
              <Flame className="mr-1 inline size-3.5 text-amber-400" />
              Zaznaczono {selected.length} z {result.top.length} · wysyłka rusza
              z widoku E-mail (limit {US.email.dailyLimit} dziennie)
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="h-auto min-h-9 whitespace-normal"
                onClick={() => onGo?.("email")}
              >
                <Mail /> Otwórz widok E-mail
              </Button>
              <Button
                className="h-auto min-h-9 max-w-full whitespace-normal rounded-xl bg-amber-400 py-2 text-center font-semibold text-black hover:bg-amber-300"
                disabled={selected.length === 0 || adding}
                onClick={() => void addToBase()}
              >
                {adding ? <Loader2 className="animate-spin" /> : <Inbox />}
                Dodaj {selected.length} firm do bazy e-mail
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
