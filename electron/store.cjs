// Baza danych LeadFinder (SQLite wbudowany w Electrona, moduł node:sqlite).
// Jedno miejsce na cały lejek: leady, dziennik zdarzeń, rejestr wysyłek,
// wspólna lista blokad oraz tabele kolejnych etapów (wiadomości, dema, oferty,
// płatności, zadania, koszty). Moduł nie zależy od Electrona — dostaje katalog
// danych, więc da się go testować na folderze tymczasowym.

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DB_FILE = "leadfinder.sqlite";
const SCHEMA_VERSION = 1;
const BACKUP_KEEP = 7;
const DAY_MS = 86400000;

/** Pliki JSON, które po migracji są obsługiwane przez bazę. */
const LEAD_FILES = { "leads.json": "sms", "email-leads.json": "email" };
const LEDGER_FILES = { "sms-ledger.json": "sms", "email-ledger.json": "email" };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS leads (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  phone_key TEXT,
  email TEXT,
  status TEXT,
  market TEXT,
  offer TEXT,
  created_at TEXT,
  updated_at INTEGER NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS leads_kind_pos ON leads (kind, pos);
CREATE INDEX IF NOT EXISTS leads_phone_key ON leads (phone_key);
CREATE INDEX IF NOT EXISTS leads_email ON leads (email);
CREATE INDEX IF NOT EXISTS leads_status ON leads (kind, status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  data TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_lead ON events (kind, lead_id, at);
CREATE INDEX IF NOT EXISTS events_at ON events (at);

CREATE TABLE IF NOT EXISTS send_ledger (
  channel TEXT NOT NULL,
  key TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (channel, key)
);

CREATE TABLE IF NOT EXISTS suppression (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  source TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_kind TEXT,
  lead_id TEXT,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  address TEXT,
  subject TEXT,
  body TEXT,
  template_id TEXT,
  status TEXT,
  classification TEXT,
  at INTEGER NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS messages_lead ON messages (lead_kind, lead_id, at);

CREATE TABLE IF NOT EXISTS demos (
  id TEXT PRIMARY KEY,
  lead_kind TEXT,
  lead_id TEXT,
  slug TEXT UNIQUE,
  url TEXT,
  template TEXT,
  status TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  last_view_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  lead_kind TEXT,
  lead_id TEXT,
  package TEXT,
  amount_minor INTEGER,
  currency TEXT,
  status TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  offer_id TEXT,
  lead_kind TEXT,
  lead_id TEXT,
  provider TEXT,
  provider_ref TEXT UNIQUE,
  amount_minor INTEGER,
  currency TEXT,
  status TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  lead_kind TEXT,
  lead_id TEXT,
  payload TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at INTEGER,
  idempotency_key TEXT UNIQUE,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, run_at);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  note TEXT,
  lead_kind TEXT,
  lead_id TEXT
);

-- Zgodność ze starym kodem: „blacklist” i „email_blacklist” to widoki na wspólną
-- listę blokad. Blokada numeru obejmuje też e-mail tej samej firmy i odwrotnie.
CREATE VIEW IF NOT EXISTS blacklist AS
  SELECT value AS phone, added_at FROM suppression WHERE kind = 'phone';
CREATE VIEW IF NOT EXISTS email_blacklist AS
  SELECT value AS email, added_at FROM suppression WHERE kind = 'email';

CREATE TRIGGER IF NOT EXISTS blacklist_insert INSTEAD OF INSERT ON blacklist
BEGIN
  INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at)
    VALUES ('phone', NEW.phone, NULL, 'manual', NEW.added_at);
  INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at)
    SELECT 'email', lower(email), NULL, 'linked:phone', NEW.added_at
    FROM leads WHERE phone_key = NEW.phone AND email IS NOT NULL AND email <> '';
END;
CREATE TRIGGER IF NOT EXISTS blacklist_delete INSTEAD OF DELETE ON blacklist
BEGIN
  DELETE FROM suppression WHERE kind = 'phone' AND value = OLD.phone;
END;
CREATE TRIGGER IF NOT EXISTS email_blacklist_insert INSTEAD OF INSERT ON email_blacklist
BEGIN
  INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at)
    VALUES ('email', lower(NEW.email), NULL, 'manual', NEW.added_at);
  INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at)
    SELECT 'phone', phone_key, NULL, 'linked:email', NEW.added_at
    FROM leads WHERE email = lower(NEW.email) AND phone_key IS NOT NULL AND phone_key <> '';
