/**
 * Trwałość ustawień w aplikacji na Maca.
 *
 * W przeglądarce wszystko żyje w localStorage. W Electronie localStorage jest
 * przypisany do adresu lokalnego serwera, więc dodatkowo lustrzanie zapisujemy
 * wszystkie klucze "leadfinder.*" do pliku JSON w katalogu danych aplikacji.
 * Dzięki temu szablony wiadomości, licznik i statystyki mapy przeżyją
 * ponowne uruchomienie niezależnie od portu.
 */

const PREFIX = "leadfinder.";

type PrefsBridge = {
  prefs?: {
    get: () => Promise<Record<string, string>>;
    set: (values: Record<string, string>) => Promise<void>;
  };
};

function bridge(): PrefsBridge["prefs"] | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { leadfinder?: PrefsBridge }).leadfinder?.prefs ?? null;
}

function collectLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(PREFIX)) out[key] = window.localStorage.getItem(key) ?? "";
  }
  return out;
}

function notifyAll() {
  for (const event of [
    "leadfinder:template-change",
    "leadfinder:region-stats-change",
    "leadfinder-sent-changed",
    "leadfinder:prefs-change",
  ]) {
    window.dispatchEvent(new Event(event));
  }
}

let installed = false;

/** Wczytuje ustawienia z dysku i włącza automatyczny zapis każdej zmiany. */
export async function initPrefsSync() {
  const prefs = bridge();
  if (!prefs || installed) return;
  installed = true;

  try {
    const stored = await prefs.get();
    for (const [key, value] of Object.entries(stored ?? {})) {
      if (key.startsWith(PREFIX)) window.localStorage.setItem(key, value);
    }
    notifyAll();
  } catch {
    /* pierwsze uruchomienie — brak pliku */
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      prefs.set(collectLocal()).catch(() => undefined);
    }, 300);
  };

  const storage = window.localStorage;
  const originalSet = storage.setItem.bind(storage);
  const originalRemove = storage.removeItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    originalSet(key, value);
    if (key.startsWith(PREFIX)) flush();
  };
  storage.removeItem = (key: string) => {
    originalRemove(key);
    if (key.startsWith(PREFIX)) flush();
  };

  // zapis awaryjny przy zamykaniu okna
  window.addEventListener("beforeunload", () => {
    prefs.set(collectLocal()).catch(() => undefined);
  });
}
