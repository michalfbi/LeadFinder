/**
 * Wirtualny świat: sprawdzian całego obiegu „wysyłka → odpowiedź → skrzynka →
 * decyzja właściciela” bez jednego prawdziwego e-maila, SMS-a ani zapytania do sieci.
 *
 * Prawdziwe są: silnik e-mail, skrzynka odpowiedzi, baza SQLite, listy blokad
 * i ich połączenie (outreach.cjs). Udawane są: firmy, serwer pocztowy (SMTP/IMAP),
 * fal.ai, zegar i właściciel klikający w skrzynce. Świat prowadzi własny, niezależny
 * dziennik tego, co do niego dotarło, i na nim sprawdza zasady — nie na tym,
 * co program sam o sobie zapisał.
 *
 * Moduł nie zależy od Electrona: działa w testach, w CI i w aplikacji.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodemailer = require("nodemailer");
const { createStore } = require("./store.cjs");
const { createOutreach } = require("./outreach.cjs");
const { classifyRules, BLOCKING } = require("./inbox.cjs");
const { stripQuoted } = require("./reply-text.cjs");
const world = require("./sim-world.json");
const countryRules = require("../country-rules.json");
const replyRules = require("../reply-rules.json");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Poniedziałek. Wirtualny kalendarz zawsze zaczyna się w tym samym miejscu. */
const WORLD_START = Date.UTC(2026, 0, 5);
/** Godziny (UTC), o których wirtualny właściciel siada do programu. */
const SESSIONS = [14, 16.5, 19, 22.5];
const SMTP_SECRET = "wirtualne-haslo-smtp-7f3a91";
const AI_SECRET = "wirtualny-klucz-fal-c42e08";
const SENDER = {
  host: "smtp.sender.example",
  port: 465,
  user: "owner@sender.example",
  from: "owner@sender.example",
  senderName: "Virtual Owner",
  company: "Virtual Web Studio",
  address: "1 Simulation Street, 00-001 Testowo, Poland",
  imapHost: "imap.sender.example",
  imapUser: "owner@sender.example",
};
const SABOTAGES = [
  "bez-stopki",
  "nocna-zmiana",
  "dziurawa-blokada",
  "jawny-sekret",
  "prawdziwa-siec",
];

/* ------------------------------ narzędzia ------------------------------ */

