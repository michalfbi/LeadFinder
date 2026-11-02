import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ban, BarChart3, Columns3, List as ListIcon, Trophy, Sparkles } from "lucide-react";
import { LeadKanban } from "@/components/lead-kanban";
import { type BriefingFilter, MorningBriefing, matchesBriefing } from "@/components/morning-briefing";
import { NicheStatsTab } from "@/components/niche-stats";
import { AnalyticsTab } from "@/components/analytics-tab";
import { AutopilotTab } from "@/components/autopilot-tab";
import { AppSidebar, APP_DESTINATIONS } from "@/components/app-sidebar";
import { openDesktopWidget } from "@/lib/widget-bridge";
import { NichePicker } from "@/components/niche-picker";
import { nicheValue, type NicheItem } from "@/lib/niches-catalog";
import { onRemoteCommand, describeRemoteCommand, reportRemoteResult, type RemoteCommandEnvelope } from "@/lib/remote-command";
import {
  Database,
  MapPin,
  Phone,
  Search,
  Star,
  Trash2,
  Radar,
  SlidersHorizontal,
  Globe,
  PhoneCall,
  Check,
  Undo2,
  StickyNote,
  MessageSquare,
  Send,
  Loader2,
  Square,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Map,
  MailCheck,
  ShieldAlert,
  Building2,
  ExternalLink,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IssueTypePicker } from "@/components/issue-type-picker";
import { IssueTemplatesEditor } from "@/components/issue-templates-editor";
import {
  ISSUE_META,
  ISSUE_TYPES,
  buildIssueMessage,
  issueTypeFromText,
  issueTypeOf,
  useIssueTemplates,
  type WebsiteIssueType,
} from "@/lib/issue-templates";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,

  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listLeads,
  insertLeads,
  addLeadsBulk,
  updateLead,
  deleteLead,
  blacklistPhone,
  isDesktop,
  desktop,
  type LeadRow,
} from "@/lib/leads-store";
import { exportLeadsCsv } from "@/lib/csv";
import { parsePhoneList } from "@/lib/phone-import";
import { Progress } from "@/components/ui/progress";
import { ScanProgressPanel } from "@/components/scan-progress";
import type { CeidgProgress } from "@/lib/leads-store";
import { type ScanProgress, scanLocally, searchCeidg, searchOlx, type PlaceLead } from "@/lib/places-scan";
import type { OlxProgress } from "@/lib/leads-store";
import { validateAndFormatPolishMobile } from "@/lib/phone-validator";

// Mega-słownik 40 nisz w 8 kategoriach — współdzielony z Electronem i pilotem Telegram
// (src/lib/niches-catalog.ts + niches-catalog.json). Kliknięcie pigułki wypełnia frazę
// (Mapy/OLX) lub kody PKD (CEIDG).

function leadRow(
  lead: PlaceLead,
  status: string,
  meta?: { nisza?: string | null; wojewodztwo?: string | null },
) {
  return {
    nazwa: lead.name,
    ocena: lead.rating,
    liczba_opinii: lead.userRatingCount,
    adres: lead.address,
    telefon: lead.phone,
    zrodlo: lead.source ?? "Google Maps",
    nip: lead.nip ?? null,
    regon: lead.regon ?? null,
    email: lead.email ?? null,
    wlasciciel: lead.owner ?? null,
    imie: lead.firstName ?? null,
    strona: lead.website ?? null,
    strona_problem: lead.websiteIssue ?? null,
    website_issue_type: lead.issueType ?? issueTypeFromText(lead.websiteIssue),
    zrodlo_telefonu: lead.phoneSource ?? null,
    status,
    miasto: lead.city,
    kategoria: lead.category,
    nisza: meta?.nisza?.trim() || null,
    wojewodztwo: meta?.wojewodztwo || null,
    godziny: lead.hours.length > 0 ? lead.hours.join("\n") : null,
    mapy_url: lead.mapsUri ?? lead.olxUrl ?? null,
    opis: lead.summary,
  };
}

import { VOIVODESHIPS, getVoivodeship } from "@/lib/voivodeships";
import {
  DEFAULT_TEMPLATE,
  NEUTRAL_TEMPLATE,
  buildMessage,
  buildMessageWithSignature,
  countSpintaxCombinations,
  fillTemplate,
  parseSpintax,
  phoneKey,
  useMessageTemplate,
  useSmsHref,
} from "@/lib/message-template";
import { websiteProblemPhrase } from "@/lib/message-template";
import { WebsiteIssueBadge } from "@/components/website-issue-badge";
import { initPrefsSync } from "@/lib/prefs-sync";
import { addScan, useScanHistory } from "@/lib/scan-history";
import { useSendSettings, readSendSettings } from "@/lib/send-settings";
import { enrichLead } from "@/lib/enrich";
import { checkDomainsBulk, type DomainProgress } from "@/lib/domain-check";
import {
  certainGender,
  certainPersonFromCompany,
  genderLabel,
  greeting,
  type Gender,
} from "@/lib/person-name";
import {
  deleteAllLeads,
  exportBackup,
  importLeads,
  purgeLeadsWithWebsite,
  messagesHistoryStatus,
  verifyPhone,
} from "@/lib/leads-store";
import { incrementSent, resetSent, useSentCounter } from "@/lib/sent-counter";
import {
  recordSentMessage,
  registerNiche,
  useRegionStats,
  regionNameOf,
} from "@/lib/region-stats";
import { PolandMap, REGION_SHAPES } from "@/components/poland-map";
import {
  getBridge,
  useIsDesktopApp,
  type BulkQueueStatus,
  type BulkResult,
} from "@/lib/bulk-send";
import { SmsSpeedPanel } from '@/components/sms-speed-panel';
import { SniperTab } from "@/components/sniper-tab";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LeadFinder B2B — firmy bez strony www" },
      {
        name: "description",
        content:
          "Znajdź lokalne firmy z wysokimi ocenami w Google Maps, które nie mają jeszcze strony internetowej, i zapisz je jako leady.",
      },
      { property: "og:title", content: "LeadFinder B2B — firmy bez strony www" },
      {
        property: "og:description",
        content:
          "Wyszukiwarka leadów B2B: świetne opinie, brak strony internetowej. Zapisuj i zarządzaj swoją bazą.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});




function CeidgKeyCard() {
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    desktop()
      ?.settings.get()
      .then((s) => {
        setKey(s.ceidgApiKey ?? "");
        setSavedKey(s.ceidgApiKey ?? "");
      })
      .catch(() => {});
  }, []);
  const save = async () => {
    const bridge = desktop();
    if (!bridge) {
      toast.error("Ustawienia działają tylko w aplikacji na Maca.");
      return;
    }
    setSaving(true);
    try {
      await bridge.settings.set({ ceidgApiKey: key.trim() });
      setSavedKey(key.trim());
      toast.success(key.trim() ? "Klucz CEIDG zapisany" : "Klucz CEIDG usunięty");
    } catch {
      toast.error("Nie udało się zapisać klucza");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="glass border-0">
      <CardHeader>
        <CardTitle className="text-base">Klucz API CEIDG</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Potrzebny do wyszukiwania nowo założonych firm. Klucz jest darmowy — wnioskuje się o
          niego na stronie dane.biznes.gov.pl. Zapisuje się tylko na tym komputerze.
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            className="glass-soft rounded-xl border-0"
            placeholder="Wklej klucz API CEIDG"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button className="rounded-xl" disabled={saving || key.trim() === savedKey} onClick={save}>
            Zapisz
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {savedKey ? "Klucz jest zapisany." : "Brak zapisanego klucza."}
        </p>
      </CardContent>
    </Card>
  );
}

