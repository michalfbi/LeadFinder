import { SniperTab } from "@/components/sniper-tab";
import { UsSniper } from "@/components/us-sniper";
import { GLASS } from "@/components/sniper-tab";
import { MARKETS, MARKET_IDS, useMarketSettings } from "@/lib/market-outreach";

/**
 * Snajper z wyborem rynku. Polska działa jak dotąd (SMS), a rynki zagraniczne
 * mają własny panel: inny kanał (e-mail), język i reguły wysyłki.
 */
export function SniperWorkspace({ onGo }: { onGo?: (tab: string) => void }) {
  const { market, meta, setMarket } = useMarketSettings();
  return (
    <div className="space-y-5">
      <section
        className={`${GLASS} flex flex-wrap items-center gap-4 p-4`}
        aria-label="Rynek"
      >
        <div
          className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1"
          role="group"
          aria-label="Wybór rynku"
        >
          {MARKET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={market === id}
              onClick={() => setMarket(id)}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                market === id
                  ? "bg-amber-400 font-semibold text-black"
                  : "text-muted-foreground hover:bg-white/10"
              }`}
            >
              {MARKETS[id].flag} {MARKETS[id].label} ·{" "}
              {MARKETS[id].channel === "email" ? "E-mail" : "SMS"}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
          {meta.summary}
        </p>
      </section>
      {market === "US" ? <UsSniper onGo={onGo} /> : <SniperTab />}
    </div>
  );
}
