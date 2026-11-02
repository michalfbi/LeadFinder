import { useCallback, useEffect, useState } from "react";
import { speedConfig, type SpeedConfig, type SpeedMode } from './sms-speed';

const KEY = "leadfinder.send-settings";
const EVENT = "leadfinder:send-settings-change";

export type SendSettings = SpeedConfig & {
  /** odstęp między wiadomościami w sekundach */
  delaySeconds: number;
  /** maksymalna liczba wiadomości w jednej serii */
  dailyLimit: number;
  /** pomijaj firmy, do których już pisałem */
  skipAlreadySent: boolean;
  /** tryb Dual eSIM — wysyłka na przemian z dwóch linii */
  dualSim: boolean;
  /** nazwa pierwszej linii (usługi SMS w Wiadomościach) */
  sim1Name: string;
  /** nazwa drugiej linii */
  sim2Name: string;
  /** blokada godzin nocnych — wysyłka tylko 08:30–17:00 */
  nightLock: boolean;
};

export const DEFAULT_SEND_SETTINGS: SendSettings = {
  ...speedConfig('fast'),
  delaySeconds: 7.5,
  dailyLimit: 100,
  skipAlreadySent: true,
  dualSim: false,
  sim1Name: "SIM 1",
  sim2Name: "SIM 2",
  nightLock: true,
};

export function readSendSettings(): SendSettings {
  if (typeof window === "undefined") return DEFAULT_SEND_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SEND_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SendSettings>;
    const mode: SpeedMode = ['turbo', 'fast', 'balance', 'custom'].includes(parsed.speedMode ?? '') ? parsed.speedMode ?? 'fast' : 'fast';
    const speed = speedConfig(mode, Number(parsed.delaySeconds) || 7.5);
    return {
      ...speed,
      delaySeconds: (speed.minDelayMs + speed.maxDelayMs) / 2000,
      dailyLimit: Math.min(500, Math.max(1, Number(parsed.dailyLimit) || 100)),
      skipAlreadySent: parsed.skipAlreadySent !== false,
      dualSim: parsed.dualSim === true,
      sim1Name: String(parsed.sim1Name ?? "SIM 1"),
      sim2Name: String(parsed.sim2Name ?? "SIM 2"),
      nightLock: parsed.nightLock !== false,
    };
  } catch {
    return DEFAULT_SEND_SETTINGS;
  }
}

export function useSendSettings() {
  const [settings, setSettings] = useState<SendSettings>(DEFAULT_SEND_SETTINGS);

  useEffect(() => {
    const sync = () => setSettings(readSendSettings());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = useCallback((patch: Partial<SendSettings>) => {
    const next = { ...readSendSettings(), ...patch };
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
    setSettings(next);
  }, []);

  return { settings, save };
}
