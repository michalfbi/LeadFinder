import { useEffect, useState } from "react";
import type { SpeedConfig } from './sms-speed';

export type BulkItem = {
  id: string;
  phone: string;
  body: string;
  /** Nazwa aktywnego szablonu — do atrybucji w analityce. */
  templateId?: string;
  /** Podpis wylosowanej kombinacji Spintax, np. „[Dzień dobry] + [Brak strony]”. */
  signature?: string;
};
export type BulkProgress = {
  index: number;
  total: number;
  id: string;
  ok: boolean;
  error?: string;
};
export type BulkResult = {
  id: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  reason?: "local" | "history";
  sentAt?: string;
};

export type BulkSendOptions = Partial<SpeedConfig> & {
  delayMs?: number;
  /** tryb Dual eSIM — na przemian z dwóch linii */
  dualSim?: boolean;
  sim1Name?: string;
  sim2Name?: string;
  /** true = wyłącz blokadę godzinową (08:30–17:00) */
  forceSend?: boolean;
};

export type BulkQueueStatus = Partial<SpeedConfig> & {
  running: boolean;
  paused: boolean;
  sent: number;
  queued: number;
  total: number;
  /** za ile sekund kolejny SMS (null gdy brak zaplanowanego) */
  nextInSec: number | null;
  /** nazwa karty SIM użytej przy bieżącej wiadomości */
  sim: string | null;
  /** true gdy kolejka czeka na godziny pracy (08:30–17:00) */
  waitingHours: boolean;
};

export type LeadFinderBridge = {
  isDesktop: boolean;
  platform: string;
  sendBulk: (
    items: BulkItem[],
    onProgress?: (p: BulkProgress) => void,
    options?: BulkSendOptions,
  ) => Promise<BulkResult[]>;
  cancelBulk: () => void;
  pauseBulk?: () => Promise<{ ok: boolean }>;
  resumeBulk?: () => Promise<{ ok: boolean }>;
  bulkStatus?: () => Promise<BulkQueueStatus>;
  setSpeedConfig?: (config: SpeedConfig) => Promise<SpeedConfig & { ok: boolean }>;
};

/** Most Electron — istnieje tylko w aplikacji desktopowej na Macu. */
export function getBridge(): LeadFinderBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { leadfinder?: LeadFinderBridge }).leadfinder ?? null
  );
}

/** true tylko w aplikacji desktopowej (po hydratacji — bezpieczne dla SSR). */
export function useIsDesktopApp(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(Boolean(getBridge()?.isDesktop));
  }, []);
  return isDesktop;
}
