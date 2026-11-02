/**
 * Rozpoznawanie imion właścicieli firm i płci na podstawie polskich imion.
 * Działa lokalnie, bez żadnych płatnych usług.
 */

export type Gender = "kobieta" | "mezczyzna" | null;

/** Najczęstsze polskie imiona męskie (mianownik). */
const MALE = [
  "adam","adrian","albert","aleksander","alan","alfred","andrzej","antoni","arek","arkadiusz","artur",
  "bartek","bartosz","bartłomiej","bernard","błażej","bogdan","bogusław","bolesław","borys","bronisław",
  "cezary","czesław","damian","dariusz","dawid","denis","dominik","donat","edward","emil","erwin","eryk",
  "eugeniusz","fabian","feliks","filip","franciszek","gabriel","gerard","grzegorz","gustaw","henryk",
  "hubert","ignacy","igor","ireneusz","iwo","jacek","jakub","jan","janusz","jarosław","jerzy","józef",
  "julian","juliusz","kacper","kajetan","kamil","karol","kazimierz","konrad","konstanty","kornel",
  "krystian","krzysztof","leon","leszek","longin","lech","lucjan","ludwik","łukasz","maciej","marcel",
  "marcin","marek","marian","mariusz","mateusz","maksymilian","michał","mieczysław","mikołaj","miłosz",
  "mirosław","nikodem","norbert","olaf","oskar","patryk","paweł","piotr","przemysław","radosław","rafał",
  "remigiusz","robert","roman","romuald","rudolf","ryszard","sebastian","seweryn","sławomir","stanisław",
  "stefan","sylwester","szymon","tadeusz","teodor","tomasz","tymon","tymoteusz","wacław","waldemar",
  "wiesław","wiktor","wincenty","witold","władysław","włodzimierz","wojciech","zbigniew","zdzisław",
  "zenon","zygmunt","alex","daniel","damiann","jarek","staszek","wojtek","krzysiek","zenek",
  // męskie imiona kończące się na -a
  "barnaba","bonawentura","kuba","jarema","kosma","dyzma","aleksy","bonifacy",
];

/** Najczęstsze polskie imiona żeńskie (mianownik). */
const FEMALE = [
  "ada","adrianna","agata","agnieszka","aleksandra","alicja","alina","amanda","amelia","aneta","anita",
  "anna","aniela","antonina","apolonia","aurelia","barbara","beata","berenika","bernadeta","blanka",
  "bogumiła","bogusława","bożena","brygida","celina","cecylia","dagmara","daniela","danuta","daria",
  "diana","dominika","dorota","edyta","eliza","elżbieta","emilia","ewa","ewelina","felicja","gabriela",
  "genowefa","grażyna","halina","hanna","helena","henryka","honorata","ilona","irena","iwona","izabela",
  "jadwiga","jagoda","janina","joanna","jolanta","judyta","julia","julianna","justyna","kamila",
  "karina","karolina","katarzyna","kazimiera","kinga","klaudia","kornelia","krystyna","laura","lena",
  "leokadia","lidia","liliana","lucyna","ludmiła","łucja","magdalena","maja","małgorzata","marcelina",
  "marta","martyna","maria","marianna","mariola","marzena","milena","mirosława","monika","nadia",
  "natalia","nikola","nina","olga","oliwia","patrycja","paulina","renata","roksana","rozalia",
  "róża","sabina","sandra","sara","sylwia","stanisława","stefania","teresa","urszula","wanda",
  "weronika","wiesława","wiktoria","wioletta","wiola","władysława","zofia","zuzanna","żaneta",
  "aldona","arleta","bibianna","cyntia","dagna","eryka","ida","kaja","luiza","malwina","melania",
];

const MALE_SET = new Set(MALE);
const FEMALE_SET = new Set(FEMALE);

/** Zdrobnienia i formy potoczne → forma podstawowa. */
const NICKNAMES: Record<string, string> = {
  aśka: "joanna", asia: "joanna", kasia: "katarzyna", kasiu: "katarzyna", basia: "barbara",
  magda: "magdalena", gosia: "małgorzata", ola: "aleksandra", ela: "elżbieta", ania: "anna",
  zosia: "zofia", jola: "jolanta", iza: "izabela", kaśka: "katarzyna", madzia: "magdalena",
  krzysiu: "krzysztof", tomek: "tomasz", tomu: "tomasz", michu: "michał", darek: "dariusz",
  mietek: "mieczysław", rysiek: "ryszard", władek: "władysław", jurek: "jerzy", zbyszek: "zbigniew",
  józek: "józef", stasiu: "stanisław", romek: "roman", edek: "edward", heniek: "henryk",
  maciek: "maciej", radek: "radosław", sławek: "sławomir", przemek: "przemysław", mirek: "mirosław",
  witek: "witold", olek: "aleksander", franek: "franciszek", grzesiek: "grzegorz",
};

function norm(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .replace(/[^a-ząćęłńóśźż]/g, "");
}

