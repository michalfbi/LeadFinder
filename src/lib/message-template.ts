import { useCallback, useEffect, useState } from "react";

const LEGACY_KEY = "leadfinder.message-template";
const STORAGE_KEY = "leadfinder.message-templates";
const EVENT = "leadfinder:template-change";

export const DEFAULT_TEMPLATE =
  "Dzień dobry, piszę do firmy {nazwa}. Nie znalazłem Państwa strony internetowej — robię proste strony www dla lokalnych firm. Mogę pokazać przykład?";

/** Wariant bezosobowy — używany, gdy nie znamy pewnie imienia ani płci. */
export const NEUTRAL_TEMPLATE =
  "Dzień dobry, kontaktuję się z Państwem w sprawie firmy {nazwa}. Nie znalazłem Państwa strony internetowej — robię proste strony www dla lokalnych firm. Mogę pokazać przykład?";

export type TemplateItem = { id: string; name: string; body: string };
type Store = { items: TemplateItem[]; activeId: string; neutral?: string };

function fresh(body: string): Store {
  return {
    items: [{ id: "default", name: "Podstawowy", body }],
    activeId: "default",
    neutral: NEUTRAL_TEMPLATE,
  };
}

export function readTemplates(): Store {
  if (typeof window === "undefined") return fresh(DEFAULT_TEMPLATE);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (Array.isArray(parsed?.items) && parsed.items.length > 0) return parsed;
    }
  } catch {
    /* uszkodzony wpis — zaczynamy od nowa */
  }
  // migracja z pojedynczego szablonu
  const legacy = window.localStorage.getItem(LEGACY_KEY);
  return fresh(legacy ?? DEFAULT_TEMPLATE);
}

function write(store: Store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(EVENT));
}

export function getTemplate(): string {
  const store = readTemplates();
  return store.items.find((t) => t.id === store.activeId)?.body ?? store.items[0]?.body ?? DEFAULT_TEMPLATE;
}

export function useMessageTemplate() {
  const [store, setStore] = useState<Store>(() => fresh(DEFAULT_TEMPLATE));

  useEffect(() => {
    const sync = () => setStore(readTemplates());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const apply = useCallback((next: Store) => {
    write(next);
    setStore(next);
  }, []);

  const active = store.items.find((t) => t.id === store.activeId) ?? store.items[0];

  const save = useCallback(
    (body: string) => {
      const current = readTemplates();
      apply({
        ...current,
        items: current.items.map((t) => (t.id === current.activeId ? { ...t, body } : t)),
      });
    },
    [apply],
  );

  const rename = useCallback(
    (name: string) => {
      const current = readTemplates();
      apply({
        ...current,
        items: current.items.map((t) => (t.id === current.activeId ? { ...t, name } : t)),
      });
    },
    [apply],
  );

  const add = useCallback(() => {
    const current = readTemplates();
    const id = `t${Date.now()}`;
    apply({
      items: [...current.items, { id, name: `Szablon ${current.items.length + 1}`, body: DEFAULT_TEMPLATE }],
      activeId: id,
    });
  }, [apply]);

  const remove = useCallback(() => {
    const current = readTemplates();
    if (current.items.length <= 1) return;
    const items = current.items.filter((t) => t.id !== current.activeId);
    apply({ items, activeId: items[0]!.id });
  }, [apply]);

  const setActive = useCallback(
    (id: string) => {
      const current = readTemplates();
      apply({ ...current, activeId: id });
    },
    [apply],
  );

  const saveNeutral = useCallback(
    (body: string) => {
      const current = readTemplates();
      apply({ ...current, neutral: body });
    },
    [apply],
  );

  return {
    template: active?.body ?? DEFAULT_TEMPLATE,
    neutral: store.neutral ?? NEUTRAL_TEMPLATE,
    templates: store.items,
    activeId: active?.id ?? "default",
    activeName: active?.name ?? "Podstawowy",
    save,
    saveNeutral,
    rename,
    add,
    remove,
    setActive,
  };
}

export type MessageVars = {
  nazwa?: string | null;
  branza?: string | null;
  adres?: string | null;
  telefon?: string | null;
  miasto?: string | null;
  ocena?: number | string | null;
  opinie?: number | string | null;
  notatki?: string | null;
  imie?: string | null;
  zwrot?: string | null;
  /** true tylko gdy imię i płeć są pewne — inaczej używamy wariantu neutralnego. */
  pewnaPlec?: boolean;
  problem_strony?: string | null;
  /** Wolna domena .pl znaleziona przez asystenta domen — haczyk w ofercie. */
  wolna_domena?: string | null;
};

/** Zwrot do SMS-a opisujący problem ze stroną firmy (zmienna {problem_strony}). */
export function websiteProblemPhrase(issue: string | null | undefined): string {
  const t = String(issue ?? "");
  if (/wygas|błąd serwera/i.test(t)) return "próbowałem wejść na Państwa stronę, ale wyświetla się błąd";
  if (/ssl|niezabezpiecz/i.test(t)) return "zauważyłem, że Państwa strona nie ma certyfikatu SSL i przeglądarki oznaczają ją jako niebezpieczną";
  if (/mobiln/i.test(t)) return "zauważyłem, że Państwa strona nie wyświetla się dobrze na telefonach";
  return "nie znalazłem Państwa strony internetowej";
}

export function fillTemplate(template: string, vars: MessageVars): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (vars as Record<string, unknown>)[key];
    return value === null || value === undefined || value === "" ? "" : String(value);
  });
}

