// Skrzynka odpowiedzi: klasyfikuje odpowiedzi klientów (SMS i e-mail),
// blokuje odmowy i nieufność, a dla reszty przygotowuje szkic odpowiedzi,
// który właściciel zatwierdza. AI (fal.ai) pomaga tylko tam, gdzie reguły
// nie są pewne, i nigdy nie cofa blokady.
// Moduł nie zależy od Electrona: bazę, sieć, wysyłkę i powiadomienia dostaje z zewnątrz.

const { createHash } = require("node:crypto");
const rules = require("../reply-rules.json");
const { stripQuoted, normalizeText } = require("./reply-text.cjs");

const BLOCKING = new Set(
  Object.keys(rules.categories).filter(
    (c) => rules.categories[c].action === "block",
  ),
);
const CATEGORY_IDS = Object.keys(rules.categories);
const SETTINGS_FILE = "inbox-settings.json";

function hasKeyword(body, keyword) {
  let from = 0;
  for (;;) {
    const at = body.indexOf(keyword, from);
    if (at < 0) return -1;
    // Dopasowanie od początku słowa: „spam” nie łapie „antispam”, „uke” nie łapie „nauke”.
    if (at === 0 || !/[a-z0-9]/.test(body[at - 1])) return at;
    from = at + 1;
  }
}

const PATTERNS = Object.fromEntries(
  Object.entries(rules.patterns).map(([category, list]) => [
    category,
    list.map((source) => new RegExp(source)),
  ]),
);

/** Ogólne wzorce (np. „don't … email”, „skąd … numer”) — łapią sformułowania spoza listy słów. */
function firstPattern(body, category) {
  for (const re of PATTERNS[category] ?? []) {
    const m = body.match(re);
    if (m) return { keyword: `/${re.source.slice(0, 40)}/`, at: m.index ?? 0 };
  }
  return null;
}

function firstKeyword(body, list) {
  for (const keyword of list) {
    const at = hasKeyword(body, keyword);
    if (at >= 0) return { keyword, at };
  }
  return null;
}

/**
 * Klasyfikacja regułami słów kluczowych. Kolejność ma znaczenie: odmowa
 * i nieufność są sprawdzane przed zainteresowaniem („not interested”).
 */
