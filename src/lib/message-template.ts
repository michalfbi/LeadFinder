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
  /** Liczba opinii w Google (Snajper). */
  liczba_opinii?: number | string | null;
  /** Lokalny konkurent z nowoczesną stroną (Snajper). */
  konkurent?: string | null;
  /** Konkretny problem techniczny wykryty przez audytor (Snajper). */
  diagnoza_tech?: string | null;
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

/* ------------------------------------------------------------------ */
/* Szablony Snajpera — dobór wg kategorii intencji                      */
/* ------------------------------------------------------------------ */

export type SniperIntent =
  | "EXPIRED_OR_BROKEN_SITE"
  | "PAID_AD_NO_SITE"
  | "SOCIAL_OR_FREE_BUILDER"
  | "HIGH_REVIEWS_NO_SITE"
  | "OUTDATED_NO_SSL_MOBILE"
  | "NEW_CEIDG_HIGH_TICKET"
  | "NO_WEBSITE";

/** Formy grzecznościowe dopasowane do płci adresata; bez pewnej płci — „Państwo”. */
type Forms = {
  /** Pan / Pani / Państwo */
  pan: string;
  /** Pana / Pani / Państwa */
  pana: string;
  /** ma / ma / mają */
  ma: string;
  /** inwestuje / inwestuje / inwestują */
  inwestuje: string;
  /** płaci / płaci / płacą */
  placi: string;
  /** kieruje / kieruje / kierują */
  kieruje: string;
};

export type SniperGender = "kobieta" | "mezczyzna" | null;

export function sniperForms(gender: SniperGender): Forms {
  if (gender === "mezczyzna") return { pan: "Pan", pana: "Pana", ma: "ma", inwestuje: "inwestuje", placi: "płaci", kieruje: "kieruje" };
  if (gender === "kobieta") return { pan: "Pani", pana: "Pani", ma: "ma", inwestuje: "inwestuje", placi: "płaci", kieruje: "kieruje" };
  return { pan: "Państwo", pana: "Państwa", ma: "mają", inwestuje: "inwestują", placi: "płacą", kieruje: "kierują" };
}

export const SNIPER_TEMPLATE_LABELS: Record<SniperIntent, string> = {
  EXPIRED_OR_BROKEN_SITE: "🎯 Snajper · Awaria strony",
  PAID_AD_NO_SITE: "🎯 Snajper · Płatne OLX bez strony",
  SOCIAL_OR_FREE_BUILDER: "🎯 Snajper · Tylko FB / kreator",
  HIGH_REVIEWS_NO_SITE: "🎯 Snajper · Lider opinii bez strony",
  OUTDATED_NO_SSL_MOBILE: "🎯 Snajper · Stara strona / brak SSL",
  NEW_CEIDG_HIGH_TICKET: "🎯 Snajper · Nowa firma CEIDG",
  NO_WEBSITE: "🎯 Snajper · Brak strony",
};

export type SniperMessageInput = {
  intent: SniperIntent;
  gender: SniperGender;
  vars: MessageVars;
  /** Dopisuje zdanie z możliwością rezygnacji (odpowiedź „NIE”). */
  optOut?: boolean | undefined;
};

/**
 * Zwraca szablon Spintax dla kategorii intencji. Zdania z faktami (domena,
 * opinie, konkurent, diagnoza) pojawiają się tylko wtedy, gdy fakt jest znany —
 * SMS nigdy nie twierdzi czegoś, czego audytor nie sprawdził.
 */
