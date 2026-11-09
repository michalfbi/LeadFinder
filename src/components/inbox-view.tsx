import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Bot,
  ChevronDown,
  CircleAlert,
  Inbox,
  KeyRound,
  Loader2,
  Mail,
  PlugZap,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { GLASS } from "@/components/sniper-tab";
import {
  CATEGORY_LABEL,
  REPLY_FIELDS,
  approveReply,
  blockReply,
  dismissReply,
  inboxBridge,
  listInbox,
  onInboxChange,
  readInboxSettings,
  resetInboxPreview,
  saveInboxSettings,
  type InboxMarket,
  type InboxMessage,
  type InboxSettings,
  type ReplyCategory,
  type ReplyData,
} from "@/lib/inbox-store";

const CATEGORY_TONE: Record<ReplyCategory, string> = {
  zainteresowany: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  cena: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  pytanie: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  nie_teraz: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  inne: "border-white/15 bg-white/5 text-muted-foreground",
  odmowa: "border-red-400/40 bg-red-400/10 text-red-200",
  nieufnosc: "border-red-400/40 bg-red-400/10 text-red-200",
  autoodpowiedz: "border-white/15 bg-white/5 text-muted-foreground",
};

type Section = "pending" | "blocked" | "done";
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "pending", label: "Do decyzji" },
  { id: "blocked", label: "Zablokowane automatycznie" },
  { id: "done", label: "Obsłużone" },
];
const STATUS_NOTE: Record<string, string> = {
  sent: "Wysłano odpowiedź",
  dismissed: "Pominięto",
  ignored: "Automatyczna odpowiedź, bez reakcji",
  blocked: "Kontakt zakończony na stałe",
};

function sectionOf(m: InboxMessage): Section {
  if (m.status === "pending" || m.status === "sending") return "pending";
  return m.status === "blocked" ? "blocked" : "done";
}
function when(at: number): string {
  return new Date(at).toLocaleString("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function errorText(err: unknown): string {
  return err instanceof Error
    ? err.message.replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        "",
      )
    : String(err);
}