function classifyRules(text) {
  const body = normalizeText(stripQuoted(text));
  const result = (category, matched = null) => ({
    category,
    confidence: rules.confidence[category],
    source: "rules",
    matched,
  });
  if (!body)
    return {
      category: "inne",
      confidence: 0.1,
      source: "rules",
      matched: null,
    };
  const bare = body
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let hit = firstKeyword(body, rules.keywords.autoodpowiedz);
  if (hit) return result("autoodpowiedz", hit.keyword);
  if (rules.exact.odmowa.includes(bare)) return result("odmowa", bare);
  hit =
    firstKeyword(body, rules.keywords.odmowa) ?? firstPattern(body, "odmowa");
  if (hit) return result("odmowa", hit.keyword);
  hit =
    firstKeyword(body, rules.keywords.nieufnosc) ??
    firstPattern(body, "nieufnosc");
  if (hit) return result("nieufnosc", hit.keyword);
  hit =
    firstKeyword(body, rules.keywords.nie_teraz) ??
    firstPattern(body, "nie_teraz");
  if (hit) return result("nie_teraz", hit.keyword);
  hit = firstKeyword(body, rules.keywords.cena) ?? firstPattern(body, "cena");
  if (hit) return result("cena", hit.keyword);
  if (rules.exactPositive.includes(bare)) return result("zainteresowany", bare);
  for (const keyword of rules.keywords.zainteresowany) {
    const at = hasKeyword(body, keyword);
    if (at < 0) continue;
    // „not sure”, „nie chętnie” — przeczenie tuż przed słowem unieważnia dopasowanie.
    if (/(?:\bnot|\bnie|n't|\bno)\s$/.test(body.slice(Math.max(0, at - 6), at)))
      continue;
    return result("zainteresowany", keyword);
  }
  hit = firstPattern(body, "zainteresowany");
  if (
    hit &&
    !/(?:\bnot|\bnie|n't|\bno)\s$/.test(
      body.slice(Math.max(0, hit.at - 6), hit.at),
    )
  )
    return result("zainteresowany", hit.keyword);
  if (
    body.includes("?") ||
    rules.questionStarts.some((q) => bare.startsWith(q))
  )
    return result("pytanie", "?");
  return result("inne");
}

function marketOf(lead) {
  return lead?.market === "US" ? "US" : "PL";
}

/** Szkic odpowiedzi z szablonu i danych właściciela. Pusty szablon = właściciel pisze sam. */
function buildDraft(category, market, data, lead) {
  const template = rules.templates[market]?.[category] ?? "";
  if (!template) return { text: "", needsEdit: true };
  const merged = {
    ...rules.defaults[market],
    ...Object.fromEntries(
      Object.entries(data ?? {}).filter(
        ([, v]) => String(v ?? "").trim() !== "",
      ),
    ),
  };
  const calendarLine = String(merged.calendarUrl ?? "").trim()
    ? rules.calendarLine[market].replace(
        "{calendarUrl}",
        String(merged.calendarUrl).trim(),
      )
    : "";
  const vars = { ...merged, name: lead?.nazwa ?? "", calendarLine };
  let text = template.replace(/\{(\w+)\}/g, (_, key) =>
    String(vars[key] ?? ""),
  );
  text = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
  const signature = String(merged.signature ?? "").trim();
  if (signature)
    text += market === "US" ? `\n\nBest,\n${signature}` : `\n\n${signature}`;
  return { text, needsEdit: false };
}

/** Wyciąga pierwszy obiekt JSON z odpowiedzi modelu (modele lubią dopisać tekst dookoła). */
function parseAiJson(output) {
  const text = String(output ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!CATEGORY_IDS.includes(parsed.category)) return null;
    const confidence = Number(parsed.confidence);
    return {
      category: parsed.category,
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.5,
      reply: typeof parsed.reply === "string" ? parsed.reply.trim() : "",
    };
  } catch {
    return null;
  }
}

function aiPrompt({ market, data, lead, outbound, inbound }) {
  const lang = market === "US" ? "English" : "Polish";
  const facts = { ...rules.defaults[market], ...data };
  const system = [
    "You triage replies to a cold outreach message sent by a freelance web designer to a small local business.",
    `Return ONLY a JSON object: {"category": one of ${JSON.stringify(CATEGORY_IDS)}, "confidence": number 0-1, "reply": string}.`,
    "Categories: odmowa = any refusal or request to stop; nieufnosc = distrust, hostility, questions about where the contact data came from, accusations of spam or scam;",
    "autoodpowiedz = automatic reply or bounce; nie_teraz = not now, maybe later; cena = asks about price, payment or what is included;",
    "zainteresowany = wants the mockup, a call or more details; pytanie = any other concrete question; inne = anything else.",
    "If in doubt between a refusal and anything else, choose odmowa.",
    `"reply" is a short, friendly draft answer in ${lang} (max 90 words) written in first person as the designer. Leave it empty for odmowa, nieufnosc and autoodpowiedz.`,
    "Use ONLY these facts and never invent prices, deadlines, guarantees, clients or results. If the facts do not answer the question, say you will check and get back.",
    "No pressure, no urgency, no flattery. Do not add a signature.",
    `Facts: price: ${facts.price}; included: ${facts.includes}; timeline: ${facts.timeline}; free mockup ready in: ${facts.mockupTime}; payment: ${facts.paymentNote}${facts.calendarUrl ? `; booking link: ${facts.calendarUrl}` : ""}.`,
  ].join("\n");
  const prompt = [
    `Business: ${lead?.nazwa ?? "unknown"}${lead?.miasto ? `, ${lead.miasto}` : ""}.`,
    outbound ? `Our message:\n"""${String(outbound).slice(0, 1200)}"""` : "",
    `Their reply:\n"""${String(inbound).slice(0, 2000)}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, prompt };
}

/**
 * deps:
 *  db() → połączenie SQLite z tabelami messages i costs albo null
 *  read(name, fallback) / write(name, value) → plik ustawień
 *  encrypt(text) / decrypt(text) → szyfrowanie klucza API
 *  fetchImpl(url, init), now()
 *  block({ channel, address, lead, reason }) → dopisuje do listy blokad
 *  isBlocked({ channel, address }) → boolean
 *  send({ channel, lead, address, body }) → Promise (rzuca błąd przy niepowodzeniu)
 *  notify(message, event) → powiadomienie właściciela (Telegram, okno aplikacji)
 */
function createInbox(d) {
  const now = d.now ?? (() => Date.now());
  const conn = () => {
    const db = d.db();
    if (!db)
      throw new Error("Skrzynka odpowiedzi wymaga działającej bazy danych.");
    return db;
  };

  /* ----------------------------- ustawienia ----------------------------- */

  const rawSettings = () => d.read(SETTINGS_FILE, {});
  function settings() {
    const s = rawSettings();
    return {
      ai: {
        enabled: s.ai?.enabled === true,
        model: s.ai?.model || rules.ai.defaultModel,
        dailyLimit:
          Number(s.ai?.dailyLimit) > 0
            ? Number(s.ai.dailyLimit)
            : rules.ai.dailyLimit,
        keyConfigured: Boolean(s.ai?.encryptedKey),
        usedToday: aiCallsToday(),
      },
      data: {
        US: { ...rules.defaults.US, ...s.data?.US },
        PL: { ...rules.defaults.PL, ...s.data?.PL },
      },
    };
  }
  function configure(value) {
    const s = rawSettings();
    const next = {
      ai: { ...s.ai },
      data: { US: { ...s.data?.US }, PL: { ...s.data?.PL } },
    };
    if (value?.ai) {
      if (value.ai.enabled !== undefined)
        next.ai.enabled = value.ai.enabled === true;
      if (value.ai.model !== undefined)
        next.ai.model = String(value.ai.model).trim();
      if (value.ai.dailyLimit !== undefined)
        next.ai.dailyLimit = Math.max(
          0,
          Math.floor(Number(value.ai.dailyLimit) || 0),
        );
      if (value.ai.key)
        next.ai.encryptedKey = d.encrypt(String(value.ai.key).trim());
      if (value.ai.clearKey === true) delete next.ai.encryptedKey;
    }
    for (const market of ["US", "PL"]) {
      for (const [key, val] of Object.entries(value?.data?.[market] ?? {})) {
        if (key in rules.defaults[market])
          next.data[market][key] = String(val ?? "").trim();
      }
    }
    d.write(SETTINGS_FILE, next);
    return settings();
  }

  /* --------------------------------- AI --------------------------------- */

  function startOfDay() {
    const date = new Date(now());
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  function aiCallsToday() {
    try {
      const db = d.db();
      if (!db) return 0;
      return Number(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM costs WHERE category = 'ai_call' AND at >= ?",
          )
          .get(startOfDay())?.n ?? 0,
      );
    } catch {
      return 0;
    }
  }

  async function callAi(system, prompt) {
    const s = rawSettings();
    if (!s.ai?.encryptedKey)
      throw new Error("Brak klucza fal.ai w ustawieniach skrzynki.");
    const limit =
      Number(s.ai?.dailyLimit) > 0
        ? Number(s.ai.dailyLimit)
        : rules.ai.dailyLimit;
    if (aiCallsToday() >= limit)
      throw new Error(`Dzienny limit zapytań AI (${limit}) jest wykorzystany.`);
    conn()
      .prepare(
        "INSERT INTO costs (at, category, amount_minor, currency, note) VALUES (?, 'ai_call', 0, 'USD', ?)",
      )
      .run(now(), s.ai?.model || rules.ai.defaultModel);
    const res = await d.fetchImpl(rules.ai.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Key ${d.decrypt(s.ai.encryptedKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: s.ai?.model || rules.ai.defaultModel,
        system_prompt: system,
        prompt,
      }),
      signal: AbortSignal.timeout(rules.ai.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(
        `fal.ai odpowiedział błędem ${res.status}: ${text.slice(0, 200)}`,
      );
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("fal.ai zwrócił nieczytelną odpowiedź.");
    }
    if (json.error)
      throw new Error(`fal.ai: ${String(json.error).slice(0, 200)}`);
    return String(json.output ?? "");
  }

  async function testAi() {
    const output = await callAi(
      "Answer with one word.",
      "Reply with the single word: OK",
    );
    return { ok: true, output: output.slice(0, 80) };
  }

  /* ------------------------------ wiadomości ------------------------------ */

  const parse = (row) => {
    let meta = {};
    try {
      meta = JSON.parse(row.meta || "{}");
    } catch {
      meta = {};
    }
    return {
      id: row.id,
      leadKind: row.lead_kind,
      leadId: row.lead_id,
      channel: row.channel,
      direction: row.direction,
      address: row.address,
      body: row.body,
      status: row.status,
      category: row.classification,
      at: row.at,
      ...meta,
    };
  };

  function get(id) {
    const row = conn()
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(String(id));
    return row ? parse(row) : null;
  }

  function list({ status, limit = 200 } = {}) {
    const max = Math.min(500, Math.max(1, Number(limit) || 200));
    const rows = status
      ? conn()
          .prepare(
            "SELECT * FROM messages WHERE direction = 'in' AND status = ? ORDER BY at DESC LIMIT ?",
          )
          .all(String(status), max)
      : conn()
          .prepare(
            "SELECT * FROM messages WHERE direction = 'in' ORDER BY at DESC LIMIT ?",
          )
          .all(max);
    return rows.map(parse);
  }

  function counts() {
    const out = { pending: 0, blocked: 0, sent: 0, ignored: 0, dismissed: 0 };
    try {
      for (const r of conn()
        .prepare(
          "SELECT status, COUNT(*) AS n FROM messages WHERE direction = 'in' GROUP BY status",
        )
        .all())
        out[r.status] = Number(r.n);
    } catch {
      /* baza niedostępna — licznik zostaje pusty */
    }
    return out;
  }

  function setStatus(id, status, metaPatch = {}) {
    const current = get(id);
    if (!current) throw new Error("Nie ma takiej wiadomości.");
    const row = conn()
      .prepare("SELECT meta FROM messages WHERE id = ?")
      .get(String(id));
    const meta = { ...JSON.parse(row.meta || "{}"), ...metaPatch };
    conn()
      .prepare("UPDATE messages SET status = ?, meta = ? WHERE id = ?")
      .run(status, JSON.stringify(meta), String(id));
    return get(id);
  }

  /**
   * Przyjmuje odpowiedź klienta. Idempotentne: ta sama wiadomość drugi raz nic nie robi.
   * reply: { channel: "sms"|"email", lead, address, text, at, externalId, outbound }
   */
  async function ingest(reply) {
    const lead = reply.lead ?? {};
    const channel = reply.channel === "email" ? "email" : "sms";
    const text = String(reply.text ?? "");
    const id = createHash("sha1")
      .update(
        [channel, lead.id ?? "", reply.externalId ?? reply.at ?? "", text].join(
          "|",
        ),
      )
      .digest("hex")
      .slice(0, 12);
    const db = conn();
    if (db.prepare("SELECT 1 AS hit FROM messages WHERE id = ?").get(id))
      return null;

    const market = marketOf(lead);
    const data = settings().data[market];
    let verdict = classifyRules(text);
    let draft = { text: "", needsEdit: true };
    let aiError = null;

    const wantsAi =
      !BLOCKING.has(verdict.category) &&
      verdict.category !== "autoodpowiedz" &&
      rawSettings().ai?.enabled === true &&
      text.trim() !== "" &&
      (verdict.confidence < rules.confidence.askAiBelow ||
        !rules.templates[market]?.[verdict.category]);
    let ai = null;
    if (wantsAi) {
      try {
        const { system, prompt } = aiPrompt({
          market,
          data,
          lead,
          outbound: reply.outbound,
          inbound: stripQuoted(text),
        });
        ai = parseAiJson(await callAi(system, prompt));
        if (!ai) aiError = "Model zwrócił odpowiedź w nieoczekiwanym formacie.";
      } catch (err) {
        aiError = String(err?.message || err);
      }
    }
    if (ai) {
      if (
        BLOCKING.has(ai.category) &&
        ai.confidence >= rules.confidence.aiBlockAtOrAbove
      ) {
        verdict = {
          category: ai.category,
          confidence: ai.confidence,
          source: "ai",
          matched: null,
        };
      } else if (
        !BLOCKING.has(ai.category) &&
        verdict.confidence < rules.confidence.askAiBelow
      ) {
        verdict = {
          category: ai.category,
          confidence: ai.confidence,
          source: "ai",
          matched: null,
        };
      }
    }

    const action = rules.categories[verdict.category].action;
    let status = "pending";
    if (action === "block") {
      status = "blocked";
      d.block({
        channel,
        address: reply.address,
        lead,
        reason: verdict.category,
      });
    } else if (action === "ignore") {
      status = "ignored";
    } else {
      draft = buildDraft(verdict.category, market, data, lead);
      if (draft.needsEdit && ai?.reply)
        draft = { text: ai.reply, needsEdit: false, fromAi: true };
    }

    const meta = {
      leadName: lead.nazwa ?? null,
      market,
      confidence: verdict.confidence,
      source: verdict.source,
      matched: verdict.matched,
      draft: status === "pending" ? draft.text : "",
      needsEdit: status === "pending" ? draft.needsEdit : false,
      draftFromAi: draft.fromAi === true,
      aiError,
      outbound: reply.outbound ? String(reply.outbound).slice(0, 2000) : null,
    };
    db.prepare(
      "INSERT INTO messages (id, lead_kind, lead_id, channel, direction, address, subject, body, template_id, status, classification, at, meta) VALUES (?, ?, ?, ?, 'in', ?, NULL, ?, NULL, ?, ?, ?, ?)",
    ).run(
      id,
      channel,
      String(lead.id ?? ""),
      channel,
      reply.address ?? null,
      stripQuoted(text).slice(0, 4000),
      status,
      verdict.category,
      Number(reply.at) || now(),
      JSON.stringify(meta),
    );
    const message = get(id);
    try {
      d.notify?.(message);
    } catch {
      /* powiadomienie nie może zatrzymać przyjmowania odpowiedzi */
    }
    return message;
  }

  /** Wysyła zatwierdzoną odpowiedź. Blokada jest sprawdzana jeszcze raz tuż przed wysyłką. */
  async function approve(id, body) {
    const message = get(id);
    if (!message) throw new Error("Nie ma takiej wiadomości.");
    if (message.status !== "pending")
      throw new Error("Ta odpowiedź została już obsłużona.");
    const text = String(body ?? message.draft ?? "").trim();
    if (!text) throw new Error("Wpisz treść odpowiedzi.");
    if (/\{\w+\}|\[[^\]]{3,}\]/.test(text))
      throw new Error("W odpowiedzi zostały nieuzupełnione pola.");
    if (d.isBlocked({ channel: message.channel, address: message.address })) {
      setStatus(id, "blocked");
      throw new Error(
        "Ten kontakt jest na liście blokad — odpowiedź nie została wysłana.",
      );
    }
    // Rezerwacja przed wysyłką: awaria w trakcie nie może skończyć się drugą wiadomością.
    setStatus(id, "sending");
    try {
      await d.send({
        channel: message.channel,
        leadId: message.leadId,
        address: message.address,
        body: text,
      });
    } catch (err) {
      setStatus(id, "pending", { sendError: String(err?.message || err) });
      throw err;
    }
    const outId = `${id}-o`;
    conn()
      .prepare(
        "INSERT OR IGNORE INTO messages (id, lead_kind, lead_id, channel, direction, address, subject, body, template_id, status, classification, at, meta) VALUES (?, ?, ?, ?, 'out', ?, NULL, ?, NULL, 'sent', ?, ?, ?)",
      )
      .run(
        outId,
        message.leadKind,
        message.leadId,
        message.channel,
        message.address,
        text,
        message.category,
        now(),
        JSON.stringify({ replyTo: id, edited: text !== message.draft }),
      );
    return setStatus(id, "sent", { sentText: text, sendError: null });
  }

  function dismiss(id) {
    const message = get(id);
    if (!message) throw new Error("Nie ma takiej wiadomości.");
    // „sending” = wysyłka przerwana w połowie (np. zamknięcie aplikacji); właściciel zamyka ją ręcznie.
    if (message.status !== "pending" && message.status !== "sending")
      throw new Error("Ta odpowiedź została już obsłużona.");
    return setStatus(id, "dismissed");
  }

  function block(id) {
    const message = get(id);
    if (!message) throw new Error("Nie ma takiej wiadomości.");
    d.block({
      channel: message.channel,
      address: message.address,
      lead: { id: message.leadId },
      reason: "manual",
    });
    return setStatus(id, "blocked");
  }

  /** Decyzja z Telegrama: "INBOX:ok:<id>", "INBOX:no:<id>", "INBOX:bl:<id>". Zwraca tekst potwierdzenia. */
  async function handleCallback(data) {
    const [, verb, id] = String(data).split(":");
    const message = id ? get(id) : null;
    if (!message) return "Nie znaleziono tej odpowiedzi.";
    if (message.status !== "pending")
      return "Ta odpowiedź została już obsłużona.";
    if (verb === "ok") {
      if (message.needsEdit)
        return "Ta odpowiedź wymaga uzupełnienia w aplikacji.";
      await approve(id);
      return `✅ Wysłano odpowiedź do ${message.leadName ?? message.address}.`;
    }
    if (verb === "no") {
      dismiss(id);
      return "Pominięto. Wiadomość zostaje w historii.";
    }
    if (verb === "bl") {
      block(id);
      return `🚫 Zablokowano ${message.leadName ?? message.address}.`;
    }
    return "Nieznane polecenie.";
  }

  return {
    ingest,
    list,
    get,
    counts,
    approve,
    dismiss,
    block,
    settings,
    configure,
    testAi,
    handleCallback,
  };
}

module.exports = {
  createInbox,
  classifyRules,
  buildDraft,
  parseAiJson,
  BLOCKING,
};