export function sniperTemplate(input: SniperMessageInput): string {
  const f = sniperForms(input.gender);
  const v = input.vars;
  const hasDomain = Boolean(v.wolna_domena);
  const reviews = Number(v.liczba_opinii);
  const hasReviews = reviews > 0 && Number(String(v.ocena).replace(",", ".")) > 0;
  const hasRival = Boolean(v.konkurent);
  const hello = "{Dzień dobry|Witam}{zwrot}";
  const price = "(1490 zł na gotowo, 0 zł zaliczki)";
  const domainAsk = hasDomain
    ? `Domena {wolna_domena} jest wolna – mogę {przygotować darmowy projekt, jak mogłaby wyglądać ${f.pana} strona|podesłać niezobowiązującą wizualizację strony pod tym adresem}?`
    : `Mogę {przygotować darmowy projekt, jak mogłaby wyglądać ${f.pana} strona|podesłać niezobowiązującą wizualizację strony}?`;
  const reviewsLine = hasReviews
    ? ` ${capitalizeFirst(f.ma)} ${f.pan} świetne opinie ({liczba_opinii} ${reviewsNoun(reviews)}, średnia {ocena}⭐).`
    : "";

  let body: string;
  switch (input.intent) {
    case "PAID_AD_NO_SITE":
      body =
        `${hello}, trafiłem na ${f.pana} wyróżnione ogłoszenie na OLX ({branza}, {miasto}). ` +
        `{Widzę, że ${f.inwestuje} ${f.pan} w promocję, ale w opisie brakuje linku do własnej strony z realizacjami|` +
        `${capitalizeFirst(f.placi)} ${f.pan} za wyróżnienia, a klienci nie mają gdzie zobaczyć pełnego portfolio}. ` +
        `Robię strony pod klucz ${price}. ${domainAsk}`;
      break;
    case "HIGH_REVIEWS_NO_SITE":
      body =
        `${hello}, trafiłem na {nazwa} w Mapach Google ({miasto}).${reviewsLine} ` +
        (hasRival
          ? "W wizytówce brakuje jednak własnej strony www, a np. {konkurent} już ją ma. "
          : "W wizytówce brakuje jednak własnej strony www, więc część klientów może wybierać konkurencję. ") +
        `Robię strony pod klucz ${price}. ${domainAsk}`;
      break;
    case "SOCIAL_OR_FREE_BUILDER":
      body =
        `${hello}, trafiłem na {nazwa} ({miasto}).${reviewsLine} ` +
        `Widzę, że ${f.kieruje} ${f.pan} klientów {diagnoza_tech} zamiast na własną stronę z domeną. ` +
        `Robię strony pod klucz ${price}. ${domainAsk}`;
      break;
    case "EXPIRED_OR_BROKEN_SITE":
    case "OUTDATED_NO_SSL_MOBILE":
      body =
        `${hello}, sprawdzałem stronę firmy {nazwa} ({miasto}) i widzę, że {diagnoza_tech}. ` +
        (hasRival
          ? "Klienci z Google mogą przez to wybierać konkurencję, np. {konkurent}. "
          : "Klienci z Google mogą przez to rezygnować z kontaktu. ") +
        `Mogę postawić nową, szybką stronę pod klucz ${price} – {podesłać darmowy projekt nowej wersji|pokazać, jak mogłaby wyglądać}?`;
      break;
    case "NEW_CEIDG_HIGH_TICKET":
      body =
        `${hello}, gratuluję założenia firmy {nazwa}! Klienci w branży {branza} szukają wykonawców głównie w Google. ` +
        `Robię strony pod klucz ${price}. ${domainAsk}`;
      break;
    case "NO_WEBSITE":
    default:
      body =
        `${hello}, nie znalazłem strony internetowej firmy {nazwa} ({miasto}).${reviewsLine} ` +
        `Robię strony dla lokalnych firm ${price}. ${domainAsk}`;
      break;
  }
  if (input.optOut !== false) {
    body += " Jeśli nie, wystarczy odpisać NIE – nie napiszę ponownie.";
  }
  return body;
}

/** „1 recenzja”, „3 recenzje”, „12 recenzji”, „73 recenzje”. */
function reviewsNoun(n: number): string {
  if (n === 1) return "recenzja";
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "recenzje";
  return "recenzji";
}

function capitalizeFirst(value: string): string {
  return value ? value[0]!.toLocaleUpperCase("pl") + value.slice(1) : value;
}

/** Deterministyczny wariant parsera Spintax — wybory z podanego generatora liczb. */
function spinSeeded(s: string, chosen: string[], rand: () => number): string {
  const group = findSpintaxGroup(s);
  if (!group) return s;
  const [start, end] = group;
  const inner = s.slice(start + 1, end);
  const options = splitSpintaxOptions(inner);
  if (options.length === 1) {
    return s.slice(0, end + 1) + spinSeeded(s.slice(end + 1), chosen, rand);
  }
  const pick = options[Math.floor(rand() * options.length)]!;
  const spun = spinSeeded(pick, chosen, rand);
  chosen.push(spun);
  return s.slice(0, start) + spun + spinSeeded(s.slice(end + 1), chosen, rand);
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Spintax z ziarnem: ten sam tekst i to samo ziarno (np. id leada) dają zawsze
 * tę samą kombinację — podgląd w UI jest dokładnie tym, co wyjdzie SMS-em.
 */
export function spinSpintaxSeeded(input: string, seed: string): { text: string; signature: string } {
  const chosen: string[] = [];
  const text = spinSeeded(input, chosen, seededRandom(seed));
  return { text, signature: chosen.map((c) => `[${c}]`).join(" + ") };
}

/** Liczba części SMS: GSM-7 160/153 znaki, z polskimi znakami (UCS-2) 70/67. */
export function smsSegments(text: string): { chars: number; segments: number; unicode: boolean } {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
  const chars = [...text].length;
  const unicode = !gsm.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { chars, unicode, segments: chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi) };
}

/** Pełny SMS Snajpera: szablon wg intencji → zmienne → deterministyczny Spintax. */
export function buildSniperMessage(
  input: SniperMessageInput & { seed: string },
): { body: string; signature: string; templateId: string } {
  const template = sniperTemplate(input);
  const filled = fillTemplate(template, input.vars);
  const spun = spinSpintaxSeeded(filled, input.seed);
  const body = spun.text
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s*,\s*\)/g, ")")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
  return { body, signature: `[TYP: ${SNIPER_TEMPLATE_LABELS[input.intent]}] ${spun.signature}`.trim(), templateId: SNIPER_TEMPLATE_LABELS[input.intent] };
}
