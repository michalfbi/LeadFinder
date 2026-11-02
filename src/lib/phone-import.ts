/** Zamienia wklejony tekst / plik CSV z numerami na leady do bazy. */
export function parsePhoneList(text: string, label = "Moja lista") {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/(\+?\d[\d\s\-().]{7,}\d)/);
    if (!match) continue;
    const num = match[1] ?? "";
    let digits = num.replace(/\D/g, "");
    if (digits.startsWith("0048")) digits = digits.slice(4);
    if (digits.length === 11 && digits.startsWith("48")) digits = digits.slice(2);
    if (digits.length !== 9) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    const phone = `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    const name = line
      .replace(num, " ")
      .replace(/[;,\t"]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      nazwa: name || phone,
      telefon: phone,
      zrodlo: label,
      status: "nowy",
      sms_sent_at: null,
    });
  }
  return out;
}
