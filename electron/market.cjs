/**
 * Rozpoznanie rynku: gdzie (miasto) i komu (nisza) opłaca się wysyłać ofertę.
 *
 * Trzy źródła, wszystkie bezpłatne:
 *  1. Census (urząd statystyczny USA) — liczba firm w branży i mieście, ludność,
 *     liczba lokalnych agencji (przybliżenie konkurencji).
 *  2. Własne próbki — każdy skan Snajpera zapisuje, ile firm miało słabą stronę
 *     i znaleziony e-mail. To jedyne źródło „odsetka trafień”; program go nie zgaduje.
 *  3. Własne kampanie — ile wysłano, ile odpowiedzi, ile zainteresowanych.
 *
 * Moduł nie zależy od Electrona. Zależności:
 *  db()                         → połączenie SQLite albo null
 *  read(name, fallback) / write(name, value) → plik ustawień
 *  encrypt / decrypt            → klucz Census (opcjonalny) trzymany tylko zaszyfrowany
 *  fetchImpl(url, init), now(), sleep(ms)
 *  emailLeads()                 → wiersze kanału e-mail (do wyników kampanii)
 */
const rules = require("../market-rules.json");
const countryRules = require("../country-rules.json");
const {
  isSocialUrl,
  isFreeBuilderUrl,
  isModernSite,
} = require("./sniper-audit.cjs");

const SETTINGS_FILE = "market-settings.json";
const US = countryRules.markets.US;
const NICHE_BY_ID = new Map(US.niches.map((n) => [n.id, n]));
const NICHE_BY_LABEL = new Map(US.niches.map((n) => [n.label, n]));
const DAY = 86_400_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS market_geo (
  geo TEXT PRIMARY KEY, name TEXT NOT NULL, population INTEGER
);
CREATE TABLE IF NOT EXISTS market_census (
  naics TEXT NOT NULL, geo TEXT NOT NULL, estab INTEGER NOT NULL,
  emp INTEGER, payann INTEGER, year INTEGER NOT NULL,
  PRIMARY KEY (naics, geo)
);
CREATE TABLE IF NOT EXISTS market_probe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  niche TEXT NOT NULL, city_key TEXT NOT NULL, at INTEGER NOT NULL,
  sampled INTEGER NOT NULL, no_site INTEGER NOT NULL, social_only INTEGER NOT NULL,
  builder INTEGER NOT NULL, broken INTEGER NOT NULL, no_ssl INTEGER NOT NULL,
  weak INTEGER NOT NULL, modern INTEGER NOT NULL, skipped INTEGER NOT NULL,
  with_email INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS market_probe_cell ON market_probe (niche, city_key, at);
