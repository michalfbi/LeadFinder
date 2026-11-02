import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/**
 * Rygorystyczna walidacja polskich numerów telefonów.
 * SMS-y docierają wyłącznie na numery komórkowe — numery stacjonarne
 * (kierunkowe 22, 41, 12 itd.) oraz błędne odrzucamy już na wejściu.
 */

/** Typowe prefiksy polskich numerów komórkowych (pierwsze 2 cyfry numeru krajowego). */
const MOBILE_PREFIXES = ["45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88"];

export type PhoneValidation = {
  /** true tylko dla poprawnego polskiego numeru komórkowego. */
  isValidMobile: boolean;
  /** Numer w standardzie E.164, np. +48600123456 (null gdy niepoprawny). */
  formatted: string | null;
  /** 9 cyfr numeru krajowego, np. 600123456 (null gdy niepoprawny). */
  nineDigits: string | null;
};

const INVALID: PhoneValidation = { isValidMobile: false, formatted: null, nineDigits: null };

export function validateAndFormatPolishMobile(rawPhone: string): PhoneValidation {
  const raw = String(rawPhone ?? "").trim();
  if (!raw) return INVALID;

  const parsed = parsePhoneNumberFromString(raw, "PL");
  if (!parsed || !parsed.isValid()) return INVALID;

  const type = parsed.getType();
  // Numer stacjonarny — SMS nie dojdzie.
  if (type === "FIXED_LINE") return INVALID;
  // Akceptujemy wyłącznie komórki (lub numery, które mogą być komórką).
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return INVALID;

  const nine = parsed.nationalNumber.replace(/\D/g, "");
  if (nine.length !== 9) return INVALID;
  // Dodatkowe zabezpieczenie: typowy prefiks komórkowy.
  if (!MOBILE_PREFIXES.includes(nine.slice(0, 2))) return INVALID;

  return { isValidMobile: true, formatted: parsed.number, nineDigits: nine };
}