function rng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quotedPrintable(text) {
  let out = "";
  let line = 0;
  for (const byte of Buffer.from(text, "utf8")) {
    let piece;
    if (byte === 10) {
      out += "\r\n";
      line = 0;
      continue;
    }
    if (byte === 61 || byte > 126 || byte < 32)
      piece = `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    else piece = String.fromCharCode(byte);
    if (line + piece.length > 73) {
      out += "=\r\n";
      line = 0;
    }
    out += piece;
    line += piece.length;
  }
  return out;
}

function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(ms));
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value),
    weekday: parts.find((p) => p.type === "weekday")?.value,
  };
}

/** Blokuje wyjście do sieci na czas symulacji i liczy próby. */
function guardNetwork() {
  const net = require("node:net");
  const dns = require("node:dns");
  const attempts = [];
  const original = {
    connect: net.Socket.prototype.connect,
    lookup: dns.lookup,
    fetch: globalThis.fetch,
  };
  const refuse = (what) => {
    attempts.push(what);
    const err = new Error(`Symulacja: zablokowano wyjście do sieci (${what}).`);
    err.code = "ESIMULATION";
    return err;
  };
  net.Socket.prototype.connect = function connect(...args) {
    const target =
      typeof args[0] === "object"
        ? `${args[0]?.host ?? args[0]?.path}:${args[0]?.port ?? ""}`
        : String(args[0]);
    const err = refuse(`połączenie ${target}`);
    process.nextTick(() => this.destroy(err));
    return this;
  };
  dns.lookup = (host, ...rest) => {
    const cb = rest[rest.length - 1];
    const err = refuse(`DNS ${host}`);
    if (typeof cb === "function") process.nextTick(() => cb(err));
  };
  globalThis.fetch = async (url) => {
    throw refuse(`fetch ${String(url?.url ?? url)}`);
  };
  return {
    attempts,
    release() {
      net.Socket.prototype.connect = original.connect;
      dns.lookup = original.lookup;
      globalThis.fetch = original.fetch;
    },
  };
}

/* --------------------------- budowa świata --------------------------- */

function buildWorld({ seed, companies, smsLeads }) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const personaPool = Object.entries(world.personas).flatMap(([name, weight]) =>
    Array(weight).fill(name),
  );
  const firms = [];
  const used = new Set();
  while (firms.length < companies) {
    const name = `${pick(world.surnames)} ${pick(world.trades)}`;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    if (used.has(slug)) {
      if (used.size >= world.surnames.length * world.trades.length)
        used.clear();
      else continue;
    }
    used.add(slug);
    const [city, timeZone] = pick(world.cities);
    const persona = pick(personaPool);
    const n = firms.length + 1;
    const firm = {
      id: `sim-us-${n}`,
      name,
      email: `info@${slug}${n}.example`,
      city,
      timeZone,
      persona,
      reply: null,
      encoding: "plain",
      delayMs: 0,
      followUp: null,
    };
    if (persona !== "cisza" && persona !== "odbicie") {
      firm.reply = pick(world.replies.US[persona]);
      firm.delayMs =
        persona === "autoodpowiedz"
          ? 60_000
          : Math.round((0.5 + rand() * 40) * HOUR);
      const roll = rand();
      firm.encoding =
        roll < 0.3
          ? "quoted"
          : roll < 0.45
            ? "qp"
            : roll < 0.55
              ? "multipart"
              : "plain";
    }
    if (persona === "zainteresowany" || persona === "cena") {
      const roll = rand();
      // Część klientów po naszej odpowiedzi pisze jeszcze raz, a część się rozmyśla.
      if (roll < 0.2)
        firm.followUp = {
          category: "odmowa",
          text: pick(world.replies.US.odmowa),
        };
      else if (roll < 0.55)
        firm.followUp = {
          category: "zainteresowany",
          text: pick(world.replies.US.zainteresowany),
        };
    }
    firms.push(firm);
  }
  const smsCategories = [
    "odmowa",
    "nieufnosc",
    "zainteresowany",
    "cena",
    "nie_teraz",
    "pytanie",
    "odmowa",
    "zainteresowany",
  ];
  const sms = [];
  for (let i = 0; i < smsLeads; i++) {
    const category = smsCategories[i % smsCategories.length];
    sms.push({
      id: `sim-pl-${i + 1}`,
      name: `${world.plNames[i % world.plNames.length]} ${i + 1}`,
      phone: `6${String(10_000_000 + Math.floor(rand() * 89_999_999)).padStart(8, "0")}`,
      email: i % 2 === 0 ? `biuro@firma-pl-${i + 1}.example` : null,
      category,
      reply: pick(world.replies.PL[category]),
      dueMs: WORLD_START + Math.round((1 + rand() * 6) * DAY),
      delivered: false,
    });
  }
  return { rand, pick, firms, sms };
}

/* ------------------------- wirtualna poczta ------------------------- */

function createMailServer({ clock, firms, rand, sabotage }) {
  const byEmail = new Map(firms.map((f) => [f.email, f]));
  const json = nodemailer.createTransport({ jsonTransport: true });
  const delivered = []; // wszystko, co „wyszło” do świata
  const mailbox = []; // odpowiedzi czekające w skrzynce właściciela
  const state = {
    smtpOutage: 0,
    imapDownUntil: 0,
    replyFailures: 0,
    passwordsSeen: new Set(),
    uid: 0,
  };

  const wrap = (firm, text, original) => {
    let body = text;
    if (firm.encoding === "quoted") {
      const stamp = new Date(clock.now()).toUTCString();
      body += `\n\nOn ${stamp} Virtual Owner <${SENDER.from}> wrote:\n${String(
        original,
      )
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n")}`;
    }
    if (firm.encoding === "qp")
      return quotedPrintable(`${body} — sent with café mail`);
    if (firm.encoding === "multipart")
      return [
        "--sim-boundary-1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
        "--sim-boundary-1",
        "Content-Type: text/html; charset=utf-8",
        "",
        `<div>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`,
        "--sim-boundary-1--",
      ].join("\r\n");
    return body;
  };
  const schedule = (firm, text, truth, at, original) => {
    mailbox.push({
      uid: ++state.uid,
      from: firm.email,
      at,
      raw: wrap(firm, text, original),
      text,
      truth,
      firm,
    });
  };

  function createTransport(options) {
    state.passwordsSeen.add(options?.auth?.pass);
    return {
      async verify() {
        return true;
      },
      close() {},
      async sendMail(message) {
        const info = await json.sendMail(message);
        const built = JSON.parse(info.message);
        const to = String(info.envelope.to[0]).toLowerCase();
        const isReply = /^re:/i.test(built.subject || "");
        if (!isReply && state.smtpOutage > 0) {
          state.smtpOutage--;
          throw new Error("ECONNRESET (wirtualna awaria serwera SMTP)");
        }
        if (isReply && state.replyFailures > 0) {
          state.replyFailures--;
          throw new Error("ETIMEDOUT (wirtualna awaria przy odpowiedzi)");
        }
        const firm = byEmail.get(to);
        if (!firm || firm.persona === "odbicie")
          return { accepted: [], rejected: [to], messageId: info.messageId };
        let text = String(built.text || "");
        if (sabotage === "bez-stopki") text = text.split("\n\n--\n")[0];
        const record = {
          at: clock.now(),
          to,
          kind: isReply ? "reply" : "cold",
          subject: built.subject,
          text,
          unsubscribe:
            Object.entries(built.headers || {}).find(
              ([k]) => k.toLowerCase() === "list-unsubscribe",
            )?.[1] ?? null,
          inReplyTo: built.inReplyTo ?? null,
        };
        delivered.push(record);
        if (!isReply && firm.reply)
          schedule(
            firm,
            firm.reply,
            firm.persona,
            clock.now() + firm.delayMs,
            text,
          );
        if (isReply && firm.followUp && !firm.followUpSent) {
          firm.followUpSent = true;
          schedule(
            firm,
            firm.followUp.text,
            firm.followUp.category,
            clock.now() + Math.round((1 + rand() * 20) * HOUR),
            text,
          );
        }
        return { accepted: [to], rejected: [], messageId: info.messageId };
      },
    };
  }

  function createImap() {
    return {
      async connect() {
        if (clock.now() < state.imapDownUntil)
          throw new Error("ECONNREFUSED (wirtualna awaria IMAP)");
      },
      async getMailboxLock() {
        return { release() {} };
      },
      async search({ since }) {
        const from = since instanceof Date ? since.getTime() : 0;
        return mailbox
          .filter((m) => m.at <= clock.now() && m.at >= from - DAY)
          .map((m) => m.uid);
      },
      async *fetch(uids) {
        for (const uid of uids) {
          const m = mailbox.find((x) => x.uid === uid);
          if (!m) continue;
          m.fetched = true;
          yield {
            uid,
            envelope: { from: [{ address: m.from }], date: new Date(m.at) },
            bodyParts: new Map([["TEXT", Buffer.from(m.raw, "utf8")]]),
          };
        }
      },
      async logout() {},
    };
  }

  return { createTransport, createImap, delivered, mailbox, state };
}

