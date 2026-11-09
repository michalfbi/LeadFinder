import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  Clapperboard,
  Crosshair,
  Eye,
  Flame,
  Globe,
  Loader2,
  MessageSquareText,
  Rocket,
  Swords,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ALL_NICHES, findNiche } from "@/lib/niches-catalog";
import { VOIVODESHIPS, getVoivodeship } from "@/lib/voivodeships";
import {
  DEFAULT_GATES,
  SNIPER_DAILY_SMS_LIMIT,
  SNIPER_DEFAULT_MIN_SCORE,
  SNIPER_TOP_LIMIT,
  phoneKey9,
  pillsFor,
  runSniperScan,
  sniperBridge,
  sniperLeadToRow,
  sniperMessageFor,
  type SniperGates,
  type SniperLead,
  type SniperRunResult,
} from "@/lib/sniper-sieve";
import { smsSegments } from "@/lib/message-template";
import {
  addLeadsBulk,
  listLeads,
  updateLead,
  desktop as leadsBridge,
  type SniperScanProgress,
} from "@/lib/leads-store";
import { getBridge, type BulkResult } from "@/lib/bulk-send";
import { speedConfig } from "@/lib/sms-speed";
import { readSendSettings } from "@/lib/send-settings";
import { incrementSent, readSent } from "@/lib/sent-counter";
import { recordSentMessage } from "@/lib/region-stats";
import {
  OFFERS,
  OFFER_IDS,
  useOfferSettings,
  type OfferId,
} from "@/lib/offer-settings";

export const GLASS = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl";

type GateMeta = { key: keyof SniperGates; label: string; hint: string };

const GATES_BY_OFFER: Record<OfferId, GateMeta[]> = {
  website: [
    {
      key: "brokenSites",
      label: "Łowca Awarii 404/SSL",
      hint: "Martwe, niezabezpieczone i przestarzałe strony",
    },
    {
      key: "paidAds",
      label: "Płacący za reklamy OLX",
      hint: "Wyróżnione ogłoszenia bez własnej strony",
    },
    {
      key: "localLeaders",
      label: "Lokalni Liderzy 4.5⭐+",
      hint: "8–90 opinii w Google i brak porządnej strony",
    },
    {
      key: "newCeidg",
      label: "Nowe firmy CEIDG High-Ticket",
      hint: "Założone w ostatnich 14 dniach",
    },
  ],
  video_ads: [
    {
      key: "adPixels",
      label: "Inwestujący w reklamy",
      hint: "Piksel Meta lub Google Ads na stronie firmy",
    },
    {
      key: "paidAds",
      label: "Promowane ogłoszenia OLX",
      hint: "Płacą za wyróżnienie — mają budżet na promocję",
    },
    {
      key: "localLeaders",
      label: "Liderzy opinii 4.5⭐+",
      hint: "Min. 15 opinii — gotowy materiał do reklamy",
    },
    {
      key: "visualNiche",
      label: "Branże wizualne i high-ticket",
      hint: "Efekt pracy dobrze wygląda na wideo, klient dużo wart",
    },
  ],
};

const FUNNEL_COPY: Record<
  OfferId,
  { stage2: string; stage2Note: string; stage34: string; stage34Note: string }
> = {
  website: {
    stage2: "Sito 2: Audyt Tech/WWW",
    stage2Note: "ma nowoczesną stronę",
    stage34: "Sito 3 & 4: Budżet, Opinie & WHOIS",
    stage34Note: "martwych wpisów",
  },
  video_ads: {
    stage2: "Sito 2: Strona & Piksele reklamowe",
    stage2Note: "strona nie działa (→ oferta WWW)",
    stage34: "Sito 3 & 4: Budżet, Opinie & Konkurencja",
    stage34Note: "bez budżetu lub aktywności",
  },
};

export const INTENT_LABEL: Record<SniperLead["intent_category"], string> = {
  EXPIRED_OR_BROKEN_SITE: "🚨 Awaria strony",
  PAID_AD_NO_SITE: "💸 Płatne OLX bez strony",
  SOCIAL_OR_FREE_BUILDER: "📱 Tylko FB / kreator",
  HIGH_REVIEWS_NO_SITE: "⭐ Lider opinii bez strony",
  OUTDATED_NO_SSL_MOBILE: "🕰️ Stara strona / brak SSL",
  NEW_CEIDG_HIGH_TICKET: "🆕 Nowa firma CEIDG",
  NO_WEBSITE: "🚫 Brak strony",
  VIDEO_ACTIVE_ADVERTISER: "🎯 Inwestuje w reklamy",
  VIDEO_PAID_PROMO: "💸 Promowane OLX",
  VIDEO_REVIEW_LEADER: "⭐ Lider opinii",
  VIDEO_SOCIAL_ACTIVE: "📱 Aktywny w social media",
  VIDEO_VISUAL_NICHE: "🎬 Branża wizualna",
};