/** Zwraca płeć dla imienia; gdy imię nieznane, korzysta z końcówki. */
export function genderFromFirstName(name: string): Gender {
  const base = NICKNAMES[norm(name)] ?? norm(name);
  if (!base || base.length < 3) return null;
  if (FEMALE_SET.has(base)) return "kobieta";
  if (MALE_SET.has(base)) return "mezczyzna";
  // heurystyka: polskie imiona żeńskie prawie zawsze kończą się na -a
  if (base.endsWith("a")) return "kobieta";
  return null;
}

/** Czy słowo wygląda na znane polskie imię. */
export function isKnownFirstName(word: string): boolean {
  const base = NICKNAMES[norm(word)] ?? norm(word);
  return MALE_SET.has(base) || FEMALE_SET.has(base);
}

export function genderLabel(gender: Gender): string {
  if (gender === "kobieta") return "Kobieta";
  if (gender === "mezczyzna") return "Mężczyzna";
  return "Nieznana";
}

/** Grzecznościowy zwrot pasujący do płci. */
export function greeting(gender: Gender, firstName?: string | null): string {
  if (!firstName) return "Dzień dobry";
  if (gender === "kobieta") return `Pani ${firstName}`;
  if (gender === "mezczyzna") return `Panie ${firstName}`;
  return `Dzień dobry, ${firstName}`;
}

/** Płeć tylko wtedy, gdy imię jest w słowniku — bez zgadywania po końcówce. */
export function certainGender(name?: string | null): Gender {
  if (!name) return null;
  const base = NICKNAMES[norm(name)] ?? norm(name);
  if (FEMALE_SET.has(base)) return "kobieta";
  if (MALE_SET.has(base)) return "mezczyzna";
  return null;
}

/**
 * Szuka w nazwie firmy schematu „Imię Nazwisko” (np. „Fryzjer Anna Kowalska”).
 * Zwraca wynik tylko dla jednoznacznie rozpoznanego polskiego imienia —
 * dla nazw typu „Wojdat Auto Spa” zwraca null, żeby nie zgadywać płci.
 */
export function certainPersonFromCompany(
  nazwa?: string | null,
): { imie: string; plec: Exclude<Gender, null> } | null {
  if (!nazwa) return null;
  const words = nazwa.split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż-]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const first = words[i]!;
    if (!isKnownFirstName(first)) continue;
    const plec = certainGender(first);
    if (!plec) continue;
    const next = words[i + 1];
    // wymagamy nazwiska po imieniu — inaczej to raczej część nazwy firmy
    if (!next || !LAST_RE.test(next) || BLOCKLIST.has(norm(next))) continue;
    return { imie: first[0]!.toLocaleUpperCase("pl") + first.slice(1), plec };
  }
  return null;
}

const CAP = "[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{2,}";
const SURNAME = `${CAP}(?:-${CAP})?`;

/** Konteksty, w których zwykle pojawia się właściciel firmy. */
const CONTEXT_RES = [
  new RegExp(`(?:właściciel(?:ka|em|:)?|prowadzi|prowadzący|kierownik|prezes|osoba kontaktowa|kontakt)[^A-ZĄĆĘŁŃÓŚŹŻ]{0,20}(${CAP})\\s+(${SURNAME})`, "g"),
  new RegExp(`(${CAP})\\s+(${SURNAME})\\s*[-–—,]\\s*(?:właściciel|właścicielka|prezes|kierownik)`, "g"),
];

/** Nazwy firm typu "Zakład Fryzjerski Anna Kowalska". */
const FIRST_RE = new RegExp(`^${CAP}$`);
const LAST_RE = new RegExp(`^${SURNAME}$`);

const BLOCKLIST = new Set([
  "polska","warszawa","kraków","google","facebook","instagram","spółka","firma","usługi","zakład",
  "cookie","polityka","strona","kontakt","oferta","opinie","adres",
]);

export type PersonGuess = {
  imie: string | null;
  wlasciciel: string | null;
  plec: Gender;
};

/** Wyciąga imię i nazwisko właściciela z tekstu strony oraz określa płeć. */
export function extractPerson(rawText: string): PersonGuess {
  const text = rawText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const candidates: Array<[string, string]> = [];

  for (const re of CONTEXT_RES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const first = m[1] ?? "";
      const last = m[2] ?? "";
      if (isKnownFirstName(first)) candidates.push([first, last]);
    }
  }

  if (candidates.length === 0) {
    // przechodzimy słowo po słowie, żeby nie gubić par w rodzaju „Fryzjer Gosia Style”
    const words = text.split(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż-]+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const first = words[i]!;
      const last = words[i + 1]!;
      if (!FIRST_RE.test(first) || !LAST_RE.test(last)) continue;
      if (!isKnownFirstName(first)) continue;
      if (BLOCKLIST.has(norm(last))) continue;
      candidates.push([first, last]);
      if (candidates.length > 20) break;
    }
  }

  if (candidates.length === 0) return { imie: null, wlasciciel: null, plec: null };

  // najczęściej powtarzająca się para wygrywa
  const counts = new Map<string, { pair: [string, string]; n: number }>();
  for (const pair of candidates) {
    const key = `${norm(pair[0])} ${norm(pair[1])}`;
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { pair, n: 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]!;
  const [imie, nazwisko] = best.pair;

  return {
    imie,
    wlasciciel: `${imie} ${nazwisko}`,
    plec: genderFromFirstName(imie),
  };
}