/* --------------------------- wirtualne AI --------------------------- */

function createVirtualAi({ rand, clock, accuracy }) {
  const truthByText = new Map();
  for (const market of ["US", "PL"])
    for (const [category, texts] of Object.entries(world.replies[market]))
      for (const t of texts) truthByText.set(stripQuoted(t).trim(), category);
  const categories = Object.keys(replyRules.categories);
  const calls = [];
  async function fetchImpl(url, init) {
    const call = {
      at: clock.now(),
      url: String(url),
      authorized: init?.headers?.Authorization === `Key ${AI_SECRET}`,
      outcome: "ok",
    };
    calls.push(call);
    const respond = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    });
    if (!call.authorized) {
      call.outcome = "401";
      return respond(401, '{"detail":"Invalid key"}');
    }
    const roll = rand();
    if (roll < 0.04) {
      call.outcome = "500";
      return respond(500, "upstream error");
    }
    if (roll < 0.07) {
      call.outcome = "nieczytelna";
      return respond(
        200,
        JSON.stringify({
          output: "Sure! I think this customer is interested.",
        }),
      );
    }
    const prompt = String(JSON.parse(init.body).prompt || "");
    const inbound =
      prompt.match(/Their reply:\n"""([\s\S]*)"""\s*$/)?.[1]?.trim() ?? "";
    let truth = truthByText.get(inbound);
    if (!truth)
      for (const [text, category] of truthByText)
        if (inbound.includes(text)) truth = category;
    let category = truth ?? "inne";
    if (rand() > accuracy)
      category = categories[Math.floor(rand() * categories.length)];
    call.truth = truth ?? null;
    call.answered = category;
    const silent = BLOCKING.has(category) || category === "autoodpowiedz";
    return respond(
      200,
      JSON.stringify({
        output: `Here is the result:\n${JSON.stringify({
          category,
          confidence: 0.86,
          reply: silent
            ? ""
            : "Thanks for the note. I will check that and get back to you shortly.",
        })}`,
      }),
    );
  }
  return { fetchImpl, calls };
}

/* ------------------------------ symulacja ------------------------------ */

