import { useCallback, useEffect, useState } from "react";

const KEY = "leadfinder.scan-history";
const EVENT = "leadfinder:scan-history-change";

export type ScanEntry = {
  id: string;
  branza: string;
  wojewodztwo: string;
  data: string;
  wyniki: number;
  miasta: number;
};

export function readHistory(): ScanEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ScanEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: ScanEntry[]) {
  window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, 50)));
  window.dispatchEvent(new Event(EVENT));
}

export function addScan(entry: Omit<ScanEntry, "id" | "data">) {
  if (typeof window === "undefined") return;
  write([
    { ...entry, id: `s${Date.now()}`, data: new Date().toISOString() },
    ...readHistory(),
  ]);
}

export function clearHistory() {
  write([]);
}

export function useScanHistory() {
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  useEffect(() => {
    const sync = () => setEntries(readHistory());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { entries, clear: useCallback(() => clearHistory(), []) };
}
