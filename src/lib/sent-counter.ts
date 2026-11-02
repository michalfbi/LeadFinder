import { useEffect, useState } from "react";

const KEY = "leadfinder.sent-messages";
const EVENT = "leadfinder-sent-changed";

type Store = { total: number; day: string; today: number };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function empty(): Store {
  return { total: 0, day: todayKey(), today: 0 };
}

export function readSent(): Store {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const store: Store = {
      total: Number(parsed.total) || 0,
      day: typeof parsed.day === "string" ? parsed.day : todayKey(),
      today: Number(parsed.today) || 0,
    };
    if (store.day !== todayKey()) {
      store.day = todayKey();
      store.today = 0;
    }
    return store;
  } catch {
    return empty();
  }
}

function write(store: Store) {
  window.localStorage.setItem(KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(EVENT));
}

export function incrementSent() {
  const store = readSent();
  write({ ...store, total: store.total + 1, today: store.today + 1 });
}

export function resetSent() {
  write(empty());
}

export function useSentCounter() {
  const [store, setStore] = useState<Store>(() => empty());

  useEffect(() => {
    const sync = () => setStore(readSent());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return store;
}