/**
 * Wybiera szablon bezpieczny dla danego leada: osobowy tylko przy pewnym imieniu,
 * w pozostałych przypadkach bezosobowy wariant neutralny.
 */
export function buildMessage(
  template: string,
  neutral: string,
  vars: MessageVars,
): string {
  return fillTemplate(vars.pewnaPlec ? template : neutral || NEUTRAL_TEMPLATE, vars);
}

/** Dzieli wnętrze grupy na warianty po „|” na najwyższym poziomie zagnieżdżenia. */
function splitSpintaxOptions(inner: string): string[] {
  const options: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "|" && depth === 0) {
      options.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  options.push(cur);
  return options;
}

/** Znajduje pierwszą grupę {…} (z balansem nawiasów) i zwraca [start, end] lub null. */
function findSpintaxGroup(s: string): [number, number] | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return [start, i];
    }
  }
  return null;
}

/** Rekurencyjnie losuje warianty — obsługuje zagnieżdżone grupy {A|B{C|D}|E}. */
function spinRecursive(s: string, chosen: string[]): string {
  const group = findSpintaxGroup(s);
  if (!group) return s;
  const [start, end] = group;
  const inner = s.slice(start + 1, end);
  const options = splitSpintaxOptions(inner);
  if (options.length === 1) {
    // Brak „|” — zwykły placeholder (np. {nazwa}); zostawiamy i idziemy dalej.
    return s.slice(0, end + 1) + spinRecursive(s.slice(end + 1), chosen);
  }
  const pick = options[Math.floor(Math.random() * options.length)]!;
  const spun = spinRecursive(pick, chosen);
  chosen.push(spun);
  return s.slice(0, start) + spun + spinRecursive(s.slice(end + 1), chosen);
}

/**
 * Deterministyczny parser Spintax: losuje warianty z grup `{A|B|C}` (także
 * zagnieżdżonych) i zwraca finalny tekst oraz podpis wylosowanej kombinacji,
 * np. „[Dzień dobry] + [Brak strony] + [Darmowy projekt]”.
 * Grupy bez „|” (np. placeholdery {nazwa}) zostają nietknięte.
 */
export function spinSpintax(input: string): { text: string; signature: string } {
  const chosen: string[] = [];
  const text = spinRecursive(input, chosen);
  const signature = chosen.map((c) => `[${c}]`).join(" + ");
  return { text, signature };
}

/**
 * Pełny silnik Spintax: najpierw podstawia zmienne leada ({nazwa}, {miasto},
 * {branza}…), a potem losuje po jednym wariancie z każdego bloku {A|B|C}.
 */
export function parseSpintax(text: string, vars?: MessageVars): string {
  const filled = vars ? fillTemplate(text, vars) : text;
  return spinRecursive(filled, []);
}

/**
 * Liczy, ile unikalnych wariantów wiadomości można wygenerować z szablonu.
 * Grupy na tym samym poziomie mnożą się, warianty w grupie dodają się,
 * zagnieżdżenia liczą się rekurencyjnie.
 */
export function countSpintaxCombinations(template: string): number {
  const count = (s: string): number => {
    let total = 1;
    let i = 0;
    while (i < s.length) {
      if (s[i] !== "{") {
        i++;
        continue;
      }
      let depth = 0;
      let end = -1;
      for (let j = i; j < s.length; j++) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end === -1) break;
      const inner = s.slice(i + 1, end);
      const options = splitSpintaxOptions(inner);
      total *=
        options.length > 1
          ? options.reduce((sum, o) => sum + count(o), 0)
          : count(inner);
      i = end + 1;
    }
    return total;
  };
  return count(template);
}

/**
 * Jak buildMessage, ale dodatkowo rozwija Spintax i zwraca podpis kombinacji
 * (do zapisu w leadzie jako sms_combination_signature).
 */
export function buildMessageWithSignature(
  template: string,
  neutral: string,
  vars: MessageVars,
): { body: string; signature: string } {
  const filled = buildMessage(template, neutral, vars);
  const spun = spinSpintax(filled);
  return { body: spun.text, signature: spun.signature };
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/** Klucz do wykrywania duplikatów — ostatnie 9 cyfr numeru. */
export function phoneKey(phone?: string | null): string {
  return (phone ?? "").replace(/\D/g, "").slice(-9);
}

function isAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Macintosh/.test(ua);
}

/**
 * iMessage / SMS deep link.
 * iOS i macOS oczekują separatora "&" po numerze, Android "?".
 */
export function smsHref(phone: string, body: string): string {
  const number = normalizePhone(phone);
  const encoded = encodeURIComponent(body);
  return isAppleDevice()
    ? `sms:${number}&body=${encoded}`
    : `sms:${number}?body=${encoded}`;
}

/** Hydration-safe href (na serwerze nie znamy systemu użytkownika). */
export function useSmsHref(phone: string, body: string): string {
  const [href, setHref] = useState(
    () => `sms:${normalizePhone(phone)}?body=${encodeURIComponent(body)}`,
  );
  useEffect(() => {
    setHref(smsHref(phone, body));
  }, [phone, body]);
  return href;
}