END;
CREATE TRIGGER IF NOT EXISTS email_blacklist_delete INSTEAD OF DELETE ON email_blacklist
BEGIN
  DELETE FROM suppression WHERE kind = 'email' AND value = lower(OLD.email);
END;
`;

function phoneKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

function emailKey(value) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Ścisły odczyt JSON: brak pliku to null, uszkodzony plik to błąd (nie gubimy danych po cichu). */
function readJsonStrict(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Plik ${path.basename(file)} jest uszkodzony (${String(err?.message || err)}). Migracja przerwana, dane zostają w plikach JSON.`,
    );
  }
}

/**
 * Otwiera bazę w katalogu danych. Rzuca błąd, gdy bazy nie da się otworzyć —
 * decyzję, co dalej, podejmuje wywołujący (patrz openStoreSafely).
 */
function createStore({ dir, now = () => Date.now() }) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DB_FILE);
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
  );
  db.exec(SCHEMA);

  const getMeta = (key) =>
    db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
  const setMeta = (key, value) =>
    db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, String(value));
  if (!getMeta("schema_version")) setMeta("schema_version", SCHEMA_VERSION);

  // Transakcje mogą się zagnieżdżać: zapis zatwierdza dopiero najbardziej zewnętrzna.
  let depth = 0;
  function transaction(fn) {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      depth--;
    }
  }

  /* ----------------------------- leady ----------------------------- */

  const addEvent = db.prepare(
    "INSERT INTO events (kind, lead_id, type, from_value, to_value, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const upsertLead = db.prepare(`
    INSERT INTO leads (kind, id, pos, phone_key, email, status, market, offer, created_at, updated_at, doc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET
      pos = excluded.pos, phone_key = excluded.phone_key, email = excluded.email, status = excluded.status,
      market = excluded.market, offer = excluded.offer, created_at = excluded.created_at,
      updated_at = excluded.updated_at, doc = excluded.doc`);

  function readLeads(kind) {
    return db
      .prepare("SELECT doc FROM leads WHERE kind = ? ORDER BY pos")
      .all(kind)
      .map((r) => JSON.parse(r.doc));
  }

  /** Zdarzenia wynikające z różnicy między starą a nową wersją leada. */
  function diffEvents(kind, id, before, after, at) {
    if (before.status !== after.status) {
      addEvent.run(
        kind,
        id,
        "status",
        before.status ?? null,
        after.status ?? null,
        null,
        at,
      );
    }
    const marks = [
      ["sms_sent_at", "sms_sent"],
      ["email_sent_at", "email_sent"],
      ["engaged_at", "replied"],
      ["closed_at", "closed"],
    ];
    for (const [field, type] of marks) {
      if (!before[field] && after[field])
        addEvent.run(kind, id, type, null, String(after[field]), null, at);
    }
    if (
      (before.deal_value ?? null) !== (after.deal_value ?? null) &&
      after.deal_value != null
    ) {
      addEvent.run(
        kind,
        id,
        "deal_value",
        before.deal_value == null ? null : String(before.deal_value),
        String(after.deal_value),
        null,
        at,
      );
    }
  }

  /**
   * Zapisuje pełną listę leadów (tak jak dotąd writeLeads), ale do bazy trafiają
   * tylko różnice, a każda zmiana statusu i każda wysyłka zostawia zdarzenie.
   */
  function writeLeads(kind, rows) {
    if (!Array.isArray(rows)) throw new Error("Lista leadów musi być tablicą.");
    return transaction(() => {
      const at = now();
      const existing = new Map(
        db
          .prepare("SELECT id, pos, doc FROM leads WHERE kind = ?")
          .all(kind)
          .map((r) => [r.id, r]),
      );
      const seen = new Set();
      let inserted = 0;
      let updated = 0;
      rows.forEach((raw, pos) => {
        const row = raw && typeof raw === "object" ? raw : {};
        // Lead bez id albo z powtórzonym id dostaje nowy identyfikator — nic nie ginie.
        if (!row.id || seen.has(String(row.id))) row.id = randomUUID();
        const id = String(row.id);
        seen.add(id);
        const doc = JSON.stringify(row);
        const prev = existing.get(id);
        if (prev && prev.doc === doc && prev.pos === pos) return;
        upsertLead.run(
          kind,
          id,
          pos,
          phoneKey(row.telefon),
          emailKey(row.email),
          row.status ?? null,
          row.market ?? null,
          row.offer_type ?? null,
          row.created_at ?? null,
          at,
          doc,
        );
        if (!prev) {
          inserted++;
          addEvent.run(
            kind,
            id,
            "created",
            null,
            row.status ?? null,
            row.zrodlo ? JSON.stringify({ zrodlo: row.zrodlo }) : null,
            at,
          );
        } else if (prev.doc !== doc) {
          updated++;
          diffEvents(kind, id, JSON.parse(prev.doc), row, at);
        }
      });
      let deleted = 0;
      const remove = db.prepare("DELETE FROM leads WHERE kind = ? AND id = ?");
      for (const [id, prev] of existing) {
        if (seen.has(id)) continue;
        remove.run(kind, id);
        deleted++;
        let name = null;
        try {
          name = JSON.parse(prev.doc).nazwa ?? null;
        } catch {
          name = null;
        }
        addEvent.run(
          kind,
          id,
          "deleted",
          null,
          null,
          name ? JSON.stringify({ nazwa: name }) : null,
          at,
        );
      }
      return { inserted, updated, deleted };
    });
  }

  /* --------------------------- rejestr wysyłek --------------------------- */

  function readLedger(channel) {
    const out = {};
    for (const r of db
      .prepare("SELECT key, at FROM send_ledger WHERE channel = ?")
      .all(channel))
      out[r.key] = r.at;
    return out;
  }

  function writeLedger(channel, map) {
    const next = map && typeof map === "object" ? map : {};
    transaction(() => {
      const current = readLedger(channel);
      const put = db.prepare(
        "INSERT INTO send_ledger (channel, key, at) VALUES (?, ?, ?) ON CONFLICT(channel, key) DO UPDATE SET at = excluded.at",
      );
      for (const [key, at] of Object.entries(next)) {
        if (current[key] !== String(at)) put.run(channel, key, String(at));
      }
      const del = db.prepare(
        "DELETE FROM send_ledger WHERE channel = ? AND key = ?",
      );
      for (const key of Object.keys(current))
        if (!(key in next)) del.run(channel, key);
    });
  }

  /* ------------------------------ blokady ------------------------------ */

  const suppression = {
    /** kind: 'phone' (9 cyfr), 'email' albo 'domain'. */
    add(kind, value, { reason = null, source = "manual" } = {}) {
      const v =
        kind === "phone"
          ? phoneKey(value)
          : kind === "email"
            ? emailKey(value)
            : String(value ?? "")
                .trim()
                .toLowerCase();
      if (!v) return false;
      if (kind === "phone")
        db.prepare("INSERT INTO blacklist (phone, added_at) VALUES (?, ?)").run(
          v,
          now(),
        );
      else if (kind === "email")
        db.prepare(
          "INSERT INTO email_blacklist (email, added_at) VALUES (?, ?)",
        ).run(v, now());
      else
        db.prepare(
          "INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at) VALUES ('domain', ?, ?, ?, ?)",
        ).run(v, reason, source, now());
      if (kind !== "domain" && (reason || source !== "manual")) {
        db.prepare(
          "UPDATE suppression SET reason = COALESCE(?, reason), source = ? WHERE kind = ? AND value = ?",
        ).run(reason, source, kind, v);
      }
      return true;
    },
    /** Czy kontakt jest zablokowany dowolnym kanałem (numer, e-mail albo cała domena). */
    isBlocked({ phone, email } = {}) {
      const has = db.prepare(
        "SELECT 1 AS hit FROM suppression WHERE kind = ? AND value = ?",
      );
      const p = phoneKey(phone);
      if (p && has.get("phone", p)) return true;
      const e = emailKey(email);
      if (e && has.get("email", e)) return true;
      if (e && has.get("domain", e.split("@")[1])) return true;
      return false;
    },
    list(kind) {
      return db
        .prepare(
          "SELECT value, reason, source, added_at FROM suppression WHERE kind = ? ORDER BY added_at",
        )
        .all(kind);
    },
  };

  /* --------------------------- migracja z JSON --------------------------- */

  /**
   * Jednorazowe przeniesienie danych z plików JSON i starych list blokad.
   * Kolejność: kopia plików → ścisły odczyt → zapis w jednej transakcji →
   * oznaczenie w meta → zmiana nazw plików na *.migrated (żeby nic już nie
   * czytało nieaktualnych danych).
   */
  function migrateFromJson() {
    if (getMeta("json_migrated_at"))
      return { migrated: false, reason: "already" };
    const sources = [
      ...Object.keys(LEAD_FILES),
      ...Object.keys(LEDGER_FILES),
    ].filter((name) => fs.existsSync(path.join(dir, name)));
    const loaded = {};
    for (const name of sources)
      loaded[name] = readJsonStrict(path.join(dir, name));

    const oldBlocks = { phone: [], email: [] };
    const cacheFile = path.join(dir, "cache.sqlite");
    if (fs.existsSync(cacheFile)) {
      let old = null;
      try {
        old = new DatabaseSync(cacheFile, { readOnly: true });
        const tables = new Set(
          old
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((r) => r.name),
        );
        if (tables.has("blacklist"))
          oldBlocks.phone = old
            .prepare("SELECT phone, added_at FROM blacklist")
            .all();
        if (tables.has("email_blacklist"))
          oldBlocks.email = old
            .prepare("SELECT email, added_at FROM email_blacklist")
            .all();
      } finally {
        try {
          old?.close();
        } catch {
          /* połączenie mogło się nie otworzyć */
        }
      }
    }

    let backupDir = null;
    if (sources.length) {
      backupDir = path.join(
        dir,
        "backups",
        `json-przed-sqlite-${stamp(new Date(now()))}`,
      );
      fs.mkdirSync(backupDir, { recursive: true });
      for (const name of sources)
        fs.copyFileSync(path.join(dir, name), path.join(backupDir, name));
    }

    for (const name of Object.keys(LEAD_FILES)) {
      if (loaded[name] != null && !Array.isArray(loaded[name])) {
        throw new Error(
          `Plik ${name} nie zawiera listy leadów. Migracja przerwana, dane zostają w plikach JSON.`,
        );
      }
    }
    for (const name of Object.keys(LEDGER_FILES)) {
      const map = loaded[name];
      if (map != null && (typeof map !== "object" || Array.isArray(map))) {
        throw new Error(
          `Plik ${name} ma nieoczekiwany format. Migracja przerwana, dane zostają w plikach JSON.`,
        );
      }
    }
    const counts = { sms: 0, email: 0, ledger: 0, blocks: 0 };
    // Wszystko w jednej transakcji: albo przenosi się komplet danych, albo nic.
    transaction(() => {
      for (const [name, kind] of Object.entries(LEAD_FILES)) {
        const rows = loaded[name];
        if (rows == null) continue;
        writeLeads(kind, rows);
        counts[kind] = rows.length;
      }
      for (const [name, channel] of Object.entries(LEDGER_FILES)) {
        const map = loaded[name];
        if (map == null) continue;
        writeLedger(channel, map);
        counts.ledger += Object.keys(map).length;
      }
      const put = db.prepare(
        "INSERT OR IGNORE INTO suppression (kind, value, reason, source, added_at) VALUES (?, ?, NULL, 'migrated', ?)",
      );
      for (const r of oldBlocks.phone) {
        const v = phoneKey(r.phone) ?? String(r.phone ?? "").replace(/\D/g, "");
        if (v)
          counts.blocks += Number(
            put.run("phone", v, Number(r.added_at) || now()).changes,
          );
      }
      for (const r of oldBlocks.email) {
        const v = emailKey(r.email);
        if (v)
          counts.blocks += Number(
            put.run("email", v, Number(r.added_at) || now()).changes,
          );
      }
      setMeta("json_migrated_at", new Date(now()).toISOString());
      setMeta("json_migration_counts", JSON.stringify(counts));
    });
    for (const name of sources) {
      fs.renameSync(
        path.join(dir, name),
        path.join(dir, name.replace(/\.json$/, ".migrated.json")),
      );
    }
    return { migrated: true, counts, backupDir };
  }

  /* ------------------------------- kopie ------------------------------- */

  const backupsDir = path.join(dir, "backups");

  function listBackups() {
    if (!fs.existsSync(backupsDir)) return [];
    return fs
      .readdirSync(backupsDir)
      .filter((f) => /^leadfinder-\d{8}-\d{6}\.sqlite$/.test(f))
      .sort()
      .map((f) => ({
        file: path.join(backupsDir, f),
        at: fs.statSync(path.join(backupsDir, f)).mtimeMs,
      }));
  }

  /** Spójna kopia całej bazy (VACUUM INTO); zostaje 7 najnowszych. */
  function backup() {
    fs.mkdirSync(backupsDir, { recursive: true });
    let target = path.join(
      backupsDir,
      `leadfinder-${stamp(new Date(now()))}.sqlite`,
    );
    for (let i = 1; fs.existsSync(target); i++) {
      target = path.join(
        backupsDir,
        `leadfinder-${stamp(new Date(now() + i * 1000))}.sqlite`,
      );
    }
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const all = listBackups();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP)))
      fs.rmSync(old.file, { force: true });
    setMeta("last_backup_at", new Date(now()).toISOString());
    return target;
  }

  /** Kopia najwyżej raz na dobę — wołana przy starcie aplikacji. */
  function backupIfDue() {
    const last = getMeta("last_backup_at");
    if (last && now() - Date.parse(last) < DAY_MS) return null;
    if (count("leads") === 0 && count("suppression") === 0) return null;
    return backup();
  }

  const count = (table, where = "", ...args) =>
    Number(
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...args)
        ?.n ?? 0,
    );

  function status() {
    return {
      engine: "sqlite",
      file,
      schemaVersion: Number(getMeta("schema_version")),
      migratedAt: getMeta("json_migrated_at"),
      lastBackupAt: getMeta("last_backup_at"),
      backups: listBackups().length,
      leads: {
        sms: count("leads", "WHERE kind = ?", "sms"),
        email: count("leads", "WHERE kind = ?", "email"),
      },
      events: count("events"),
      suppression: count("suppression"),
    };
  }

  const events = {
    forLead(kind, id) {
      return db
        .prepare(
          "SELECT type, from_value, to_value, data, at FROM events WHERE kind = ? AND lead_id = ? ORDER BY id",
        )
        .all(kind, String(id));
    },
    recent(limit = 50) {
      return db
        .prepare(
          "SELECT kind, lead_id, type, from_value, to_value, data, at FROM events ORDER BY id DESC LIMIT ?",
        )
        .all(Math.min(500, Math.max(1, Number(limit) || 50)));
    },
  };

  /** Adaptery dla istniejącego kodu: te pliki JSON są teraz tabelami. */
  function handles(fileName) {
    const name = path.basename(String(fileName));
    return name in LEAD_FILES || name in LEDGER_FILES;
  }
  function readFile(fileName) {
    const name = path.basename(String(fileName));
    if (name in LEAD_FILES) return readLeads(LEAD_FILES[name]);
    return readLedger(LEDGER_FILES[name]);
  }
  function writeFile(fileName, value) {
    const name = path.basename(String(fileName));
    if (name in LEAD_FILES) writeLeads(LEAD_FILES[name], value);
    else writeLedger(LEDGER_FILES[name], value);
  }

  return {
    db,
    file,
    readLeads,
    writeLeads,
    readLedger,
    writeLedger,
    suppression,
    events,
    migrateFromJson,
    backup,
    backupIfDue,
    listBackups,
    status,
    handles,
    readFile,
    writeFile,
    close: () => db.close(),
  };
}

/**
 * Bezpieczne otwarcie bazy dla aplikacji. Trzy stany:
 *  - "sqlite": baza działa (po ewentualnej migracji),
 *  - "json":   bazy nigdy nie było i nie da się jej utworzyć — aplikacja działa na plikach jak dawniej,
 *  - "broken": baza istniała, ale nie da się jej otworzyć albo migracja się nie powiodła po rozpoczęciu.
 *              Wtedy NIE wracamy do plików JSON: byłyby nieaktualne i groziłyby podwójną wysyłką.
 */
function openStoreSafely({ dir, now, log = console.warn }) {
  const existed = fs.existsSync(path.join(dir, DB_FILE));
  let store = null;
  try {
    store = createStore({ dir, now });
  } catch (err) {
    log(`Baza danych niedostępna: ${String(err?.message || err)}`);
    return {
      state: existed ? "broken" : "json",
      store: null,
      error: String(err?.message || err),
    };
  }
  try {
    const migration = store.migrateFromJson();
    return { state: "sqlite", store, migration, error: null };
  } catch (err) {
    const error = String(err?.message || err);
    log(`Migracja do bazy nie powiodła się: ${error}`);
    const migrated = Boolean(store.status().migratedAt);
    try {
      store.close();
    } catch {
      /* baza mogła się już zamknąć */
    }
    // Migracja nie została oznaczona, więc pliki JSON są nadal aktualne i kompletne.
    if (!migrated && !existed) {
      for (const suffix of ["", "-wal", "-shm"])
        fs.rmSync(path.join(dir, DB_FILE + suffix), { force: true });
    }
    return { state: migrated ? "broken" : "json", store: null, error };
  }
}

module.exports = {
  createStore,
  openStoreSafely,
  phoneKey,
  emailKey,
  DB_FILE,
  LEAD_FILES,
  LEDGER_FILES,
};