function MessageCard({
  message,
  simulated,
  onDone,
}: {
  message: InboxMessage;
  simulated: boolean;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(message.draft);
  const [busy, setBusy] = useState<"send" | "skip" | "block" | null>(null);
  const [showOurs, setShowOurs] = useState(false);
  useEffect(() => setDraft(message.draft), [message.id, message.draft]);

  const act = async (kind: "send" | "skip" | "block") => {
    setBusy(kind);
    try {
      if (kind === "send") {
        await approveReply(message.id, draft);
        toast.success(
          simulated
            ? "Podgląd: odpowiedź oznaczona jako wysłana (nic nie wyszło)."
            : "Odpowiedź wysłana.",
        );
      } else if (kind === "skip") {
        await dismissReply(message.id);
        toast("Pominięto. Kontakt zostaje w bazie bez odpowiedzi.");
      } else {
        await blockReply(message.id);
        toast("Kontakt zablokowany we wszystkich kanałach.");
      }
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      onDone();
    }
  };

  const open = message.status === "pending";
  const Channel = message.channel === "sms" ? Smartphone : Mail;
  return (
    <article className={`${GLASS} p-4 sm:p-5`}>
      <header className="flex flex-wrap items-center gap-2">
        <Channel
          className="size-4 shrink-0 text-muted-foreground"
          aria-label={message.channel === "sms" ? "SMS" : "E-mail"}
        />
        <h4 className="min-w-0 flex-1 basis-40 truncate font-semibold">
          {message.leadName || message.address || "Nieznany nadawca"}
        </h4>
        <Badge variant="outline" className={CATEGORY_TONE[message.category]}>
          {CATEGORY_LABEL[message.category]}
        </Badge>
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title="Pewność rozpoznania"
        >
          {message.source === "ai" ? "AI" : "reguły"} ·{" "}
          {Math.round(message.confidence * 100)}%
        </span>
      </header>
      <p className="mt-1 break-all text-xs text-muted-foreground">
        {message.address} · {message.market === "US" ? "🇺🇸 USA" : "🇵🇱 Polska"} ·{" "}
        {when(message.at)}
      </p>

      <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm">
        {message.body}
      </blockquote>
      {message.outbound && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showOurs}
            onClick={() => setShowOurs((v) => !v)}
          >
            <ChevronDown
              className={`size-3 transition-transform ${showOurs ? "rotate-180" : ""}`}
            />{" "}
            Nasza wiadomość, na którą odpisano
          </button>
          {showOurs && (
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {message.outbound}
            </p>
          )}
        </div>
      )}

      {message.status === "sending" && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Wysyłka została przerwana w trakcie. Sprawdź w poczcie lub
          Wiadomościach, czy odpowiedź wyszła, zanim wyślesz ją ponownie.
        </p>
      )}

      {open ? (
        <div className="mt-4">
          <Label
            htmlFor={`draft-${message.id}`}
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          >
            Propozycja odpowiedzi
            {message.draftFromAi && (
              <span className="flex items-center gap-1 text-sky-300">
                <Bot className="size-3" />
                napisana przez AI
              </span>
            )}
            {message.needsEdit && !draft.trim() && (
              <span className="text-amber-300">
                brak szablonu dla tej kategorii, napisz odpowiedź sam
              </span>
            )}
          </Label>
          <Textarea
            id={`draft-${message.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(
              16,
              Math.max(
                4,
                draft
                  .split("\n")
                  .reduce(
                    (n, line) => n + Math.max(1, Math.ceil(line.length / 48)),
                    1,
                  ),
              ),
            )}
            className="mt-1.5 rounded-xl"
            placeholder="Twoja odpowiedź…"
          />
          {message.aiError && (
            <p className="mt-1.5 text-xs text-amber-300">
              AI nie odpowiedziało ({message.aiError}). Użyto samych reguł.
            </p>
          )}
          {message.sendError && (
            <p className="mt-1.5 text-xs text-red-300">
              Ostatnia próba wysyłki nie powiodła się: {message.sendError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="rounded-xl"
              disabled={busy !== null || !draft.trim()}
              onClick={() => void act("send")}
            >
              {busy === "send" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Send />
              )}{" "}
              Wyślij odpowiedź
            </Button>
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={busy !== null}
              onClick={() => void act("skip")}
            >
              <X /> Pomiń
            </Button>
            <Button
              variant="ghost"
              className="rounded-xl text-red-300 hover:text-red-200"
              disabled={busy !== null}
              onClick={() => void act("block")}
            >
              <Ban /> Zablokuj kontakt
            </Button>
          </div>
        </div>
      ) : message.status === "sending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={busy !== null}
            onClick={() => void act("skip")}
          >
            <X /> Zamknij bez ponawiania
          </Button>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          <p>{STATUS_NOTE[message.status] ?? message.status}</p>
          {message.sentText && (
            <p className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-white/10 px-3 py-2 text-foreground/80">
              {message.sentText}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function SettingsPanel({ simulated }: { simulated: boolean }) {
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [market, setMarket] = useState<InboxMarket>("US");
  const [data, setData] = useState<Record<InboxMarket, ReplyData> | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const apply = useCallback((s: InboxSettings) => {
    setSettings(s);
    setData(s.data);
    setModel(s.ai.model);
    setLimit(String(s.ai.dailyLimit));
  }, []);
  useEffect(() => {
    readInboxSettings()
      .then(apply)
      .catch((err) => toast.error(errorText(err)));
  }, [apply]);

  if (!settings || !data)
    return (
      <p className="p-5 text-sm text-muted-foreground">Wczytywanie ustawień…</p>
    );

  const save = async (
    extra: { enabled?: boolean; clearKey?: boolean } = {},
  ) => {
    setBusy("save");
    try {
      const next = await saveInboxSettings({
        data,
        ai: {
          model: model.trim() || settings.ai.model,
          dailyLimit: Math.max(0, Math.round(Number(limit) || 0)),
          ...(key.trim() ? { key: key.trim() } : {}),
          ...extra,
        },
      });
      apply(next);
      setKey("");
      toast.success("Zapisano. Nowe dane trafią do kolejnych propozycji.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    const bridge = inboxBridge();
    if (!bridge) return;
    setBusy("test");
    setTestResult(null);
    try {
      const result = await bridge.testAi();
      setTestResult({
        ok: result.ok,
        text: result.ok
          ? `Połączenie działa. Odpowiedź modelu: „${result.output.slice(0, 120)}”`
          : result.output,
      });
    } catch (err) {
      setTestResult({ ok: false, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-8 p-4 sm:p-5 lg:grid-cols-2">
      <section>
        <h4 className="font-semibold">Dane do szablonów</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Te wartości są wstawiane w propozycje odpowiedzi. AI też dostaje
          wyłącznie je i nie może podać innej ceny ani terminu.
        </p>
        <div
          className="apple-segment mt-4 flex w-fit"
          role="group"
          aria-label="Rynek"
        >
          {(["US", "PL"] as const).map((m) => (
            <Button
              key={m}
              variant="ghost"
              size="sm"
              aria-pressed={market === m}
              onClick={() => setMarket(m)}
              className={
                market === m ? "apple-segment-active" : "text-muted-foreground"
              }
            >
              {m === "US" ? "🇺🇸 USA" : "🇵🇱 Polska"}
            </Button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {REPLY_FIELDS.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`reply-${market}-${field.key}`}>
                {field.label}
              </Label>
              <Input
                id={`reply-${market}-${field.key}`}
                className="mt-1 rounded-xl"
                value={data[market][field.key]}
                onChange={(e) =>
                  setData({
                    ...data,
                    [market]: { ...data[market], [field.key]: e.target.value },
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="flex items-center gap-2 font-semibold">
          <Bot className="size-4" /> Pomocnik AI (fal.ai)
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Reguły rozpoznają oczywiste odpowiedzi. Przy niepewnych AI czyta
          wiadomość, przypisuje kategorię i proponuje tekst. Niczego nie wysyła,
          decyzja zawsze należy do Ciebie.
        </p>
        {simulated ? (
          <p className="mt-4 rounded-xl border border-white/10 px-3 py-2 text-sm text-muted-foreground">
            Klucz fal.ai można wpisać tylko w aplikacji na Macu. Jest tam
            szyfrowany w pęku kluczy systemu, a w przeglądarce nie byłby
            bezpieczny.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="fal-key" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Klucz API fal.ai
              </Label>
              <Input
                id="fal-key"
                type="password"
                autoComplete="off"
                className="mt-1 rounded-xl"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  settings.ai.keyConfigured
                    ? "Zapisany (wpisz nowy, aby podmienić)"
                    : "Wklej klucz z fal.ai → API Keys"
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Zapisywany w formie zaszyfrowanej, nigdy nie trafia do plików
                projektu ani logów.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="fal-model">Model</Label>
                <Input
                  id="fal-model"
                  className="mt-1 rounded-xl"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="fal-limit">Dzienny limit zapytań</Label>
                <Input
                  id="fal-limit"
                  inputMode="numeric"
                  className="mt-1 rounded-xl"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
                />
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  Dziś użyto: {settings.ai.usedToday}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2.5">
              <Label htmlFor="fal-enabled" className="text-sm">
                Używaj AI przy niepewnych odpowiedziach
              </Label>
              <Switch
                id="fal-enabled"
                checked={settings.ai.enabled}
                disabled={
                  busy !== null || (!settings.ai.keyConfigured && !key.trim())
                }
                onCheckedChange={(v) => void save({ enabled: v })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="rounded-xl"
                disabled={busy !== null || !settings.ai.keyConfigured}
                onClick={() => void test()}
              >
                {busy === "test" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PlugZap />
                )}{" "}
                Test połączenia
              </Button>
              {settings.ai.keyConfigured && (
                <Button
                  variant="ghost"
                  className="rounded-xl text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => void save({ clearKey: true, enabled: false })}
                >
                  Usuń klucz
                </Button>
              )}
            </div>
            {!settings.ai.keyConfigured && (
              <p className="text-xs text-muted-foreground">
                Najpierw zapisz klucz, potem uruchom test.
              </p>
            )}
            {testResult && (
              <p
                role="status"
                className={`break-words text-sm ${testResult.ok ? "text-emerald-300" : "text-red-300"}`}
              >
                {testResult.text}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="lg:col-span-2">
        <Button
          className="rounded-xl"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}{" "}
          Zapisz ustawienia
        </Button>
      </div>
    </div>
  );
}

/** Skrzynka odpowiedzi: AI i reguły proponują, właściciel zatwierdza. */
export function InboxView() {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [section, setSection] = useState<Section>("pending");
  const [showSettings, setShowSettings] = useState(false);
  const [simulated, setSimulated] = useState(false);

  const refresh = useCallback(() => {
    listInbox()
      .then(setMessages)
      .catch((err) => {
        setMessages([]);
        toast.error(errorText(err));
      });
  }, []);
  useEffect(() => {
    setSimulated(!inboxBridge());
    refresh();
    return onInboxChange(refresh);
  }, [refresh]);

  const groups = useMemo(() => {
    const out: Record<Section, InboxMessage[]> = {
      pending: [],
      blocked: [],
      done: [],
    };
    for (const m of messages ?? []) out[sectionOf(m)].push(m);
    for (const list of Object.values(out)) list.sort((a, b) => b.at - a.at);
    return out;
  }, [messages]);
  const visible = groups[section];

  return (
    <div className="space-y-5">
      <div className={`${GLASS} flex flex-wrap items-start gap-3 p-4 sm:p-5`}>
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" />
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Nic nie wychodzi bez Twojej zgody.
          </span>{" "}
          Odmowy i wyrazy nieufności kończą kontakt na stałe i nie dostają
          odpowiedzi. Pozostałe wiadomości czekają tu z gotową propozycją, którą
          możesz poprawić przed wysłaniem.
          {simulated &&
            " To podgląd na przykładowych danych: przyciski niczego nie wysyłają."}
        </p>
        <div className="flex flex-wrap gap-2">
          {simulated && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-muted-foreground"
              onClick={resetInboxPreview}
            >
              <RotateCcw /> Przywróć przykłady
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <ChevronDown
              className={`transition-transform ${showSettings ? "rotate-180" : ""}`}
            />{" "}
            Dane do szablonów i AI
          </Button>
        </div>
      </div>

      {showSettings && (
        <div className={GLASS}>
          <SettingsPanel simulated={simulated} />
        </div>
      )}

      <div
        className="apple-segment flex h-auto w-fit max-w-full flex-wrap"
        role="group"
        aria-label="Widok skrzynki"
      >
        {SECTIONS.map((s) => (
          <Button
            key={s.id}
            variant="ghost"
            size="sm"
            aria-pressed={section === s.id}
            onClick={() => setSection(s.id)}
            className={
              section === s.id
                ? "apple-segment-active"
                : "text-muted-foreground"
            }
          >
            {s.label}{" "}
            <span className="tabular-nums opacity-70">
              {groups[s.id].length}
            </span>
          </Button>
        ))}
      </div>

      {messages === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Wczytywanie…
        </p>
      ) : visible.length === 0 ? (
        <div
          className={`${GLASS} flex flex-col items-center gap-2 px-6 py-12 text-center`}
        >
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {section === "pending"
              ? "Brak odpowiedzi do decyzji"
              : section === "blocked"
                ? "Nic nie zostało zablokowane"
                : "Jeszcze nic nie obsłużono"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {section === "pending"
              ? "Nowe odpowiedzi na SMS-y i e-maile pojawią się tu same. Dostaniesz też powiadomienie na Telegramie, jeśli jest połączony."
              : section === "blocked"
                ? "Tu trafiają odmowy i wyrazy nieufności. Możesz sprawdzić, czy program ocenił je trafnie."
                : "Tu zobaczysz wysłane odpowiedzi, pominięte wiadomości i autorespondery."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((m) => (
            <MessageCard
              key={m.id}
              message={m}
              simulated={simulated}
              onDone={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