`;

/* ------------------------------ czyste funkcje ------------------------------ */

/** „Tulsa, OK” → „tulsa, ok”. Zwraca null, gdy nie ma miasta i dwuliterowego stanu. */
function cityKey(value) {
  const m = String(value ?? "")
    .trim()
    .match(/^(.+?),\s*([A-Za-z]{2})\b/);
  return m ? `${m[1].trim().toLowerCase()}, ${m[2].toLowerCase()}` : null;
}

/** „Dallas-Fort Worth-Arlington, TX Metro Area” → miasta, stany, rodzaj obszaru. */
function parseGeoName(name) {
  const text = String(name ?? "");
  const kind = /Micro Area\s*$/i.test(text) ? "micro" : "metro";
  const bare = text.replace(
    /\s+(Metro|Micro)(politan Statistical)? Area\s*$/i,
    "",
  );
  const cut = bare.lastIndexOf(", ");
  const cities = (cut >= 0 ? bare.slice(0, cut) : bare).trim();
  const states = (cut >= 0 ? bare.slice(cut + 2) : "")
    .split("-")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  return {
    kind,
    cities,
    states,
    short: states.length ? `${cities}, ${states.join("-")}` : cities,
  };
}

function geoHasCity(parsed, city) {
  const hay = `-${parsed.cities.toLowerCase()}-`;
  return hay.includes(`-${String(city).toLowerCase()}-`);
}

/** Miasto, o które pytamy Mapy, gdy badamy cały obszar: pierwsze znane miasto z jego nazwy. */
function probeCityFor(parsed) {
  const state = parsed.states[0];
  if (!state) return null;
  const known = US.states.find((s) => s.code === state)?.cities ?? [];
  const hit = known.find((c) => geoHasCity(parsed, c));
  // Nazwa obszaru łączy miasta myślnikiem, więc miasta z myślnikiem w nazwie rozpoznajemy z listy.
  const hyphenated = rules.hyphenatedCities.find((c) =>
    parsed.cities.toLowerCase().startsWith(c.toLowerCase()),
  );
  const city = hit ?? hyphenated ?? parsed.cities.split(/-+/)[0];
  return `${city}, ${state}`;
}

/** Podsumowanie jednego skanu Map: co program zobaczył wśród znalezionych firm. */
function summarizeProbe(raw) {
  const out = {
    sampled: 0,
    noSite: 0,
    socialOnly: 0,
    builder: 0,
    broken: 0,
    noSsl: 0,
    weak: 0,
    modern: 0,
    skipped: 0,
    withEmail: 0,
  };
  for (const r of Array.isArray(raw) ? raw : []) {
    out.sampled++;
    if (r.email) out.withEmail++;
    if (!r.website) out.noSite++;
    else if (isSocialUrl(r.website)) out.socialOnly++;
    else if (isFreeBuilderUrl(r.website)) out.builder++;
    else if (!r.tech_audit)
      out.skipped++; // duża firma albo sieć — program jej nie audytuje
    else if (r.tech_audit.httpStatus === null || r.tech_audit.httpStatus >= 400)
      out.broken++;
    else if (isModernSite(r.tech_audit)) out.modern++;
    else {
      out.weak++;
      if (!r.tech_audit.hasSsl) out.noSsl++;
    }
  }
  return out;
}

/** Kwantyl rozkładu Beta(a, b) liczony całkowaniem na siatce (wystarczająco dokładny do przedziału w tabeli). */
function betaQuantile(a, b, q) {
  const steps = 600;
  const pdf = [];
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) / steps;
    const v = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
    pdf.push(v);
    total += v;
  }
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    acc += pdf[i];
    if (acc / total >= q) return (i + 0.5) / steps;
  }
  return 1;
}

/**
 * Odsetek trafień dla komórki nisza × miasto.
 * own   — ostatnia próbka w tej komórce
 * niche — suma próbek tej niszy w innych miastach
 * all   — suma wszystkich próbek
 * Bez żadnej próbki zostaje jawne założenie startowe z market-rules.json.
 */
function hitRate({ own, niche, all }) {
  const s = rules.scoring;
  const global =
    (all.hits + s.assumedStrength * s.assumedHitRate) /
    (all.sampled + s.assumedStrength);
  const pooled =
    (niche.hits + s.assumedStrength * global) /
    (niche.sampled + s.assumedStrength);
  const strength = Math.min(
    s.poolStrength,
    s.assumedStrength + niche.sampled + all.sampled / 4,
  );
  const a = pooled * strength + own.hits;
  const b = (1 - pooled) * strength + (own.sampled - own.hits);
  const basis =
    own.sampled > 0
      ? "pomiar"
      : niche.sampled > 0
        ? "inne-miasta"
        : all.sampled > 0
          ? "inne-nisze"
          : "zalozenie";
  return {
    mean: a / (a + b),
    low: betaQuantile(a, b, s.interval[0]),
    high: betaQuantile(a, b, s.interval[1]),
    basis,
    sampled: own.sampled,
    hits: own.hits,
  };
}

/** Odpowiedź Census: tablica tablic z nagłówkiem w pierwszym wierszu. */
function parseCensus(text) {
  const body = String(text ?? "").trim();
  if (!body) return [];
  if (!body.startsWith("[")) return null;
  let rows;
  try {
    rows = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) return null;
  const header = rows[0].map(String);
  return rows
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/* --------------------------------- moduł --------------------------------- */

function createMarket(d) {
  const now = d.now ?? (() => Date.now());
  const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let ready = false;
  let running = false;
  const conn = () => {
    const db = d.db();
    if (!db)
      throw new Error("Rozpoznanie rynku wymaga działającej bazy danych.");
    if (!ready) {
      db.exec(SCHEMA);
      ready = true;
    }
    return db;
  };
  const raw = () => d.read(SETTINGS_FILE, {});

  function settings() {
    const s = raw();
    let counts = { geos: 0, cells: 0, probes: 0 };
    try {
      const db = conn();
      counts = {
        geos: Number(
          db.prepare("SELECT COUNT(*) AS n FROM market_geo").get().n,
        ),
        cells: Number(
          db.prepare("SELECT COUNT(*) AS n FROM market_census").get().n,
        ),
        probes: Number(
          db.prepare("SELECT COUNT(*) AS n FROM market_probe").get().n,
        ),
      };
    } catch {
      /* baza niedostępna — liczniki zostają puste */
    }
    return {
      keyConfigured: Boolean(s.encryptedKey),
      fetchedAt: s.fetchedAt ?? null,
      year: s.year ?? null,
      notes: Array.isArray(s.notes) ? s.notes : [],
      keySignupUrl: rules.census.keySignupUrl,
      ...counts,
    };
  }

  function configure(value = {}) {
    const s = raw();
    if (value.clearKey) delete s.encryptedKey;
    const key = String(value.key ?? "").trim();
    if (key) {
      if (!/^[A-Za-z0-9]{20,64}$/.test(key))
        throw new Error(
          "Klucz Census to ciąg 40 liter i cyfr z e-maila od Census.",
        );
      s.encryptedKey = d.encrypt(key);
    }
    d.write(SETTINGS_FILE, s);
    return settings();
  }

  /* ------------------------------- Census ------------------------------- */

  async function census(path, query) {
    const s = raw();
    const key = s.encryptedKey ? d.decrypt(s.encryptedKey) : "";
    const url = `${rules.census.base}/${path}?${query}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
    const scrub = (t) => (key ? String(t).split(key).join("***") : String(t));
    let res;
    try {
      res = await d.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(rules.census.timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `Nie udało się połączyć z Census: ${scrub(err?.message || err)}`,
      );
    }
    const text = await res.text();
    if (res.status === 204) return [];
    const rows = res.ok ? parseCensus(text) : null;
    if (rows) return rows;
    const plain = scrub(
      text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ).slice(0, 160);
    const err = new Error(
      /key/i.test(plain) || res.status === 401 || res.status === 403
        ? key
          ? `Census odrzucił klucz. Sprawdź, czy został aktywowany linkiem z e-maila. (${plain || res.status})`
          : "Census wymaga bezpłatnego klucza. Zamów go e-mailem (link poniżej) i wklej w ustawieniach rozpoznania."
        : `Census odpowiedział błędem ${res.status}: ${plain || "brak treści"}`,
    );
    err.status = res.status;
    err.needsKey =
      !key && (/key/i.test(plain) || res.status === 401 || res.status === 403);
    throw err;
  }

  const geoClause = `for=${rules.census.geography.replace(/ /g, "%20")}:*`;
  const cbpQuery = (code) =>
    `get=ESTAB,EMP,PAYANN,NAME&${geoClause}&${rules.census.industryVariable}=${code}`;

  async function test() {
    const rows = await census(
      `${rules.census.cbpYear}/cbp`,
      `get=ESTAB,NAME&for=us:*&${rules.census.industryVariable}=${rules.niches.roofing.naics}`,
    );
    const firms = Math.max(0, ...rows.map((r) => toInt(r.ESTAB) ?? 0));
    if (!firms)
      throw new Error(
        "Census odpowiedział, ale bez liczby firm. Format danych mógł się zmienić.",
      );
    return { ok: true, firms };
  }

  /** Pobiera liczbę firm dla wszystkich nisz i obszarów. Około 25 zapytań, raz na rok wystarczy. */
  async function refresh(progress = () => {}) {
    if (running) throw new Error("Pobieranie danych już trwa.");
    running = true;
    try {
      const db = conn();
      const codes = [
        ...new Set([
          rules.totalNaics,
          ...Object.keys(rules.competitionNaics),
          ...Object.values(rules.niches).map((n) => n.naics),
        ]),
      ];
      const total = codes.length + 1;
      const notes = [];
      let year = rules.census.cbpYear;
      const upsertGeo = db.prepare(
        "INSERT INTO market_geo (geo, name, population) VALUES (?, ?, ?) ON CONFLICT(geo) DO UPDATE SET name = excluded.name, population = COALESCE(excluded.population, market_geo.population)",
      );
      const insert = db.prepare(
        "INSERT OR REPLACE INTO market_census (naics, geo, estab, emp, payann, year) VALUES (?, ?, ?, ?, ?, ?)",
      );
      const clear = db.prepare("DELETE FROM market_census WHERE naics = ?");
      const geoOf = (r) => String(r[rules.census.geography] ?? "");
      let cells = 0;

      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        progress({ index: i, total, label: `Liczba firm: kod branży ${code}` });
        let rows;
        try {
          rows = await census(`${year}/cbp`, cbpQuery(code));
        } catch (err) {
          // Pierwsze zapytanie decyduje: brak klucza przerywa, a brak rocznika próbuje poprzedni.
          if (i > 0 || err.needsKey || year === rules.census.cbpFallbackYear) {
            if (i === 0) throw err;
            notes.push(`Kod ${code}: ${String(err.message).slice(0, 120)}`);
            continue;
          }
          year = rules.census.cbpFallbackYear;
          rows = await census(`${year}/cbp`, cbpQuery(code));
        }
        // Gdy Census zwróci kilka wierszy na obszar (np. klasy wielkości), bierzemy wiersz łączny, czyli największy.
        const best = new Map();
        for (const r of rows) {
          const geo = geoOf(r);
          const estab = toInt(r.ESTAB);
          if (!geo || estab === null) continue;
          if (!best.has(geo) || estab > best.get(geo).estab)
            best.set(geo, {
              estab,
              emp: toInt(r.EMP),
              payann: toInt(r.PAYANN),
              name: String(r.NAME ?? geo),
            });
        }
        db.exec("BEGIN");
        try {
          clear.run(code);
          for (const [geo, v] of best) {
            insert.run(code, geo, v.estab, v.emp, v.payann, year);
            upsertGeo.run(geo, v.name, null);
          }
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
        cells += best.size;
        if (i < codes.length - 1) await sleep(rules.census.pauseMs);
      }

      progress({ index: codes.length, total, label: "Ludność obszarów" });
      try {
        const rows = await census(
          `${rules.census.populationYear}/acs/acs5`,
          `get=NAME,B01003_001E&${geoClause}`,
        );
        db.exec("BEGIN");
        for (const r of rows) {
          const geo = geoOf(r);
          const population = toInt(r.B01003_001E);
          if (geo && population)
            db.prepare(
              "UPDATE market_geo SET population = ? WHERE geo = ?",
            ).run(population, geo);
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* transakcja nie była otwarta */
        }
        notes.push(
          `Ludność: ${String(err.message).slice(0, 120)}. Ranking działa bez kolumny „na 100 tys.”.`,
        );
      }
      if (!cells)
        throw new Error("Census nie zwrócił żadnych danych o firmach.");
      d.write(SETTINGS_FILE, { ...raw(), fetchedAt: now(), year, notes });
      progress({ index: total, total, label: "Gotowe" });
      return settings();
    } finally {
      running = false;
    }
  }

  /* -------------------------------- próbki -------------------------------- */

  /** Zapisuje wynik skanu Map jako próbkę. Wołane po każdym skanie Snajpera USA i po „Zbadaj próbką”. */
  function recordProbe({ nicheId, city, raw: rows, at }) {
    const key = cityKey(city);
    if (!NICHE_BY_ID.has(nicheId) || !key) return null;
    const p = summarizeProbe(rows);
    if (!p.sampled) return null;
    conn()
      .prepare(
        "INSERT INTO market_probe (niche, city_key, at, sampled, no_site, social_only, builder, broken, no_ssl, weak, modern, skipped, with_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        nicheId,
        key,
        Number(at) || now(),
        p.sampled,
        p.noSite,
        p.socialOnly,
        p.builder,
        p.broken,
        p.noSsl,
        p.weak,
        p.modern,
        p.skipped,
        p.withEmail,
      );
    return { nicheId, cityKey: key, ...p };
  }

  /* ------------------------------- ranking ------------------------------- */

  function loadGeos(db) {
    const geos = new Map();
    for (const g of db
      .prepare("SELECT geo, name, population FROM market_geo")
      .all()) {
      const parsed = parseGeoName(g.name);
      geos.set(g.geo, {
        geo: g.geo,
        name: g.name,
        population: g.population ? Number(g.population) : null,
        ...parsed,
        probeCity: probeCityFor(parsed),
      });
    }
    return geos;
  }

  function resolveCity(geos, key) {
    if (!key) return null;
    const [city, state] = key.split(", ");
    let best = null;
    for (const g of geos.values()) {
      if (!g.states.includes(state.toUpperCase()) || !geoHasCity(g, city))
        continue;
      if (!best || (g.kind === "metro" && best.kind !== "metro")) best = g;
    }
    return best?.geo ?? null;
  }

  function campaignStats(db, geos) {
    const stats = new Map();
    let leads = [];
    try {
      leads = d.emailLeads?.() ?? [];
    } catch {
      leads = [];
    }
    if (!leads.length) return stats;
    const marks = rules.positiveReplies.map(() => "?").join(",");
    let positive = new Set();
    try {
      positive = new Set(
        db
          .prepare(
            `SELECT DISTINCT lead_id FROM messages WHERE channel = 'email' AND direction = 'in' AND classification IN (${marks})`,
          )
          .all(...rules.positiveReplies)
          .map((r) => r.lead_id),
      );
    } catch {
      /* tabela wiadomości może nie istnieć w starszej bazie */
    }
    const geoCache = new Map();
    for (const l of leads) {
      if (!l.email_sent_at) continue;
      const niche = NICHE_BY_LABEL.get(l.kategoria)?.id;
      const key = cityKey(l.miasto);
      if (!niche || !key) continue;
      if (!geoCache.has(key)) geoCache.set(key, resolveCity(geos, key));
      const geo = geoCache.get(key);
      if (!geo) continue;
      const id = `${niche}|${geo}`;
      const s = stats.get(id) ?? {
        sent: 0,
        replies: 0,
        positive: 0,
        blocked: 0,
      };
      s.sent++;
      if (l.engaged_at || l.status === "odpisal" || l.status === "zablokowany")
        s.replies++;
      if (positive.has(l.id)) s.positive++;
      if (l.status === "zablokowany") s.blocked++;
      stats.set(id, s);
    }
    return stats;
  }

  function ranking(filter = {}) {
    const db = conn();
    const s = rules.scoring;
    const geos = loadGeos(db);
    const meta = settings();
    if (!geos.size)
      return {
        ready: false,
        ...meta,
        rows: [],
        recommended: [],
        limits: rules.limits,
        total: 0,
      };

    const byNaics = new Map();
    for (const r of db
      .prepare("SELECT naics, geo, estab, emp, payann FROM market_census")
      .all()) {
      if (!byNaics.has(r.naics)) byNaics.set(r.naics, new Map());
      byNaics.get(r.naics).set(r.geo, {
        estab: Number(r.estab),
        emp: r.emp === null ? null : Number(r.emp),
        payann: r.payann === null ? null : Number(r.payann),
      });
    }

    // Konkurencja: lokalne agencje i studia na 1000 firm, podzielone na trzy równe grupy obszarów.
    const totals = byNaics.get(rules.totalNaics) ?? new Map();
    const competition = new Map();
    for (const [geo, t] of totals) {
      if (!t.estab) continue;
      let agencies = 0;
      for (const code of Object.keys(rules.competitionNaics))
        agencies += byNaics.get(code)?.get(geo)?.estab ?? 0;
      competition.set(geo, (agencies / t.estab) * 1000);
    }
    const sorted = [...competition.values()].sort((a, b) => a - b);
    const cutLow = sorted[Math.floor(sorted.length / 3)] ?? 0;
    const cutHigh = sorted[Math.floor((sorted.length * 2) / 3)] ?? 0;
    const levelOf = (index) =>
      index === undefined
        ? null
        : index <= cutLow
          ? "low"
          : index <= cutHigh
            ? "mid"
            : "high";

    // Próbki: w każdej komórce liczy się tylko ostatnia, żeby te same firmy nie były liczone dwa razy.
    const fresh = now() - s.probeStaleDays * DAY;
    const latest = new Map();
    const geoCache = new Map();
    for (const p of db
      .prepare("SELECT * FROM market_probe WHERE at >= ? ORDER BY at")
      .all(fresh)) {
      if (!geoCache.has(p.city_key))
        geoCache.set(p.city_key, resolveCity(geos, p.city_key));
      const geo = geoCache.get(p.city_key);
      if (!geo) continue;
      latest.set(`${p.niche}|${geo}`, { ...p, geo });
    }
    const pool = { all: { sampled: 0, hits: 0 }, niche: new Map() };
    for (const p of latest.values()) {
      pool.all.sampled += Number(p.sampled);
      pool.all.hits += Number(p.with_email);
      const n = pool.niche.get(p.niche) ?? { sampled: 0, hits: 0 };
      n.sampled += Number(p.sampled);
      n.hits += Number(p.with_email);
      pool.niche.set(p.niche, n);
    }

    const campaigns = campaignStats(db, geos);
    const wantState = filter.state ? String(filter.state).toUpperCase() : null;
    const minFirms = Math.max(1, Number(filter.minFirms) || s.minFirms);
    const rows = [];
    for (const niche of US.niches) {
      if (filter.niche && filter.niche !== niche.id) continue;
      const spec = rules.niches[niche.id];
      const firms = spec ? byNaics.get(spec.naics) : null;
      if (!firms) continue;
      for (const [geo, f] of firms) {
        const g = geos.get(geo);
        if (!g || f.estab < minFirms) continue;
        if (wantState && !g.states.includes(wantState)) continue;
        const index = competition.get(geo);
        const level = levelOf(index);
        if (filter.lowCompetition && level !== "low") continue;
        const id = `${niche.id}|${geo}`;
        const own = latest.get(id);
        const nichePool = pool.niche.get(niche.id) ?? { sampled: 0, hits: 0 };
        const ownStats = own
          ? { sampled: Number(own.sampled), hits: Number(own.with_email) }
          : { sampled: 0, hits: 0 };
        const hit = hitRate({
          own: ownStats,
          niche: {
            sampled: nichePool.sampled - ownStats.sampled,
            hits: nichePool.hits - ownStats.hits,
          },
          all: {
            sampled: pool.all.sampled - nichePool.sampled,
            hits: pool.all.hits - nichePool.hits,
          },
        });
        const factor = level ? s.competitionFactor[level] : 1;
        const campaign = campaigns.get(id) ?? null;
        rows.push({
          id,
          niche: niche.id,
          nicheLabel: niche.label,
          geo,
          place: g.short,
          kind: g.kind,
          states: g.states,
          probeCity: g.probeCity,
          firms: f.estab,
          per100k: g.population
            ? Math.round((f.estab / g.population) * 100_000 * 10) / 10
            : null,
          payrollPerFirm:
            f.payann !== null && f.estab
              ? Math.round((f.payann * 1000) / f.estab)
              : null,
          competition:
            index === undefined
              ? null
              : { index: Math.round(index * 10) / 10, level },
          hit: { ...hit, at: own ? Number(own.at) : null },
          probe: own
            ? {
                sampled: Number(own.sampled),
                noSite: Number(own.no_site),
                socialOnly: Number(own.social_only),
                builder: Number(own.builder),
                broken: Number(own.broken),
                noSsl: Number(own.no_ssl),
                weak: Number(own.weak),
                modern: Number(own.modern),
                skipped: Number(own.skipped),
                withEmail: Number(own.with_email),
              }
            : null,
          reachable: {
            mean: Math.round(f.estab * hit.mean),
            low: Math.round(f.estab * hit.low),
            high: Math.round(f.estab * hit.high),
          },
          potential: Math.round(f.estab * hit.mean * factor),
          optimistic: Math.round(f.estab * hit.high * factor),
          campaign,
          verified: Boolean(campaign && campaign.sent >= s.verifiedAfterSent),
          exact: spec.exact,
          note: spec.note ?? null,
        });
      }
    }
    rows.sort((a, b) => b.potential - a.potential || b.firms - a.firms);

    // Co zbadać najpierw: komórki bez własnej próbki o najwyższym optymistycznym potencjale, po jednej na niszę i obszar.
    const recommended = [];
    const seenNiche = new Set();
    const seenGeo = new Set();
    const candidates = rows.filter(
      (x) => x.hit.basis !== "pomiar" && x.probeCity,
    );
    // Najpierw miejsca bez wysokiej konkurencji; dopiero gdy ich nie ma, wszystkie.
    const calm = candidates.filter((x) => x.competition?.level !== "high");
    for (const r of (calm.length ? calm : candidates).sort(
      (a, b) => b.optimistic - a.optimistic,
    )) {
      if (seenNiche.has(r.niche) || seenGeo.has(r.geo)) continue;
      seenNiche.add(r.niche);
      seenGeo.add(r.geo);
      recommended.push(r);
      if (recommended.length >= 3) break;
    }
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 50));
    // Bez wybranej niszy pokazujemy najwyżej kilka nisz na obszar, żeby jedno duże miasto nie zajęło całej listy.
    const perGeo = filter.niche ? Infinity : s.maxPerGeo;
    const shown = new Map();
    const listed = rows.filter((r) => {
      const n = (shown.get(r.geo) ?? 0) + 1;
      shown.set(r.geo, n);
      return n <= perGeo;
    });
    return {
      ready: true,
      ...meta,
      rows: listed.slice(0, limit),
      recommended,
      limits: rules.limits,
      total: rows.length,
    };
  }

  return {
    settings,
    configure,
    test,
    refresh,
    recordProbe,
    ranking,
    isRunning: () => running,
  };
}

module.exports = {
  createMarket,
  summarizeProbe,
  parseGeoName,
  probeCityFor,
  cityKey,
  hitRate,
  betaQuantile,
  parseCensus,
};
