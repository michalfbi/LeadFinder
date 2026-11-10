import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  CircleAlert,
  Compass,
  Download,
  FlaskConical,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  TrendingUp,
  Radar,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GLASS } from "@/components/sniper-tab";
import {
  US_NICHES,
  US_STATES,
  loadRanking,
  marketBridge,
  type CompetitionLevel,
  type HitBasis,
  type MarketProgress,
  type MarketRanking,
  type MarketRow,
} from "@/lib/market-store";

const ALL = "all";
const COMPETITION: Record<CompetitionLevel, { label: string; tone: string }> = {
  low: {
    label: "niska konkurencja",
    tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
  mid: {
    label: "średnia konkurencja",
    tone: "border-white/15 bg-white/5 text-muted-foreground",
  },
  high: {
    label: "wysoka konkurencja",
    tone: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  },
};
const BASIS: Record<HitBasis, string> = {
  pomiar: "pomiar",
  "inne-miasta": "szacunek z innych miast tej niszy",
  "inne-nisze": "szacunek z innych nisz",
  zalozenie: "założenie startowe, brak próbek",
};
const FORECAST_BASIS: Record<HitBasis, string> = {
  pomiar: "Twoja kampania w tym miejscu",
  "inne-miasta": "Twoje kampanie w tej niszy w innych miastach",
  "inne-nisze": "Twoje kampanie w innych niszach",
  zalozenie: "założenia startowe, brak własnych wyników",
};
/** Małych szans nie zaokrąglamy do zera: „poniżej 1%” mówi więcej niż „0%”. */
const chanceText = (v: number) =>
  v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => v.toLocaleString("pl-PL");
const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        "",
      )
    : String(err);