async function runSimulation(options = {}) {
  const seed = Number(options.seed) || 1;
  const days = Math.min(60, Math.max(3, Number(options.days) || 14));
  const companies = Math.min(
    400,
    Math.max(10, Number(options.companies) || 150),
  );
  const smsLeads = Math.min(100, Math.max(0, Number(options.smsLeads ?? 24)));
  const useAi = options.ai !== false;
  const sabotage = SABOTAGES.includes(options.sabotage)
    ? options.sabotage
    : null;
  const started = Date.now();
  const dir = fs.mkdtempSync(
    path.join(options.tmpDir || os.tmpdir(), "leadfinder-symulacja-"),
  );
  const guard = options.guardNetwork === false ? null : guardNetwork();

  const clock = {
    t: WORLD_START,
    now: () => clock.t,
    set: (ms) => {
      clock.t = Math.max(clock.t, ms);
    },
  };
  const { rand, firms, sms } = buildWorld({ seed, companies, smsLeads });
  const server = createMailServer({ clock, firms, rand, sabotage });
  const ai = createVirtualAi({ rand, clock, accuracy: 0.9 });
  const firmByLead = new Map();
  const smsByLead = new Map(sms.map((s) => [s.id, s]));
  const smsOut = [];
  const owner = {
    approvals: [],
    blocks: [],
    dismissals: 0,
    placeholderGuards: 0,
    blockedApproveGuards: 0,
    failures: [],
  };
  const incidents = [];
  const daily = [];
  const restarts = [];
  let store = null;
  let outreach = null;

  const encrypt =
    sabotage === "jawny-sekret"
      ? (t) => String(t)
      : (t) => `sim:${Buffer.from(String(t), "utf8").toString("hex")}`;
  const decrypt =
    sabotage === "jawny-sekret"
      ? (t) => String(t)
      : (t) =>
          Buffer.from(String(t).replace(/^sim:/, ""), "hex").toString("utf8");
  const file = (name) => path.join(dir, name);
  const read = (f, fallback) => {
    if (store.handles(f)) return store.readFile(f);
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      return fallback;
    }
  };
  const write = (f, value) => {
    if (store.handles(f)) store.writeFile(f, value);
    else fs.writeFileSync(f, JSON.stringify(value));
  };

  function boot() {
    store = createStore({ dir, now: clock.now });
    outreach = createOutreach({
      email: {
        file,
        read,
        write,
        db: () => store.db,
        sleep: async (ms) => {
          clock.t += ms;
        },
        // „Nocna zmiana”: program dostaje zegar przesunięty o 6 godzin, świat liczy czas prawdziwie.
        now: sabotage === "nocna-zmiana" ? () => clock.t + 6 * HOUR : clock.now,
        random: rand,
        changed: () => {},
        templates: () => ({}),
        encrypt,
        decrypt,
        createTransport: server.createTransport,
        createImap: server.createImap,
      },
      inboxDb: () => store.db,
      read: (name, fallback) => read(file(name), fallback),
      write: (name, value) => write(file(name), value),
      encrypt,
      decrypt,
      fetchImpl: ai.fetchImpl,
      now: clock.now,
      blockPhone: (address) => {
        if (sabotage === "dziurawa-blokada") return;
        const key = String(address).replace(/\D/g, "").slice(-9);
        store.db
          .prepare(
            "INSERT OR IGNORE INTO blacklist (phone, added_at) VALUES (?, ?)",
          )
          .run(key, clock.now());
      },
      isBlocked: ({ channel, address }) =>
        store.suppression.isBlocked(
          channel === "email" ? { email: address } : { phone: address },
        ),
      sendSms: async (address, body) => {
        smsOut.push({ at: clock.now(), to: String(address), text: body });
      },
      notify: () => {},
    });
  }

  const truthOf = (message) => {
    if (message.channel === "sms")
      return smsByLead.get(message.leadId)?.category ?? null;
    const firm = firmByLead.get(message.leadId);
    if (!firm) return null;
    const entry = server.mailbox.find(
      (m) =>
        m.firm === firm &&
        stripQuoted(m.text).trim().slice(0, 4000) === message.body,
    );
    return entry?.truth ?? null;
  };

  async function ownerSession() {
    const { inbox } = outreach;
    // Właściciel raz dziennie próbuje (błędnie) wysłać coś do zablokowanego kontaktu.
    const blocked = inbox.list({ status: "blocked" })[0];
    if (blocked) {
      try {
        await inbox.approve(blocked.id, "Just checking in once more.");
        owner.failures.push(
          `Zatwierdzono odpowiedź do zablokowanego kontaktu ${blocked.address}.`,
        );
      } catch {
        owner.blockedApproveGuards++;
      }
    }
    for (const message of inbox.list({ status: "pending" })) {
      const truth = truthOf(message);
      const hasDraft = String(message.draft || "").trim() !== "";
      if (BLOCKING.has(truth)) {
        // Odmowa, której program nie rozpoznał. Uważny właściciel blokuje ją ręcznie.
        owner.blocks.push({
          id: message.id,
          address: message.address,
          hadDraft: hasDraft,
          at: clock.now(),
        });
        if (rand() < 0.5) await inbox.handleCallback(`INBOX:bl:${message.id}`);
        else inbox.block(message.id);
        continue;
      }
      if (truth === "autoodpowiedz") {
        inbox.dismiss(message.id);
        owner.dismissals++;
        continue;
      }
      if (rand() < 0.05) {
        try {
          await inbox.approve(message.id, "Sure, the price is {price}.");
          owner.failures.push(
            "Wysłano odpowiedź z nieuzupełnionym polem {price}.",
          );
          continue;
        } catch {
          owner.placeholderGuards++;
        }
      }
      const roll = rand();
      try {
        if (hasDraft) {
          if (roll < 0.2) {
            const before = server.delivered.length + smsOut.length;
            await inbox.handleCallback(`INBOX:ok:${message.id}`);
            if (server.delivered.length + smsOut.length > before)
              owner.approvals.push({
                id: message.id,
                address: message.address,
                text: message.draft.trim(),
                at: clock.now(),
              });
          } else {
            const text =
              roll < 0.4
                ? `${message.draft.trim()}\n\nP.S. Happy to answer anything else.`
                : message.draft.trim();
            owner.approvals.push({
              id: message.id,
              address: message.address,
              text,
              at: clock.now(),
            });
            await inbox.approve(message.id, text);
          }
        } else if (roll < 0.6) {
          const text =
            "Thanks for writing back. Yes, that is no problem at all.";
          owner.approvals.push({
            id: message.id,
            address: message.address,
            text,
            at: clock.now(),
          });
          await inbox.approve(message.id, text);
        } else {
          if (roll < 0.8) await inbox.handleCallback(`INBOX:no:${message.id}`);
          else inbox.dismiss(message.id);
          owner.dismissals++;
        }
      } catch (err) {
        incidents.push(
          `Odpowiedź do ${message.address} nie wyszła (${String(err.message).slice(0, 80)}). Wróciła do „Do decyzji”.`,
        );
      }
    }
  }

  let report;
  try {
    boot();
    outreach.emailEngine.configure({ ...SENDER, password: SMTP_SECRET });
    outreach.inbox.configure({
      ai: { enabled: useAi, key: AI_SECRET, dailyLimit: 40 },
      data: { US: { signature: "Virtual Owner" } },
    });
    const inserted = outreach.emailEngine.insert(
      firms.map((f) => ({
        id: f.id,
        nazwa: f.name,
        email: f.email,
        miasto: f.city,
        market: "US",
        timezone: f.timeZone,
        website_issue_type: "NO_SSL",
        email_prepared_subject: `Quick note about the ${f.name} website`,
        email_prepared_body: `Hi,\n\nI was looking at the ${f.name} website and noticed that browsers mark it as "Not Secure".\n\nWould you like me to send a free homepage mockup?`,
        email_prepared_signature: "[SYMULACJA]",
      })),
    );
    for (const row of outreach.emailEngine.list())
      firmByLead.set(
        row.id,
        firms.find((f) => f.email === row.email),
      );
    write(
      file("leads.json"),
      sms.map((s) => ({
        id: s.id,
        nazwa: s.name,
        telefon: s.phone,
        email: s.email,
        miasto: "Łódź",
        status: "wyslano_wiadomosc",
        created_at: new Date(WORLD_START).toISOString(),
      })),
    );
    if (sabotage === "prawdziwa-siec")
      await fetch("https://example.com/").catch(() => {});

    for (let day = 0; day < days + 3; day++) {
      const dayStart = WORLD_START + day * DAY;
      const sending = day < days;
      // Każdy dzień zaczyna się od „ponownego uruchomienia aplikacji”: dane muszą przetrwać.
      const before = {
        leads: outreach.emailEngine.list().length,
        messages: outreach.inbox.list({ limit: 500 }).length,
        blocked: store.suppression.list("email").length,
      };
      store.close();
      boot();
      const after = {
        leads: outreach.emailEngine.list().length,
        messages: outreach.inbox.list({ limit: 500 }).length,
        blocked: store.suppression.list("email").length,
      };
      restarts.push(JSON.stringify(before) === JSON.stringify(after));

      const stat = {
        date: new Date(dayStart).toISOString().slice(0, 10),
        weekday: localParts(dayStart + 12 * HOUR, "UTC").weekday,
        sent: 0,
        replies: 0,
        blocked: 0,
        answered: 0,
      };
      const deliveredBefore = server.delivered.length;
      const blockedBefore = outreach.inbox.counts().blocked;
      const inboxBefore = outreach.inbox.list({ limit: 500 }).length;
      if (day === 2) {
        server.state.smtpOutage = 3;
        incidents.push(
          `${stat.date}: wirtualna awaria SMTP przerwała 3 wysyłki.`,
        );
      }
      if (day === 3) {
        server.state.imapDownUntil = dayStart + DAY;
        incidents.push(
          `${stat.date}: wirtualna awaria IMAP na cały dzień. Odpowiedzi czekały do następnego dnia.`,
        );
      }
      if (day === 4) server.state.replyFailures = 1;

      for (const hour of SESSIONS) {
        clock.set(dayStart + hour * HOUR);
        if (sending) {
          const ids = outreach.emailEngine
            .list()
            .filter((r) => r.status === "nowy")
            .slice(0, 200)
            .map((r) => r.id);
          if (ids.length) await outreach.emailEngine.sendBulk(ids, true);
        }
        try {
          await outreach.emailEngine.syncReplies();
        } catch (err) {
          if (!/wirtualna awaria IMAP/.test(String(err.message))) throw err;
        }
        for (const s of sms) {
          if (s.delivered || s.dueMs > clock.now()) continue;
          s.delivered = true;
          const lead = read(file("leads.json"), []).find((l) => l.id === s.id);
          // Ta sama wiadomość zgłoszona dwa razy (tak robi monitor odpowiedzi) nie może się zdublować.
          for (let i = 0; i < 2; i++)
            await outreach.inbox.ingest({
              channel: "sms",
              lead,
              address: s.phone,
              text: s.reply,
              at: s.dueMs,
              externalId: `chat-${s.id}`,
            });
        }
        await ownerSession();
      }
      stat.sent = server.delivered
        .slice(deliveredBefore)
        .filter((m) => m.kind === "cold").length;
      stat.answered = server.delivered
        .slice(deliveredBefore)
        .filter((m) => m.kind === "reply").length;
      stat.replies = outreach.inbox.list({ limit: 500 }).length - inboxBefore;
      stat.blocked = outreach.inbox.counts().blocked - blockedBefore;
      daily.push(stat);
    }

    report = buildReport({
      seed,
      days,
      companies,
      useAi,
      sabotage,
      dir,
      inserted,
      firms,
      sms,
      server,
      ai,
      owner,
      smsOut,
      incidents,
      daily,
      restarts,
      store,
      outreach,
      firmByLead,
      truthOf,
      guard,
      started,
    });
  } finally {
    try {
      store?.close();
    } catch {
      /* baza mogła być już zamknięta */
    }
    guard?.release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return report;
}

