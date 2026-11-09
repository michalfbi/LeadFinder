import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const {
  createStore,
  openStoreSafely,
  DB_FILE,
} = require("../../../electron/store.cjs");
const { createEmailEngine } = require("../../../electron/email.cjs");
const { DatabaseSync } = require("node:sqlite");

const dirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leadfinder-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

const write = (dir: string, name: string, value: unknown) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));

/** Realistyczna baza: leady SMS z pełnym zestawem pól, w tym zagnieżdżonych. */
function sampleLeads(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `lead-${i}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    nazwa: `Stolarstwo Nowak ${i} „Żółć” 🚀`,
    telefon: `+48 6${String(10000000 + i).padStart(8, "0")}`,
    miasto: i % 3 ? "Łódź" : "Kielce",
    status: i % 5 === 0 ? "wyslano_wiadomosc" : "nowy",
    sms_sent_at: i % 5 === 0 ? "2026-02-01T10:00:00.000Z" : null,
    deal_value: i % 50 === 0 ? 1490 : undefined,
    notatki: i % 7 === 0 ? "Zadzwonić po 16:00\nDruga linia" : null,
    score_reasons: ["🚫 Brak strony WWW (+25)", "⭐ Lokalny lider (+20)"],
    tech_audit: {
      httpStatus: i % 2 ? 200 : null,
      hasSsl: false,
      copyrightYear: 2014,
    },
    hot_score: 50 + (i % 50),
  }));
}

describe("migracja z plików JSON", () => {
  it("przenosi 2000 leadów bez zmiany ani jednego pola i zachowuje kolejność", () => {
    const dir = tmp();
    const leads = sampleLeads(2000);
    const original = JSON.parse(JSON.stringify(leads));
    write(dir, "leads.json", leads);
    write(dir, "email-leads.json", [
      {
        id: "e1",
        nazwa: "Miller Roofing",
        email: "Info@MillerRoofing.com",
        channel_type: "EMAIL",
        market: "US",
        status: "nowy",
      },
    ]);
    write(dir, "sms-ledger.json", { "610000000": "2026-02-01T10:00:00.000Z" });
    write(dir, "email-ledger.json", {
      "info@millerroofing.com": "2026-02-02T10:00:00.000Z",
    });

    const opened = openStoreSafely({ dir, log: () => {} });
    expect(opened.state).toBe("sqlite");
    expect(opened.migration.counts).toEqual({
      sms: 2000,
      email: 1,
      ledger: 2,
      blocks: 0,
    });
    expect(opened.store.readLeads("sms")).toEqual(original);
    expect(
      opened.store.readFile(path.join(dir, "email-leads.json"))[0].email,
    ).toBe("Info@MillerRoofing.com");
    expect(opened.store.readLedger("sms")).toEqual({
      "610000000": "2026-02-01T10:00:00.000Z",
    });

    // Stare pliki nie są już czytane, a ich kopia leży w backups/.
    expect(fs.existsSync(path.join(dir, "leads.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "leads.migrated.json"))).toBe(true);
    const backupDir = opened.migration.backupDir as string;
    expect(
      JSON.parse(fs.readFileSync(path.join(backupDir, "leads.json"), "utf8")),
    ).toEqual(original);
    opened.store.close();

    // Drugie uruchomienie nie migruje ponownie i widzi te same dane.
    const again = openStoreSafely({ dir, log: () => {} });
    expect(again.migration).toEqual({ migrated: false, reason: "already" });
    expect(again.store.readLeads("sms")).toHaveLength(2000);
    again.store.close();
  });

  it("przenosi stare listy blokad z cache.sqlite i łączy kanały", () => {
    const dir = tmp();
    const old = new DatabaseSync(path.join(dir, "cache.sqlite"));
    old.exec(
      "CREATE TABLE blacklist (phone TEXT PRIMARY KEY, added_at INTEGER NOT NULL); CREATE TABLE email_blacklist (email TEXT PRIMARY KEY, added_at INTEGER NOT NULL);",
    );
    old.prepare("INSERT INTO blacklist VALUES (?, ?)").run("601234567", 111);
    old
      .prepare("INSERT INTO email_blacklist VALUES (?, ?)")
      .run("Stop@Firma.pl", 222);
    old.close();
    write(dir, "leads.json", []);
    const { store, migration } = openStoreSafely({ dir, log: () => {} });
    expect(migration.counts.blocks).toBe(2);
    expect(store.suppression.isBlocked({ phone: "+48 601 234 567" })).toBe(
      true,
    );
    expect(store.suppression.isBlocked({ email: "stop@firma.pl" })).toBe(true);
    expect(
      store.suppression.isBlocked({ phone: "602345678", email: "ok@firma.pl" }),
    ).toBe(false);
    store.close();
  });

  it("uszkodzony plik przerywa migrację, niczego nie rusza i zostawia aplikację na plikach", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "leads.json"), '[{"id":"a","nazwa":"X"');
    write(dir, "sms-ledger.json", { "601234567": "t" });
    const opened = openStoreSafely({ dir, log: () => {} });
    expect(opened.state).toBe("json");
    expect(opened.error).toMatch(/leads\.json jest uszkodzony/);
    expect(fs.existsSync(path.join(dir, "leads.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "sms-ledger.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, DB_FILE))).toBe(false);
  });

  it("uszkodzona baza po migracji daje stan „broken”, a nie powrót do starych plików", () => {
    const dir = tmp();
    write(dir, "leads.json", sampleLeads(3));
    openStoreSafely({ dir, log: () => {} }).store.close();
    for (const suffix of ["", "-wal", "-shm"])
      fs.rmSync(path.join(dir, DB_FILE + suffix), { force: true });
    fs.writeFileSync(
      path.join(dir, DB_FILE),
      "to nie jest baza sqlite, tylko śmieci ".repeat(200),
    );
    const opened = openStoreSafely({ dir, log: () => {} });
    expect(opened.state).toBe("broken");
    expect(opened.store).toBeNull();
  });
});

describe("zapis leadów i dziennik zdarzeń", () => {
  it("zapisuje tylko różnice i notuje utworzenie, zmianę statusu, wysyłkę, odpowiedź i usunięcie", () => {
    let clock = 1000;
    const store = createStore({ dir: tmp(), now: () => clock });
    const rows = sampleLeads(3).map((l) => ({
      ...l,
      status: "nowy",
      sms_sent_at: null,
    }));
    expect(store.writeLeads("sms", rows)).toEqual({
      inserted: 3,
      updated: 0,
      deleted: 0,
    });
    expect(store.writeLeads("sms", store.readLeads("sms"))).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    });

    clock = 2000;
    const next = store.readLeads("sms");
    next[0] = {
      ...next[0],
      status: "wyslano_wiadomosc",
      sms_sent_at: "2026-03-01T09:00:00.000Z",
    };
    next[1] = {
      ...next[1],
      status: "odpisal",
      engaged_at: "2026-03-02T09:00:00.000Z",
      deal_value: 1490,
    };
    next.pop();
    expect(store.writeLeads("sms", next)).toEqual({
      inserted: 0,
      updated: 2,
      deleted: 1,
    });

    expect(
      store.events
        .forLead("sms", "lead-0")
        .map((e: { type: string }) => e.type),
    ).toEqual(["created", "status", "sms_sent"]);
    const second = store.events.forLead("sms", "lead-1");
    expect(second.map((e: { type: string }) => e.type)).toEqual([
      "created",
      "status",
      "replied",
      "deal_value",
    ]);
    expect(second[1]).toMatchObject({
      from_value: "nowy",
      to_value: "odpisal",
      at: 2000,
    });
    expect(
      store.events
        .forLead("sms", "lead-2")
        .map((e: { type: string }) => e.type),
    ).toEqual(["created", "deleted"]);
    store.close();
  });

  it("lead bez id albo z powtórzonym id dostaje nowy identyfikator zamiast zniknąć", () => {
    const store = createStore({ dir: tmp() });
    store.writeLeads("sms", [
      { id: "x", nazwa: "A" },
      { id: "x", nazwa: "B" },
      { nazwa: "C" },
    ]);
    const rows = store.readLeads("sms");
    expect(rows.map((r: { nazwa: string }) => r.nazwa)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(new Set(rows.map((r: { id: string }) => r.id)).size).toBe(3);
    store.close();
  });

  it("błąd w trakcie zapisu wycofuje całą transakcję", () => {
    const store = createStore({ dir: tmp() });
    store.writeLeads("sms", [{ id: "a", nazwa: "A" }]);
    const circular: Record<string, unknown> = { id: "b" };
    circular["self"] = circular;
    expect(() =>
      store.writeLeads("sms", [{ id: "a", nazwa: "ZMIENIONE" }, circular]),
    ).toThrow();
    expect(store.readLeads("sms")).toEqual([{ id: "a", nazwa: "A" }]);
    store.close();
  });
});

describe("wspólna lista blokad", () => {
  it("stare zapytania SQL działają na widokach, a blokada jednego kanału obejmuje drugi", () => {
    const store = createStore({ dir: tmp() });
    store.writeLeads("sms", [
      {
        id: "a",
        nazwa: "Firma",
        telefon: "601 234 567",
        email: "Biuro@Firma.pl",
      },
    ]);
    // Dokładnie te zapytania, których używa main.cjs i email.cjs.
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS email_blacklist (email TEXT PRIMARY KEY, added_at INTEGER NOT NULL)",
    );
    store.db
      .prepare("INSERT OR IGNORE INTO email_blacklist VALUES (?,?)")
      .run("biuro@firma.pl", 1);
    store.db
      .prepare("INSERT OR IGNORE INTO email_blacklist VALUES (?,?)")
      .run("biuro@firma.pl", 2);
    expect(store.db.prepare("SELECT email FROM email_blacklist").all()).toEqual(
      [{ email: "biuro@firma.pl" }],
    );
    // Rezygnacja e-mailem zablokowała też numer tej samej firmy.
    expect(store.db.prepare("SELECT phone FROM blacklist").all()).toEqual([
      { phone: "601234567" },
    ]);
    expect(
      store.db
        .prepare("SELECT 1 AS hit FROM blacklist WHERE phone = ?")
        .get("601234567"),
    ).toBeTruthy();

    store.suppression.add("domain", "Spamtrap.com", { reason: "skarga" });
    expect(store.suppression.isBlocked({ email: "kto@spamtrap.com" })).toBe(
      true,
    );
    store.suppression.add("phone", "+48 609 876 543", {
      reason: "odmowa",
      source: "auto",
    });
    expect(
      store.suppression
        .list("phone")
        .find((r: { value: string }) => r.value === "609876543"),
    ).toMatchObject({ reason: "odmowa", source: "auto" });
    store.close();
  });

  it("silnik e-mail działa na bazie: zapis, rynek, blokada i rejestr wysyłek", () => {
    const dir = tmp();
    const store = createStore({ dir });
    const file = (name: string) => path.join(dir, name);
    const settings: Record<string, unknown> = {};
    const engine = createEmailEngine({
      file,
      read: (f: string, fallback: unknown) =>
        store.handles(f) ? store.readFile(f) : (settings[f] ?? fallback),
      write: (f: string, value: unknown) =>
        store.handles(f) ? store.writeFile(f, value) : (settings[f] = value),
      db: () => store.db,
      changed: () => {},
      templates: () => ({}),
    });
    expect(
      engine.insert([
        {
          nazwa: "Miller Roofing",
          email: "info@millerroofing.com",
          market: "US",
        },
      ]),
    ).toEqual({ added: 1, skipped: 0 });
    expect(
      engine.insert([{ nazwa: "Duplikat", email: "INFO@millerroofing.com" }]),
    ).toEqual({ added: 0, skipped: 1 });
    engine.blacklist("info@millerroofing.com");
    expect(engine.blocked()).toEqual(["info@millerroofing.com"]);
    expect(engine.list()[0]).toMatchObject({
      status: "zablokowany",
      market: "US",
    });
    expect(
      engine.insert([{ nazwa: "Znowu", email: "info@millerroofing.com" }]),
    ).toEqual({ added: 0, skipped: 1 });
    expect(
      store.events
        .forLead("email", engine.list()[0].id)
        .map((e: { type: string }) => e.type),
    ).toEqual(["created", "status"]);
    store.writeFile(file("email-ledger.json"), {
      "info@millerroofing.com": "t1",
    });
    expect(store.readFile(file("email-ledger.json"))).toEqual({
      "info@millerroofing.com": "t1",
    });
    store.close();
  });
});

describe("kopie zapasowe", () => {
  it("kopia zawiera komplet danych, a starsze niż 7 ostatnich są usuwane", () => {
    const dir = tmp();
    let clock = Date.UTC(2026, 10, 1, 8, 0, 0);
    const store = createStore({ dir, now: () => clock });
    store.writeLeads("sms", sampleLeads(25));
    let last = "";
    for (let i = 0; i < 9; i++) {
      clock += 86400000;
      last = store.backup();
    }
    expect(store.listBackups()).toHaveLength(7);
    const copy = new DatabaseSync(last, { readOnly: true });
    expect(copy.prepare("SELECT COUNT(*) AS n FROM leads").get().n).toBe(25);
    copy.close();

    // Najwyżej jedna automatyczna kopia na dobę.
    expect(store.backupIfDue()).toBeNull();
    clock += 86400000 + 1;
    expect(store.backupIfDue()).toMatch(/leadfinder-\d{8}-\d{6}\.sqlite$/);
    expect(store.status()).toMatchObject({
      engine: "sqlite",
      backups: 7,
      leads: { sms: 25, email: 0 },
    });
    store.close();
  });
});
