import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createStore } = require("../../../electron/store.cjs");
const {
  createMarket,
  summarizeProbe,
  parseGeoName,
  probeCityFor,
  cityKey,
  hitRate,
  parseCensus,
} = require("../../../electron/market.cjs");
const rules = require("../../../market-rules.json");

const GEO = rules.census.geography;
const AREAS: Array<[string, string, number]> = [
  ["46140", "Tulsa, OK Metro Area", 1_020_000],
  ["19100", "Dallas-Fort Worth-Arlington, TX Metro Area", 7_800_000],
  ["49180", "Winston-Salem, NC Metro Area", 690_000],
  ["28140", "Kansas City, MO-KS Metro Area", 2_200_000],
  ["14580", "Bozeman, MT Micro Area", 120_000],
];
/** Udawany Census: liczba firm zależy od kodu branży i obszaru, żeby ranking miał co sortować. */
function fakeCensus(
  options: {
    requireKey?: boolean;
    failCodes?: string[];
    noPopulation?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const respond = (status: number, body: string) => ({
      ok: status < 300,
      status,
      text: async () => body,
    });
    if (options.requireKey && !u.searchParams.get("key"))
      return respond(
        403,
        "<html><body>A valid <b>key</b> must be included with each data API request.</body></html>",
      );
    if (u.pathname.endsWith("/acs/acs5")) {
      if (options.noPopulation) return respond(500, "boom");
      return respond(
        200,
        JSON.stringify([
          ["NAME", "B01003_001E", GEO],
          ...AREAS.map(([geo, name, pop]) => [name, String(pop), geo]),
        ]),
      );
    }
    const code = u.searchParams.get(rules.census.industryVariable) ?? "";
    if (options.failCodes?.includes(code)) return respond(500, "upstream");
    if (u.searchParams.get("for") === "us:*")
      return respond(
        200,
        JSON.stringify([
          ["ESTAB", "NAME", rules.census.industryVariable, "us"],
          ["21000", "United States", code, "1"],
        ]),
      );
    const base =
      code === "00"
        ? 20_000
        : Object.keys(rules.competitionNaics).includes(code)
          ? 60
          : 100 + (Number(code) % 97);
    const rows = AREAS.map(([geo, name, pop], i) => {
      // Tulsa ma mało agencji, Dallas dużo — do sprawdzenia poziomów konkurencji.
      const scale = pop / 1_000_000;
      const agencies = geo === "46140" ? 0.2 : geo === "19100" ? 3 : 1;
      const estab =
        Math.round(
          base *
            scale *
            (Object.keys(rules.competitionNaics).includes(code) ? agencies : 1),
        ) + i;
      return [
        String(estab),
        String(estab * 6),
        String(estab * 300),
        name,
        code,
        geo,
      ];
    });
    // Jeden obszar z danymi utajnionymi i jeden zdublowany wiersz (klasa wielkości) — parser ma to znieść.
    rows.push(["N", "N", "N", "Nowhere, ZZ Micro Area", code, "99999"]);
    rows.push(["3", "10", "100", AREAS[0]![1], code, AREAS[0]![0]]);
    return respond(
      200,
      JSON.stringify([
        ["ESTAB", "EMP", "PAYANN", "NAME", rules.census.industryVariable, GEO],
        ...rows,
      ]),
    );
  };
  return { fetchImpl, calls };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});
function setup(
  census = fakeCensus(),
  leads: Array<Record<string, unknown>> = [],
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lf-market-"));
  dirs.push(dir);
  const store = createStore({ dir });
  const files: Record<string, unknown> = {};
  const market = createMarket({
    db: () => store.db,
    read: (name: string, fallback: unknown) => files[name] ?? fallback,
    write: (name: string, value: unknown) => {
      files[name] = structuredClone(value);
      fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    },
    encrypt: (t: string) => `enc:${Buffer.from(t).toString("hex")}`,
    decrypt: (t: string) =>
      Buffer.from(t.replace(/^enc:/, ""), "hex").toString(),
    fetchImpl: census.fetchImpl,
    sleep: async () => {},
    emailLeads: () => leads,
  });
  return { dir, store, market, census, files };
}
const site = (patch: Record<string, unknown> = {}) => ({
  httpStatus: 200,
  hasSsl: true,
  hasMobileViewport: true,
  responseTimeMs: 300,
  copyrightYear: null,
  ...patch,
});
const sample = (hits: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({
    nazwa: `Firm ${i}`,
    website: `https://firm${i}.com`,
    tech_audit: site({ hasSsl: false }),
    email: i < hits ? `info@firm${i}.com` : null,
  }));