function SettingsTab() {
  const [cache, setCache] = useState<{ available: boolean; entries: number; hits: number } | null>(
    null,
  );
  const [history, setHistory] = useState<{ available: boolean; error?: string } | null>(null);

  const refreshCache = () => {
    const bridge = desktop();
    if (!bridge?.cache) return;
    bridge.cache
      .stats()
      .then(setCache)
      .catch(() => setCache(null));
  };

  const refreshHistory = () => {
    messagesHistoryStatus()
      .then(setHistory)
      .catch(() => setHistory(null));
  };

  useEffect(() => {
    if (!desktop()) return;
    refreshCache();
    refreshHistory();
  }, []);

  const clearCache = async () => {
    const bridge = desktop();
    if (!bridge?.cache) return;
    const res = await bridge.cache.clear();
    if (res.ok) toast.success("Pamięć podręczna wyczyszczona");
    else toast.error("Nie udało się wyczyścić pamięci podręcznej");
    refreshCache();
  };

  return (
    <div className="space-y-4">
      <CeidgKeyCard />
      <Card className="glass border-0">
        <CardHeader>
          <CardTitle className="text-base">Ustawienia aplikacji</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Wyszukiwanie firm przegląda publiczne Mapy Google w ukrytym oknie — nie
            potrzebujesz żadnych kluczy API. Wyszukiwanie i baza leadów działają lokalnie na tym
            komputerze.
          </p>
        </CardContent>
      </Card>

      <Card className="glass border-0">
        <CardHeader>
          <CardTitle className="text-base">Pamięć podręczna wyników</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Wyniki skanowania zapisują się na tym komputerze na 30 dni. Powtórne skanowanie tej
            samej branży i miasta nie kosztuje nic — dane wracają z dysku.
          </p>
          {cache ? (
            cache.available ? (
              <p className="text-sm">
                Zapisanych zapytań: <span className="text-foreground">{cache.entries}</span> —
                pobranych z dysku w tej sesji: {cache.hits}
              </p>
            ) : (
              <p className="text-sm text-amber-500">
                Pamięć podręczna jest niedostępna (brak dostępu do zapisu na dysku). Skanowanie
                działa normalnie, tylko bez oszczędzania zapytań.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Pamięć podręczna działa w aplikacji na Maca.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl" onClick={clearCache}>
              Wyczyść pamięć podręczną
            </Button>
            <Button variant="ghost" className="rounded-xl" onClick={refreshCache}>
              Odśwież
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-0">
        <CardHeader>
          <CardTitle className="text-base">Historia Wiadomości</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Przed wysłaniem SMS-a aplikacja sprawdza, czy z tym numerem masz już rozmowę w
            aplikacji Wiadomości. Jeśli tak — wiadomość nie idzie drugi raz.
          </p>
          {history ? (
            history.available ? (
              <p className="text-sm text-emerald-500">
                Historia Wiadomości: dostępna — powtórki są blokowane automatycznie.
              </p>
            ) : (
              <p className="text-sm text-amber-500">
                Historia Wiadomości: brak dostępu. Włącz „Pełny dostęp do dysku” dla LeadFinder w
                Ustawieniach systemowych → Prywatność i bezpieczeństwo, a potem uruchom aplikację
                ponownie. Wysyłka działa dalej, ale sprawdzamy tylko własną bazę.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Sprawdzanie historii działa w aplikacji na Maca.
            </p>
          )}
          <Button variant="ghost" className="rounded-xl" onClick={refreshHistory}>
            Odśwież
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function useLeads() {
  return useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      return listLeads();
    },
  });
}

function useLeadStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await updateLead(id, { status });
      return status;
    },
    onSuccess: (status) => {
      toast.success(
        status === "do_dzwonienia"
          ? "Dodano do listy „Do dzwonienia”"
          : status === "zadzwoniono"
            ? "Oznaczono jako obdzwonione"
            : status === "do_oferty"
              ? "Dodano do listy „Do wysłania oferty”"
              : status === "oferta_wyslana"
                ? "Oznaczono jako oferta wysłana"
                : "Przeniesiono leada",
      );
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function useBlockLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lead: { id: string; telefon: string | null }) => {
      if (!lead.telefon) throw new Error("Ten lead nie ma numeru telefonu");
      await blacklistPhone(lead.telefon);
      await deleteLead(lead.id);
    },
    onSuccess: () => {
      toast.success("Numer dodany do czarnej listy. Lead usunięty.");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function LeadNotes({ lead }: { lead: LeadRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(lead.notatki ?? "");

  const save = useMutation({
    mutationFn: async (value: string) => {
      await updateLead(lead.id, { notatki: value.trim() === "" ? null : value });
    },
    onSuccess: () => {
      toast.success("Notatka zapisana");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasNote = !!lead.notatki && lead.notatki.trim() !== "";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setText(lead.notatki ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          aria-label="Notatka o leadzie"
          title={hasNote ? lead.notatki! : "Dodaj notatkę"}
        >
          <StickyNote
            className={hasNote ? "size-4 text-primary" : "size-4 text-muted-foreground"}
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="glass rounded-3xl border-0">
        <DialogHeader>
          <DialogTitle>Notatka — {lead.nazwa}</DialogTitle>
          <DialogDescription>
            Zapisz, co zaproponować tej firmie przy pisaniu wiadomości lub rozmowie.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Np. brak strony, ma tylko Facebooka — zaproponować wizytówkę + formularz kontaktowy..."
          className="rounded-2xl"
        />
        <DialogFooter>
          <Button
            className="rounded-xl"
            disabled={save.isPending}
            onClick={() => save.mutate(text)}
          >
            Zapisz notatkę
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function Index() {
  // Na Macu wczytujemy ustawienia z dysku i włączamy ich automatyczny zapis.
  useEffect(() => {
    initPrefsSync();
  }, []);
  // Monitor w tle (co 5 min) zgłasza nowe odpowiedzi — odświeżamy listę.
  const rootQueryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("search");
  useEffect(() => {
    const lf = (window as unknown as { leadfinder?: { onLeadsChanged?: (cb: () => void) => () => void } }).leadfinder;
    return lf?.onLeadsChanged?.(() => rootQueryClient.invalidateQueries({ queryKey: ["leads"] }));
  }, [rootQueryClient]);

  const { data: leads = [] } = useLeads();
  const hot = leads.filter(l => l.status === "odpisal").length;
  const destination = APP_DESTINATIONS.find(d => d.id === activeTab);
  const subviews = activeTab === "base" || activeTab === "calls" ? [
    { id: "base", label: "Cała baza" }, { id: "calls", label: "Do dzwonienia" },
  ] : activeTab === "analytics" || activeTab === "map" || activeTab === "niches" ? [
    { id: "analytics", label: "Przegląd" }, { id: "map", label: "Mapa Polski" }, { id: "niches", label: "Statystyki nisz" },
  ] : activeTab === "message" || activeTab === "offer" ? [
    { id: "message", label: "Szablony & Wysyłka" }, { id: "offer", label: "Do wysłania oferty" },
  ] : [];
  const navigationGroup = activeTab === "calls" ? "base" : ["map", "niches"].includes(activeTab) ? "analytics" : activeTab === "offer" ? "message" : activeTab;

  // Telefon jako pilot TV: komendy z Telegrama (lub symulatora) sterują ekranem Maca.
  const [remoteCmd, setRemoteCmd] = useState<RemoteCommandEnvelope | null>(null);
  const [pilotNote, setPilotNote] = useState<string | null>(null);
  useEffect(() => onRemoteCommand(cmd => {
    setRemoteCmd({ cmd, at: Date.now() });
    setActiveTab("search");
    setPilotNote(describeRemoteCommand(cmd));
  }), []);
  useEffect(() => {
    if (!pilotNote) return;
    const t = setTimeout(() => setPilotNote(null), 12000);
    return () => clearTimeout(t);
  }, [pilotNote]);

  return (
    <main className="app-shell bg-macos-canvas text-foreground">
      <AppSidebar active={navigationGroup} onNavigate={setActiveTab} hot={hot} />
      <div className="app-workspace min-w-0">
        {pilotNote && (
          <div role="status" className="apple-glass-panel fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium shadow-lg">
            <span className="size-2 rounded-full bg-chart-2 motion-safe:animate-pulse" />
            📱 Pilot Mobilny aktywny: {pilotNote}
          </div>
        )}
        <header className="workspace-header flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />Kanał SMS<span className="text-border">/</span>Przestrzeń robocza</p>
            <h2 className="text-2xl font-semibold">{destination?.label ?? (navigationGroup === "base" ? "Moja Baza" : navigationGroup === "analytics" ? "Analityka" : "Szablony & Wysyłka")}</h2>
          </div>
          <div className="flex items-center gap-3"><span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{leads.length} kontaktów</span><SentCounterBadge /></div>
        </header>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="workspace-views">
          {subviews.length > 0 && <TabsList className="apple-segment mb-6 h-auto flex w-fit max-w-full flex-wrap">{subviews.map(view => <TabsTrigger key={view.id} value={view.id}>{view.label}</TabsTrigger>)}</TabsList>}
          <TabsContent value="search" forceMount className="data-[state=inactive]:hidden">
            <SearchTab onGoToTab={setActiveTab} remoteCommand={remoteCmd} />
          </TabsContent>
          <TabsContent value="sniper" forceMount className="data-[state=inactive]:hidden"><SniperTab /></TabsContent>
          <TabsContent value="base"><BaseTab /></TabsContent>
          <TabsContent value="calls"><CallListTab /></TabsContent>
          <TabsContent value="offer"><OfferTab /></TabsContent>
          <TabsContent value="map"><MapTab /></TabsContent>
          <TabsContent value="niches"><NichesTab /></TabsContent>
          <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
          <TabsContent value="autopilot" forceMount className="data-[state=inactive]:hidden"><AutopilotTab onRemoteCommand={cmd => {
            setRemoteCmd({ cmd, at: Date.now() });
            setActiveTab("search");
            setPilotNote(describeRemoteCommand(cmd));
          }} /></TabsContent>
          <TabsContent value="message"><MessageTab /></TabsContent>
          <TabsContent value="settings">
            <section className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6"><div><h3 className="text-lg font-semibold">Widget pulpitowy</h3><p className="mt-1 text-sm text-muted-foreground">LeadFinder Pro</p></div><Button variant="outline" onClick={() => void openDesktopWidget().catch(() => toast.error("Nie udało się otworzyć widgetu."))}><ExternalLink />Otwórz Widget</Button></section>
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

/** Historia ostatnich wyszukiwań — widać, co i gdzie było już przeskanowane. */
function ScanHistoryPanel() {
  const { entries, clear } = useScanHistory();
  if (entries.length === 0) return null;
  return (
    <Card className="glass rounded-3xl border-0 shadow-none">
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Ostatnie wyszukiwania</h3>
          <Button variant="ghost" size="sm" className="rounded-xl" onClick={clear}>
            Wyczyść
          </Button>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2">
              <span className="text-foreground">
                {e.branza} — {e.wojewodztwo}
              </span>
              <span>
                {e.wyniki} firm / {e.miasta} miast ·{" "}
                {new Date(e.data).toLocaleString("pl-PL", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Sformatowany numer telefonu z zieloną odznaką „Komórkowy” (walidacja libphonenumber-js). */
function PhoneLine({ phone }: { phone: string }) {
  const check = validateAndFormatPolishMobile(phone);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{check.formatted ?? phone}</span>
      {check.isValidMobile && (
        <Badge
          variant="outline"
          className="rounded-full border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
        >
          Komórkowy
        </Badge>
      )}
    </span>
  );
}

function SearchTab({ onGoToTab, remoteCommand }: { onGoToTab?: (tab: string) => void; remoteCommand?: RemoteCommandEnvelope | null } = {}) {
  const [mode, setMode] = useState<"maps" | "ceidg" | "olx">("maps");
  const [keyword, setKeyword] = useState("");
  const [pkd, setPkd] = useState("");
  const [days, setDays] = useState("7");
  const [deepHarvest, setDeepHarvest] = useState(false);
  const [auditSites, setAuditSites] = useState(false);
  const [olxDoubleCheck, setOlxDoubleCheck] = useState(false);
  const [harvestProgress, setHarvestProgress] = useState<CeidgProgress | null>(null);
  const [olxProgress, setOlxProgress] = useState<OlxProgress | null>(null);
  const [voivodeship, setVoivodeship] = useState("");
  const [maxCities, setMaxCities] = useState(25);

  const [results, setResults] = useState<PlaceLead[] | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    citiesScanned: 0,
    requests: 0,
    cached: 0,
    regionName: "",
    rejectedPhones: 0,
  });
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const queryClient = useQueryClient();
  const { data: baseLeads } = useLeads();

  // Zestaw firm już zapisanych w bazie — po numerze telefonu i po nazwie.
  const inBaseKeys = useMemo(() => {
    const set = new Set<string>();
    for (const l of baseLeads ?? []) {
      const tel = phoneKey(l.telefon);
      if (tel) set.add(`t:${tel}`);
      set.add(`n:${l.nazwa.toLowerCase().trim()}`);
    }
    return set;
  }, [baseLeads]);

  const isInBase = (lead: PlaceLead) =>
    inBaseKeys.has(`t:${phoneKey(lead.phone)}`) && phoneKey(lead.phone) !== ""
      ? true
      : inBaseKeys.has(`n:${lead.name.toLowerCase().trim()}`);

  const niche =
    mode === "ceidg"
      ? pkd.trim()
        ? `CEIDG ${pkd.trim()}`
        : "CEIDG nowe firmy"
      : mode === "olx"
        ? `OLX ${keyword.trim()}`
        : keyword.trim();

  const region = getVoivodeship(voivodeship);
  const cityCount = region ? Math.min(maxCities, region.cities.length) : 0;

  const search = useMutation({
    mutationFn: () => {
      if (!isDesktop()) {
        throw new Error("Skanowanie działa tylko w aplikacji na Maca.");
      }
      setProgress(null);
      return scanLocally(
        {
          keyword: keyword.trim(),
          voivodeship,
          maxCities,
          auditSites,
        },
        (p) => setProgress(p),
      );
    },

    onSuccess: (data) => {
      registerNiche(niche);
      setResults(data.leads);
      setSelected(new Set(data.leads.filter((l) => !isInBase(l)).map((l) => l.id)));
      setStats({
        total: data.total,
        citiesScanned: data.citiesScanned,
        requests: data.requests,
        cached: data.cached ?? 0,
        regionName: data.regionName,
        rejectedPhones: data.rejectedPhones ?? 0,
      });
      addScan({
        branza: niche,
        wojewodztwo: data.regionName,
        wyniki: data.leads.length,
        miasta: data.citiesScanned,
      });
      if (data.warning) toast.warning(data.warning);
      toast.success(
        `Przeskanowano ${data.citiesScanned} miast (${data.total} firm) — ${data.leads.length} bez własnej strony`,
      );
      reportScanDone(data.leads.length, data.total);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (remoteReportPending.current) { remoteReportPending.current = false; reportRemoteResult(`⚠️ Skanowanie na ekranie Maca przerwane: ${e.message}`); }
    },
  });


  const ceidg = useMutation({
    mutationFn: () => {
      if (!region) throw new Error("Wybierz województwo.");
      setHarvestProgress(null);
      return searchCeidg(
        { days: Number(days), pkd: pkd.trim(), voivodeshipName: region.name, enableDeepHarvest: deepHarvest },
        (p) => setHarvestProgress(p),
      );
    },
    onSettled: () => setHarvestProgress(null),
    onSuccess: (data) => {
      registerNiche(niche);
      setResults(data.leads);
      setSelected(new Set(data.leads.filter((l) => !isInBase(l)).map((l) => l.id)));
      setStats({ total: data.total, citiesScanned: 0, requests: 1, cached: 0, regionName: region?.name ?? "", rejectedPhones: data.rejectedPhones ?? 0 });
      addScan({ branza: niche, wojewodztwo: region?.name ?? "", wyniki: data.leads.length, miasta: 0 });
      toast.success(`CEIDG: ${data.total} nowych firm od ${data.from} — ${data.leads.length} z telefonem i bez strony${data.harvested ? ` (${data.harvested} numerów wyłuskanych z sieci)` : ""}`);
      reportScanDone(data.leads.length, data.total);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (remoteReportPending.current) { remoteReportPending.current = false; reportRemoteResult(`⚠️ Skanowanie CEIDG na ekranie Maca przerwane: ${e.message}`); }
    },
  });

  const olx = useMutation({
    mutationFn: () => {
      if (!region) throw new Error("Wybierz województwo.");
      if (!keyword.trim()) throw new Error("Wpisz frazę lub kliknij pigułkę niszy.");
      setOlxProgress(null);
      return searchOlx(
        { query: keyword.trim(), voivodeshipName: region.name, maxResults: 50, checkDuckDuckGo: olxDoubleCheck },
        (p) => setOlxProgress(p),
      );
    },
    onSettled: () => setOlxProgress(null),
    onSuccess: (data) => {
      registerNiche(niche);
      setResults(data.leads);
      setSelected(new Set(data.leads.filter((l) => !isInBase(l)).map((l) => l.id)));
      setStats({ total: data.total, citiesScanned: 0, requests: 1, cached: 0, regionName: region?.name ?? "", rejectedPhones: data.rejectedPhones ?? 0 });
      addScan({ branza: niche, wojewodztwo: region?.name ?? "", wyniki: data.leads.length, miasta: 0 });
      if (data.fromMock) {
        toast.info("Podgląd w przeglądarce — to symulowane ogłoszenia OLX. Prawdziwe skanowanie działa w aplikacji na Maca.");
      }
      toast.success(
        `OLX: ${data.total} ogłoszeń — ${data.leads.length} leadów z numerem i bez strony` +
          (data.clicked ? ` (${data.clicked} numerów odkrytych auto-clickerem)` : "") +
          (data.skippedSite ? `, pominięto ${data.skippedSite} z własną stroną` : ""),
      );
      reportScanDone(data.leads.length, data.total);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      if (remoteReportPending.current) { remoteReportPending.current = false; reportRemoteResult(`⚠️ Skanowanie OLX na ekranie Maca przerwane: ${e.message}`); }
    },
  });

  const saveLead = useMutation({
    mutationFn: async ({ lead, status }: { lead: PlaceLead; status: string }) => {
      await insertLeads([leadRow(lead, status, { nisza: niche, wojewodztwo: voivodeship })]);

      return { id: lead.id, status };
    },
    onSuccess: ({ id, status }) => {
      setSaved((s) => ({ ...s, [id]: true }));
      toast.success(
        status === "do_dzwonienia"
          ? "Dodano do listy „Do dzwonienia”"
          : status === "do_oferty"
            ? "Dodano do listy „Do wysłania oferty”"
            : "Lead zapisany w bazie",
      );
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(`Nie udało się zapisać: ${e.message}`),
  });

  const saveSelected = useMutation({
    mutationFn: async ({ leads, status }: { leads: PlaceLead[]; status: string }) => {
      const rows = leads.map((lead) =>
        leadRow(lead, status, { nisza: niche, wojewodztwo: voivodeship }),
      );

      await insertLeads(rows);
      return leads.map((l) => l.id);
    },
    onSuccess: (ids, { status }) => {
      setSaved((s) => {
        const next = { ...s };
        ids.forEach((id) => (next[id] = true));
        return next;
      });
      setSelected(new Set());
      toast.success(
        status === "do_dzwonienia"
          ? `Dodano ${ids.length} firm do listy „Do dzwonienia”`
          : status === "do_oferty"
            ? `Dodano ${ids.length} firm do listy „Do wysłania oferty”`
            : `Zapisano ${ids.length} leadów w bazie`,
      );
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(`Nie udało się zapisać zaznaczonych: ${e.message}`),
  });

  const addBulk = useMutation({
    mutationFn: async ({ leads, thenSend }: { leads: PlaceLead[]; thenSend: boolean }) => {
      const status = thenSend ? "do_oferty" : "nowy";
      const rows = leads.map((lead) =>
        leadRow(lead, status, { nisza: niche, wojewodztwo: voivodeship }),
      );
      const res = await addLeadsBulk(rows);
      return { ...res, ids: leads.map((l) => l.id), thenSend };
    },
    onSuccess: ({ addedCount, skippedCount, ids, thenSend }) => {
      setSaved((s) => {
        const next = { ...s };
        ids.forEach((id) => (next[id] = true));
        return next;
      });
      setSelected(new Set());
      toast.success(
        `Dodano ${addedCount} nowych leadów do bazy (pominięto ${skippedCount} duplikatów)`,
      );
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      if (thenSend && addedCount > 0) onGoToTab?.("offer");
      if (remoteReportPending.current) {
        remoteReportPending.current = false;
        reportRemoteResult(
          thenSend
            ? `🚀 Zapisano ${addedCount} leadów (pominięto ${skippedCount} duplikatów) — ekran Maca przeszedł do „Szablony & Wysyłka”. Uruchom wysyłkę przyciskiem Bulk SMS.`
            : `📥 Zapisano ${addedCount} leadów do bazy (pominięto ${skippedCount} duplikatów).`,
        );
      }
    },
    onError: (e: Error) => {
      toast.error(`Nie udało się dodać: ${e.message}`);
      if (remoteReportPending.current) { remoteReportPending.current = false; reportRemoteResult(`⚠️ Nie udało się dodać wyników: ${e.message}`); }
    },
  });

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectableIds = (list: PlaceLead[]) =>
    list.filter((r) => !saved[r.id] && !isInBase(r)).map((r) => r.id);
  const selectableCount = results ? selectableIds(results).length : 0;

  const toggleAll = () => {
    if (!results) return;
    if (selected.size === selectableCount) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds(results)));
    }
  };

  const selectedLeads = results?.filter((r) => selected.has(r.id)) ?? [];

  const canSearch =
    voivodeship &&
    !search.isPending &&
    !ceidg.isPending &&
    !olx.isPending &&
    (mode === "ceidg" || keyword.trim());
  const runSearch = () =>
    mode === "ceidg" ? ceidg.mutate() : mode === "olx" ? olx.mutate() : search.mutate();

  // ---- Telefon jako pilot TV: zdalne komendy sterują tym ekranem ----
  const pendingRemoteScan = useRef<{ source: string; query: string; region: string } | null>(null);
  const remoteReportPending = useRef(false);

  useEffect(() => {
    if (!remoteCommand) return;
    const { cmd } = remoteCommand;
    if (cmd.action === "scan") {
      const nextMode = cmd.source === "CEIDG" ? "ceidg" : cmd.source === "OLX" ? "olx" : "maps";
      pendingRemoteScan.current = { source: cmd.source, query: cmd.query, region: cmd.region };
      setMode(nextMode);
      if (nextMode === "ceidg") setPkd(cmd.query); else setKeyword(cmd.query);
      const v = VOIVODESHIPS.find(x => x.name.toLowerCase() === cmd.region.toLowerCase());
      if (v) setVoivodeship(v.id);
    } else if (cmd.action === "addAndSend" || cmd.action === "addOnly") {
      if (cmd.action === "addAndSend" && cmd.speed) {
        const config = cmd.speed;
        window.localStorage.setItem('leadfinder.send-settings', JSON.stringify({ ...readSendSettings(), ...config, delaySeconds: (config.minDelayMs + config.maxDelayMs) / 2000 }));
        window.dispatchEvent(new Event('leadfinder:send-settings-change'));
      }
      const fresh = (results ?? []).filter(r => !saved[r.id] && !isInBase(r));
      if (!fresh.length) {
        reportRemoteResult("⚠️ Brak nowych wyników na ekranie Maca — najpierw uruchom skanowanie.");
        return;
      }
      remoteReportPending.current = true;
      setSelected(new Set(fresh.map(l => l.id)));
      addBulk.mutate({ leads: fresh, thenSend: cmd.action === "addAndSend" });
    } else if (cmd.action === "discard") {
      setResults(null);
      setSelected(new Set());
      reportRemoteResult("❌ Odrzucono wyniki na ekranie Maca.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteCommand]);

  // Gdy pola są już ustawione zgodnie z komendą, odpalamy dokładnie ten sam pełny skan co na Macu.
  useEffect(() => {
    const cmd = pendingRemoteScan.current;
    if (!cmd || !voivodeship) return;
    const applied = cmd.source === "CEIDG" ? pkd === cmd.query : keyword === cmd.query;
    if (!applied || search.isPending || ceidg.isPending || olx.isPending) return;
    pendingRemoteScan.current = null;
    remoteReportPending.current = true;
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pkd, voivodeship, mode]);

  const reportScanDone = (count: number, total: number) => {
    if (!remoteReportPending.current) return;
    remoteReportPending.current = false;
    reportRemoteResult(
      count > 0
        ? `✅ Skanowanie na ekranie Maca zakończone! Znaleziono ${count} czystych leadów (z ${total} wyników). Co dalej?`
        : `🔎 Skanowanie na ekranie Maca zakończone — brak nowych, czystych numerów (sprawdzono ${total} wyników).`,
      count > 0,
    );
  };


  return (
    <div className="space-y-6">
      <Card className="workspace-section">
        <CardContent className="space-y-6 p-0">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "maps" | "ceidg" | "olx")}>
            <TabsList className="apple-segment h-auto flex max-w-full flex-wrap">
              <TabsTrigger value="maps" className="rounded-lg">
                <MapPin className="mr-2 size-4" /> Szukaj na Mapach
              </TabsTrigger>
              <TabsTrigger value="ceidg" className="rounded-lg">
                <Building2 className="mr-2 size-4" /> Nowe firmy (CEIDG)
              </TabsTrigger>
              <TabsTrigger value="olx" className="rounded-lg">
                Ogłoszenia OLX
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
            {mode === "ceidg" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pkd">Kody PKD (np. 43.32.Z, 45.20.Z)</Label>
                  <Input
                    id="pkd"
                    className="glass-soft rounded-xl border-0"
                    placeholder="puste = wszystkie branże"
                    value={pkd}
                    onChange={(e) => setPkd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSearch) runSearch();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="days">Szukaj z ostatnich</Label>
                  <Select value={days} onValueChange={setDays}>
                    <SelectTrigger id="days" className="glass-soft rounded-xl border-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["3", "7", "14", "30", "60"].map((d) => (
                        <SelectItem key={d} value={d}>
                          {d} dni
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="keyword">Czego szukasz?</Label>
              <Input
                id="keyword"
                className="glass-soft rounded-xl border-0"
                placeholder="np. stolarz, fryzjer, mechanik"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSearch) runSearch();
                }}
              />
            </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="voivodeship">Województwo</Label>
              <Select value={voivodeship} onValueChange={setVoivodeship}>
                <SelectTrigger id="voivodeship" className="glass-soft rounded-xl border-0">
                  <SelectValue placeholder="Wybierz województwo" />
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
            <div className="flex items-end">
              <Button
                className="w-full rounded-xl sm:w-auto"
                disabled={!canSearch}
                onClick={runSearch}
              >
                <Search className="mr-2 size-4" />
                {search.isPending || ceidg.isPending || olx.isPending
                  ? "Szukam..."
                  : mode === "ceidg"
                    ? "Szukaj nowych firm"
                    : mode === "olx"
                      ? "Skanuj ogłoszenia OLX"
                      : "Skanuj województwo"}
              </Button>
            </div>
          </div>

          {mode === "ceidg" && (
            <div className="glass-soft flex items-start justify-between gap-4 rounded-xl px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="deep-harvest" className="text-sm font-medium">
                  🕵️‍♂️ Głębokie szukanie brakujących numerów w sieci (OSINT Harvester po NIP)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Dla firm bez telefonu w rejestrze program szuka numeru komórkowego w wyszukiwarce i katalogach
                  firm. Trwa dłużej — ok. 3–5 s na firmę.
                </p>
              </div>
              <Switch id="deep-harvest" checked={deepHarvest} onCheckedChange={setDeepHarvest} />
            </div>
          )}

          {mode === "ceidg" && ceidg.isPending && harvestProgress && (
            <div className="glass-soft space-y-2 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <Loader2 className="mr-2 inline size-4 animate-spin" />
                  Szukam numeru: <span className="font-medium">{harvestProgress.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {harvestProgress.index} / {harvestProgress.total} · znalezione: {harvestProgress.harvested}
                </span>
              </div>
              <Progress value={(harvestProgress.index / Math.max(1, harvestProgress.total)) * 100} />
            </div>
          )}

          {mode === "ceidg" && (
            <NichePicker source="ceidg" value={pkd} onPick={(n: NicheItem) => setPkd(nicheValue(n, "ceidg"))} onClear={() => setPkd("")} />
          )}

          {mode === "olx" && (
            <NichePicker source="olx" value={keyword} onPick={(n: NicheItem) => setKeyword(nicheValue(n, "olx"))} onClear={() => setKeyword("")} />
          )}

          {mode === "maps" && (
            <NichePicker source="maps" value={keyword} onPick={(n: NicheItem) => setKeyword(nicheValue(n, "maps"))} onClear={() => setKeyword("")} />
          )}

          {mode === "olx" && (
            <div className="glass-soft flex items-start justify-between gap-4 rounded-xl px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="olx-ddg" className="text-sm font-medium">
                  🔎 Podwójna weryfikacja w DuckDuckGo
                </Label>
                <p className="text-xs text-muted-foreground">
                  Dla każdego znalezionego ogłoszeniodawcy program dodatkowo sprawdza w
                  wyszukiwarce, czy nie ma jednak własnej strony www. Trwa dłużej — ok. 1–2 s na
                  ogłoszenie.
                </p>
              </div>
              <Switch id="olx-ddg" checked={olxDoubleCheck} onCheckedChange={setOlxDoubleCheck} />
            </div>
          )}

          {mode === "olx" && olx.isPending && olxProgress && (
            <div className="glass-soft space-y-2 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <Loader2 className="mr-2 inline size-4 animate-spin" />
                  {olxProgress.phase === "click" ? "Odkrywam ukryty numer (auto-click):" : "Czytam ogłoszenie:"}{" "}
                  <span className="font-medium">{olxProgress.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {olxProgress.index} / {olxProgress.total} · leadów: {olxProgress.harvested}
                </span>
              </div>
              <Progress value={(olxProgress.index / Math.max(1, olxProgress.total)) * 100} />
            </div>
          )}

          {mode === "olx" && (
            <p className="text-xs text-muted-foreground">
              Skaner przegląda ogłoszenia OLX z wybranego województwa, wyciąga numery komórkowe z
              opisów, a ukryte numery odsłania automatycznym kliknięciem „Pokaż numer” w ukrytym
              oknie. Ogłoszenia z własną stroną www w opisie są odrzucane.
            </p>
          )}

          {mode === "maps" && (
            <div className="glass-soft flex items-start gap-3 rounded-xl px-4 py-3">
              <Checkbox
                id="audit-sites"
                checked={auditSites}
                onCheckedChange={(v) => setAuditSites(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="audit-sites" className="text-sm font-medium">
                  🔍 Łowca zepsutych stron (szukaj też firm z wygasłą domeną, brakiem SSL lub brakiem wersji mobilnej)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Uwzględnij firmy z zepsutą / przestarzałą stroną WWW. Każda strona jest sprawdzana (do 5 s), więc
                  skan trwa dłużej.
                </p>
              </div>
            </div>
          )}

          {search.isPending && progress && (
            <ScanProgressPanel p={progress} />
          )}

          {mode === "ceidg" ? (
            <p className="text-xs text-muted-foreground">
              Dane z oficjalnego rejestru CEIDG. Pokazujemy tylko firmy, które podały telefon i
              nie mają strony www. Wymaga klucza API wpisanego w zakładce Ustawienia.
            </p>
          ) : mode === "olx" ? null : (
            <>
          {region && (
            <p className="text-xs text-muted-foreground">
              Skanowane miasta ({cityCount}): {region.cities.slice(0, maxCities).join(", ")}
            </p>
          )}

          <Separator className="opacity-40" />

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SlidersHorizontal className="size-4" />
            Obszar i filtry
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <SliderField
              label="Ile miast skanować"
              value={region ? `${cityCount} z ${region.cities.length}` : `${maxCities} miast`}
              min={1}
              max={40}
              step={1}
              current={maxCities}
              onChange={setMaxCities}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Aplikacja przegląda Mapy Google w ukrytym oknie (do 120 firm na miasto) i zostawia
            tylko firmy, które mają w wizytówce telefon, ale nie mają strony www. Między
            miastami robi kilkusekundowe przerwy, żeby Google nie zablokował wyszukiwania.
          </p>
            </>
          )}
        </CardContent>
      </Card>

      <ScanHistoryPanel />

      {results && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Wyniki: <span className="text-foreground">{results.length}</span> — z {stats.total}{" "}
              {stats.citiesScanned > 0 ? (
                <>
                  firm znalezionych w {stats.citiesScanned} miastach ({stats.regionName}),{" "}
                  {stats.requests} wyszukiwań w Mapach Google
                  {stats.cached > 0 ? `, ${stats.cached} z pamięci podręcznej` : ""}
                </>
              ) : mode === "olx" ? (
                <>ogłoszeń OLX ({stats.regionName})</>
              ) : (
                <>nowych firm w CEIDG ({stats.regionName})</>
              )}
              {stats.rejectedPhones > 0 && (
                <>
                  {" "}· odrzucono numerów stacjonarnych / błędnych:{" "}
                  <span className="text-foreground">{stats.rejectedPhones}</span>
                </>
              )}
            </p>

            {results.length > 0 && (
              <div className="bulk-action-bar sticky top-4 z-30 flex w-full flex-wrap items-center gap-2 rounded-2xl p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    className="rounded-md"
                    checked={selectableCount > 0 && selected.size === selectableCount}
                    onCheckedChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                  Zaznacz wszystkie ({selectableCount})
                </label>
                <span className="text-xs text-muted-foreground">· zaznaczono {selected.size}</span>
                <Button
                  size="sm"
                  className="rounded-xl"
                  disabled={selected.size === 0 || addBulk.isPending}
                  onClick={() => addBulk.mutate({ leads: selectedLeads, thenSend: false })}
                >
                  📥 Dodaj wszystkie do bazy ({selected.size})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-xl"
                  disabled={selected.size === 0 || addBulk.isPending}
                  onClick={() => addBulk.mutate({ leads: selectedLeads, thenSend: true })}
                >
                  🚀 Dodaj wszystkie i wyślij SMS ({selected.size})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={selected.size === 0 || saveSelected.isPending}
                  onClick={() => saveSelected.mutate({ leads: selectedLeads, status: "nowy" })}
                >
                  <Database className="mr-2 size-4" /> Zapisz zaznaczone
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={selected.size === 0 || saveSelected.isPending}
                  onClick={() =>
                    saveSelected.mutate({ leads: selectedLeads, status: "do_dzwonienia" })
                  }
                >
                  <PhoneCall className="mr-2 size-4" /> Do dzwonienia
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={selected.size === 0 || saveSelected.isPending}
                  onClick={() => saveSelected.mutate({ leads: selectedLeads, status: "do_oferty" })}
                >
                  <Send className="mr-2 size-4" /> Do oferty
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() =>
                    exportLeadsCsv(
                      selectedLeads.length > 0 ? selectedLeads : results,
                      `leadfinder-${stats.regionName || "wyniki"}.csv`,
                    )
                  }
                >
                  Eksport CSV
                </Button>

              </div>
            )}
          </div>
          {results.length === 0 && (

            <Card className="glass rounded-3xl border-0 shadow-none">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Brak firm spełniających kryteria. Zwiększ liczbę miast lub poluzuj filtry.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {results.map((lead) => (
              <Card
                key={lead.id}
                className="apple-glass-card group overflow-hidden"
              >
                <CardContent className="relative z-10 space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Checkbox
                        className="mt-1 rounded-md"
                        checked={selected.has(lead.id)}
                        disabled={!!saved[lead.id] || isInBase(lead)}
                        onCheckedChange={() => toggleOne(lead.id)}
                        aria-label={saved[lead.id] ? "Lead już zapisany" : "Zaznacz leada"}
                      />
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(
                          `${lead.name} ${lead.address ?? ""}`.trim(),
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-base font-semibold leading-tight underline-offset-4 transition-colors hover:text-primary hover:underline"
                        title="Szukaj w Google"
                      >
                        {lead.name}
                      </a>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {lead.source === "CEIDG" && (
                        <Badge className="rounded-full">CEIDG</Badge>
                      )}
                      {lead.source === "OLX" && (
                        <Badge className="rounded-full border-0 bg-chart-4/15 text-chart-4">
                          🟣 Ogłoszeniodawca OLX
                        </Badge>
                      )}
                      {lead.source === "OLX" && lead.phoneSource && (
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {lead.phoneSource === "OLX opis"
                            ? "Numer z opisu ogłoszenia"
                            : "Numer odkryty przyciskiem (Auto-Click)"}
                        </Badge>
                      )}
                      {lead.source === "OLX" && lead.socialOnly && (
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          Tylko Social Media (FB/IG)
                        </Badge>
                      )}
                      <IssueTypePicker
                        type={lead.issueType ?? issueTypeFromText(lead.websiteIssue)}
                        onChange={(t) =>
                          setResults((rs) =>
                            rs?.map((r) =>
                              r.id === lead.id ? { ...r, issueType: t, websiteIssue: ISSUE_META[t].tag } : r,
                            ) ?? rs,
                          )
                        }
                      />
                      {lead.phoneSource === "OSINT Harvester" && (
                        <Badge className="rounded-full border-0 bg-chart-4/15 text-chart-4">
                          Numer wyłuskany z sieci (OSINT)
                        </Badge>
                      )}
                      {lead.rating > 0 && (
                        <Badge variant="secondary" className="rounded-full">
                          <Star className="mr-1 size-3 text-primary" />
                          {lead.rating.toFixed(1)} · {lead.userRatingCount}
                        </Badge>
                      )}
                      {isInBase(lead) && (
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          już w bazie
                        </Badge>
                      )}
                    </div>
                  </div>


                  {lead.source === "CEIDG" && (
                    <div className="glass-soft grid grid-cols-3 gap-2 rounded-xl px-3 py-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">NIP</p>
                        <p className="font-medium tabular-nums">{lead.nip || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Start działalności</p>
                        <p className="font-medium tabular-nums">{lead.startDate || "—"}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-muted-foreground">PKD</p>
                        <p className="truncate font-medium" title={lead.category ?? ""}>
                          {lead.category || "—"}
                        </p>
                      </div>
                    </div>
                  )}

                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    {lead.address || "Brak adresu"}
                    <span className="ml-auto shrink-0">{lead.city}</span>
                  </p>
                  {lead.olxUrl && (
                    <p className="flex items-center gap-2 text-sm">
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={lead.olxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-primary underline-offset-4 hover:underline"
                      >
                        Oryginalne ogłoszenie OLX
                      </a>
                    </p>
                  )}
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="size-4 shrink-0" />
                    {lead.phone ? (
                      <PhoneMessageLink
                        phone={lead.phone}
                        vars={{
                          nazwa: lead.name,
                          adres: lead.address,
                          telefon: lead.phone,
                          miasto: lead.city,
                          ocena: lead.rating.toFixed(1),
                          opinie: lead.userRatingCount,
                        }}
                        meta={{
                          nisza: niche,
                          wojewodztwo: voivodeship,
                          miasto: lead.city,
                          adres: lead.address,
                        }}
                      />
                    ) : (
                      "Brak telefonu"
                    )}
                  </p>

                  {lead.website && (
                    <p className="flex items-center gap-2 truncate text-sm text-muted-foreground">
                      <Globe className="size-4 shrink-0" />
                      {lead.website}
                    </p>
                  )}

                  {(lead.category || lead.summary || lead.hours.length > 0 ||
                    lead.reviews.length > 0 || lead.mapsUri) && (
                    <details className="glass-soft rounded-xl px-3 py-2 text-sm">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Szczegóły firmy
                      </summary>
                      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                        {lead.category && (
                          <p>
                            <span className="text-foreground">Kategoria:</span> {lead.category}
                          </p>
                        )}
                        {lead.summary && <p>{lead.summary}</p>}
                        {lead.hours.length > 0 && (
                          <div>
                            <p className="text-foreground">Godziny otwarcia</p>
                            <ul className="mt-1 space-y-0.5">
                              {lead.hours.map((h) => (
                                <li key={h}>{h}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {lead.reviews.length > 0 && (
                          <div>
                            <p className="text-foreground">Ostatnie opinie</p>
                            <ul className="mt-1 space-y-1">
                              {lead.reviews.map((r, i) => (
                                <li key={i}>
                                  ★ {r.rating} — {r.author}: {r.text.slice(0, 180)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {lead.mapsUri && (
                          <a
                            href={lead.mapsUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block underline-offset-4 hover:text-primary hover:underline"
                          >
                            Otwórz profil w Google Maps
                          </a>
                        )}
                      </div>
                    </details>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {saved[lead.id] || isInBase(lead) ? (
                      <Badge className="h-8 cursor-default rounded-xl bg-chart-2/15 px-3 text-chart-2 hover:bg-chart-2/15">
                        ✓ W bazie
                      </Badge>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        className="rounded-xl"
                        disabled={saveLead.isPending}
                        onClick={() => saveLead.mutate({ lead, status: "nowy" })}
                      >
                        Zapisz Leada
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="secondary-lead-action rounded-lg"
                      disabled={!!saved[lead.id] || saveLead.isPending}
                      aria-label="Do dzwonienia" title="Do dzwonienia"
                      onClick={() => saveLead.mutate({ lead, status: "do_dzwonienia" })}
                    >
                      <PhoneCall className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="secondary-lead-action rounded-lg"
                      disabled={!!saved[lead.id] || saveLead.isPending}
                      aria-label="Do oferty" title="Do oferty"
                      onClick={() => saveLead.mutate({ lead, status: "do_oferty" })}
                    >
                      <Send className="size-4" />
                    </Button>
                    {lead.phone && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="secondary-lead-action rounded-lg text-destructive"
                        aria-label="Zablokuj numer"
                        title="Zablokuj numer"
                        onClick={async () => {
                          try {
                            if (!lead.phone) return;
                            await blacklistPhone(lead.phone);
                            setResults((r) => r?.filter((x) => x.id !== lead.id) ?? null);
                            toast.success("Numer dodany do czarnej listy. Lead usunięty.");
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                      >
                        <Ban className="size-4" />
                      </Button>
                    )}
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>

        </div>
      )}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <Label>{label}</Label>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={(v) => onChange(v[0] ?? current)}
      />
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="glass-soft flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function LeadActions({
  lead,
  onDelete,
  setStatus,
}: {
  lead: LeadRow;
  onDelete: () => void;
  setStatus: ReturnType<typeof useLeadStatus>;
}) {
  const block = useBlockLead();
  return (
    <>
      <LeadNotes lead={lead} />
      {lead.telefon && (
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-xl md:size-9"
          aria-label="Zablokuj"
          title="Zablokuj"
          disabled={block.isPending}
          onClick={() => block.mutate(lead)}
        >
          <Ban className="size-4 text-destructive" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl md:size-9"
        aria-label={
          lead.status === "do_dzwonienia"
            ? "Zdejmij z listy do dzwonienia"
            : "Dodaj do listy do dzwonienia"
        }
        title={
          lead.status === "do_dzwonienia"
            ? "Zdejmij z listy do dzwonienia"
            : "Dodaj do listy do dzwonienia"
        }
        onClick={() =>
          setStatus.mutate({
            id: lead.id,
            status: lead.status === "do_dzwonienia" ? "nowy" : "do_dzwonienia",
          })
        }
      >
        <PhoneCall
          className={
            lead.status === "do_dzwonienia"
              ? "size-4 text-primary"
              : "size-4 text-muted-foreground"
          }
        />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl md:size-9"
        aria-label="Dodaj do wysłania oferty"
        title="Dodaj do wysłania oferty"
        onClick={() =>
          setStatus.mutate({
            id: lead.id,
            status: lead.status === "do_oferty" ? "nowy" : "do_oferty",
          })
        }
      >
        <Send
          className={
            lead.status === "do_oferty" ? "size-4 text-primary" : "size-4 text-muted-foreground"
          }
        />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl md:size-9"
        aria-label="Usuń leada"
        onClick={onDelete}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </>
  );
}

/** Mini-modal zamknięcia sprzedaży — kwota zlecenia zapisywana w leadzie. */
function CloseDealDialog({ lead, onClose }: { lead: LeadRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("2500");

  const save = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("Brak leada");
      const amount = Math.max(0, Number(value.replace(",", ".").replace(/[^\d.]/g, "")) || 0);
      await updateLead(lead.id, {
        status: "sukces",
        closed_at: new Date().toISOString(),
        deal_value: amount,
      });
      return amount;
    },
    onSuccess: (amount) => {
      toast.success(`🎉 Sprzedaż zamknięta — ${amount.toLocaleString("pl-PL")} zł`);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={Boolean(lead)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="glass rounded-3xl border-0 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🎉 Gratulacje zamknięcia sprzedaży!</DialogTitle>
          <DialogDescription>
            {lead?.nazwa} — podaj kwotę zlecenia (PLN):
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {["1500", "2500", "4000"].map((v) => (
              <Button
                key={v}
                type="button"
                variant={value === v ? "default" : "outline"}
                size="sm"
                className="rounded-xl"
                onClick={() => setValue(v)}
              >
                {Number(v).toLocaleString("pl-PL")} zł
              </Button>
            ))}
          </div>
          <Input
            inputMode="decimal"
            className="glass-soft rounded-xl border-0"
            placeholder="Własna kwota, np. 3200"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !save.isPending) save.mutate();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" className="rounded-xl" onClick={onClose} disabled={save.isPending}>
            Anuluj
          </Button>
          <Button className="rounded-xl" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Zapisz sprzedaż
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BulkState = "pending" | "sending" | "ok" | "error";

function BulkSendDialog({ leads }: { leads: LeadRow[] }) {
  const isDesktop = useIsDesktopApp();
  const { templates: issueTemplates } = useIssueTemplates();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, BulkState>>({});
  const [done, setDone] = useState(0);
  const [queue, setQueue] = useState<BulkQueueStatus | null>(null);

  const { settings, save: saveSendSettings } = useSendSettings();

  // Odsiewamy firmy bez numeru, powtórzone numery i te, do których już pisałem.
  const seenPhones = new Set<string>();
  const skippedSent: string[] = [];
  const skippedDuplicate: string[] = [];
  const items = leads
    .filter((l) => {
      if (!l.telefon) return false;
      if (l.sms_sent_at) {
        skippedSent.push(l.nazwa);
        return false;
      }
      if (settings.skipAlreadySent && l.status === "wyslano_wiadomosc") {
        skippedSent.push(l.nazwa);
        return false;
      }
      const key = phoneKey(l.telefon);
      if (key && seenPhones.has(key)) {
        skippedDuplicate.push(l.nazwa);
        return false;
      }
      if (key) seenPhones.add(key);
      return true;
    })
    .slice(0, settings.dailyLimit)
    .map((lead) => {
      // Ruter szablonów: wybór treści wg diagnozy strony leada.
      const vars = leadVars(lead);
      const { body, signature, type } = buildIssueMessage(issueTemplates, issueTypeOf(lead), {
        ...vars,
        miasto: lead.miasto ?? "",
        branza: lead.nisza || lead.kategoria || "",
      });
      return { lead, body, signature, type };
    });

  if (!isDesktop) return null;

  const total = items.length;
  const typeCounts: Record<WebsiteIssueType, number> = { NO_WEBSITE: 0, EXPIRED_OR_ERROR: 0, NO_SSL: 0, NO_MOBILE: 0, OLX_NO_WEBSITE: 0 };
  items.forEach((i) => typeCounts[i.type]++);
  const skipped = skippedSent.length + skippedDuplicate.length;

  const start = async () => {
    const bridge = getBridge();
    if (!bridge || running || total === 0) return;
    setRunning(true);
    setDone(0);
    const initial: Record<string, BulkState> = {};
    items.forEach((i) => {
      initial[i.lead.id] = "pending";
    });
    setStates(initial);

    // Na żywo odpytujemy kolejkę: ile wysłano, za ile kolejny SMS i z której karty SIM.
    const poll = window.setInterval(async () => {
      const status = await bridge.bulkStatus?.().catch(() => null);
      if (status) setQueue(status);
    }, 500);

    const sendSettings = readSendSettings();
    let results: BulkResult[];
    try {
    results = await bridge?.sendBulk?.(
      items.map((i) => ({
        id: i.lead.id,
        phone: (i.lead.telefon ?? '').replace(/\s+/g, ""),
        body: i.body,
        templateId: ISSUE_META[i.type].label,
        signature: i.signature,
      })),
      // Postęp tylko odświeża listę w okienku — licznik rusza po zakończeniu wysyłki.
      (p) => {
        setStates((prev) => ({ ...prev, [p.id]: p.ok ? "ok" : "error" }));
        setDone((c) => c + 1);
      },
      {
        speedMode: sendSettings.speedMode,
        minDelayMs: sendSettings.minDelayMs,
        maxDelayMs: sendSettings.maxDelayMs,
        dualSim: sendSettings.dualSim,
        sim1Name: sendSettings.sim1Name,
        sim2Name: sendSettings.sim2Name,
        forceSend: !sendSettings.nightLock,
      },
    ) ?? [];
    } catch {
      setRunning(false);
      toast.error('Wysyłka przerwana — sprawdź kolejkę na Macu.');
      return;
    } finally {
      window.clearInterval(poll);
      setQueue(null);
    }

    // Licznik i statystyki mapy liczymy dopiero z potwierdzonych wyników wysyłki.
    const okIds = results.filter((r) => r.ok).map((r) => r.id);
    for (const id of okIds) {
      const item = items.find((i) => i.lead.id === id);
      if (item) recordSentMessage(leadMeta(item.lead));
      incrementSent();
      await updateLead(id, {
        status: "wyslano_wiadomosc",
        sms_sent_at: new Date().toISOString(),
        // Atrybucja: dokładna treść, szablon i kombinacja Spintax.
        sms_exact_text: item?.body ?? null,
        sms_template_id: item ? ISSUE_META[item.type].label : null,
        website_issue_type: item?.type ?? null,
        sms_combination_signature: item?.signature || null,
      });
    }
    // Pominięte z powodu istniejącej rozmowy w Wiadomościach też mają już znacznik w bazie.
    const fromHistory = results.filter((r) => r.skipped && r.reason === "history").length;
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    setRunning(false);
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const historyNote = fromHistory > 0 ? ` ${fromHistory} pominięto — numer już w historii Wiadomości.` : "";
    if (failed > 0) {
      toast.warning(`Wysłano ${okIds.length} z ${total} — ${failed} bez powodzenia.${historyNote}`);
    } else {
      toast.success(`Wysłano ${okIds.length} z ${total} wiadomości.${historyNote}`);
    }
  };

  const stop = () => {
    getBridge()?.cancelBulk();
    setRunning(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !running && setOpen(v)}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="rounded-xl"
          disabled={total === 0}
          title={
            total === 0
              ? "Brak leadów z numerem telefonu"
              : "Automatycznie wyślij iMessage do wszystkich"
          }
        >
          <MessageSquare className="mr-2 size-4" /> Wyślij do wszystkich (
          {total})
        </Button>
      </DialogTrigger>
      <DialogContent className="glass max-h-[85vh] overflow-y-auto rounded-3xl border-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Masowa wysyłka iMessage</DialogTitle>
          <DialogDescription>
            <span className="mb-2 block rounded-xl bg-background/40 p-2 text-foreground">
              Do wysłania łącznie: {total} SMS
              {total > 0 &&
                ` (w tym: ${ISSUE_TYPES.filter((t) => typeCounts[t] > 0)
                  .map((t) => `${typeCounts[t]}x ${ISSUE_META[t].short}`)
                  .join(", ")})`}
            </span>
            Wysyłka w tle: {total}{" "}
            {total === 1 ? "wiadomość" : "wiadomości"} po kolei, średnio co ~
            {settings.delaySeconds} s. Przy pierwszej wysyłce macOS poprosi o
            zgodę na sterowanie aplikacją Wiadomości.
            {skipped > 0 && (
              <>
                {" "}
                Pomijam {skipped}:{" "}
                {skippedSent.length > 0 && `${skippedSent.length} z już wysłaną wiadomością`}
                {skippedSent.length > 0 && skippedDuplicate.length > 0 && ", "}
                {skippedDuplicate.length > 0 && `${skippedDuplicate.length} z powtórzonym numerem`}
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <SmsSpeedPanel count={running ? Math.max(0, total - done) : total} running={running} />

        {/* Ochrona anty-banowa: Dual eSIM + blokada godzin nocnych */}
        {!running && (
          <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Tryb Dual eSIM</p>
                <p className="text-xs text-muted-foreground">
                  Wysyłka na przemian z dwóch linii — mniejsze ryzyko blokady karty.
                </p>
              </div>
              <Switch
                checked={settings.dualSim}
                onCheckedChange={(v) => saveSendSettings({ dualSim: v })}
                aria-label="Tryb Dual eSIM"
              />
            </div>
            {settings.dualSim && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={settings.sim1Name}
                  onChange={(e) => saveSendSettings({ sim1Name: e.target.value })}
                  placeholder="Nazwa linii 1 (np. Orange)"
                  className="h-10 rounded-xl text-sm"
                  aria-label="Nazwa pierwszej karty SIM"
                />
                <Input
                  value={settings.sim2Name}
                  onChange={(e) => saveSendSettings({ sim2Name: e.target.value })}
                  placeholder="Nazwa linii 2 (np. Play)"
                  className="h-10 rounded-xl text-sm"
                  aria-label="Nazwa drugiej karty SIM"
                />
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Blokada godzin nocnych (08:30–17:00)</p>
                <p className="text-xs text-muted-foreground">
                  Poza tymi godzinami kolejka czeka do rana.
                </p>
              </div>
              <Switch
                checked={settings.nightLock}
                onCheckedChange={(v) => saveSendSettings({ nightLock: v })}
                aria-label="Blokada godzin nocnych"
              />
            </div>
          </div>
        )}

        {(running || done > 0) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Postęp</span>
              <span className="tabular-nums">
                {done} / {total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
            {queue && running && (
              <p className="text-xs text-muted-foreground">
                {queue.waitingHours
                  ? "⏸ Blokada godzinowa — kolejka wznowi się o 08:30."
                  : queue.nextInSec !== null
                    ? `Kolejny SMS za ~${queue.nextInSec} s`
                    : "Wysyłam…"}
                {queue.sim ? ` · karta: ${queue.sim}` : ""}
                {queue.paused ? " · wstrzymano" : ""}
              </p>
            )}
          </div>
        )}

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {items.map((i) => {
            const state = states[i.lead.id];
            return (
              <div
                key={i.lead.id}
                className="glass-soft flex items-start gap-3 rounded-xl p-3"
              >
                <div className="pt-0.5">
                  {state === "ok" ? (
                    <CheckCircle2 className="size-4 text-primary" />
                  ) : state === "error" ? (
                    <XCircle className="size-4 text-destructive" />
                  ) : running ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <MessageSquare className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {i.lead.nazwa}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {i.lead.telefon}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {i.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          {running ? (
            <>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={async () => {
                  const bridge = getBridge();
                  if (queue?.paused) {
                    await bridge?.resumeBulk?.();
                    setQueue((q) => (q ? { ...q, paused: false } : q));
                  } else {
                    await bridge?.pauseBulk?.();
                    setQueue((q) => (q ? { ...q, paused: true } : q));
                  }
                }}
              >
                {queue?.paused ? (
                  <>
                    <Play className="mr-2 size-4" /> Wznów
                  </>
                ) : (
                  <>
                    <Pause className="mr-2 size-4" /> Pauza
                  </>
                )}
              </Button>
              <Button variant="destructive" onClick={stop} className="rounded-xl">
                <Square className="mr-2 size-4" /> Stop
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                className="rounded-xl"
              >
                Anuluj
              </Button>
              <Button onClick={start} className="rounded-xl">
                <Send className="mr-2 size-4" /> Wyślij masowo SMS
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BaseTab() {
  const queryClient = useQueryClient();
  const { data: allLeads, isLoading, error } = useLeads();
  const setStatus = useLeadStatus();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [enriching, setEnriching] = useState(false);
  const [checking, setChecking] = useState<{ index: number; total: number } | null>(null);
  const [domainChecking, setDomainChecking] = useState<DomainProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const phonesFileRef = useRef<HTMLInputElement>(null);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [phonesText, setPhonesText] = useState("");
  const [phonesLabel, setPhonesLabel] = useState("Moja lista");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [briefFilter, setBriefFilter] = useState<BriefingFilter | null>(null);
  const [dealLead, setDealLead] = useState<LeadRow | null>(null);
  const block = useBlockLead();

  const data = useMemo(() => {
    const q = query.toLowerCase().trim();
    const now = new Date();
    return (allLeads ?? []).filter((l) => {
      if (briefFilter && !matchesBriefing(l, briefFilter, now)) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      return [l.nazwa, l.adres, l.miasto, l.nisza, l.telefon, l.notatki, l.zrodlo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [allLeads, query, statusFilter, briefFilter]);

  // Dociąga e-mail, NIP i profile społecznościowe z publicznych stron (tylko na Macu).
  const enrichAll = async () => {
    const targets = data.filter((l) => !l.dane_wzbogacone_at).slice(0, 25);
    if (targets.length === 0) {
      toast.info("Wszystkie firmy z tej listy mają już dodatkowe dane");
      return;
    }
    setEnriching(true);
    let found = 0;
    let withSite = 0;
    let shared = 0;
    for (const lead of targets) {
      try {
        const extra = await enrichLead({
          nazwa: lead.nazwa,
          miasto: lead.miasto,
          adres: lead.adres,
          mapy_url: lead.mapy_url,
        });

        // Sprawdzamy, czy numer nie krąży po katalogach firmowych zamiast należeć do firmy.
        let telefonStatus: string | null = null;
        if (lead.telefon) {
          const check = await verifyPhone(lead.telefon);
          if (check?.ok) {
            telefonStatus = check.verdict;
            if (check.verdict === "shared") shared++;
          }
        }

        await updateLead(lead.id, {
          ...extra,
          ...(telefonStatus ? { telefon_status: telefonStatus } : {}),
          dane_wzbogacone_at: new Date().toISOString(),
        });
        if (extra.email || extra.nip || extra.social || extra.imie || extra.strona) found++;
        if (extra.strona) withSite++;
      } catch {
        /* pomijamy pojedyncze błędy */
      }
    }
    setEnriching(false);
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    toast.success(
      `Sprawdzono ${targets.length} firm — nowe dane dla ${found}` +
        (withSite > 0 ? `, w tym ${withSite} ma jednak stronę` : "") +
        (shared > 0 ? `, ${shared} z numerem z katalogów` : ""),
    );
  };

  // Sprawdza w wynikach wyszukiwania, czy firma ma własną stronę z tym numerem.
  // Gdy tak — lead znika z bazy, bo strony już nie potrzebuje.
  const checkWebsites = async () => {
    const targets = data.filter((l) => l.telefon).map((l) => l.id);
    if (targets.length === 0) {
      toast.info("Brak firm z numerem telefonu do sprawdzenia");
      return;
    }
    setChecking({ index: 0, total: targets.length });
    try {
      const res = await purgeLeadsWithWebsite(targets, (p) => setChecking(p));
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(
        res.removed > 0
          ? `Sprawdzono ${res.checked} firm — usunięto ${res.removed}, bo mają już stronę`
          : `Sprawdzono ${res.checked} firm — żadna nie ma własnej strony`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się sprawdzić stron");
    } finally {
      setChecking(null);
    }
  };

  // Asystent wolnych domen .pl — dla każdej firmy bez strony WWW proponuje
  // domenę i sprawdza w WHOIS/DNS, czy jest wolna (na Macu; w podglądzie symulacja).
  const checkFreeDomains = async () => {
    const targets = data.filter((l) => !l.strona && !l.suggested_free_domain);
    if (targets.length === 0) {
      toast.info("Wszystkie firmy z tej listy mają już stronę albo sprawdzoną domenę");
      return;
    }
    setDomainChecking({ index: 0, total: targets.length, name: "", found: 0 });
    try {
      const res = await checkDomainsBulk(data, (p) => setDomainChecking(p));
      // W podglądzie przeglądarki zapisujemy wyniki lokalnie (na Macu robi to proces główny).
      for (const [id, domain] of res.results) {
        await updateLead(id, { suggested_free_domain: domain });
      }
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(
        res.found > 0
          ? `Sprawdzono ${res.checked} firm — znaleziono ${res.found} wolnych domen .pl`
          : `Sprawdzono ${res.checked} firm — żadna proponowana domena nie jest wolna`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się sprawdzić domen");
    } finally {
      setDomainChecking(null);
    }
  };

  const addPhones = async () => {
    const label = phonesLabel.trim() || "Moja lista";
    const rows = parsePhoneList(phonesText, label);
    if (rows.length === 0) {
      toast.error("Nie znalazłem żadnego poprawnego numeru (9 cyfr)");
      return;
    }
    try {
      const added = await importLeads(rows);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(
        `Dodano ${added} numerów` +
          (rows.length - added > 0 ? ` (${rows.length - added} już było w bazie)` : ""),
      );
      setPhonesText("");
      setPhonesOpen(false);
      setQuery(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nie udało się dodać numerów");
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = JSON.parse(text);
      const added = await importLeads(Array.isArray(rows) ? rows : []);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`Dodano ${added} nowych firm z kopii`);
    } catch {
      toast.error("Nie udało się wczytać pliku kopii");
    }
  };


  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteLead(id);
    },
    onSuccess: () => {
      toast.success("Lead usunięty");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const wipeAll = useMutation({
    mutationFn: () => deleteAllLeads(),
    onSuccess: (removed) => {
      toast.success(`Usunięto ${removed} leadów — baza jest pusta`);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="workspace-section">
      <CardContent className="p-0">
        <MorningBriefing
          leads={allLeads ?? []}
          active={briefFilter}
          onFilterChange={(f) => {
            setBriefFilter(f);
            if (f) {
              setStatusFilter("all");
              setView("kanban");
            }
          }}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj: nazwa, miasto, branża, telefon..."
            className="h-11 min-w-[12rem] flex-1 rounded-xl"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="glass-soft h-11 rounded-xl px-3 text-sm"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="nowy">Nowe</option>
            <option value="do_dzwonienia">Do dzwonienia</option>
            <option value="zadzwoniono">Obdzwonione</option>
            <option value="wyslano_wiadomosc">Wysłana wiadomość</option>
            <option value="odpisal">Odpisał</option>
            <option value="blad_dostarczenia">Błąd dostarczenia</option>
            <option value="do_oferty">Do oferty</option>
            <option value="oferta_wyslana">Oferta wysłana</option>
          </select>
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => exportBackup()}
          >
            Kopia zapasowa
          </Button>
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => fileRef.current?.click()}
          >
            Wczytaj kopię
          </Button>
          <Dialog open={phonesOpen} onOpenChange={setPhonesOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl">
                Dodaj swoje numery
              </Button>
            </DialogTrigger>
            <DialogContent className="glass rounded-3xl border-0">
              <DialogHeader>
                <DialogTitle>Dodaj swoją listę numerów</DialogTitle>
                <DialogDescription>
                  Wklej numery — każdy w osobnej linii. Możesz dopisać nazwę obok numeru, np.
                  „Jan Kowalski 600 123 456”. Albo wczytaj plik CSV / TXT.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={phonesText}
                onChange={(e) => setPhonesText(e.target.value)}
                rows={8}
                placeholder={"600 123 456\nAuto Serwis Nowak; +48 501 222 333"}
                className="rounded-xl"
              />
              <Input
                value={phonesLabel}
                onChange={(e) => setPhonesLabel(e.target.value)}
                placeholder="Nazwa listy (np. Moja lista)"
                className="rounded-xl"
              />
              <input
                ref={phonesFileRef}
                type="file"
                accept=".csv,.txt,text/plain,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) { const txt = await file.text(); setPhonesText((t) => (t ? t + "\n" : "") + txt); }
                  e.target.value = "";
                }}
              />
              <p className="text-sm text-muted-foreground">
                Rozpoznane numery: {parsePhoneList(phonesText).length}
              </p>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => phonesFileRef.current?.click()}
                >
                  Wczytaj plik
                </Button>
                <Button className="rounded-xl" onClick={() => void addPhones()}>
                  Dodaj do bazy
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {isDesktop() && (
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              disabled={enriching}
              onClick={enrichAll}
            >
              {enriching ? "Zbieram dane..." : "Wzbogać dane"}
            </Button>
          )}
          {isDesktop() && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl"
                  disabled={checking !== null || data.length === 0}
                >
                  {checking
                    ? `Sprawdzam strony ${checking.index}/${checking.total}...`
                    : "Sprawdź strony WWW"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glass rounded-3xl border-0">
                <AlertDialogHeader>
                  <AlertDialogTitle>Sprawdzić firmy z tej listy?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Aplikacja poszuka w internecie strony każdej z {data.length} firm. Jeśli numer
                    telefonu firmy znajdzie się na jej własnej stronie, taka firma zostanie usunięta
                    z bazy — bo stronę już ma.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Anuluj</AlertDialogCancel>
                  <AlertDialogAction className="rounded-xl" onClick={() => void checkWebsites()}>
                    Sprawdź i usuń
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            disabled={domainChecking !== null || data.length === 0}
            onClick={() => void checkFreeDomains()}
            title="Dla każdej firmy bez strony WWW znajduje wolną domenę .pl (WHOIS/DNS)"
          >
            {domainChecking
              ? `Sprawdzam domeny ${domainChecking.index}/${domainChecking.total}...`
              : "🔍 Sprawdź wolne domeny .pl dla całej listy"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                className="h-11 rounded-xl"
                disabled={(allLeads ?? []).length === 0 || wipeAll.isPending}
              >
                <Trash2 className="mr-2 size-4" /> Usuń wszystkie leady
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass rounded-3xl border-0">
              <AlertDialogHeader>
                <AlertDialogTitle>Usunąć całą bazę?</AlertDialogTitle>
                <AlertDialogDescription>
                  Usuniętych zostanie {(allLeads ?? []).length} firm wraz z notatkami i ofertami.
                  Tego nie da się cofnąć — zrób najpierw kopię zapasową.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">Anuluj</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => wipeAll.mutate()}
                >
                  Usuń wszystko
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
              e.target.value = "";
            }}
          />
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Ładowanie bazy...</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && data.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {(allLeads ?? []).length === 0
              ? "Baza jest pusta. Zapisz pierwszego leada z wyszukiwarki."
              : "Brak firm pasujących do filtrów."}
          </p>
        )}
        {data && data.length > 0 && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {data.length} {data.length === 1 ? "lead" : "leadów"} w bazie
              </p>
              <div className="flex items-center gap-2">
                <div className="glass-soft flex rounded-xl p-1">
                  <Button
                    size="sm"
                    variant={view === "kanban" ? "secondary" : "ghost"}
                    className="h-8 rounded-lg"
                    onClick={() => setView("kanban")}
                  >
                    <Columns3 className="mr-1.5 size-4" /> Kanban
                  </Button>
                  <Button
                    size="sm"
                    variant={view === "list" ? "secondary" : "ghost"}
                    className="h-8 rounded-lg"
                    onClick={() => setView("list")}
                  >
                    <ListIcon className="mr-1.5 size-4" /> Lista
                  </Button>
                </div>
                <BulkSendDialog leads={data} />
              </div>
            </div>
            <CloseDealDialog lead={dealLead} onClose={() => setDealLead(null)} />
            {view === "kanban" ? (
              <LeadKanban
                leads={data}
                onMove={(id, status) => {
                  // Upuszczenie w kolumnie „Sukces” otwiera modal z kwotą zlecenia.
                  if (status === "sukces") {
                    const lead = data.find((l) => l.id === id);
                    if (lead) setDealLead(lead);
                    return;
                  }
                  setStatus.mutate({ id, status });
                }}
                onBlock={(lead) => block.mutate(lead)}
                onCloseDeal={(lead) => setDealLead(lead)}
              />
            ) : (
            <>
            {/* Telefon: lista kart */}
            <div className="space-y-3 md:hidden">
              {data.map((lead) => (
                <div key={lead.id} className="glass-soft space-y-2 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        `${lead.nazwa} ${lead.adres ?? ""}`.trim(),
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1 font-medium leading-tight underline-offset-4 hover:text-primary hover:underline"
                    >
                      {lead.nazwa}
                    </a>
                    <Badge variant="secondary" className="shrink-0 rounded-full">
                      <Star className="mr-1 size-3 text-primary" />
                      {lead.ocena ?? "—"} · {lead.liczba_opinii ?? "—"}
                    </Badge>
                  </div>
                  {lead.adres && (
                    <p className="text-xs text-muted-foreground">{lead.adres}</p>
                  )}
                  {lead.notatki && <p className="text-xs text-primary/90">{lead.notatki}</p>}
                  <LeadPerson lead={lead} />
                  {lead.telefon && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="w-full text-sm text-muted-foreground">
                        <PhoneLine phone={lead.telefon} />
                      </span>
                      <Button asChild size="sm" variant="outline" className="min-h-11 rounded-xl">
                        <a href={`tel:${lead.telefon.replace(/\s+/g, "")}`}>
                          <Phone className="mr-2 size-4" /> Zadzwoń
                        </a>
                      </Button>
                      <MessageButton
                        phone={lead.telefon}
                        vars={leadVars(lead)}
                        meta={leadMeta(lead)}
                        leadId={lead.id}
                        sentAt={lead.sms_sent_at ?? null}
                      />
                      <SentMark lead={lead} />

                    </div>
                  )}
                  <div className="flex items-center gap-1 pt-1">
                    <LeadActions lead={lead} onDelete={() => remove.mutate(lead.id)} setStatus={setStatus} />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: tabela */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nazwa</TableHead>
                    <TableHead className="text-right">Ocena</TableHead>
                    <TableHead className="text-right">Opinie</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead>Źródło</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(
                            `${lead.nazwa} ${lead.adres ?? ""}`.trim(),
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-4 transition-colors hover:text-primary hover:underline"
                          title="Szukaj w Google"
                        >
                          {lead.nazwa}
                        </a>
                        {lead.adres && (
                          <span className="block text-xs text-muted-foreground">{lead.adres}</span>
                        )}
                        <LeadPerson lead={lead} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{lead.ocena ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lead.liczba_opinii ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {lead.telefon ? (
                          <span className="inline-flex items-center gap-2">
                            <PhoneMessageLink
                              phone={lead.telefon}
                              vars={leadVars(lead)}
                              meta={leadMeta(lead)}
                              leadId={lead.id}
                              sentAt={lead.sms_sent_at ?? null}
                            />
                            <SentMark lead={lead} />
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full">
                          {lead.zrodlo}
                        </Badge>
                      </TableCell>
                      <TableCell className="flex items-center justify-end gap-1">
                        <LeadActions
                          lead={lead}
                          onDelete={() => remove.mutate(lead.id)}
                          setStatus={setStatus}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CallListTab() {
  const { data, isLoading, error } = useLeads();
  const setStatus = useLeadStatus();

  const toCall = (data ?? []).filter((l) => l.status === "do_dzwonienia");
  const done = (data ?? []).filter((l) => l.status === "zadzwoniono");

  return (
    <div className="space-y-6">
      <Card className="glass glass-sheen rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Lista do obdzwonienia</h2>
            <div className="flex items-center gap-2">
              <BulkSendDialog leads={toCall} />
              <Badge variant="secondary" className="rounded-full">
                {toCall.length} firm
              </Badge>
            </div>
          </div>
          {isLoading && <p className="text-sm text-muted-foreground">Ładowanie...</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {!isLoading && toCall.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Lista jest pusta. Dodaj firmy przyciskiem „Do dzwonienia” w wyszukiwarce lub w bazie.
            </p>
          )}
          <div className="grid gap-3">
            {toCall.map((lead) => (
              <div
                key={lead.id}
                className="glass-soft flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
              >
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{lead.nazwa}</p>
                  <p className="text-xs text-muted-foreground">{lead.adres ?? "Brak adresu"}</p>
                  {lead.notatki && (
                    <p className="mt-1 text-xs text-primary/90">{lead.notatki}</p>
                  )}
                </div>
                <LeadNotes lead={lead} />
                <p className="text-sm text-muted-foreground">
                  {lead.telefon ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <PhoneMessageLink phone={lead.telefon} vars={leadVars(lead)} meta={leadMeta(lead)} />
                      <PhoneLine phone={lead.telefon} />
                    </span>
                  ) : (
                    "Brak telefonu"
                  )}
                </p>
                {lead.telefon && (
                  <>
                    <Button asChild size="sm" className="rounded-xl">
                      <a href={`tel:${lead.telefon.replace(/\s+/g, "")}`}>
                        <Phone className="mr-2 size-4" /> Zadzwoń
                      </a>
                    </Button>
                    <MessageButton phone={lead.telefon} vars={leadVars(lead)} meta={leadMeta(lead)} />
                  </>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setStatus.mutate({ id: lead.id, status: "zadzwoniono" })}
                >
                  <Check className="mr-2 size-4" /> Obdzwonione
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setStatus.mutate({ id: lead.id, status: "do_oferty" })}
                >
                  <Send className="mr-2 size-4" /> Do oferty
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card className="glass rounded-3xl border-0 shadow-none">
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-base font-semibold">Już obdzwonione ({done.length})</h2>
            {done.map((lead) => (
              <div
                key={lead.id}
                className="glass-soft flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm"
              >
                <span className="flex-1 font-medium">{lead.nazwa}</span>
                <span className="text-muted-foreground">
                  {lead.telefon ? <PhoneLine phone={lead.telefon} /> : "—"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setStatus.mutate({ id: lead.id, status: "do_dzwonienia" })}
                >
                  <Undo2 className="mr-2 size-4" /> Wróć na listę
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OfferCard({ lead, sent }: { lead: LeadRow; sent?: boolean }) {
  const queryClient = useQueryClient();
  const setStatus = useLeadStatus();
  const [text, setText] = useState(lead.oferta ?? "");

  const save = useMutation({
    mutationFn: async (value: string) => {
      await updateLead(lead.id, { oferta: value });
    },
    onSuccess: () => {
      toast.success("Zapisano plan oferty");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteLead(id);
    },
    onSuccess: () => {
      toast.success("Oferta usunięta");
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="glass-soft space-y-3 rounded-2xl px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(`${lead.nazwa} ${lead.adres ?? ""}`.trim())}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:underline"
            title="Szukaj w Google"
          >
            {lead.nazwa}
          </a>
          <p className="text-xs text-muted-foreground">{lead.adres ?? "Brak adresu"}</p>
          {lead.notatki && <p className="mt-1 text-xs text-primary/90">{lead.notatki}</p>}
        </div>
        {lead.telefon && (
          <>
            <span className="w-full text-sm text-muted-foreground">
              <PhoneLine phone={lead.telefon} />
            </span>
            <Button asChild size="sm" variant="outline" className="rounded-xl">
              <a href={`tel:${lead.telefon.replace(/\s+/g, "")}`}>
                <Phone className="mr-2 size-4" /> Zadzwoń
              </a>
            </Button>
            <MessageButton phone={lead.telefon} vars={leadVars(lead)} meta={leadMeta(lead)} />
          </>
        )}
        {sent ? (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={() => setStatus.mutate({ id: lead.id, status: "do_oferty" })}
          >
            <Undo2 className="mr-2 size-4" /> Wróć na listę
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setStatus.mutate({ id: lead.id, status: "oferta_wyslana" })}
          >
            <Check className="mr-2 size-4" /> Oferta wysłana
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          aria-label="Usuń ofertę"
          title="Usuń ofertę"
          onClick={() => remove.mutate(lead.id)}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Co wysłać i kolejne kroki: np. link do przykładowej strony, cena, termin follow-upu..."
        className="glass-soft rounded-xl border-0"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          className="rounded-xl"
          disabled={save.isPending || text === (lead.oferta ?? "")}
          onClick={() => save.mutate(text)}
        >
          Zapisz plan
        </Button>
      </div>
    </div>
  );
}

function OfferTab() {
  const { data, isLoading, error } = useLeads();
  const toSend = (data ?? []).filter((l) => l.status === "do_oferty");
  const sent = (data ?? []).filter((l) => l.status === "oferta_wyslana");

  return (
    <div className="space-y-6">
      <Card className="glass glass-sheen rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Do wysłania oferty</h2>
            <Badge variant="secondary" className="rounded-full">
              {toSend.length} firm
            </Badge>
          </div>
          {isLoading && <p className="text-sm text-muted-foreground">Ładowanie...</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {!isLoading && toSend.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Pusto. Dodaj firmy ikoną koperty w „Mojej Bazie” lub przyciskiem „Do oferty”.
            </p>
          )}
          <div className="grid gap-3">
            {toSend.map((lead) => (
              <OfferCard key={lead.id} lead={lead} />
            ))}
          </div>
        </CardContent>
      </Card>

      {sent.length > 0 && (
        <Card className="glass rounded-3xl border-0 shadow-none">
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-base font-semibold">Oferta wysłana ({sent.length})</h2>
            {sent.map((lead) => (
              <OfferCard key={lead.id} lead={lead} sent />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function leadMeta(lead: LeadRow) {
  return {
    nisza: lead.nisza ?? lead.kategoria ?? null,
    wojewodztwo: lead.wojewodztwo ?? null,
    miasto: lead.miasto ?? null,
    adres: lead.adres ?? null,
  };
}

function leadVars(lead: LeadRow) {
  // Imię i płeć bierzemy tylko wtedy, gdy są pewne (imię ze słownika polskich imion),
  // inaczej wiadomość idzie w wariancie bezosobowym.
  const znane = certainGender(lead.imie ?? null);
  const zNazwy = znane ? null : certainPersonFromCompany(lead.nazwa);
  const imie = znane ? (lead.imie ?? null) : (zNazwy?.imie ?? null);
  const plec: Gender = znane ?? zNazwy?.plec ?? null;
  const pewnaPlec = Boolean(imie && plec);
  return {
    nazwa: lead.nazwa,
    adres: lead.adres,
    telefon: lead.telefon,
    ocena: lead.ocena ?? "",
    opinie: lead.liczba_opinii ?? "",
    notatki: lead.notatki,
    imie: imie ?? "",
    zwrot: pewnaPlec ? greeting(plec, imie) : "Dzień dobry",
    problem_strony: websiteProblemPhrase(lead.strona_problem),
    wolna_domena: lead.suggested_free_domain ?? "",
    pewnaPlec,
  };
}

/** Wiersz z danymi osoby kontaktowej — imię, płeć, e-mail, NIP. */
function LeadPerson({ lead }: { lead: LeadRow }) {
  const plec = (lead.plec as Gender) ?? null;
  if (!lead.wlasciciel && !lead.imie && !lead.email && !lead.nip && !lead.strona && !lead.suggested_free_domain && !lead.email_verified) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {(lead.wlasciciel || lead.imie) && (
        <Badge variant="outline" className="rounded-full text-xs font-normal">
          {lead.wlasciciel ?? lead.imie}
          {plec ? ` · ${genderLabel(plec)}` : ""}
        </Badge>
      )}
      {lead.email && (
        <Badge variant="outline" className="rounded-full text-xs font-normal">
          {lead.email}
        </Badge>
      )}
      {lead.nip && (
        <Badge variant="outline" className="rounded-full text-xs font-normal">
          NIP {lead.nip}
        </Badge>
      )}
      {lead.strona && (
        <Badge variant="destructive" className="rounded-full text-xs font-normal">
          <a href={lead.strona} target="_blank" rel="noopener noreferrer">
            Ma stronę: {lead.strona.replace(/^https?:\/\//, "")}
          </a>
        </Badge>
      )}
      {lead.suggested_free_domain && (
        <Badge className="rounded-full border border-amber-500/40 bg-amber-500/15 text-xs font-normal text-amber-600 dark:text-amber-400">
          🌐 Wolna domena: {lead.suggested_free_domain}
        </Badge>
      )}
      {lead.email_verified && (
        <Badge className="rounded-full border border-emerald-500/40 bg-emerald-500/15 text-xs font-normal text-emerald-600 dark:text-emerald-400">
          ✓ Zweryfikowany MX/SMTP
        </Badge>
      )}
    </div>
  );
}

function SentCounterBadge() {
  const { total, today } = useSentCounter();
  return (
    <div className="glass ml-auto flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-right">
      <MessageSquare className="size-4 text-primary" />
      <div className="leading-tight">
        <div className="text-base font-semibold tabular-nums sm:text-lg">{total}</div>
        <div className="text-[11px] text-muted-foreground">
          wysłane · dziś {today}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="rounded-xl text-xs"
        onClick={() => resetSent()}
        title="Wyzeruj licznik"
      >
        Reset
      </Button>
    </div>
  );
}

/** Szara koperta = do tej firmy wiadomość już poszła. */
function SentMark({ lead }: { lead: LeadRow }) {
  const shared = lead.telefon_status === "shared";
  if (!lead.sms_sent_at && !shared) return null;
  const when = lead.sms_sent_at ? new Date(lead.sms_sent_at).toLocaleString("pl-PL") : null;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {lead.sms_sent_at && (
        <span title={`Wiadomość już wysłana — ${when}`} className="inline-flex">
          <MailCheck className="size-4 text-muted-foreground/70" />
        </span>
      )}
      {shared && (
        <span
          title="Ten numer pojawia się w katalogach firmowych — może nie być numerem firmy"
          className="inline-flex"
        >
          <ShieldAlert className="size-4 text-amber-500" />
        </span>
      )}
    </span>
  );
}

/** Zapisuje ręczną wysyłkę: licznik i znacznik w bazie ruszają po kliknięciu wiadomości. */
function useManualSend(leadId?: string, sentAt?: string | null) {
  const queryClient = useQueryClient();
  return async () => {
    if (sentAt) {
      toast.info("Do tej firmy wiadomość już poszła — otwieram rozmowę bez liczenia");
      return;
    }
    incrementSent();
    if (leadId) {
      try {
        await updateLead(leadId, { sms_sent_at: new Date().toISOString() });
        queryClient.invalidateQueries({ queryKey: ["leads"] });
      } catch {
        /* brak zapisu nie blokuje wysyłki */
      }
    }
  };
}

function PhoneMessageLink({
  phone,
  vars,
  meta,
  leadId,
  sentAt,
}: {
  phone: string;
  vars: Parameters<typeof fillTemplate>[1];
  meta?: Parameters<typeof recordSentMessage>[0];
  leadId?: string;
  sentAt?: string | null;
}) {
  const { template, neutral } = useMessageTemplate();
  const href = useSmsHref(phone, buildMessage(template, neutral, vars));
  const register = useManualSend(leadId, sentAt);
  return (
    <a
      href={href}
      onClick={() => {
        void register();
        if (!sentAt && meta) recordSentMessage(meta);
      }}
      className="inline-block py-1 underline-offset-4 transition-colors hover:text-primary hover:underline"
      title="Napisz iMessage / SMS z gotową wiadomością"
    >
      {phone}
    </a>
  );
}

function MessageButton({
  phone,
  vars,
  meta,
  leadId,
  sentAt,
}: {
  phone: string;
  vars: Parameters<typeof fillTemplate>[1];
  meta?: Parameters<typeof recordSentMessage>[0];
  leadId?: string;
  sentAt?: string | null;
}) {
  const { template, neutral } = useMessageTemplate();
  const href = useSmsHref(phone, buildMessage(template, neutral, vars));
  const register = useManualSend(leadId, sentAt);
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={`min-h-11 rounded-xl ${sentAt ? "text-muted-foreground" : ""}`}
    >
      <a
        href={href}
        onClick={() => {
          void register();
          if (!sentAt && meta) recordSentMessage(meta);
        }}
      >
        {sentAt ? (
          <MailCheck className="mr-2 size-4" />
        ) : (
          <MessageSquare className="mr-2 size-4" />
        )}
        {sentAt ? "Wysłane" : "Napisz"}
      </a>
    </Button>
  );
}

function MessageTab() {
  const {
    template,
    neutral,
    templates,
    activeId,
    activeName,
    save,
    saveNeutral,
    rename,
    add,
    remove,
    setActive,
  } = useMessageTemplate();
  const { settings, save: saveSettings } = useSendSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [neutralDraft, setNeutralDraft] = useState<string | null>(null);
  const [spintaxPreview, setSpintaxPreview] = useState<string | null>(null);
  const value = draft ?? template;
  const neutralValue = neutralDraft ?? neutral;

  const preview = fillTemplate(value, {
    nazwa: "Stolarstwo Kowalski",
    adres: "ul. Sienkiewicza 12, Kielce",
    telefon: "+48 600 100 200",
    miasto: "Kielce",
    ocena: "4.9",
    opinie: 37,
    notatki: "ma tylko Facebooka",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <IssueTemplatesEditor />
      <SmsSpeedPanel count={settings.dailyLimit} />
      <Card className="glass rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold">Szablon wiadomości</h2>
            <p className="text-sm text-muted-foreground">
              Ta treść zostanie wklejona do Wiadomości (iMessage/SMS) po kliknięciu numeru.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeId}
              onChange={(e) => {
                setDraft(null);
                setActive(e.target.value);
              }}
              className="glass-soft h-11 min-w-[10rem] rounded-xl px-3 text-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Input
              value={activeName}
              onChange={(e) => rename(e.target.value)}
              className="h-11 w-40 rounded-xl"
              aria-label="Nazwa szablonu"
            />
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => { setDraft(null); add(); }}>
              Nowy
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              disabled={templates.length <= 1}
              onClick={() => { setDraft(null); remove(); }}
            >
              Usuń
            </Button>
          </div>
          <Textarea
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="rounded-2xl"
          />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {["{nazwa}", "{imie}", "{zwrot}", "{adres}", "{telefon}", "{miasto}", "{ocena}", "{opinie}", "{notatki}", "{problem_strony}", "{wolna_domena}"].map(
              (tag) => (
                <button
                  key={tag}
                  type="button"
                  className="glass-soft rounded-full px-3 py-1 transition-colors hover:text-primary"
                  onClick={() => setDraft(`${value}${tag}`)}
                >
                  {tag}
                </button>
              ),
            )}
          </div>
          {/* Spintax: podgląd na żywo + licznik kombinacji anty-spamowych */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() =>
                setSpintaxPreview(
                  parseSpintax(value, {
                    nazwa: "Stolarstwo Kowalski",
                    miasto: "Kielce",
                    branza: "stolarz",
                    imie: "Jan",
                    zwrot: "Panie Janie",
                    telefon: "+48 600 100 200",
                  }),
                )
              }
            >
              🎲 Wylosuj przykładowy wariant Spintax
            </Button>
            <span className="text-xs text-muted-foreground">
              Twój szablon generuje{" "}
              <span className="font-medium text-foreground">
                {countSpintaxCombinations(value)}
              </span>{" "}
              unikalnych kombinacji anty-spamowych
            </span>
          </div>
          {spintaxPreview && (
            <p className="glass-soft rounded-xl p-3 text-sm">{spintaxPreview}</p>
          )}
          <div className="flex gap-2">
            <Button
              className="rounded-xl"
              onClick={() => {
                save(value.trim());
                setDraft(null);
                toast.success("Szablon zapisany");
              }}
            >
              Zapisz szablon
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                save(DEFAULT_TEMPLATE);
                setDraft(null);
                toast.success("Przywrócono domyślny szablon");
              }}
            >
              Przywróć domyślny
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-3 pt-6">
          <div>
            <h2 className="text-base font-semibold">Wiadomość bezosobowa</h2>
            <p className="text-sm text-muted-foreground">
              Używana zawsze, gdy w nazwie firmy nie ma wyraźnego imienia — aplikacja nigdy nie
              zgaduje, czy piszesz do pani czy do pana.
            </p>
          </div>
          <Textarea
            value={neutralValue}
            onChange={(e) => setNeutralDraft(e.target.value)}
            rows={6}
            className="rounded-2xl"
          />
          <div className="flex gap-2">
            <Button
              className="rounded-xl"
              onClick={() => {
                saveNeutral(neutralValue.trim());
                setNeutralDraft(null);
                toast.success("Wiadomość bezosobowa zapisana");
              }}
            >
              Zapisz
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                saveNeutral(NEUTRAL_TEMPLATE);
                setNeutralDraft(null);
                toast.success("Przywrócono domyślną treść");
              }}
            >
              Przywróć domyślną
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass rounded-3xl border-0 shadow-none">

        <CardContent className="space-y-3 pt-6">
          <h2 className="text-base font-semibold">Podgląd</h2>
          <div className="glass-soft whitespace-pre-wrap rounded-2xl p-4 text-sm">{preview}</div>
          <p className="text-xs text-muted-foreground">
            Przykładowe dane. W aplikacji podstawiane są dane klikniętej firmy.
          </p>

          <div className="space-y-3 border-t border-border/50 pt-4">
            <h3 className="text-sm font-semibold">Masowa wysyłka</h3>
            <label className="flex items-center justify-between gap-3 text-sm">
              Dzienny limit wiadomości
              <Input
                type="number"
                min={1}
                max={500}
                value={settings.dailyLimit}
                onChange={(e) => saveSettings({ dailyLimit: Number(e.target.value) })}
                className="h-11 w-24 rounded-xl"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Pomijaj firmy z już wysłaną wiadomością
              <input
                type="checkbox"
                checked={settings.skipAlreadySent}
                onChange={(e) => saveSettings({ skipAlreadySent: e.target.checked })}
                className="size-5"
              />
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MapTab() {
  const { stats, niches, reset } = useRegionStats();
  const [niche, setNiche] = useState<string | null>(null);
  const active = niche && stats[niche] ? niche : (niches[0] ?? null);
  const counts = active ? (stats[active] ?? {}) : {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const ranking = REGION_SHAPES.map((r) => ({ ...r, count: counts[r.id] ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="glass rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-base font-semibold">Wysłane wiadomości w województwach</h2>
            {niches.length > 0 && (
              <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={reset}>
                Wyzeruj statystyki
              </Button>
            )}
          </div>

          {niches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Jeszcze nie ma danych. Wyszukaj branżę i wyślij wiadomości — liczby pojawią się na mapie.
            </p>
          ) : (
            <>
              <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {niches.map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={n === active ? "default" : "outline"}
                    className="min-h-10 shrink-0 rounded-xl"
                    onClick={() => setNiche(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <div className="mx-auto max-w-xl">
                <PolandMap counts={counts} />
              </div>
              <p className="text-sm text-muted-foreground">
                Nisza <span className="font-medium text-foreground">{active}</span> — łącznie {total}{" "}
                {total === 1 ? "wiadomość" : "wiadomości"}.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="glass rounded-3xl border-0 shadow-none">
        <CardContent className="space-y-3 pt-6">
          <h3 className="text-base font-semibold">Ranking województw</h3>
          {ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak wysłanych wiadomości w tej niszy.</p>
          ) : (
            <ul className="space-y-2">
              {ranking.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{regionNameOf(r.id)}</span>
                  <Badge variant="secondary" className="rounded-full tabular-nums">
                    {r.count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NichesTab() {
  const { data } = useLeads();
  return <NicheStatsTab leads={data ?? []} />;
}