/* ------------------------------- raport ------------------------------- */

function buildReport(c) {
  const { server, firms, sms, owner, store, outreach, ai } = c;
  const cold = server.delivered.filter((m) => m.kind === "cold");
  const replies = server.delivered.filter((m) => m.kind === "reply");
  const leads = outreach.emailEngine.list();
  const messages = outreach.inbox.list({ limit: 500 });
  const emailRule = countryRules.markets.US.email;
  const blockedAt = new Map(
    store.db
      .prepare("SELECT kind, value, added_at FROM suppression")
      .all()
      .map((r) => [`${r.kind}:${r.value}`, r.added_at]),
  );
  const firmByEmail = new Map(firms.map((f) => [f.email, f]));
  const invariants = [];
  const check = (id, label, checked, problems) =>
    invariants.push({
      id,
      label,
      ok: problems.length === 0,
      checked,
      detail: problems.slice(0, 3).join(" | "),
    });

  check(
    "siec",
    "Zero prawdziwych połączeń z Internetem",
    c.guard ? 1 : 0,
    c.guard ? c.guard.attempts : [],
  );

  check(
    "adresy",
    "Każda wiadomość trafiła wyłącznie do wirtualnej firmy (.example)",
    server.delivered.length + c.smsOut.length,
    server.delivered
      .filter((m) => !m.to.endsWith(".example") || !firmByEmail.has(m.to))
      .map((m) => m.to),
  );

  check(
    "okno",
    "Pierwsze wiadomości wychodzą tylko w dni robocze, w godzinach pracy odbiorcy",
    cold.length,
    cold
      .map((m) => ({
        m,
        local: localParts(m.at, firmByEmail.get(m.to).timeZone),
      }))
      .filter(
        ({ local }) =>
          ["Sat", "Sun"].includes(local.weekday) ||
          local.hour < emailRule.sendWindow.startHour ||
          local.hour >= emailRule.sendWindow.endHour,
      )
      .map(({ m, local }) => `${m.to} o ${local.hour}:00 (${local.weekday})`),
  );

  const perDay = new Map();
  for (const m of cold)
    perDay.set(
      new Date(m.at).toDateString(),
      (perDay.get(new Date(m.at).toDateString()) ?? 0) + 1,
    );
  check(
    "limit",
    `Dzienny limit ${emailRule.dailyLimit} pierwszych wiadomości nie został przekroczony`,
    perDay.size,
    [...perDay]
      .filter(([, n]) => n > emailRule.dailyLimit)
      .map(([d, n]) => `${d}: ${n}`),
  );

  const coldCount = new Map();
  for (const m of cold) coldCount.set(m.to, (coldCount.get(m.to) ?? 0) + 1);
  check(
    "raz",
    "Żadna firma nie dostała pierwszej wiadomości dwa razy",
    coldCount.size,
    [...coldCount].filter(([, n]) => n > 1).map(([to, n]) => `${to} ×${n}`),
  );

  const footer = (m) =>
    m.text.includes(SENDER.company) &&
    m.text.includes(SENDER.address) &&
    /unsubscribe/i.test(m.text) &&
    /business solicitation/i.test(m.text) &&
    Boolean(m.unsubscribe);
  check(
    "stopka",
    "Każdy e-mail ma dane nadawcy, adres pocztowy i sposób rezygnacji",
    server.delivered.length,
    server.delivered
      .filter((m) => !footer(m))
      .map((m) => `${m.kind} → ${m.to}`),
  );

  check(
    "po-blokadzie",
    "Po zablokowaniu kontaktu nic więcej do niego nie wyszło",
    blockedAt.size,
    [
      ...server.delivered
        .filter(
          (m) =>
            blockedAt.has(`email:${m.to}`) &&
            m.at > blockedAt.get(`email:${m.to}`),
        )
        .map((m) => m.to),
      ...c.smsOut
        .filter(
          (m) =>
            blockedAt.has(`phone:${m.to.slice(-9)}`) &&
            m.at > blockedAt.get(`phone:${m.to.slice(-9)}`),
        )
        .map((m) => m.to),
    ],
  );

  const approvedTexts = new Set(
    owner.approvals.map((a) => `${String(a.address).toLowerCase()}|${a.text}`),
  );
  check(
    "zgoda",
    "Każda odpowiedź do klienta została wcześniej zatwierdzona przez właściciela",
    replies.length + c.smsOut.length,
    [
      ...replies
        .filter(
          (m) => !approvedTexts.has(`${m.to}|${m.text.split("\n\n--\n")[0]}`),
        )
        .map((m) => m.to),
      ...c.smsOut
        .filter((m) => !approvedTexts.has(`${m.to}|${m.text}`))
        .map((m) => m.to),
    ],
  );

  const autoBlocked = messages.filter((m) => m.status === "blocked");
  check(
    "blokada-wspolna",
    "Rozpoznana odmowa blokuje kontakt w bazie, także w drugim kanale",
    autoBlocked.length,
    autoBlocked
      .filter((m) => {
        if (m.channel === "email")
          return !store.suppression.isBlocked({ email: m.address });
        const lead = sms.find((s) => s.id === m.leadId);
        return (
          !store.suppression.isBlocked({ phone: m.address }) ||
          (lead?.email && !store.suppression.isBlocked({ email: lead.email }))
        );
      })
      .map((m) => m.address),
  );

  const fetched = server.mailbox.filter((m) => m.fetched);
  const expectedInbox = fetched.length + sms.filter((s) => s.delivered).length;
  const ids = new Set(messages.map((m) => m.id));
  check(
    "bez-dubli",
    "Każda odpowiedź jest w skrzynce dokładnie raz, mimo powtórnych pobrań i restartów",
    expectedInbox,
    ids.size === messages.length && messages.length === expectedInbox
      ? []
      : [`w skrzynce ${messages.length}, w świecie ${expectedInbox}`],
  );

  check(
    "restart",
    "Dane przetrwały każde ponowne uruchomienie",
    c.restarts.length,
    c.restarts.every(Boolean)
      ? []
      : ["po restarcie zmieniła się liczba rekordów"],
  );

  const leaks = [];
  const scan = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) scan(full);
      else {
        const content = fs.readFileSync(full).toString("latin1");
        if (content.includes(SMTP_SECRET) || content.includes(AI_SECRET))
          leaks.push(entry.name);
      }
    }
  };
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  scan(c.dir);
  check(
    "sekrety",
    "Hasło do poczty i klucz AI nie leżą na dysku jawnym tekstem",
    2,
    leaks,
  );

  check(
    "hasla-dzialaja",
    "Program odszyfrował hasło i klucz poprawnie",
    1 + ai.calls.length,
    [
      ...(server.state.passwordsSeen.size === 1 &&
      server.state.passwordsSeen.has(SMTP_SECRET)
        ? []
        : ["SMTP dostał inne hasło"]),
      ...(ai.calls.every((x) => x.authorized) ? [] : ["AI dostało zły klucz"]),
    ],
  );

  const aiPerDay = new Map();
  for (const call of ai.calls)
    aiPerDay.set(
      new Date(call.at).toISOString().slice(0, 10),
      (aiPerDay.get(new Date(call.at).toISOString().slice(0, 10)) ?? 0) + 1,
    );
  check(
    "limit-ai",
    "Dzienny limit zapytań do AI (40) nie został przekroczony",
    aiPerDay.size,
    [...aiPerDay].filter(([, n]) => n > 40).map(([d, n]) => `${d}: ${n}`),
  );

  check(
    "wlasciciel",
    "Zabezpieczenia w skrzynce zatrzymały błędne kliknięcia właściciela",
    owner.blockedApproveGuards + owner.placeholderGuards,
    owner.failures,
  );

  const sentRows = leads.filter((l) => l.email_sent_at);
  const events = store.db
    .prepare("SELECT lead_id FROM events WHERE type = 'email_sent'")
    .all();
  const withEvent = new Set(events.map((e) => e.lead_id));
  check(
    "dziennik",
    "Baza zgadza się ze światem: tyle samo wysyłek i wpis w dzienniku dla każdej",
    sentRows.length,
    [
      ...(sentRows.length === cold.length
        ? []
        : [`baza ${sentRows.length}, świat ${cold.length}`]),
      ...sentRows
        .filter((l) => !withEvent.has(l.id))
        .map((l) => `brak zdarzenia: ${l.email}`),
    ],
  );

  /* ---- pomiary (nie zasady): jak program ocenił odpowiedzi ---- */
  const matrix = {};
  const refusals = {
    total: 0,
    autoBlocked: 0,
    caughtByOwner: 0,
    withReadyDraft: 0,
    leftUnanswered: 0,
  };
  let correct = 0;
  let judged = 0;
  let falseBlocks = 0;
  const ownerBlocks = new Map(owner.blocks.map((b) => [b.id, b]));
  for (const m of messages) {
    const truth = c.truthOf(m);
    if (!truth) continue;
    judged++;
    matrix[truth] ??= {};
    matrix[truth][m.category] = (matrix[truth][m.category] ?? 0) + 1;
    if (truth === m.category) correct++;
    if (BLOCKING.has(truth)) {
      refusals.total++;
      if (ownerBlocks.has(m.id)) {
        refusals.caughtByOwner++;
        if (ownerBlocks.get(m.id).hadDraft) refusals.withReadyDraft++;
      } else if (m.status === "blocked") refusals.autoBlocked++;
      else refusals.leftUnanswered++;
    } else if (BLOCKING.has(m.category)) falseBlocks++;
  }
  const rulesOnly = { total: 0, blocked: 0 };
  for (const entry of [
    ...fetched,
    ...sms
      .filter((s) => s.delivered)
      .map((s) => ({ text: s.reply, truth: s.category })),
  ]) {
    if (!BLOCKING.has(entry.truth)) continue;
    rulesOnly.total++;
    if (BLOCKING.has(classifyRules(stripQuoted(entry.text)).category))
      rulesOnly.blocked++;
  }

  const personas = {};
  for (const f of firms) personas[f.persona] = (personas[f.persona] ?? 0) + 1;
  const statusCount = (s) => leads.filter((l) => l.status === s).length;
  return {
    ok: invariants.every((i) => i.ok),
    seed: c.seed,
    sabotage: c.sabotage,
    params: {
      companies: c.companies,
      days: c.days,
      smsLeads: sms.length,
      ai: c.useAi,
    },
    durationMs: Date.now() - c.started,
    world: {
      personas,
      from: daily0(c.daily),
      to: c.daily[c.daily.length - 1]?.date,
    },
    funnel: {
      inserted: c.inserted.added,
      coldDelivered: cold.length,
      bounced: firms.filter(
        (f) =>
          f.persona === "odbicie" &&
          leads.find((l) => l.email === f.email)?.status === "blad_wysylki",
      ).length,
      sendErrors: statusCount("blad_wysylki"),
      neverSent: statusCount("nowy"),
      repliesReceived: messages.length,
      autoBlocked: autoBlocked.length - owner.blocks.length,
      ownerBlocked: owner.blocks.length,
      ignored: messages.filter((m) => m.status === "ignored").length,
      answered: replies.length + c.smsOut.length,
      dismissed: messages.filter((m) => m.status === "dismissed").length,
      stillPending: messages.filter(
        (m) => m.status === "pending" || m.status === "sending",
      ).length,
    },
    classifier: {
      judged,
      correct,
      falseBlocks,
      refusals,
      rulesOnly,
      matrix,
      aiCalls: ai.calls.length,
      aiFailures: ai.calls.filter((x) => x.outcome !== "ok").length,
      aiWrong: ai.calls.filter(
        (x) => x.outcome === "ok" && x.truth && x.truth !== x.answered,
      ).length,
    },
    days: c.daily,
    incidents: c.incidents,
    invariants,
    notCovered: [
      "Wysyłka pierwszych SMS-ów (iMessage/AppleScript) i odczyt Wiadomości na Macu",
      "Skan Map Google, audyt stron i sito Snajpera",
      "Prawdziwa trafność fal.ai: wirtualne AI odpowiada poprawnie w 9 przypadkach na 10 z założenia",
      "Prawdziwe serwery SMTP/IMAP, filtry antyspamowe i dostarczalność",
      "Interfejs aplikacji i przyciski w Telegramie (tu wywoływane bezpośrednio)",
    ],
  };
}