describe("rozpoznanie rynku: czyste funkcje", () => {
  it("czyta nazwy obszarów i wybiera miasto do próbki", () => {
    expect(
      parseGeoName("Dallas-Fort Worth-Arlington, TX Metro Area"),
    ).toMatchObject({
      kind: "metro",
      states: ["TX"],
      short: "Dallas-Fort Worth-Arlington, TX",
    });
    expect(parseGeoName("Kansas City, MO-KS Metro Area").states).toEqual([
      "MO",
      "KS",
    ]);
    expect(parseGeoName("Bozeman, MT Micro Area").kind).toBe("micro");
    expect(
      probeCityFor(parseGeoName("Dallas-Fort Worth-Arlington, TX Metro Area")),
    ).toBe("Dallas, TX");
    expect(probeCityFor(parseGeoName("Winston-Salem, NC Metro Area"))).toBe(
      "Winston-Salem, NC",
    );
    expect(cityKey(" Tulsa , OK ")).toBe("tulsa, ok");
    expect(cityKey("Tulsa")).toBeNull();
  });

  it("podsumowuje skan Map bez zgadywania", () => {
    const p = summarizeProbe([
      { website: null },
      { website: "https://facebook.com/firm" },
      { website: "https://firm.wixsite.com/home" },
      { website: "https://big.com", tech_audit: null },
      { website: "https://dead.com", tech_audit: site({ httpStatus: null }) },
      {
        website: "https://old.com",
        tech_audit: site({ hasSsl: false }),
        email: "info@old.com",
      },
      {
        website: "https://slow.com",
        tech_audit: site({ responseTimeMs: 9000 }),
      },
      { website: "https://good.com", tech_audit: site() },
    ]);
    expect(p).toEqual({
      sampled: 8,
      noSite: 1,
      socialOnly: 1,
      builder: 1,
      broken: 1,
      noSsl: 1,
      weak: 2,
      modern: 1,
      skipped: 1,
      withEmail: 1,
    });
    expect(summarizeProbe(null).sampled).toBe(0);
  });

  it("odsetek trafień: bez próbki to jawne założenie, z próbką pomiar z węższym przedziałem", () => {
    const none = hitRate({
      own: { sampled: 0, hits: 0 },
      niche: { sampled: 0, hits: 0 },
      all: { sampled: 0, hits: 0 },
    });
    expect(none.basis).toBe("zalozenie");
    expect(none.mean).toBeCloseTo(rules.scoring.assumedHitRate, 5);
    const measured = hitRate({
      own: { sampled: 40, hits: 12 },
      niche: { sampled: 0, hits: 0 },
      all: { sampled: 0, hits: 0 },
    });
    expect(measured.basis).toBe("pomiar");
    expect(measured.mean).toBeGreaterThan(0.25);
    expect(measured.mean).toBeLessThan(0.3);
    expect(measured.high - measured.low).toBeLessThan(
      none.high - none.low + 0.2,
    );
    expect(measured.low).toBeLessThan(measured.mean);
    expect(measured.high).toBeGreaterThan(measured.mean);
    const borrowed = hitRate({
      own: { sampled: 0, hits: 0 },
      niche: { sampled: 60, hits: 24 },
      all: { sampled: 0, hits: 0 },
    });
    expect(borrowed.basis).toBe("inne-miasta");
    expect(borrowed.mean).toBeGreaterThan(0.3);
  });

  it("parser Census odrzuca strony błędów", () => {
    expect(parseCensus('[["ESTAB","us"],["5","1"]]')).toEqual([
      { ESTAB: "5", us: "1" },
    ]);
    expect(parseCensus("<html>error</html>")).toBeNull();
    expect(parseCensus("")).toEqual([]);
  });
});

