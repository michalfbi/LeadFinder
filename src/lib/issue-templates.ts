import { useCallback, useEffect, useState } from "react";
import { fillTemplate, spinSpintax, type MessageVars } from "./message-template";

/** Ruter szablonów SMS wg diagnozy strony www leada. */
export type WebsiteIssueType = "NO_WEBSITE" | "EXPIRED_OR_ERROR" | "NO_SSL" | "NO_MOBILE" | "OLX_NO_WEBSITE";

export const ISSUE_TYPES: WebsiteIssueType[] = ["NO_WEBSITE", "EXPIRED_OR_ERROR", "NO_SSL", "NO_MOBILE", "OLX_NO_WEBSITE"];

export const ISSUE_META: Record<WebsiteIssueType, { emoji: string; label: string; short: string; tag: string | null }> = {
  NO_WEBSITE: { emoji: "🔴", label: "Brak strony WWW", short: "Brak strony", tag: null },
  EXPIRED_OR_ERROR: { emoji: "⚡", label: "Strona wygasła / Błąd serwera", short: "Strona wygasła", tag: "🚨 Strona wygasła / Błąd serwera" },
  NO_SSL: { emoji: "🔓", label: "Brak certyfikatu SSL", short: "Brak SSL", tag: "🔓 Brak certyfikatu SSL" },
  NO_MOBILE: { emoji: "📱", label: "Brak wersji mobilnej", short: "Brak wersji mobilnej", tag: "📱 Brak wersji mobilnej" },
  OLX_NO_WEBSITE: { emoji: "🟣", label: "Ogłoszenie OLX (Brak własnej strony)", short: "Ogłoszenie OLX", tag: "🟣 Ogłoszenie OLX — brak własnej strony" },
};

export const DEFAULT_ISSUE_TEMPLATES: Record<WebsiteIssueType, string> = {
  NO_WEBSITE:
    "{Dzień dobry|Witam|Cześć}, {szukałem|przeglądałem} {wizytówki|firmy} z branży {branza} w {miasto} i trafiłem na {nazwa}, ale {zauważyłem, że nie macie Państwo|nie znalazłem Waszej} strony www. {Tworzę nowoczesne strony dla lokalnych firm|Buduję strony z portfolio dla tej branży} – {podesłać darmowy, niezobowiązujący projekt|pokazać jak mogłaby wyglądać Wasza strona}?",
  EXPIRED_OR_ERROR:
    "{Dzień dobry|Witam}, próbowałem właśnie wejść na stronę internetową firmy {nazwa} ({miasto}), ale {wyświetla się błąd serwera i strona nie działa|domena wygasła i strona zniknęła z sieci}. {Pomagam lokalnym firmom szybko przywrócić i odświeżyć stronę na tańszym serwerze|Mogę pomóc uruchomić nową, działającą wersję strony} – {podesłać propozycję rozwiązania|rozmawiamy z właścicielem}?",
  NO_SSL:
    "{Dzień dobry|Witam}, wchodziłem na stronę firmy {nazwa} z telefonu i przeglądarka {blokuje wejście komunikatem 'Strona niezabezpieczona' (brak SSL)|ostrzega klientów, że połączenie nie jest bezpieczne}. {Przez to część klientów z {miasto} może rezygnować z kontaktu|Mogę wdrożyć certyfikat i odświeżyć wygląd strony na nowoczesny} – {podesłać szczegóły jak to naprawić|przygotować wycenę odświeżenia}?",
  NO_MOBILE:
    "{Dzień dobry|Witam}, przeglądałem stronę firmy {nazwa} na telefonie i zauważyłem, że {jest to starsza wersja, która nie dopasowuje się do ekranów smartfonów|strona rozjeżdża się na telefonach}. {Robię szybkie, nowoczesne strony mobilne dla firm z {miasto}|Mogę przygotować odświeżony projekt dopasowany pod telefony} – podesłać darmową wizualizację?",
  OLX_NO_WEBSITE:
    "{Dzień dobry|Cześć|Witam}, trafiłem właśnie na Państwa ogłoszenie na OLX w kategorii {branza} ({miasto}). {Szukałem w opisie linku do Państwa strony www, żeby zobaczyć pełne portfolio i realizacje, ale widzę tylko ogłoszenie|Widzę, że promujecie usługi na OLX, ale brakuje tam własnej strony internetowej, która buduje zaufanie klientów}. {Tworzę nowoczesne strony z galerią realizacji specjalnie dla tej branży|Buduję strony, które pozwalają wyróżnić się na tle innych ogłoszeń z OLX} – {podesłać darmowy, niezobowiązujący projekt|pokazać jak mogłaby wyglądać Wasza strona}?",
};