function RowCard({
  row,
  busy,
  canProbe,
  onProbe,
}: {
  row: MarketRow;
  busy: boolean;
  canProbe: boolean;
  onProbe: (row: MarketRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const measured = row.hit.basis === "pomiar";
  const level = row.competition?.level;
  return (
    <article className={`${GLASS} p-4`}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold">{row.nicheLabel}</h4>
          <p className="text-sm text-muted-foreground">
            {row.place}
            {row.kind === "micro" && " · mały ośrodek"}
          </p>
        </div>
        {row.forecast && (
          <div className="text-right">
            <p
              className="text-2xl font-semibold tabular-nums"
              title="Szansa na co najmniej jedną sprzedaż w okresie prognozy"
            >
              {chanceText(row.forecast.chance)}
            </p>
            <p className="text-xs text-muted-foreground">szansa na sprzedaż</p>
          </div>
        )}
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {level && (
          <Badge variant="outline" className={COMPETITION[level].tone}>
            {COMPETITION[level].label}
          </Badge>
        )}
        <Badge
          variant="outline"
          className={
            measured
              ? "border-sky-400/40 bg-sky-400/10 text-sky-200"
              : "border-white/15 bg-white/5 text-muted-foreground"
          }
        >
          {measured ? "zbadane próbką" : "bez własnej próbki"}
        </Badge>
        {row.verified && (
          <Badge
            variant="outline"
            className="border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          >
            sprawdzone kampanią
          </Badge>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Firm w branży</dt>
          <dd className="tabular-nums">
            {num(row.firms)}
            {row.per100k !== null && (
              <span className="text-xs text-muted-foreground">
                {" "}
                · {row.per100k.toLocaleString("pl-PL")} na 100 tys.
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Odsetek trafień</dt>
          <dd className="tabular-nums">
            {pct(row.hit.mean)}
            {measured && (
              <span className="text-xs text-muted-foreground">
                {" "}
                · {row.hit.hits} z {row.hit.sampled}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Osiągalne firmy</dt>
          <dd className="tabular-nums">
            {num(row.reachable.mean)}
            <span className="text-xs text-muted-foreground">
              {" "}
              · {num(row.reachable.low)}–{num(row.reachable.high)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Twoja kampania</dt>
          <dd className="tabular-nums">
            {row.campaign ? (
              <>
                {row.campaign.sent} wysłanych
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {row.campaign.positive} zainteresowanych
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">jeszcze nie</span>
            )}
          </dd>
        </div>
      </dl>
      {row.forecast && (
        <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm">
          {row.forecast.emails < 1 ? (
            "Ten rynek jest już wyczerpany: do osiągalnych firm wysłano wiadomości."
          ) : (
            <>
              Przy {num(row.forecast.emails)} wysłanych e-mailach spodziewane{" "}
              <span className="font-medium tabular-nums">
                {row.forecast.expectedSales.toLocaleString("pl-PL", {
                  maximumFractionDigits: 1,
                })}{" "}
                sprzedaży
              </span>{" "}
              <span className="text-muted-foreground tabular-nums">
                (od{" "}
                {row.forecast.salesLow.toLocaleString("pl-PL", {
                  maximumFractionDigits: 1,
                })}{" "}
                do{" "}
                {row.forecast.salesHigh.toLocaleString("pl-PL", {
                  maximumFractionDigits: 1,
                })}
                ), czyli około {num(row.forecast.revenueUsd)} USD
                {row.forecast.emailsPerSale
                  ? `. Jedna sprzedaż na około ${num(row.forecast.emailsPerSale)} e-maili`
                  : ""}
                .
              </span>
            </>
          )}
          <span className="mt-1 block text-xs text-muted-foreground">
            Podstawa prognozy: {FORECAST_BASIS[row.forecast.basis]}.
          </span>
        </p>
      )}
      {!measured && (
        <p className="mt-2 text-xs text-muted-foreground">
          Odsetek trafień: {BASIS[row.hit.basis]}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canProbe && row.probeCity && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={busy}
            onClick={() => onProbe(row)}
          >
            {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />}{" "}
            {measured ? "Zbadaj ponownie" : "Zbadaj próbką"}
          </Button>
        )}
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
          />{" "}
          Szczegóły
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-xs text-muted-foreground">
          {row.probe ? (
            <p>
              Próbka z{" "}
              {row.hit.at
                ? new Date(row.hit.at).toLocaleDateString("pl-PL")
                : "—"}
              , {row.probe.sampled} firm z Map: {row.probe.noSite} bez strony,{" "}
              {row.probe.socialOnly} tylko z profilem społecznościowym,{" "}
              {row.probe.builder} na darmowym kreatorze, {row.probe.broken} z
              niedziałającą stroną, {row.probe.weak} ze słabą stroną (w tym{" "}
              {row.probe.noSsl} bez SSL), {row.probe.modern} z dobrą stroną,{" "}
              {row.probe.skipped} dużych firm pominiętych. E-mail znaleziono u{" "}
              {row.probe.withEmail}.
            </p>
          ) : (
            <p>
              Brak próbki w tym mieście. Do firm bez żadnej strony program w USA
              nie napisze, bo nie ma skąd wziąć adresu e-mail, dlatego liczy się
              dopiero pomiar.
            </p>
          )}
          {row.competition && (
            <p>
              Lokalne agencje i studia:{" "}
              {row.competition.index.toLocaleString("pl-PL")} na 1000 firm.
            </p>
          )}
          {row.payrollPerFirm !== null && (
            <p>
              Średnie roczne płace na firmę: {num(row.payrollPerFirm)} USD
              (przybliżenie wielkości firm).
            </p>
          )}
          {row.campaign && (
            <p>
              Kampania: {row.campaign.sent} wysłanych, {row.campaign.replies}{" "}
              odpowiedzi, {row.campaign.positive} zainteresowanych,{" "}
              {row.campaign.blocked} zablokowanych.
            </p>
          )}
          {!row.exact && row.note && <p>Uwaga do liczby firm: {row.note}</p>}
          {row.probeCity && <p>Miasto próbki: {row.probeCity}.</p>}
        </div>
      )}
    </article>
  );
}

/** Rozpoznanie rynku: gdzie i komu opłaca się wysyłać ofertę, na danych, a nie na przeczuciu. */
export function MarketView() {
  const [data, setData] = useState<MarketRanking | null>(null);
  const [niche, setNiche] = useState(ALL);
  const [state, setState] = useState(ALL);
  const [lowOnly, setLowOnly] = useState(true);
  const [simulated, setSimulated] = useState(false);
  const [progress, setProgress] = useState<MarketProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const [showForecast, setShowForecast] = useState(false);
  const [positive, setPositive] = useState("");
  const [close, setClose] = useState("");
  const [price, setPrice] = useState("");

  const refresh = useCallback(() => {
    loadRanking({
      ...(niche !== ALL ? { niche } : {}),
      ...(state !== ALL ? { state } : {}),
      lowCompetition: lowOnly,
      limit: 60,
    })
      .then(setData)
      .catch((err) => toast.error(errorText(err)));
  }, [niche, state, lowOnly]);
  useEffect(() => {
    setSimulated(!marketBridge());
    refresh();
  }, [refresh]);

  const download = async () => {
    const bridge = marketBridge();
    if (!bridge) return;
    setBusy("download");
    try {
      const next = await bridge.refresh(setProgress);
      toast.success(`Pobrano dane dla ${next.geos} obszarów.`);
      if (next.notes.length) toast.warning(next.notes[0]!);
    } catch (err) {
      const text = errorText(err);
      toast.error(text);
      if (/klucz/i.test(text)) setShowKey(true);
    } finally {
      setBusy(null);
      setProgress(null);
      refresh();
    }
  };
  const assumptions = data?.forecast;
  useEffect(() => {
    if (!assumptions) return;
    setPositive(
      String(+(assumptions.positiveRate * 100).toFixed(2)).replace(".", ","),
    );
    setClose(
      String(+(assumptions.closeRate * 100).toFixed(1)).replace(".", ","),
    );
    setPrice(String(assumptions.priceUsd));
    // Pola formularza odświeżamy tylko, gdy zmienią się same wartości, a nie przy każdym pobraniu rankingu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    assumptions?.positiveRate,
    assumptions?.closeRate,
    assumptions?.priceUsd,
  ]);
  const saveForecast = async (reset = false) => {
    const bridge = marketBridge();
    if (!bridge) return;
    setBusy("forecast");
    try {
      const parse = (v: string) =>
        Number(v.replace(",", ".").replace("%", "").trim());
      await bridge.configure(
        reset
          ? { resetForecast: true }
          : {
              forecast: {
                positiveRate: parse(positive) / 100,
                closeRate: parse(close) / 100,
                priceUsd: parse(price),
              },
            },
      );
      toast.success(
        reset
          ? "Przywrócono założenia startowe."
          : "Zapisano założenia. Prognozy przeliczone.",
      );
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const saveKey = async (clear = false) => {
    const bridge = marketBridge();
    if (!bridge) return;
    setBusy("key");
    try {
      await bridge.configure(clear ? { clearKey: true } : { key });
      setKey("");
      if (!clear) {
        const result = await bridge.test();
        toast.success(
          `Klucz działa. Census zwrócił ${num(result.firms)} firm dekarskich w USA.`,
        );
      }
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const probe = async (row: MarketRow) => {
    const bridge = marketBridge();
    if (!bridge || !row.probeCity) return;
    setBusy(row.id);
    try {
      const p = await bridge.probe(
        { nicheId: row.niche, city: row.probeCity },
        setProgress,
      );
      toast.success(
        `${row.nicheLabel}, ${row.probeCity}: e-mail znaleziono u ${p.withEmail} z ${p.sampled} firm.`,
      );
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      setProgress(null);
      refresh();
    }
  };

  const ready = data?.ready ?? false;
  return (
    <div className="space-y-5">
      <div className={`${GLASS} space-y-3 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-start gap-3">
          <Compass className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Gdzie i komu wysyłać.
            </span>{" "}
            Liczba firm pochodzi z bezpłatnych danych urzędu statystycznego USA
            (Census). Odsetek trafień program mierzy sam: każdy skan Snajpera
            zapisuje, u ilu firm znalazł słabą stronę i adres e-mail. Wyniki
            Twoich kampanii dopisują się automatycznie.
            {simulated &&
              " To podgląd na przykładowych liczbach, nie na danych Census."}
          </p>
          {!simulated && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-xl"
                variant={ready ? "outline" : "default"}
                disabled={busy !== null}
                onClick={() => void download()}
              >
                {busy === "download" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}{" "}
                {ready ? "Odśwież dane" : "Pobierz dane (za darmo)"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl text-muted-foreground"
                aria-expanded={showKey}
                onClick={() => setShowKey((v) => !v)}
              >
                <KeyRound /> Klucz Census
              </Button>
            </div>
          )}
        </div>
        {progress && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" /> {progress.label}
            {progress.total > 0 && (
              <span className="tabular-nums">
                · {Math.min(progress.index + 1, progress.total)} z{" "}
                {progress.total}
              </span>
            )}
          </p>
        )}
        {data && ready && (
          <p className="text-xs text-muted-foreground">
            Dane Census za {data.year ?? "—"} r.
            {data.fetchedAt
              ? `, pobrane ${new Date(data.fetchedAt).toLocaleDateString("pl-PL")}`
              : ""}{" "}
            · {num(data.geos)} obszarów · {num(data.probes)} własnych próbek
          </p>
        )}
        {data?.notes.map((n) => (
          <p key={n} className="flex items-start gap-2 text-xs text-amber-200">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            {n}
          </p>
        ))}
        {showKey && !simulated && data && (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <Label htmlFor="census-key">
              Bezpłatny klucz Census{" "}
              {data.keyConfigured && (
                <span className="text-emerald-300">· zapisany</span>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              Potrzebny tylko wtedy, gdy pobieranie o niego poprosi. Zamawiasz
              go e-mailem na stronie{" "}
              <a
                className="underline"
                href={data.keySignupUrl}
                target="_blank"
                rel="noreferrer"
              >
                api.census.gov/data/key_signup.html
              </a>
              , przychodzi w kilka minut i nic nie kosztuje. W aplikacji jest
              przechowywany w formie zaszyfrowanej.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                id="census-key"
                type="password"
                autoComplete="off"
                className="max-w-sm rounded-xl"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  data.keyConfigured
                    ? "Wpisz nowy, aby podmienić"
                    : "Wklej klucz z e-maila"
                }
              />
              <Button
                variant="outline"
                className="rounded-xl"
                disabled={busy !== null || !key.trim()}
                onClick={() => void saveKey()}
              >
                {busy === "key" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PlugZap />
                )}{" "}
                Zapisz i sprawdź
              </Button>
              {data.keyConfigured && (
                <Button
                  variant="ghost"
                  className="rounded-xl text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => void saveKey(true)}
                >
                  Usuń klucz
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {data === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Wczytywanie…
        </p>
      ) : !ready ? (
        <div
          className={`${GLASS} flex flex-col items-center gap-2 px-6 py-12 text-center`}
        >
          <Radar className="size-8 text-muted-foreground" />
          <p className="font-medium">Brak danych o rynku</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Kliknij „Pobierz dane (za darmo)”. Program pobierze liczbę firm dla
            18 nisz we wszystkich obszarach miejskich USA. Trwa to około minuty
            i wystarczy raz na rok.
          </p>
        </div>
      ) : (
        <>
          {assumptions && (
            <section
              aria-label="Prognoza sprzedaży"
              className={`${GLASS} space-y-3 p-4 sm:p-5`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <TrendingUp className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 basis-64 space-y-1 text-sm text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">
                      Szansa na sprzedaż w {assumptions.horizonLabel}.
                    </span>{" "}
                    Program liczy ją dla każdego miejsca z trzech liczb: ile
                    firm da się zaadresować, jaki odsetek odpowie z
                    zainteresowaniem i jaki odsetek zainteresowanych kupi. Przy
                    limicie wysyłki mieści się {num(data.capacity ?? 0)}{" "}
                    e-maili.
                  </p>
                  <p className="tabular-nums">
                    {data.own && data.own.sent > 0
                      ? `Twoje dotychczasowe kampanie: ${num(data.own.sent)} wysłanych, ${data.own.positive} zainteresowanych, ${data.own.sales} sprzedaży. Prognoza uczy się z tych liczb.`
                      : "Nie masz jeszcze własnych wyników z e-maili, więc prognoza stoi na założeniach poniżej. Im więcej wyślesz, tym mniej będzie zgadywania."}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  aria-expanded={showForecast}
                  onClick={() => setShowForecast((v) => !v)}
                >
                  <ChevronDown
                    className={`transition-transform ${showForecast ? "rotate-180" : ""}`}
                  />{" "}
                  Założenia
                </Button>
              </div>
              {showForecast && (
                <div className="space-y-3 border-t border-white/10 pt-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="fc-positive">
                        Zainteresowane odpowiedzi (% wysłanych)
                      </Label>
                      <Input
                        id="fc-positive"
                        inputMode="decimal"
                        className="mt-1 rounded-xl"
                        value={positive}
                        disabled={simulated}
                        onChange={(e) => setPositive(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {assumptions.positiveSource}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="fc-close">
                        Sprzedaże (% zainteresowanych)
                      </Label>
                      <Input
                        id="fc-close"
                        inputMode="decimal"
                        className="mt-1 rounded-xl"
                        value={close}
                        disabled={simulated}
                        onChange={(e) => setClose(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {assumptions.closeSource}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="fc-price">Cena strony (USD)</Label>
                      <Input
                        id="fc-price"
                        inputMode="numeric"
                        className="mt-1 rounded-xl"
                        value={price}
                        disabled={simulated}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Służy tylko do przeliczenia prognozy na pieniądze.
                      </p>
                    </div>
                  </div>
                  {simulated ? (
                    <p className="text-xs text-muted-foreground">
                      Założenia zmienia się w aplikacji na Macu.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="rounded-xl"
                        disabled={busy !== null}
                        onClick={() => void saveForecast()}
                      >
                        {busy === "forecast" ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Save />
                        )}{" "}
                        Zapisz założenia
                      </Button>
                      {assumptions.custom && (
                        <Button
                          variant="ghost"
                          className="rounded-xl text-muted-foreground"
                          disabled={busy !== null}
                          onClick={() => void saveForecast(true)}
                        >
                          Przywróć startowe
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {data.recommended.length > 0 && (
            <section aria-label="Co zbadać najpierw" className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FlaskConical className="size-4" /> Co zbadać najpierw
              </h3>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Miejsca bez własnej próbki, które przy dobrym wyniku dałyby
                najwięcej. Jedna próbka to jeden zwykły skan Map, bez dodawania
                firm do bazy.
              </p>
              <div className="grid items-start gap-4 xl:grid-cols-3">
                {data.recommended.map((r) => (
                  <RowCard
                    key={`rec-${r.id}`}
                    row={r}
                    busy={busy === r.id}
                    canProbe={!simulated && (busy === null || busy === r.id)}
                    onProbe={(row) => void probe(row)}
                  />
                ))}
              </div>
            </section>
          )}

          <section aria-label="Ranking" className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label
                  htmlFor="market-niche"
                  className="text-xs text-muted-foreground"
                >
                  Nisza
                </Label>
                <Select value={niche} onValueChange={setNiche}>
                  <SelectTrigger
                    id="market-niche"
                    className="mt-1 w-56 rounded-xl"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Wszystkie nisze</SelectItem>
                    {US_NICHES.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label
                  htmlFor="market-state"
                  className="text-xs text-muted-foreground"
                >
                  Stan
                </Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger
                    id="market-state"
                    className="mt-1 w-56 rounded-xl"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Wszystkie stany</SelectItem>
                    {US_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex h-9 items-center gap-2">
                <Switch
                  id="market-low"
                  checked={lowOnly}
                  onCheckedChange={setLowOnly}
                />
                <Label htmlFor="market-low" className="text-sm">
                  Tylko niska konkurencja
                </Label>
              </div>
              <p className="ml-auto flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                <Users className="size-3.5" /> {data.rows.length} z{" "}
                {num(data.total)} par nisza × miasto
              </p>
            </div>
            {data.rows.length === 0 ? (
              <p
                className={`${GLASS} px-6 py-10 text-center text-sm text-muted-foreground`}
              >
                Żadna para nisza × miasto nie spełnia tych warunków. Zmień
                niszę, stan albo wyłącz filtr konkurencji.
              </p>
            ) : (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {data.rows.map((r) => (
                  <RowCard
                    key={r.id}
                    row={r}
                    busy={busy === r.id}
                    canProbe={!simulated && (busy === null || busy === r.id)}
                    onProbe={(row) => void probe(row)}
                  />
                ))}
              </div>
            )}
          </section>

          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer text-foreground">
              Jak czytać te liczby i czego w nich nie ma
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Szansa na sprzedaż to prawdopodobieństwo co najmniej jednej
                sprzedaży w okresie prognozy. Program losuje kilkaset możliwych
                przebiegów kampanii z tego, co wiadomo, i liczy, w ilu z nich
                doszło do sprzedaży.
              </li>
              <li>
                Dopóki nie masz własnych wyników, szansa różni się między
                miejscami tylko liczbą osiągalnych firm. Różnice w chęci zakupu
                między miastami pokażą dopiero Twoje kampanie.
              </li>
              <li>
                Kolejność listy: liczba firm × odsetek trafień × mnożnik
                konkurencji (niska ×1,15, wysoka ×0,85).
              </li>
              <li>
                Trafienie to firma ze słabą, ale działającą stroną i znalezionym
                adresem e-mail. Tylko do takich firm program w USA może napisać.
              </li>
              <li>
                Bez próbki odsetek trafień jest szacunkiem z innych miast albo
                założeniem 10%. Zakres obok „osiągalnych firm” pokazuje, jak
                bardzo wynik jest niepewny.
              </li>
              {data.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