describe("rozpoznanie rynku: dane i ranking", () => {
  it("pobiera dane bez klucza, gdy Census go nie wymaga, i buduje ranking", async () => {
    const { market, census } = setup();
    expect(market.ranking().ready).toBe(false);
    const steps: string[] = [];
    const state = await market.refresh((p: { label: string }) =>
      steps.push(p.label),
    );
    expect(state.geos).toBe(5);
    expect(state.year).toBe(rules.census.cbpYear);
    expect(steps.at(-1)).toBe("Gotowe");
    expect(census.calls.every((u) => !u.includes("key="))).toBe(true);
    // Jedno zapytanie na kod branży + ludność, a nie jedno na miasto.
    expect(census.calls.length).toBeLessThan(30);

    const all = market.ranking({ limit: 200 });
    expect(all.ready).toBe(true);
    // Bez wybranej niszy jedno miasto nie może zająć całej listy: najwyżej trzy nisze na obszar.
    expect(all.rows.length).toBe(15);
    expect(all.total).toBeGreaterThan(60);
    const perGeo = new Map<string, number>();
    for (const r of all.rows) perGeo.set(r.geo, (perGeo.get(r.geo) ?? 0) + 1);
    expect(Math.max(...perGeo.values())).toBe(3);
    const roofing = market.ranking({ niche: "roofing", limit: 200 }).rows;
    const roofingTulsa = roofing.find(
      (r: { id: string }) => r.id === "roofing|46140",
    );
    // Zdublowany wiersz i utajniony obszar nie psują liczb.
    expect(roofingTulsa.firms).toBeGreaterThan(50);
    expect(roofingTulsa.place).toBe("Tulsa, OK");
    expect(roofingTulsa.probeCity).toBe("Tulsa, OK");
    expect(roofingTulsa.per100k).toBeGreaterThan(0);
    expect(roofingTulsa.payrollPerFirm).toBe(300_000);
    expect(roofingTulsa.hit.basis).toBe("zalozenie");
    expect(roofingTulsa.competition.level).toBe("low");
    expect(
      roofing.find((r: { id: string }) => r.id === "roofing|19100").competition
        .level,
    ).toBe("high");
    expect(roofing.some((r: { geo: string }) => r.geo === "99999")).toBe(false);
    // Sortowanie malejąco po potencjale.
    for (let i = 1; i < all.rows.length; i++)
      expect(all.rows[i - 1].potential).toBeGreaterThanOrEqual(
        all.rows[i].potential,
      );

    expect(
      market
        .ranking({ state: "KS" })
        .rows.every((r: { geo: string }) => r.geo === "28140"),
    ).toBe(true);
    expect(
      market
        .ranking({ niche: "septic" })
        .rows.every((r: { niche: string }) => r.niche === "septic"),
    ).toBe(true);
    expect(
      market
        .ranking({ lowCompetition: true })
        .rows.every(
          (r: { competition: { level: string } }) =>
            r.competition.level === "low",
        ),
    ).toBe(true);
    expect(all.recommended.length).toBeGreaterThan(0);
    expect(
      new Set(all.recommended.map((r: { niche: string }) => r.niche)).size,
    ).toBe(all.recommended.length);
  });

  it("bez klucza prosi o niego zrozumiale, a z kluczem nie zapisuje go jawnie", async () => {
    const { market, census, dir } = setup(fakeCensus({ requireKey: true }));
    await expect(market.refresh()).rejects.toThrow("bezpłatnego klucza");
    await expect(market.test()).rejects.toThrow("bezpłatnego klucza");
    expect(() => market.configure({ key: "za krótki" })).toThrow("40 liter");
    const secret = "abcdef0123456789abcdef0123456789abcdef01";
    expect(market.configure({ key: secret }).keyConfigured).toBe(true);
    expect(await market.test()).toEqual({ ok: true, firms: 21000 });
    await market.refresh();
    expect(census.calls.some((u) => u.includes(`key=${secret}`))).toBe(true);
    for (const f of fs.readdirSync(dir))
      if (fs.statSync(path.join(dir, f)).isFile())
        expect(
          fs.readFileSync(path.join(dir, f)).toString("latin1"),
        ).not.toContain(secret);
    expect(market.configure({ clearKey: true }).keyConfigured).toBe(false);
  });

  it("błąd jednej branży lub ludności nie zatrzymuje reszty", async () => {
    const { market } = setup(
      fakeCensus({
        failCodes: [rules.niches.septic.naics],
        noPopulation: true,
      }),
    );
    const state = await market.refresh();
    expect(state.notes.join(" ")).toContain(rules.niches.septic.naics);
    expect(state.notes.join(" ")).toContain("Ludność");
    const r = market.ranking({ limit: 200 });
    expect(r.rows.some((x: { niche: string }) => x.niche === "septic")).toBe(
      false,
    );
    expect(r.rows[0].per100k).toBeNull();
  });

  it("próbka zmienia ranking i jest pożyczana innym miastom tej samej niszy", async () => {
    const { market } = setup();
    await market.refresh();
    const before = market.ranking({ niche: "roofing", limit: 200 }).rows;
    const tulsaBefore = before.find((r: { geo: string }) => r.geo === "46140");
    expect(
      market.recordProbe({
        nicheId: "roofing",
        city: "Tulsa, OK",
        raw: sample(16, 40),
      }),
    ).toMatchObject({ sampled: 40, withEmail: 16 });
    expect(
      market.recordProbe({
        nicheId: "nie-ma",
        city: "Tulsa, OK",
        raw: sample(1, 2),
      }),
    ).toBeNull();
    expect(
      market.recordProbe({
        nicheId: "roofing",
        city: "Tulsa",
        raw: sample(1, 2),
      }),
    ).toBeNull();
    const after = market.ranking({ niche: "roofing", limit: 200 }).rows;
    const tulsa = after.find((r: { geo: string }) => r.geo === "46140");
    expect(tulsa.hit).toMatchObject({ basis: "pomiar", sampled: 40, hits: 16 });
    expect(tulsa.probe.noSsl).toBe(40);
    expect(tulsa.reachable.mean).toBeGreaterThan(
      tulsaBefore.reachable.mean * 2,
    );
    const dallas = after.find((r: { geo: string }) => r.geo === "19100");
    expect(dallas.hit.basis).toBe("inne-miasta");
    expect(dallas.hit.mean).toBeGreaterThan(0.2);
    // Inna nisza dostaje słabszą wskazówkę „z innych nisz”.
    const painting = market.ranking({ niche: "painting", limit: 200 }).rows[0];
    expect(painting.hit.basis).toBe("inne-nisze");
    // Druga próbka w tej samej komórce zastępuje pierwszą, a nie sumuje się z nią.
    market.recordProbe({
      nicheId: "roofing",
      city: "Tulsa, OK",
      raw: sample(2, 40),
    });
    const again = market
      .ranking({ niche: "roofing", limit: 200 })
      .rows.find((r: { geo: string }) => r.geo === "46140");
    expect(again.hit).toMatchObject({ sampled: 40, hits: 2 });
    // Zbadana komórka nie wraca do rekomendacji „co zbadać najpierw”.
    expect(
      market
        .ranking({ limit: 200 })
        .recommended.some((r: { id: string }) => r.id === "roofing|46140"),
    ).toBe(false);
  });

  it("dolicza wyniki prawdziwych kampanii do właściwej komórki", async () => {
    const leads = [
      ...Array.from({ length: 22 }, (_, i) => ({
        id: `l${i}`,
        kategoria: "Dekarze",
        miasto: "Tulsa, OK",
        email_sent_at: "2026-11-01T15:00:00Z",
        status:
          i < 3 ? "odpisal" : i === 3 ? "zablokowany" : "wyslano_wiadomosc",
      })),
      {
        id: "x1",
        kategoria: "Dekarze",
        miasto: "Tulsa, OK",
        email_sent_at: null,
        status: "nowy",
      },
      {
        id: "x2",
        kategoria: "Nieznana",
        miasto: "Tulsa, OK",
        email_sent_at: "2026-11-01T15:00:00Z",
        status: "odpisal",
      },
    ];
    const { market, store } = setup(fakeCensus(), leads);
    await market.refresh();
    store.db
      .prepare(
        "INSERT INTO messages (id, lead_kind, lead_id, channel, direction, address, subject, body, template_id, status, classification, at, meta) VALUES ('m1','email','l0','email','in','a@b.c',NULL,'Sure',NULL,'pending','zainteresowany',1,'{}')",
      )
      .run();
    store.db
      .prepare(
        "INSERT INTO messages (id, lead_kind, lead_id, channel, direction, address, subject, body, template_id, status, classification, at, meta) VALUES ('m2','email','l3','email','in','a@b.d',NULL,'No',NULL,'blocked','odmowa',1,'{}')",
      )
      .run();
    const row = market
      .ranking({ niche: "roofing", limit: 200 })
      .rows.find((r: { geo: string }) => r.geo === "46140");
    expect(row.campaign).toEqual({
      sent: 22,
      replies: 4,
      positive: 1,
      blocked: 1,
      sales: 0,
    });
    expect(row.verified).toBe(true);
    expect(
      market
        .ranking({ niche: "roofing", limit: 200 })
        .rows.find((r: { geo: string }) => r.geo === "19100").campaign,
    ).toBeNull();
  });

  it("prognoza sprzedaży: jawne założenia na starcie, potem własne wyniki", async () => {
    const { market } = setup();
    await market.refresh();
    const start = market.ranking({ niche: "roofing", limit: 200 });
    const tulsa = start.rows.find((r: { geo: string }) => r.geo === "46140");
    expect(start.own).toEqual({ sent: 0, positive: 0, sales: 0 });
    expect(tulsa.forecast.basis).toBe("zalozenie");
    expect(tulsa.forecast.positiveRate).toBeCloseTo(
      rules.forecast.positiveRate,
      5,
    );
    expect(tulsa.forecast.closeRate).toBeCloseTo(rules.forecast.closeRate, 5);
    // 1% × 15% = jedna sprzedaż na kilkaset e-maili; szansa to ułamek, nie pewność.
    expect(tulsa.forecast.emailsPerSale).toBeGreaterThan(300);
    expect(tulsa.forecast.emailsPerSale).toBeLessThan(1500);
    expect(tulsa.forecast.chance).toBeGreaterThan(0);
    expect(tulsa.forecast.chance).toBeLessThan(0.5);
    expect(tulsa.forecast.emails).toBeLessThanOrEqual(start.capacity);
    expect(tulsa.forecast.salesLow).toBeLessThanOrEqual(
      tulsa.forecast.expectedSales,
    );
    expect(tulsa.forecast.salesHigh).toBeGreaterThanOrEqual(
      tulsa.forecast.expectedSales,
    );
    // Ten sam stan danych daje tę samą liczbę (bez migotania przy odświeżeniu).
    expect(
      market
        .ranking({ niche: "roofing", limit: 200 })
        .rows.find((r: { geo: string }) => r.geo === "46140").forecast,
    ).toEqual(tulsa.forecast);
    // Większy rynek przy tych samych założeniach nie może mieć mniejszej szansy.
    const dallas = start.rows.find((r: { geo: string }) => r.geo === "19100");
    expect(dallas.forecast.chance).toBeGreaterThanOrEqual(
      tulsa.forecast.chance,
    );

    // Właściciel zmienia założenia: prognoza idzie za nimi.
    expect(() =>
      market.configure({
        forecast: { positiveRate: 0, closeRate: 0.2, priceUsd: 1500 },
      }),
    ).toThrow("większą od 0%");
    const tuned = market.configure({
      forecast: { positiveRate: 0.03, closeRate: 0.3, priceUsd: 2000 },
    });
    expect(tuned.forecast).toMatchObject({
      positiveRate: 0.03,
      closeRate: 0.3,
      priceUsd: 2000,
      custom: true,
    });
    const better = market
      .ranking({ niche: "roofing", limit: 200 })
      .rows.find((r: { geo: string }) => r.geo === "46140");
    expect(better.forecast.chance).toBeGreaterThan(tulsa.forecast.chance * 2);
    expect(market.configure({ resetForecast: true }).forecast.custom).toBe(
      false,
    );
  });

  it("prognoza uczy się z własnych kampanii i pożycza wynik innym miastom niszy", async () => {
    const leads = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      kategoria: "Dekarze",
      miasto: "Tulsa, OK",
      email_sent_at: "2026-11-01T15:00:00Z",
      status: i < 4 ? "sukces" : i < 16 ? "odpisal" : "wyslano_wiadomosc",
    }));
    const { market, store } = setup(fakeCensus(), leads);
    await market.refresh();
    const insert = store.db.prepare(
      "INSERT INTO messages (id, lead_kind, lead_id, channel, direction, address, subject, body, template_id, status, classification, at, meta) VALUES (?, 'email', ?, 'email', 'in', 'a@b.c', NULL, 'x', NULL, 'sent', 'cena', 1, '{}')",
    );
    for (let i = 4; i < 16; i++) insert.run(`m${i}`, `s${i}`);
    const r = market.ranking({ niche: "roofing", limit: 200 });
    expect(r.own).toEqual({ sent: 200, positive: 16, sales: 4 });
    const tulsa = r.rows.find((x: { geo: string }) => x.geo === "46140");
    expect(tulsa.campaign.sales).toBe(4);
    expect(tulsa.forecast.basis).toBe("pomiar");
    // 16 zainteresowanych na 200 wysłanych ciągnie odsetek mocno ponad założenie 1%.
    expect(tulsa.forecast.positiveRate).toBeGreaterThan(0.04);
    expect(tulsa.forecast.closeRate).toBeGreaterThan(0.18);
    const dallas = r.rows.find((x: { geo: string }) => x.geo === "19100");
    expect(dallas.forecast.basis).toBe("inne-miasta");
    expect(dallas.forecast.positiveRate).toBeGreaterThan(0.03);
    const painting = market.ranking({ niche: "painting", limit: 200 }).rows[0];
    expect(painting.forecast.basis).toBe("inne-nisze");
    expect(painting.forecast.positiveRate).toBeGreaterThan(
      rules.forecast.positiveRate,
    );
    expect(painting.forecast.positiveRate).toBeLessThan(
      dallas.forecast.positiveRate,
    );
  });
});