/** Mapuje tekst z audytora (np. „🚨 Strona wygasła…”) na typ problemu. */
export function issueTypeFromText(text: string | null | undefined): WebsiteIssueType {
  const t = String(text ?? "");
  if (/wygas|błąd/i.test(t)) return "EXPIRED_OR_ERROR";
  if (/ssl|niezabezpiecz/i.test(t)) return "NO_SSL";
  if (/mobiln/i.test(t)) return "NO_MOBILE";
  return "NO_WEBSITE";
}

/** Typ problemu leada: jawne pole, źródło OLX albo opis z audytora. */
export function issueTypeOf(lead: { website_issue_type?: string | null; strona_problem?: string | null; zrodlo?: string | null }): WebsiteIssueType {
  const t = lead.website_issue_type;
  if (t && (ISSUE_TYPES as string[]).includes(t)) return t as WebsiteIssueType;
  if (lead.zrodlo === "OLX") return "OLX_NO_WEBSITE";
  return issueTypeFromText(lead.strona_problem);
}

const KEY = "leadfinder.issue-templates";
const EVENT = "leadfinder:template-change";

export function readIssueTemplates(): Record<WebsiteIssueType, string> {
  const out = { ...DEFAULT_ISSUE_TEMPLATES };
  if (typeof window === "undefined") return out;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<WebsiteIssueType, string>>;
      for (const t of ISSUE_TYPES) if (typeof parsed[t] === "string") out[t] = parsed[t]!;
    }
  } catch {
    /* uszkodzony wpis — domyślne */
  }
  return out;
}

export function useIssueTemplates() {
  const [templates, setTemplates] = useState(DEFAULT_ISSUE_TEMPLATES);
  useEffect(() => {
    const sync = () => setTemplates(readIssueTemplates());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const save = useCallback((type: WebsiteIssueType, body: string) => {
    const next = { ...readIssueTemplates(), [type]: body };
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
    setTemplates(next);
  }, []);
  return { templates, save };
}

/**
 * Buduje SMS dla leada z szablonu przypisanego do jego diagnozy strony.
 * Podpis zaczyna się od typu, np. „[TYP: Strona wygasła] + [Dzień dobry] + …”.
 */
export function buildIssueMessage(
  templates: Record<WebsiteIssueType, string>,
  type: WebsiteIssueType,
  vars: MessageVars,
): { body: string; signature: string; type: WebsiteIssueType } {
  const filled = fillTemplate(templates[type] || DEFAULT_ISSUE_TEMPLATES[type], vars);
  const spun = spinSpintax(filled);
  const body = spun.text.replace(/\s{2,}/g, " ").trim();
  const typeTag = `[TYP: ${ISSUE_META[type].short}]`;
  return { body, signature: spun.signature ? `${typeTag} + ${spun.signature}` : typeTag, type };
}

/** Odczytuje typ z podpisu kombinacji (do analityki). */
export function issueShortFromSignature(sig: string | null | undefined): string | null {
  const m = /\[TYP: ([^\]]+)\]/.exec(String(sig ?? ""));
  return m ? m[1]! : null;
}
