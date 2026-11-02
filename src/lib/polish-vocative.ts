import { certainGender, type Gender } from "./person-name";

/**
 * Deterministyczny wołacz polskich imion do zwrotów grzecznościowych w SMS-ach
 * („Panie Marku”, „Pani Anno”). Najpierw słownik form nieregularnych i
 * zdrobnień, potem reguły końcówek. Dla imion spoza słownika płci zwracamy "",
 * bo błędny zwrot szkodzi bardziej niż jego brak.
 */

/** Formy nieregularne lub takie, których reguły końcówek nie oddają poprawnie. */
const MALE_EXCEPTIONS: Record<string, string> = {
  paweł: "Pawle",
  michał: "Michale",
  rafał: "Rafale",
  piotr: "Piotrze",
  aleksander: "Aleksandrze",
  sylwester: "Sylwestrze",
  kacper: "Kacprze",
  krzysztof: "Krzysztofie",
  jan: "Janie",
  marek: "Marku",
  tomasz: "Tomaszu",
  łukasz: "Łukaszu",
  daniel: "Danielu",
  kamil: "Kamilu",
  emil: "Emilu",
  karol: "Karolu",
  marcel: "Marcelu",
  kornel: "Kornelu",
  jerzy: "Jerzy",
  antoni: "Antoni",
  ignacy: "Ignacy",
  aleksy: "Aleksy",
  bonifacy: "Bonifacy",
  konstanty: "Konstanty",
  wincenty: "Wincenty",
  cezary: "Cezary",
  kuba: "Kubo",
  barnaba: "Barnabo",
  bonawentura: "Bonawenturo",
  jarema: "Jaremo",
  kosma: "Kosmo",
  dyzma: "Dyzmo",
  lech: "Lechu",
  bartek: "Bartku",
  tomek: "Tomku",
  jacek: "Jacku",
  leszek: "Leszku",
  wojtek: "Wojtku",
  zbyszek: "Zbyszku",
  krzysiek: "Krzyśku",
  staszek: "Staszku",
  grzesiek: "Grześku",
  maciek: "Maćku",
  zenek: "Zenku",
  igor: "Igorze",
  olaf: "Olafie",
};

const FEMALE_EXCEPTIONS: Record<string, string> = {
  kasia: "Kasiu",
  basia: "Basiu",
  ania: "Aniu",
  zosia: "Zosiu",
  gosia: "Gosiu",
  asia: "Asiu",
  ola: "Olu",
  ela: "Elu",
  jola: "Jolu",
  iza: "Izo",
  magda: "Magdo",
  madzia: "Madziu",
  aśka: "Aśka",
  kaśka: "Kaśka",
  wiola: "Wiolu",
};

function capitalize(value: string): string {
  return value ? value[0]!.toLocaleUpperCase("pl") + value.slice(1) : value;
}

function norm(value: string): string {
  return value.toLocaleLowerCase("pl").replace(/[^a-ząćęłńóśźż]/g, "");
}

/** Wołacz imienia męskiego według końcówki mianownika. */
function maleVocative(name: string): string {
  const exception = MALE_EXCEPTIONS[name];
  if (exception) return exception;
  let stem: string;
  if (/[iy]$/.test(name)) stem = name;
  else if (/a$/.test(name)) stem = `${name.slice(0, -1)}o`;
  else if (/ek$/.test(name)) stem = `${name.slice(0, -2)}ku`;
  else if (/ł$/.test(name)) stem = `${name.slice(0, -1)}le`;
  else if (/(sz|cz|rz|ż|j|ch|k|g|h|l|c)$/.test(name)) stem = `${name}u`;
  else if (/er$/.test(name)) stem = `${name.slice(0, -2)}rze`;
  else if (/r$/.test(name)) stem = `${name}ze`;
  else if (/st$/.test(name)) stem = `${name.slice(0, -2)}ście`;
  else if (/t$/.test(name)) stem = `${name.slice(0, -1)}cie`;
  else if (/d$/.test(name)) stem = `${name}zie`;
  else if (/z$/.test(name)) stem = `${name}ie`;
  else if (/s$/.test(name)) stem = `${name}ie`;
  else if (/[nmwfbp]$/.test(name)) stem = `${name}ie`;
  else stem = name;
  return capitalize(stem);
}

/** Wołacz imienia żeńskiego według końcówki mianownika. */
function femaleVocative(name: string): string {
  const exception = FEMALE_EXCEPTIONS[name];
  if (exception) return exception;
  // Zdrobnienia na -sia/-zia/-cia/-nia/-dzia → -u (Kasia → Kasiu).
  if (/(si|zi|ci|ni|dzi)a$/.test(name) && name.length <= 6)
    return capitalize(`${name.slice(0, -1)}u`);
  if (/a$/.test(name)) return capitalize(`${name.slice(0, -1)}o`);
  return capitalize(name);
}

/**
 * Wyciąga pierwsze rozpoznane polskie imię z dowolnego tekstu kontaktowego,
 * np. „Kontakt: Tomasz”, „Marek Kowalski”, „MAREK”. Zwraca formę mianownika
 * z wielką literą albo null.
 */
export function extractFirstName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const words = String(raw)
    .split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/)
    .filter(Boolean);
  for (const word of words) {
    const lower = norm(word);
    if (lower.length < 2) continue;
    if (certainGender(lower)) return capitalize(lower);
    if (MALE_EXCEPTIONS[lower] || FEMALE_EXCEPTIONS[lower])
      return capitalize(lower);
  }
  return null;
}

/** Płeć imienia tylko wtedy, gdy jest pewna (słownik imion lub słownik wyjątków). */
export function vocativeGender(firstName: string | null | undefined): Gender {
  const lower = norm(String(firstName ?? ""));
  if (!lower) return null;
  if (FEMALE_EXCEPTIONS[lower]) return "kobieta";
  if (MALE_EXCEPTIONS[lower]) return "mezczyzna";
  return certainGender(lower);
}

/**
 * Zamienia imię (lub tekst zawierający imię) na zwrot w wołaczu:
 * Marek → „Panie Marku”, Anna → „Pani Anno”. Nieznane imię → "".
 */
export function toPolishVocative(firstName: string | null | undefined): string {
  const extracted = extractFirstName(firstName);
  if (!extracted) return "";
  const lower = norm(extracted);
  const gender = vocativeGender(lower);
  if (gender === "mezczyzna") return `Panie ${maleVocative(lower)}`;
  if (gender === "kobieta") return `Pani ${femaleVocative(lower)}`;
  return "";
}