const SOURCE_LABEL: Record<SniperLead["source"], string> = {
  GOOGLE_MAPS: "Mapy Google",
  OLX: "OLX",
  CEIDG: "CEIDG",
};

/** Kolorowy pierścień Hot Score: szmaragd ≥85, złoto ≥75, reszta wyciszona. */
export function ScoreRing({ score }: { score: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const tone =
    score >= 85
      ? "text-emerald-400"
      : score >= 75
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <div
      className={`relative size-14 shrink-0 ${tone}`}
      aria-label={`Hot Score ${score} na 100`}
    >
      <svg viewBox="0 0 56 56" className="size-14 -rotate-90">
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="5"
        />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, score) / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-base font-semibold tabular-nums">{score}</span>
        <span className="text-[9px] text-muted-foreground">
          {score >= 85 ? "🔥" : "/100"}
        </span>
      </span>
    </div>
  );
}

export function FunnelStep({
  title,
  value,
  note,
  highlight,
}: {
  title: string;
  value: number;
  note: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`${GLASS} relative min-w-0 flex-1 p-4 ${highlight ? "border-amber-400/40 bg-amber-400/10" : ""}`}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function SniperLeadCard({
  lead,
  selected,
  onToggle,
  vocative,
  onVocative,
  optOut,
  price,
}: {
  lead: SniperLead;
  selected: boolean;
  onToggle: (value: boolean) => void;
  vocative: string | null;
  onVocative: (value: string) => void;
  optOut: boolean;
  price: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const message = useMemo(
    () => sniperMessageFor(lead, { optOut, vocativeOverride: vocative, price }),
    [lead, optOut, vocative, price],
  );
  const seg = smsSegments(message.body);
  return (
    <article className={`${GLASS} p-4 ${selected ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggle(v === true)}
          aria-label={`Uwzględnij ${lead.nazwa} w wysyłce`}
          className="mt-1"
        />
        <ScoreRing score={lead.hot_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold">{lead.nazwa}</h4>
            <Badge variant="secondary" className="text-[10px]">
              {SOURCE_LABEL[lead.source]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {INTENT_LABEL[lead.intent_category]}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lead.miasto ?? "—"} · {lead.phone_e164 ?? lead.telefon}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1">
              <UserRound className="size-3.5 text-muted-foreground" />
              {editing ? (
                <Input
                  autoFocus
                  defaultValue={vocative ?? ""}
                  placeholder="np. Panie Marku"
                  className="h-7 w-40 text-xs"
                  onBlur={(e) => {
                    onVocative(e.currentTarget.value.trim());
                    setEditing(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => setEditing(true)}
                >
                  Decydent: {vocative || "brak imienia (forma „Państwo”)"}
                </button>
              )}
            </span>
            {lead.suggested_free_domain && (
              <span className="flex items-center gap-1">
                <Globe className="size-3.5 text-muted-foreground" />
                {lead.suggested_free_domain}
              </span>
            )}
            {lead.local_competitor && (
              <span className="flex items-center gap-1">
                <Swords className="size-3.5 text-muted-foreground" />
                {lead.offer === "video_ads"
                  ? "Konkurent z pikselem reklamowym"
                  : "Konkurent"}
                : {lead.local_competitor}
              </span>
            )}
            {lead.google_reviews_count && lead.google_rating ? (
              <span>
                ⭐ {lead.google_rating?.toFixed(1).replace(".", ",")} (
                {lead.google_reviews_count} opinii)
              </span>
            ) : null}
          </div>
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
            <MessageSquareText className="size-3.5" /> Podgląd SMS
            <ChevronDown
              className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          {open && (
            <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{message.body}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {seg.chars} znaków · {seg.segments}{" "}
                {seg.segments === 1 ? "część" : "części"} SMS
                {seg.unicode
                  ? " (polskie znaki: 70 znaków na część)"
                  : ""} · {message.templateId}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function SniperTab() {
  const queryClient = useQueryClient();
  const {
    offer,
    meta: offerMeta,
    price,
    setOffer,
    setPrice,
  } = useOfferSettings();
  const pills = pillsFor(offer);
  const gateMeta = GATES_BY_OFFER[offer];
  const funnelCopy = FUNNEL_COPY[offer];
  const [nicheId, setNicheId] = useState<string>(
    pillsFor("website")[0]!.nicheId,
  );
  const [priceDraft, setPriceDraft] = useState(price);
  useEffect(() => setPriceDraft(price), [price]);
  const [voivodeshipId, setVoivodeshipId] = useState<string>("swietokrzyskie");
  const region = getVoivodeship(voivodeshipId) ?? VOIVODESHIPS[0]!;
  const [city, setCity] = useState<string>(region.cities[0] ?? "");
  const [minScore, setMinScore] = useState<number>(SNIPER_DEFAULT_MIN_SCORE);
  const [gates, setGates] = useState<SniperGates>(DEFAULT_GATES);
  const [sources, setSources] = useState({
    maps: true,
    olx: true,
    ceidg: true,
  });
  const [optOut, setOptOut] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SniperScanProgress | null>(null);
  const [result, setResult] = useState<SniperRunResult | null>(null);
  const [view, setView] = useState<"top" | "rejected">("top");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [vocatives, setVocatives] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const niche = findNiche(nicheId);

  // Zmiana oferty: wynik poprzedniego skanu dotyczył innej usługi, więc go chowamy,
  // a nisza przeskakuje na pierwszą pigułkę nowej oferty.
  const [shownOffer, setShownOffer] = useState<OfferId>(offer);
  useEffect(() => {
    if (offer === shownOffer) return;
    setShownOffer(offer);
    setResult(null);
    setNicheId(pillsFor(offer)[0]!.nicheId);
  }, [offer, shownOffer]);
  const ceidgAvailable = offer === "website";
  const activeSources = { ...sources, ceidg: sources.ceidg && ceidgAvailable };

  const scan = async () => {
    if (!niche) return;
    setRunning(true);
    setProgress(null);
    try {
      let blacklist: string[] = [];
      try {
        blacklist = (await leadsBridge()?.blacklist?.getAll?.()) ?? [];
      } catch {
        blacklist = [];
      }
      const existing = sniperBridge()
        ? (await listLeads()).map((l) => l.telefon ?? "")
        : [];
      const res = await runSniperScan(
        {
          nicheId,
          keyword: niche.searchQuery,
          pkd: niche.pkd,
          city,
          voivodeship: region.name,
          sources: activeSources,
          offer,
        },
        {
          offer,
          minScoreThreshold: minScore,
          gates,
          blacklist,
          existingPhones: existing,
          onProgress: setProgress,
        },
      );
      setResult(res);
      setExcluded(new Set());
      setVocatives({});
      setView("top");
      if (res.top.length === 0)
        toast.warning(
          "Żaden lead nie przekroczył progu. Obniż próg Hot Score lub zmień niszę.",
        );
      else
        toast.success(
          `Złota ${res.top.length}-tka gotowa · średni Hot Score ${res.funnel.averageScore}/100`,
        );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Skan Snajpera nie powiódł się.",
      );
    } finally {
      setRunning(false);
    }
  };

  const vocativeFor = (lead: SniperLead) =>
    lead.id in vocatives
      ? vocatives[lead.id] || null
      : (lead.owner_vocative ?? null);
  const selected = result ? result.top.filter((l) => !excluded.has(l.id)) : [];
  const sentToday = readSent().today;
  const dailyLeft = Math.max(0, SNIPER_DAILY_SMS_LIMIT - sentToday);
  const isDesktop = Boolean(getBridge()?.isDesktop);

  const addAndSend = async () => {
    setConfirmOpen(false);
    if (!result || selected.length === 0) return;
    if (result.simulated) {
      toast.info(
        "To podgląd z danymi symulowanymi — nic nie zapisuję do bazy i nic nie wysyłam.",
      );
      return;
    }
    const scannedAt = result.scannedAt;
    const rows = selected.map((lead) => {
      const vocative = vocativeFor(lead);
      return {
        ...sniperLeadToRow(lead, voivodeshipId, scannedAt),
        owner_vocative: vocative,
      };
    });
    const added = await addLeadsBulk(rows);
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    toast.success(
      `Dodano ${added.addedCount} leadów do bazy${added.skippedCount ? ` (${added.skippedCount} już było)` : ""}.`,
    );
    const bridge = getBridge();
    if (!bridge?.isDesktop) {
      toast.info(
        "Wysyłka SMS działa tylko w aplikacji na Macu — leady czekają w Mojej Bazie.",
      );
      return;
    }
    const addedKeys = new Set(added.addedPhones);
    const stored = await listLeads();
    const byKey = new Map(stored.map((l) => [phoneKey9(l.telefon), l]));
    const batch = selected
      .filter((lead) =>
        addedKeys.has(phoneKey9(lead.phone_e164 ?? lead.telefon)),
      )
      .slice(0, dailyLeft)
      .map((lead) => {
        const row = byKey.get(phoneKey9(lead.phone_e164 ?? lead.telefon));
        const msg = sniperMessageFor(lead, {
          optOut,
          vocativeOverride: vocativeFor(lead),
          price,
        });
        return row ? { lead, row, msg } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (batch.length === 0) {
      toast.warning(
        dailyLeft === 0
          ? "Dzisiejszy limit 50 SMS jest wykorzystany — wyślesz jutro z Mojej Bazy."
          : "Brak nowych numerów do wysłania.",
      );
      return;
    }
    const settings = readSendSettings();
    const pace = speedConfig("balance");
    setSending({ done: 0, total: batch.length });
    let results: BulkResult[] = [];
    try {
      results =
        (await bridge.sendBulk(
          batch.map((b) => ({
            id: b.row.id,
            phone: (b.row.telefon ?? "").replace(/\s+/g, ""),
            body: b.msg.body,
            templateId: b.msg.templateId,
            signature: b.msg.signature,
          })),
          () => setSending((s) => (s ? { ...s, done: s.done + 1 } : s)),
          {
            ...pace,
            dualSim: settings.dualSim,
            sim1Name: settings.sim1Name,
            sim2Name: settings.sim2Name,
            forceSend: !settings.nightLock,
          },
        )) ?? [];
    } catch {
      toast.error("Wysyłka przerwana — sprawdź kolejkę na Macu.");
      setSending(null);
      return;
    }
    const sentAt = new Date().toISOString();
    for (const r of results.filter((x) => x.ok)) {
      const item = batch.find((b) => b.row.id === r.id);
      if (!item) continue;
      recordSentMessage({
        nisza: item.row.nisza ?? null,
        wojewodztwo: item.row.wojewodztwo ?? null,
        miasto: item.row.miasto ?? null,
        adres: item.row.adres ?? null,
      });
      incrementSent();
      await updateLead(item.row.id, {
        status: "wyslano_wiadomosc",
        sms_sent_at: sentAt,
        sms_exact_text: item.msg.body,
        sms_template_id: item.msg.templateId,
        sms_combination_signature: item.msg.signature,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    setSending(null);
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    if (failed)
      toast.warning(
        `Wysłano ${ok} z ${batch.length} — ${failed} bez powodzenia.`,
      );
    else toast.success(`Wysłano ${ok} precyzyjnych SMS-ów.`);
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
  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.index / progress.total) * 100)
      : null;

  return (
    <div className="space-y-6 pb-28">
      <section
        className={`${GLASS} space-y-5 p-5`}
        aria-label="Panel sterowania sitem"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Crosshair className="size-5 text-amber-400" /> Sniper Control Deck
          </h3>
          <span className="text-xs text-muted-foreground">
            Max {SNIPER_TOP_LIMIT} leadów · limit {SNIPER_DAILY_SMS_LIMIT} SMS
            dziennie · dziś wysłano {sentToday}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Czego szukamy — oferta
            </Label>
            <div
              className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
              role="group"
              aria-label="Oferta"
            >
              {OFFER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={offer === id}
                  disabled={running}
                  onClick={() => setOffer(id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
                    offer === id
                      ? "bg-amber-400 font-semibold text-black"
                      : "text-muted-foreground hover:bg-white/10"
                  }`}
                >
                  {id === "video_ads" ? (
                    <Clapperboard className="size-4" />
                  ) : (
                    <Globe className="size-4" />
                  )}
                  {OFFERS[id].label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="sniper-price"
              className="text-xs text-muted-foreground"
            >
              Cena w SMS-ie ({offerMeta.label}) — w nawiasie, puste = bez ceny
            </Label>
            <Input
              id="sniper-price"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              onBlur={() => {
                if (priceDraft.trim() !== price) setPrice(offer, priceDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              placeholder={offerMeta.defaultPrice}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            {offer === "video_ads"
              ? "Nisza wizualna / High-Ticket"
              : "Nisza High-Ticket"}
          </Label>
          <div className="flex flex-wrap gap-2">
            {pills.map((pill) => (
              <button
                key={pill.nicheId}
                type="button"
                onClick={() => setNicheId(pill.nicheId)}
                aria-pressed={nicheId === pill.nicheId}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  nicheId === pill.nicheId
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
                <SelectValue placeholder="Inna nisza…" />
              </SelectTrigger>
              <SelectContent>
                {ALL_NICHES.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.icon} {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Województwo</Label>
            <Select
              value={voivodeshipId}
              onValueChange={(id) => {
                setVoivodeshipId(id);
                setCity(getVoivodeship(id)?.cities[0] ?? "");
              }}
            >
              <SelectTrigger aria-label="Województwo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOIVODESHIPS.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
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
                {region.cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Źródła</Label>
            <div className="flex h-9 items-center gap-4 text-xs">
              {(["maps", "olx", "ceidg"] as const).map((key) => (
                <label
                  key={key}
                  className={`flex items-center gap-1.5 ${key === "ceidg" && !ceidgAvailable ? "opacity-50" : ""}`}
                  title={
                    key === "ceidg" && !ceidgAvailable
                      ? "Przy reklamach wideo liczą się firmy z budżetem, a nie świeże rejestracje"
                      : undefined
                  }
                >
                  <Switch
                    checked={activeSources[key]}
                    disabled={key === "ceidg" && !ceidgAvailable}
                    onCheckedChange={(v) =>
                      setSources((s) => ({ ...s, [key]: v }))
                    }
                    aria-label={
                      key === "maps" ? "Mapy Google" : key.toUpperCase()
                    }
                  />
                  {key === "maps" ? "Mapy" : key.toUpperCase()}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Minimalny Próg Gorącego Leada (Hot Score)
              </Label>
              <span className="text-sm font-semibold tabular-nums text-amber-400">
                {minScore} pkt
              </span>
            </div>
            <Slider
              min={50}
              max={95}
              step={5}
              value={[minScore]}
              onValueChange={(v) =>
                setMinScore(v[0] ?? SNIPER_DEFAULT_MIN_SCORE)
              }
              aria-label="Minimalny Hot Score"
            />
            <label className="flex items-center gap-2 pt-2 text-xs">
              <Switch
                checked={optOut}
                onCheckedChange={setOptOut}
                aria-label="Zdanie o rezygnacji"
              />
              Dopisz „Jeśli nie, wystarczy odpisać NIE” (zalecane)
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {gateMeta.map((g) => (
              <label
                key={g.key}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <Switch
                  checked={gates[g.key]}
                  onCheckedChange={(v) =>
                    setGates((s) => ({ ...s, [g.key]: v }))
                  }
                  aria-label={g.label}
                />
                <span>
                  <span className="block text-sm font-medium">{g.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {g.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Button
          size="lg"
          className="h-auto min-h-12 w-full whitespace-normal rounded-xl bg-amber-400 py-3 text-center text-base font-semibold text-black hover:bg-amber-300"
          disabled={
            running ||
            !city ||
            !(activeSources.maps || activeSources.olx || activeSources.ceidg)
          }
          onClick={() => void scan()}
        >
          {running ? <Loader2 className="animate-spin" /> : <Crosshair />}
          🎯 Uruchom 5-Stopniowe Sito i Wybierz Złotą 50-tkę · {
            offerMeta.icon
          }{" "}
          {offerMeta.label}
        </Button>
        {running && progress && (
          <div className="space-y-1.5" role="status">
            <p className="text-xs text-muted-foreground">{progress.label}</p>
            {progressPct !== null && <Progress value={progressPct} />}
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

      {f && (
        <section aria-label="Lejek odsiewu" className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <FunnelStep
              title="Etap 0: Pobrano surowych"
              value={f.totalScanned}
              note={
                ceidgAvailable ? "firm z Map, OLX i CEIDG" : "firm z Map i OLX"
              }
            />
            <FunnelStep
              title="Sito 1: Komórka Decydenta"
              value={f.passedStage1}
              note={`−${f.rejectedByStage[1]} stacjonarnych / korpo / duplikatów`}
            />
            <FunnelStep
              title={funnelCopy.stage2}
              value={f.passedStage2}
              note={`−${f.rejectedByStage[2]} ${funnelCopy.stage2Note}`}
            />
            <FunnelStep
              title={funnelCopy.stage34}
              value={f.passedStage4}
              note={`−${f.rejectedByStage[3] + f.rejectedByStage[4]} ${funnelCopy.stage34Note}`}
            />
            <FunnelStep
              title={`🔥 Sito 5: ZŁOTA ${SNIPER_TOP_LIMIT}-TKA (Score ≥ ${minScore})`}
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
              <Eye /> Pokaż Złotą {SNIPER_TOP_LIMIT}-tkę ({result.top.length})
            </Button>
            <Button
              variant={view === "rejected" ? "secondary" : "ghost"}
              size="sm"
              className="h-auto min-h-8 whitespace-normal text-left"
              onClick={() => setView("rejected")}
            >
              <Trash2 /> Pokaż odrzucone przez sito ({result.rejected.length} –
              sprawdź powody odrzucenia)
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
        <section className="space-y-3" aria-label="Złota 50-tka">
          {result.top.map((lead) => (
            <SniperLeadCard
              key={lead.id}
              lead={lead}
              optOut={optOut}
              price={price}
              selected={!excluded.has(lead.id)}
              onToggle={(value) =>
                setExcluded((prev) => {
                  const next = new Set(prev);
                  if (value) next.delete(lead.id);
                  else next.add(lead.id);
                  return next;
                })
              }
              vocative={vocativeFor(lead)}
              onVocative={(value) =>
                setVocatives((prev) => ({ ...prev, [lead.id]: value }))
              }
            />
          ))}
        </section>
      )}

      {result && view === "rejected" && (
        <section className="space-y-4" aria-label="Odrzucone przez sito">
          <div className={`${GLASS} p-4`}>
            <h4 className="mb-2 text-sm font-semibold">Powody odrzucenia</h4>
            <ul className="space-y-1 text-sm">
              {rejectedGroups.map(([reason, count]) => (
                <li key={reason} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{reason}</span>
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={`${GLASS} divide-y divide-white/5`}>
            {result.rejected.slice(0, 200).map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {lead.nazwa}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {SOURCE_LABEL[lead.source]} · sito{" "}
                    {lead.sieve_stage_reached}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {lead.rejection_reason}
                </span>
              </div>
            ))}
            {result.rejected.length > 200 && (
              <p className="px-4 py-2.5 text-xs text-muted-foreground">
                …i {result.rejected.length - 200} kolejnych
              </p>
            )}
          </div>
        </section>
      )}

      {result && result.top.length > 0 && (
        <div className="sticky bottom-4 z-30">
          <div
            className={`${GLASS} flex flex-wrap items-center justify-between gap-3 !bg-background/95 p-3 shadow-2xl`}
          >
            <p className="text-xs text-muted-foreground">
              <Flame className="mr-1 inline size-3.5 text-amber-400" />
              Zaznaczono {selected.length} z {result.top.length} · dziś zostało{" "}
              {dailyLeft} z {SNIPER_DAILY_SMS_LIMIT} SMS
              {sending ? ` · wysyłka ${sending.done}/${sending.total}` : ""}
            </p>
            <Button
              className="h-auto min-h-9 max-w-full whitespace-normal rounded-xl bg-amber-400 py-2 text-center font-semibold text-black hover:bg-amber-300"
              disabled={selected.length === 0 || sending !== null}
              onClick={() => setConfirmOpen(true)}
            >
              {sending ? <Loader2 className="animate-spin" /> : <Rocket />}
              🚀 Dodaj Złotą 50-tkę do Bazy i Uruchom Precyzyjną Wysyłkę (Limit:{" "}
              {SNIPER_DAILY_SMS_LIMIT} SMS / dzień)
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potwierdź precyzyjną wysyłkę</AlertDialogTitle>
            <AlertDialogDescription>
              {result?.simulated
                ? "To podgląd z danymi symulowanymi — nic nie zostanie zapisane ani wysłane."
                : isDesktop
                  ? `Dodam ${selected.length} leadów do Mojej Bazy i wyślę ${Math.min(selected.length, dailyLeft)} SMS-ów w tempie „Balans” (12–20 s odstępu), z blokadą godzin pracy. Każda treść jest dokładnie taka jak w podglądzie.`
                  : `Dodam ${selected.length} leadów do Mojej Bazy. Wysyłka SMS działa tylko w aplikacji na Macu.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={() => void addAndSend()}>
              {isDesktop && !result?.simulated ? "Dodaj i wyślij" : "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
