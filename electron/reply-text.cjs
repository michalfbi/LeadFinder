// Czyszczenie treści odpowiedzi: wspólne dla silnika e-mail i skrzynki odpowiedzi.

/** Sama odpowiedź, bez cytowanej wiadomości — cytat zawiera naszą stopkę ze słowem rezygnacji. */
function stripQuoted(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (
      /^\s*(On .{5,120} wrote:|W dniu .{5,120} napisał\(?a?\)?:|-{2,}\s*Original Message\s*-{2,}|-{2,}\s*Wiadomość oryginalna\s*-{2,}|From: .+|Od: .+|Sent from my .+|Wysłane z .+)\s*$/i.test(
        line,
      )
    )
      break;
    out.push(line);
  }
  return out.join("\n").trim();
}

function decodeQuotedPrintable(text) {
  const bytes = [];
  const src = String(text).replace(/=\r?\n/g, "");
  for (let i = 0; i < src.length; i++) {
    const hex = src[i] === "=" ? src.slice(i + 1, i + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      for (const b of Buffer.from(src[i], "utf8")) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodePart(body, encoding) {
  const enc = String(encoding || "").toLowerCase();
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Tekst z surowej treści e-maila (część TEXT z IMAP). Dla wiadomości
 * wieloczęściowych wybiera część text/plain (albo text/html bez znaczników)
 * i dekoduje quoted-printable / base64. Zwykły tekst zwraca bez zmian.
 */
function extractPlainText(raw, transferEncoding) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const boundary = text.match(/^--([^\s-][^\n]{0,69})$/m)?.[1];
  if (!boundary) return decodePart(text, transferEncoding).trim();
  const parts = text.split(
    new RegExp(
      `^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*$`,
      "m",
    ),
  );
  let html = null;
  for (const part of parts) {
    const split = part.indexOf("\n\n");
    if (split < 0) continue;
    const headers = part.slice(0, split);
    const body = part.slice(split + 2);
    const type =
      headers
        .match(/content-type:\s*([^;\n]+)/i)?.[1]
        ?.trim()
        .toLowerCase() ?? "";
    const enc =
      headers.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1] ?? "";
    if (type.startsWith("multipart/")) {
      const nested = extractPlainText(body);
      if (nested) return nested;
    }
    if (type === "text/plain") return decodePart(body, enc).trim();
    if (type === "text/html" && html === null)
      html = htmlToText(decodePart(body, enc)).trim();
  }
  return html ?? "";
}

/** Małe litery, bez polskich znaków i ozdobnych apostrofów, pojedyncze spacje. */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { stripQuoted, extractPlainText, normalizeText };
