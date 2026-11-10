import { useState } from "react";
import { toast } from "sonner";
import {
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Invariant = {
  id: string;
  label: string;
  ok: boolean;
  checked: number;
  detail: string;
};
export type SimulationReport = {
  ok: boolean;
  seed: number;
  durationMs: number;
  params: { companies: number; days: number; smsLeads: number; ai: boolean };
  funnel: {
    inserted: number;
    coldDelivered: number;
    sendErrors: number;
    repliesReceived: number;
    autoBlocked: number;
    ownerBlocked: number;
    ignored: number;
    answered: number;
    dismissed: number;
  };
  classifier: {
    judged: number;
    correct: number;
    falseBlocks: number;
    refusals: {
      total: number;
      autoBlocked: number;
      caughtByOwner: number;
      withReadyDraft: number;
      leftUnanswered: number;
    };
    rulesOnly: { total: number; blocked: number };
  };
  incidents: string[];
  invariants: Invariant[];
  notCovered: string[];
};

function bridge(): { run: (seed: number) => Promise<SimulationReport> } | null {
  if (typeof window === "undefined") return null;
  return (
    (
      window as unknown as {
        leadfinder?: {
          simulation?: { run: (seed: number) => Promise<SimulationReport> };
        };
      }
    ).leadfinder?.simulation ?? null
  );
}

/** Ustawienia → Wirtualny świat: sprawdzian programu bez prawdziwej wysyłki. */
export function SimulationCard() {
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(1);
  const sim = bridge();

  const run = async () => {
    if (!sim) return;
    setBusy(true);
    try {
      const next = await sim.run(seed);
      setReport(next);
      setSeed(seed + 1);
      if (next.ok) toast.success("Wszystkie zasady dotrzymane.");
      else
        toast.error(
          "Sprawdzian wykrył złamaną zasadę. Nie wysyłaj, dopóki tego nie wyjaśnimy.",
        );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const f = report?.funnel;
  const k = report?.classifier;
  return (
    <section
      className="mb-6 space-y-3 border-b border-border pb-6"
      aria-label="Wirtualny świat"
    >
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <FlaskConical className="size-5" /> Wirtualny świat
      </h3>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Sprawdzian całego obiegu na wymyślonych firmach: wysyłka, odpowiedzi,
        skrzynka, blokady. Poczta, AI i zegar są udawane, więc nie wychodzi
        żaden prawdziwy e-mail ani SMS, a Twoje dane nie są ruszane. Dwa
        tygodnie pracy programu mijają w kilka sekund.
      </p>
      {sim ? (
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={busy}
          onClick={() => void run()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          {busy
            ? "Trwa sprawdzian…"
            : report
              ? `Uruchom kolejny świat (nr ${seed})`
              : "Uruchom sprawdzian"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sprawdzian uruchamia się w aplikacji na Macu. Ten sam test wykonuje
          się też automatycznie przy każdej zmianie programu na GitHubie.
        </p>
      )}

      {report && f && k && (
        <div className="space-y-4" role="status">
          <p
            className={`flex items-center gap-2 font-medium ${report.ok ? "text-emerald-300" : "text-destructive"}`}
          >
            {report.ok ? (
              <CircleCheck className="size-5" />
            ) : (
              <CircleX className="size-5" />
            )}
            Świat nr {report.seed}:{" "}
            {report.ok ? "wszystkie zasady dotrzymane" : "złamana zasada"}
            <span className="font-normal tabular-nums text-muted-foreground">
              · {report.params.companies} firm, {report.params.days} dni,{" "}
              {(report.durationMs / 1000).toFixed(1)} s
            </span>
          </p>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm lg:grid-cols-2">
            {report.invariants.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                {i.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <span className="min-w-0 flex-1">
                  {i.label}
                  {!i.ok && (
                    <span className="block break-words text-xs text-destructive">
                      {i.detail}
                    </span>
                  )}
                </span>
                <span
                  className="tabular-nums text-xs text-muted-foreground"
                  title="Liczba sprawdzonych przypadków"
                >
                  {i.checked}
                </span>
              </li>
            ))}
          </ul>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                [
                  "Pierwsze wiadomości dostarczone",
                  `${f.coldDelivered} z ${f.inserted}`,
                ],
                ["Błędy wysyłki", f.sendErrors],
                ["Odpowiedzi w skrzynce", f.repliesReceived],
                ["Zablokowane automatycznie", f.autoBlocked],
                ["Zablokowane ręcznie", f.ownerBlocked],
                ["Odpowiedzi wysłane po zatwierdzeniu", f.answered],
              ] as Array<[string, string | number]>
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Odmów i wyrazów nieufności było {k.refusals.total}:{" "}
            {k.refusals.autoBlocked} zablokował program,{" "}
            {k.refusals.caughtByOwner} musiał wyłapać właściciel,{" "}
            {k.refusals.leftUnanswered} zostało bez blokady i bez odpowiedzi.
            Same reguły, bez AI, złapałyby {k.rulesOnly.blocked} z{" "}
            {k.rulesOnly.total}. Fałszywe blokady: {k.falseBlocks}.
          </p>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer text-foreground">
              Czego ten sprawdzian nie obejmuje
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {report.notCovered.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>
                Liczby odpowiedzi wynikają z założeń wirtualnego świata. To nie
                jest prognoza sprzedaży.
              </li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
