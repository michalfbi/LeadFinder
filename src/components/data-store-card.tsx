import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Database,
  FolderOpen,
  Loader2,
  Save,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktop, type StoreEvent, type StoreStatus } from "@/lib/leads-store";

const EVENT_LABEL: Record<string, string> = {
  created: "dodano do bazy",
  status: "zmiana statusu",
  sms_sent: "wysłano SMS",
  email_sent: "wysłano e-mail",
  replied: "odpowiedź",
  closed: "zamknięto",
  deal_value: "wartość sprzedaży",
  deleted: "usunięto",
};

const STATUS_LABEL: Record<string, string> = {
  nowy: "nowy",
  wyslano_wiadomosc: "wysłano wiadomość",
  odpisal: "odpisał",
  zablokowany: "zablokowany",
  blad_wysylki: "błąd wysyłki",
  sukces: "sprzedaż",
};

function when(value: string | number | null | undefined): string {
  if (!value) return "jeszcze nie";
  return new Date(value).toLocaleString("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Karta „Baza danych” w Ustawieniach: stan, kopie zapasowe i ostatnie zdarzenia. */
export function DataStoreCard() {
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const bridge = desktop()?.store;

  const refresh = useCallback(async () => {
    const store = desktop()?.store;
    if (!store) return;
    try {
      setStatus(await store.status());
      setEvents((await store.events()).slice(0, 8));
    } catch (err) {
      setStatus({
        engine: "broken",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!bridge) {
    return (
      <section className="mb-6 border-b border-border pb-6">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Database className="size-5" /> Baza danych
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Podgląd w przeglądarce trzyma dane próbne w pamięci przeglądarki. Baza
          z historią zdarzeń i kopiami zapasowymi działa w aplikacji na Macu.
        </p>
      </section>
    );
  }

  const backupNow = async () => {
    setBusy(true);
    try {
      setStatus(await bridge.backup());
      toast.success("Kopia zapasowa zapisana.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="mb-6 space-y-3 border-b border-border pb-6"
      aria-label="Baza danych"
    >
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <Database className="size-5" /> Baza danych
      </h3>
      {status?.engine === "broken" && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            Baza danych jest niedostępna, więc wysyłka jest wstrzymana. Uruchom
            aplikację ponownie. Jeśli błąd wraca, przywróć ostatnią kopię z
            folderu kopii zapasowych. Szczegóły: {status.error}
          </span>
        </p>
      )}
      {status?.engine === "json" && (
        <p
          role="status"
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm"
        >
          Aplikacja działa jeszcze na starych plikach, bo przeniesienie danych
          do bazy nie powiodło się. Dane są nienaruszone. Szczegóły:{" "}
          {status.error ?? "brak"}
        </p>
      )}
      {status?.engine === "sqlite" && (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Leady SMS / e-mail</dt>
              <dd className="tabular-nums">
                {status.leads?.sms ?? 0} / {status.leads?.email ?? 0}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Zablokowane kontakty</dt>
              <dd className="tabular-nums">{status.suppression ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Zdarzenia w dzienniku</dt>
              <dd className="tabular-nums">{status.events ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Ostatnia kopia zapasowa</dt>
              <dd>
                {when(status.lastBackupAt)} ({status.backups ?? 0} z 7)
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Kopia robi się sama raz na dobę przy starcie aplikacji. Rezygnacja
            zgłoszona SMS-em albo e-mailem blokuje oba kanały tej samej firmy.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void backupNow()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Zrób
              kopię teraz
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void bridge.openBackups()}
            >
              <FolderOpen /> Pokaż folder kopii
            </Button>
          </div>
          {events.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Ostatnie zdarzenia</h4>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {events.map((e, i) => (
                  <li key={`${e.lead_id}-${e.at}-${i}`}>
                    {when(e.at)} · {e.kind === "email" ? "e-mail" : "SMS"} ·{" "}
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.type === "status" && e.to_value
                      ? `: ${STATUS_LABEL[e.to_value] ?? e.to_value}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
