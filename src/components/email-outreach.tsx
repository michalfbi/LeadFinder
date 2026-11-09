import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Inbox,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailSettings, useEmails } from "@/components/email-workspace";
import { GLASS } from "@/components/sniper-tab";
import { US, isRefusal, usFooterPreview } from "@/lib/market-outreach";
import {
  emailBridge,
  readEmailMock,
  updateEmail,
  writeEmailMock,
  type DomainCheck,
  type EmailLead,
  type EmailQueue,
  type EmailSendResult,
} from "@/lib/email-store";

const STATUS_LABEL: Record<string, string> = {
  nowy: "Do wysyłki",
  wyslano_wiadomosc: "Wysłano",
  odpisal: "Odpowiedź",
  zablokowany: "Rezygnacja",
  blad_wysylki: "Błąd wysyłki",
  sukces: "Sprzedaż",
};

function DnsRow({
  ok,
  label,
  hint,
}: {
  ok: boolean | null;
  label: string;
  hint: string;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
      ) : (
        <CircleAlert
          className={`mt-0.5 size-4 shrink-0 ${ok === null ? "text-muted-foreground" : "text-amber-400"}`}
        />
      )}
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </li>
  );
}

function DomainSetup() {
  const [domain, setDomain] = useState("");
  const [selector, setSelector] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const desktop = Boolean(emailBridge()?.checkDomain);

  useEffect(() => {
    emailBridge()
      ?.settings()
      .then((s) => {
        const from = String(s["from"] ?? "");
        if (from.includes("@")) setDomain(from.split("@")[1] ?? "");
        setSelector(String(s["dkimSelector"] ?? ""));
      })
      .catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const res = await emailBridge()?.checkDomain?.(domain, selector);
      if (res) setCheck(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`${GLASS} space-y-4 p-5`}
      aria-label="Domena do wysyłki"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <ShieldCheck className="size-5 text-amber-400" /> Osobna domena do
        wysyłki
      </h3>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          Kup osobną domenę podobną do głównej (np. z końcówką .com albo
          dopiskiem „studio”). Gdyby wpadła do spamu, główna domena zostaje
          czysta.
        </li>
        <li>
          Załóż na niej skrzynkę (np. Google Workspace lub Zoho Mail) i dodaj w
          DNS rekordy SPF, DKIM i DMARC według instrukcji dostawcy poczty.
        </li>
        <li>
          Ustaw przekierowanie domeny na swoją stronę, żeby odbiorca widział,
          kim jesteś.
        </li>
        <li>
          Rozgrzewaj skrzynkę: zacznij od {US.email.dailyLimit} e-maili dziennie
          i zwiększaj limit stopniowo przez 3–4 tygodnie.
        </li>
      </ol>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="dns-domain">Domena nadawcy</Label>
          <Input
            id="dns-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="twojadomena.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dns-selector">Selektor DKIM (opcjonalnie)</Label>
          <Input
            id="dns-selector"
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder="np. google"
          />
        </div>
        <Button
          variant="secondary"
          disabled={!desktop || busy || !domain.trim()}
          onClick={() => void run()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sprawdź
          DNS
        </Button>
      </div>
      {!desktop && (
        <p className="text-xs text-muted-foreground">
          Sprawdzanie DNS działa w aplikacji na Macu.
        </p>
      )}
      {check && (
        <ul className="space-y-2">
          <DnsRow
            ok={check.mx}
            label="MX — domena przyjmuje pocztę"
            hint={
              check.mx
                ? "Rekord MX jest ustawiony."
                : "Brak rekordu MX: odpowiedzi nie dotrą."
            }
          />
          <DnsRow
            ok={Boolean(check.spf)}
            label="SPF — kto może wysyłać z tej domeny"
            hint={check.spf ?? "Brak rekordu TXT zaczynającego się od v=spf1."}
          />
          <DnsRow
            ok={Boolean(check.dmarc)}
            label="DMARC — polityka dla podszywających się"
            hint={check.dmarc ?? "Brak rekordu TXT _dmarc z v=DMARC1."}
          />
          <DnsRow
            ok={check.dkim}
            label="DKIM — podpis wiadomości"
            hint={
              check.dkim === null
                ? "Wpisz selektor DKIM od dostawcy poczty, żeby go sprawdzić."
                : check.dkim
                  ? "Klucz DKIM jest opublikowany."
                  : "Nie znaleziono klucza dla tego selektora."
            }
          />
        </ul>
      )}
    </section>
  );
}

function LeadRow({
  lead,
  sender,
  desktop,
}: {
  lead: EmailLead;
  sender: { company?: string; address?: string };
  desktop: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`${GLASS} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-semibold">{lead.nazwa}</h4>
          <p className="break-all text-xs text-muted-foreground">
            {lead.email} · {lead.miasto}
            {lead.hot_score ? ` · Hot Score ${lead.hot_score}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Badge
            variant={lead.status === "odpisal" ? "default" : "secondary"}
            className="text-[10px]"
          >
            {STATUS_LABEL[lead.status] ?? lead.status}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Zablokuj ${lead.email}`}
            title="Zablokuj adres na stałe"
            onClick={async () => {
              if (desktop) await emailBridge()?.blacklist(lead.email);
              else await updateEmail(lead.id, { status: "zablokowany" });
            }}
          >
            <Ban />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Usuń ${lead.nazwa}`}
            title="Usuń z bazy"
            onClick={async () => {
              if (desktop) await emailBridge()?.remove(lead.id);
              else
                writeEmailMock(readEmailMock().filter((r) => r.id !== lead.id));
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {lead.email_reply_text && (
        <p className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
          <span className="font-medium">Odpowiedź: </span>
          {lead.email_reply_text}
        </p>
      )}
      {lead.email_error && (
        <p className="mt-2 text-xs text-destructive">{lead.email_error}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
      >
        {lead.email_prepared_subject ?? "Podgląd wiadomości"}
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-relaxed">
          <p className="whitespace-pre-wrap">{lead.email_prepared_body}</p>
          <p className="mt-3 whitespace-pre-wrap border-t border-white/10 pt-2 text-xs text-muted-foreground">
            {usFooterPreview(sender)}
          </p>
        </div>
      )}
    </article>
  );
}

/** Widok kanału e-mail dla rynku USA: reguły, domena, skrzynka, kolejka i odpowiedzi. */
export function EmailOutreach() {
  const all = useEmails();
  const rows = useMemo(() => all.filter((l) => l.market === "US"), [all]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [sender, setSender] = useState<{ company?: string; address?: string }>(
    {},
  );
  const [queue, setQueue] = useState<EmailQueue>({
    running: false,
    paused: false,
    total: 0,
    done: 0,
    sent: 0,
  });

  useEffect(() => {
    const bridge = emailBridge();
    setDesktop(Boolean(bridge));
    bridge
      ?.settings()
      .then((s) =>
        setSender({
          company: String(s["company"] ?? ""),
          address: String(s["address"] ?? ""),
        }),
      )
      .catch(() => {});
    const timer = setInterval(() => {
      emailBridge()
        ?.status()
        .then(setQueue)
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const eligible = rows.filter(
    (l) => !l.email_sent_at && !l.email_reserved_at && l.status === "nowy",
  );
  const sent = rows.filter((l) => l.email_sent_at);
  const replies = rows.filter((l) => l.status === "odpisal");
  const blocked = rows.filter((l) => l.status === "zablokowany");

  const send = async () => {
    setBusy(true);
    try {
      const bridge = emailBridge();
      if (!bridge) {
        const now = new Date().toISOString();
        const ids = new Set(
          eligible.slice(0, US.email.dailyLimit).map((l) => l.id),
        );
        writeEmailMock(
          readEmailMock().map((l) =>
            ids.has(l.id)
              ? { ...l, email_sent_at: now, status: "wyslano_wiadomosc" }
              : l,
          ),
        );
        toast.success(
          `Symulacja: oznaczono ${ids.size} jako wysłane. Żaden prawdziwy e-mail nie wyszedł.`,
        );
        return;
      }
      const results: EmailSendResult[] =
        (await bridge.sendBulk(
          eligible.map((l) => l.id),
          confirmed,
        )) ?? [];
      const ok = results.filter((r) => r.ok).length;
      const outside = results.filter(
        (r) => r.reason === "outside-window",
      ).length;
      const limit = results.filter((r) => r.reason === "daily-limit").length;
      const failed = results.filter((r) => !r.ok && !r.skipped).length;
      const parts = [`Wysłano ${ok}`];
      if (outside) parts.push(`${outside} poza godzinami pracy odbiorcy`);
      if (limit) parts.push(`${limit} ponad dzienny limit`);
      if (failed) parts.push(`${failed} z błędem`);
      (failed ? toast.warning : toast.success)(`${parts.join(" · ")}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const syncReplies = async () => {
    try {
      const bridge = emailBridge();
      if (bridge) {
        const res = (await bridge.syncReplies()) as {
          updated: number;
          blocked?: number;
        };
        toast.success(
          `Nowe odpowiedzi: ${res.updated}. Rezygnacje dopisane do blokad: ${res.blocked ?? 0}.`,
        );
        return;
      }
      // Podgląd: pierwsza wysłana firma „odpisuje”, druga rezygnuje.
      const pending = sent.filter((l) => l.status === "wyslano_wiadomosc");
      const samples = [
        "Sure, send the mockup over. What would it cost?",
        "Not interested, please remove me.",
      ];
      for (const [i, lead] of pending.slice(0, 2).entries()) {
        const text = samples[i]!;
        await updateEmail(
          lead.id,
          isRefusal(text)
            ? { status: "zablokowany", email_reply_text: text }
            : {
                status: "odpisal",
                engaged_at: new Date().toISOString(),
                email_reply_text: text,
              },
        );
      }
      toast.success("Symulacja odpowiedzi w podglądzie.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <section className={`${GLASS} space-y-3 p-5`} aria-label="Reguły rynku">
        <h3 className="text-base font-semibold">
          {US.flag} Reguły wysyłki: {US.label}
        </h3>
        <p className="text-sm text-muted-foreground">{US.summary}</p>
        <ul className="grid gap-1.5 text-sm md:grid-cols-2">
          {US.email.checklist.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Wysyłka idzie tylko w dni robocze, {US.email.sendWindow.startHour}:00–
          {US.email.sendWindow.endHour}:00 czasu odbiorcy, z odstępem 1–2 minut
          między wiadomościami. To nie jest porada prawna: przed większą
          kampanią potwierdź zasady z prawnikiem.
        </p>
      </section>

      <section className={`${GLASS} space-y-4 p-5`} aria-label="Kolejka e-mail">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Inbox className="size-5 text-amber-400" /> Kolejka i odpowiedzi
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {eligible.length} do wysyłki · {sent.length} wysłanych ·{" "}
            {replies.length} odpowiedzi · {blocked.length} rezygnacji
          </span>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            className="mt-0.5"
          />
          {US.email.confirmation}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy || queue.running || eligible.length === 0 || !confirmed
            }
            onClick={() => void send()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {desktop ? "Wyślij" : "Symuluj wysyłkę"} (do {US.email.dailyLimit}{" "}
            dziennie)
          </Button>
          <Button variant="outline" onClick={() => void syncReplies()}>
            <RefreshCw /> Sprawdź odpowiedzi{desktop ? "" : " (symulacja)"}
          </Button>
          {queue.running && (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label={queue.paused ? "Wznów" : "Wstrzymaj"}
                onClick={() =>
                  emailBridge()?.control(queue.paused ? "resume" : "pause")
                }
              >
                {queue.paused ? <Play /> : <Pause />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Przerwij kolejkę"
                onClick={() => emailBridge()?.control("cancel")}
              >
                <Square />
              </Button>
            </>
          )}
        </div>
        {queue.running && (
          <p role="status" className="text-sm">
            Kolejka: {queue.done}/{queue.total} · wysłano {queue.sent}
            {queue.paused ? " · pauza" : ""}
          </p>
        )}
        {queue.error && (
          <p className="text-sm text-destructive">{queue.error}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Odmowy i wyrazy nieufności („not interested”, „remove me”, „how did
          you get my email”) program rozpoznaje sam: adres trafia na stałą listę
          blokad i nie dostanie kolejnej wiadomości.
        </p>
      </section>

      {rows.length === 0 ? (
        <p className={`${GLASS} p-5 text-sm text-muted-foreground`}>
          Baza e-mail jest pusta. Otwórz Snajpera, wybierz rynek 🇺🇸 USA i dodaj
          zakwalifikowane firmy.
        </p>
      ) : (
        <section
          className="grid gap-3 lg:grid-cols-2"
          aria-label="Firmy w bazie e-mail"
        >
          {rows.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              sender={sender}
              desktop={desktop}
            />
          ))}
        </section>
      )}

      <DomainSetup />
      <div className={`${GLASS} p-5`}>
        <EmailSettings />
      </div>
    </div>
  );
}