function daily0(daily) {
  return daily[0]?.date ?? null;
}

/** Raport w Markdownie: do konsoli, podsumowania CI i podglądu w aplikacji. */
function formatReport(r) {
  const f = r.funnel;
  const k = r.classifier;
  const lines = [
    `### ${r.ok ? "✅" : "❌"} Wirtualny świat nr ${r.seed}${r.sabotage ? ` (celowe zepsucie: ${r.sabotage})` : ""}`,
    "",
    `${r.params.companies} wirtualnych firm z USA, ${r.params.smsLeads} polskich kontaktów SMS, ${r.params.days} dni wysyłki (${r.world.from} → ${r.world.to}), AI ${r.params.ai ? "włączone" : "wyłączone"}. Czas: ${(r.durationMs / 1000).toFixed(1)} s.`,
    "",
    "| Zasada | Wynik | Sprawdzono |",
    "| --- | --- | --- |",
    ...r.invariants.map(
      (i) =>
        `| ${i.label} | ${i.ok ? "✅" : `❌ ${i.detail}`} | ${i.checked} |`,
    ),
    "",
    "| Lejek | Liczba |",
    "| --- | --- |",
    `| Pierwsze wiadomości dostarczone | ${f.coldDelivered} z ${f.inserted} |`,
    `| Błędy wysyłki (odbicia i awaria SMTP) | ${f.sendErrors} |`,
    `| Niewysłane do końca okresu | ${f.neverSent} |`,
    `| Odpowiedzi w skrzynce (e-mail i SMS) | ${f.repliesReceived} |`,
    `| Zablokowane automatycznie | ${f.autoBlocked} |`,
    `| Zablokowane ręcznie przez właściciela | ${f.ownerBlocked} |`,
    `| Autorespondery pominięte | ${f.ignored} |`,
    `| Odpowiedzi wysłane po zatwierdzeniu | ${f.answered} |`,
    `| Pominięte przez właściciela | ${f.dismissed} |`,
    "",
    `**Rozpoznawanie odpowiedzi:** trafna kategoria w ${k.correct} z ${k.judged}. Odmów i wyrazów nieufności było ${k.refusals.total}: ${k.refusals.autoBlocked} zablokował program, ${k.refusals.caughtByOwner} musiał wyłapać właściciel (w tym ${k.refusals.withReadyDraft} z gotową propozycją odpowiedzi), ${k.refusals.leftUnanswered} zostało bez blokady i bez odpowiedzi. Same reguły, bez AI, złapałyby ${k.rulesOnly.blocked} z ${k.rulesOnly.total}. Fałszywe blokady: ${k.falseBlocks}. Zapytań do wirtualnego AI: ${k.aiCalls} (awarie: ${k.aiFailures}, błędne oceny: ${k.aiWrong}).`,
  ];
  if (r.incidents.length)
    lines.push(
      "",
      "**Zdarzenia losowe:**",
      ...r.incidents.map((i) => `- ${i}`),
    );
  return lines.join("\n");
}

module.exports = { runSimulation, formatReport, SABOTAGES };
