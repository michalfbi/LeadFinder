import { useCallback, useEffect, useState } from "react";
import rules from "../../sniper-rules.json";
import type { OfferId } from "./leads-store";

/**
 * Aktywna oferta (usługa, pod którą szukamy klientów) i tekst ceny wstawiany
 * do SMS-ów. Klucze "leadfinder.*" w localStorage są na Macu lustrzane na dysk
 * przez prefs-sync, więc wybór przetrwa ponowne uruchomienie aplikacji.
 */

export type { OfferId } from "./leads-store";

export type OfferMeta = {
  id: OfferId;
  label: string;
  icon: string;
  /** Krótka nazwa usługi w zdaniu, np. „strona www”. */
  short: string;
  defaultPrice: string;
  templateLabelPrefix: string;
};

export const OFFER_IDS: OfferId[] = ["website", "video_ads"];

export const OFFERS: Record<OfferId, OfferMeta> = {
  website: { id: "website", ...rules.offers.website },
  video_ads: { id: "video_ads", ...rules.offers.video_ads },
};

const ACTIVE_KEY = "leadfinder.active-offer";
const PRICE_KEY = "leadfinder.offer-prices";
const EVENT = "leadfinder:offer-change";

export function isOfferId(value: unknown): value is OfferId {
  return value === "website" || value === "video_ads";
}

/** Oferta zapisana przy leadzie; brak pola oznacza starsze leady, czyli strony www. */
export function offerOf(lead: { offer_type?: string | null }): OfferId {
  return isOfferId(lead.offer_type) ? lead.offer_type : "website";
}

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* tryb prywatny lub pełny magazyn — ustawienie działa do odświeżenia */
  }
}

export function readActiveOffer(): OfferId {
  const raw = safeGet(ACTIVE_KEY);
  return isOfferId(raw) ? raw : "website";
}

export function readOfferPrices(): Record<OfferId, string> {
  const out: Record<OfferId, string> = {
    website: OFFERS.website.defaultPrice,
    video_ads: OFFERS.video_ads.defaultPrice,
  };
  const raw = safeGet(PRICE_KEY);
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<OfferId, unknown>>;
    for (const id of OFFER_IDS) {
      if (typeof parsed[id] === "string")
        out[id] = (parsed[id] as string).trim();
    }
  } catch {
    /* uszkodzony wpis — zostają ceny domyślne */
  }
  return out;
}

export function readOfferPrice(offer: OfferId): string {
  return readOfferPrices()[offer];
}

export function useOfferSettings() {
  const [offer, setOfferState] = useState<OfferId>("website");
  const [prices, setPricesState] = useState<Record<OfferId, string>>({
    website: OFFERS.website.defaultPrice,
    video_ads: OFFERS.video_ads.defaultPrice,
  });

  useEffect(() => {
    const sync = () => {
      setOfferState(readActiveOffer());
      setPricesState(readOfferPrices());
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("leadfinder:prefs-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("leadfinder:prefs-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setOffer = useCallback((next: OfferId) => {
    safeSet(ACTIVE_KEY, next);
    setOfferState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const setPrice = useCallback((id: OfferId, text: string) => {
    const next = { ...readOfferPrices(), [id]: text.trim() };
    safeSet(PRICE_KEY, JSON.stringify(next));
    setPricesState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return {
    offer,
    meta: OFFERS[offer],
    prices,
    price: prices[offer],
    setOffer,
    setPrice,
  };
}
