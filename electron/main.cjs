// LeadFinder B2B — proces główny Electron (macOS)
// Aplikacja działa w pełni lokalnie: interfejs z folderu dist/client,
// dane w plikach JSON na dysku, zapytania do Google Places bezpośrednio z komputera.
const { app, BrowserWindow, ipcMain, Menu, Notification, powerSaveBlocker, safeStorage, screen, shell, nativeTheme } = require("electron");
const { secondaryDisplay, animateWindowToSecondaryDisplay } = require("./window-motion.cjs");
const { createAutopilot } = require("./autopilot.cjs");
const { createOutreach } = require("./outreach.cjs");
const { createMarket } = require("./market.cjs");
const countryRules = require("../country-rules.json");
const { collectOffers, offerDetail } = require("./olx-results.cjs");
const { createSniperScanner } = require("./sniper-audit.cjs");
const { openStoreSafely, LEAD_FILES, LEDGER_FILES } = require("./store.cjs");
const { classifyRules, BLOCKING: BLOCKING_REPLIES } = require("./inbox.cjs");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { parsePhoneNumberFromString } = require("libphonenumber-js/max");
const Bottleneck = require("bottleneck");
const { createSpeedClock } = require("./sms-speed.cjs");
const cheerio = require("cheerio");
const dns = require("dns").promises;

// Biblioteki open-source z GitHuba — ładowane opcjonalnie, żeby aplikacja
// działała nawet gdy któraś paczka się nie załaduje (fallback na natywne DNS).
let whoisJson = null;
try { whoisJson = require("whois-json"); } catch { /* fallback: dns.resolveNs */ }
let deepEmailValidator = null;
try { deepEmailValidator = require("deep-email-validator"); } catch { /* fallback: dns.resolveMx */ }
let FingerprintGenerator = null;
let FingerprintInjector = null;
try {
  ({ FingerprintGenerator } = require("fingerprint-generator"));
  ({ FingerprintInjector } = require("fingerprint-injector"));
} catch { /* fallback: własna rotacja UA + usunięcie navigator.webdriver */ }

const CLIENT_DIR = path.join(__dirname, "..", "dist", "client");
const SHELL = path.join(CLIENT_DIR, "_shell.html");

// ---------- walidacja polskich numerów komórkowych (libphonenumber-js) ----------
// SMS-y docierają tylko na komórki — numery stacjonarne i błędne odrzucamy na wejściu.
const MOBILE_PREFIXES = ["45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88"];

function validatePolishMobile(rawPhone) {
  const invalid = { isValidMobile: false, formatted: null, nineDigits: null };
  const raw = String(rawPhone ?? "").trim();
  if (!raw) return invalid;
  const parsed = parsePhoneNumberFromString(raw, "PL");
  if (!parsed || !parsed.isValid()) return invalid;
  const type = parsed.getType();
  if (type === "FIXED_LINE") return invalid; // stacjonarny — SMS nie dojdzie
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") return invalid;
  const nine = String(parsed.nationalNumber).replace(/\D/g, "");
  if (nine.length !== 9 || !MOBILE_PREFIXES.includes(nine.slice(0, 2))) return invalid;
  return { isValidMobile: true, formatted: parsed.number, nineDigits: nine };
}

// ---------- lokalne przechowywanie ----------

function dataFile(name) {
  return path.join(app.getPath("userData"), name);
}

// Baza SQLite (electron/store.cjs) przejmuje leady, rejestry wysyłek i listy blokad.
// Otwierana leniwie przy pierwszym odczycie danych; przy pierwszym uruchomieniu
// przenosi dane z plików JSON (z kopią zapasową).
let storeHandle = null;
function dataStore() {
  if (!storeHandle) {
    storeHandle = openStoreSafely({ dir: app.getPath("userData") });
    if (storeHandle.state === "sqlite" && storeHandle.migration?.migrated) {
      console.log("Dane przeniesione do bazy SQLite:", JSON.stringify(storeHandle.migration.counts));
    }
  }
  return storeHandle;
}
const STORE_BROKEN_MESSAGE =
  "Baza danych LeadFinder jest niedostępna. Zamknij aplikację i uruchom ją ponownie; jeśli błąd wraca, przywróć kopię z folderu „backups”. Wysyłka jest wstrzymana, żeby nikt nie dostał wiadomości dwa razy.";

/** Czy ten plik jest obsługiwany przez bazę. W stanie „broken” rzuca błąd zamiast wracać do starych plików. */
function storeFor(file) {
  const name = path.basename(String(file));
  if (!(name in LEAD_FILES) && !(name in LEDGER_FILES)) return null;
  const handle = dataStore();
  if (handle.state === "broken") throw new Error(`${STORE_BROKEN_MESSAGE} (${handle.error})`);
  return handle.state === "sqlite" ? handle.store : null;
}

function readJson(file, fallback) {
  const store = storeFor(file);
  if (store) return store.readFile(file);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const store = storeFor(file);
  if (store) return store.writeFile(file, value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

const readSettings = () => ({ googleApiKey: "", ceidgApiKey: "", ...readJson(dataFile("settings.json"), {}) });
const readLeads = () => readJson(dataFile("leads.json"), []);
const writeLeads = (rows) => writeJson(dataFile("leads.json"), rows);

// Wirtualny świat: sprawdzian na udawanej poczcie i udawanych firmach, w osobnym folderze tymczasowym.
// Nie dotyka danych właściciela ani prawdziwej skrzynki (wszystkie połączenia są podstawione).
let simulationRunning = false;
ipcMain.handle("simulation:run", async (_event, seed) => {
  if (simulationRunning) throw new Error("Sprawdzian już trwa.");
  simulationRunning = true;
  try {
    const { runSimulation } = require("./simulation.cjs");
    return await runSimulation({ seed: Math.max(1, Math.round(Number(seed)) || 1), guardNetwork: false });
  } finally {
    simulationRunning = false;
  }
});

// Stan bazy danych dla widoku Ustawień.
ipcMain.handle("store:status", () => {
  const handle = dataStore();
  if (handle.state !== "sqlite") return { engine: handle.state, error: handle.error ?? null };
  return { ...handle.store.status(), error: null };
});
ipcMain.handle("store:backup", () => {
  const handle = dataStore();
  if (handle.state !== "sqlite") throw new Error("Kopia zapasowa wymaga działającej bazy danych.");
  const file = handle.store.backup();
  return { file, ...handle.store.status() };
});
ipcMain.handle("store:openBackups", () => {
  const dir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle("store:events", (_e, kind, id) => {
  const handle = dataStore();
  if (handle.state !== "sqlite") return [];
  return id ? handle.store.events.forLead(kind === "email" ? "email" : "sms", String(id)) : handle.store.events.recent(100);
});

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (_e, value) => {
  writeJson(dataFile("settings.json"), {
    ...readSettings(),
    ...(value?.googleApiKey !== undefined ? { googleApiKey: String(value.googleApiKey) } : {}),
    ...(value?.ceidgApiKey !== undefined ? { ceidgApiKey: String(value.ceidgApiKey).trim() } : {}),
  });
  return true;
});

ipcMain.handle("leads:list", () =>
  readLeads().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
);

ipcMain.handle("leads:insert", (_e, rows) => {
  const all = readLeads();
  const now = new Date().toISOString();
  for (const row of rows ?? []) {
    all.push({
      id: randomUUID(),
      created_at: now,
      zrodlo: "Google Maps",
      status: "nowy",
      notatki: null,
      oferta: null,
      sms_sent_at: null,
      engaged_at: null,
      closed_at: null,
      deal_value: 0,
      ...row,
    });
  }
  writeLeads(all);
  return true;
});

ipcMain.handle("leads:update", (_e, id, patch) => {
  const all = readLeads().map((l) => {
    if (l.id !== id) return l;
    const next = { ...l, ...patch };
    if (patch && patch.status && patch.status !== l.status) next.status_changed_at = new Date().toISOString();
    return next;
  });
  writeLeads(all);
  return true;
});

ipcMain.handle("leads:remove", (_e, id) => {
  writeLeads(readLeads().filter((l) => l.id !== id));
  return true;
});

// Kopia zapasowa i przywracanie całej bazy.
ipcMain.handle("leads:replaceAll", (_e, rows) => {
  writeLeads(Array.isArray(rows) ? rows : []);
  return true;
});

// Wyczyszczenie całej bazy leadów (potwierdzane w interfejsie).
ipcMain.handle("leads:deleteAll", () => {
  try {
    const removed = readLeads().length;
    writeLeads([]);
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, removed: 0, error: String(err?.message || err) };
  }
});

// ---------- ustawienia interfejsu (szablony, licznik, statystyki mapy) ----------

const PREFS_FILE = () => dataFile("prefs.json");

ipcMain.handle("prefs:get", () => readJson(PREFS_FILE(), {}));
ipcMain.handle("prefs:set", (_e, values) => {
  writeJson(PREFS_FILE(), values && typeof values === "object" ? values : {});
  return true;
});

// ---------- pamięć podręczna wyników (SQLite wbudowany w Electrona) ----------

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dni
let db = null;
let dbFailed = false;
let cacheHits = 0;

// Baza jest opcjonalna: gdy macOS nie pozwoli zapisać pliku, aplikacja działa dalej bez cache.
function cacheDb() {
  if (db || dbFailed) return db;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const file = dataFile("cache.sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        query_key TEXT PRIMARY KEY,
        city TEXT,
        json_response TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS search_cache_created_at ON search_cache (created_at);
      CREATE TABLE IF NOT EXISTS blacklist (
        phone TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL
      );
    `);
  } catch (err) {
    dbFailed = true;
    db = null;
    console.warn("Pamięć podręczna wyłączona (brak dostępu do pliku bazy):", String(err?.message || err));
  }
  return db;
}

/**
 * Połączenie z listami blokad („blacklist”, „email_blacklist”). Po migracji to
 * widoki na wspólną tabelę suppression w głównej bazie; bez bazy zostaje stary
 * plik cache. W stanie „broken” zwraca null — brak listy blokad wstrzymuje wysyłkę.
 */
function blockDb() {
  const handle = dataStore();
  if (handle.state === "sqlite") return handle.store.db;
  if (handle.state === "broken") return null;
  return cacheDb();
}

function cacheRead(key) {
  const conn = cacheDb();
  if (!conn) return null;
  try {
    const row = conn
      .prepare("SELECT json_response, created_at FROM search_cache WHERE query_key = ?")
      .get(key);
    if (!row) return null;
    if (Date.now() - Number(row.created_at) > CACHE_TTL_MS) {
      conn.prepare("DELETE FROM search_cache WHERE query_key = ?").run(key);
      return null;
    }
    return JSON.parse(row.json_response);
  } catch (err) {
    console.warn("Nie udało się odczytać pamięci podręcznej:", String(err?.message || err));
    return null;
  }
}

function cacheWrite(key, city, json) {
  const conn = cacheDb();
  if (!conn) return;
  // zapis w tle — nie blokuje odpowiedzi dla interfejsu
  setImmediate(() => {
    try {
      conn
        .prepare(
          "INSERT OR REPLACE INTO search_cache (query_key, city, json_response, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(key, String(city ?? ""), JSON.stringify(json), Date.now());
    } catch (err) {
      console.warn("Nie udało się zapisać pamięci podręcznej:", String(err?.message || err));
    }
  });
}

ipcMain.handle("cache:stats", () => {
  const conn = cacheDb();
  if (!conn) return { available: false, entries: 0, hits: cacheHits };
  try {
    const row = conn.prepare("SELECT COUNT(*) AS n FROM search_cache").get();
    return { available: true, entries: Number(row?.n ?? 0), hits: cacheHits };
  } catch {
    return { available: false, entries: 0, hits: cacheHits };
  }
});

ipcMain.handle("cache:clear", () => {
  const conn = cacheDb();
  if (!conn) return { ok: false };
  try {
    conn.exec("DELETE FROM search_cache");
    cacheHits = 0;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// ---------- Maskowanie fingerprintu ukrytych okien (ochrona przed anty-botami) ----------
// Rotacja realistycznych User-Agentów, losowe wymiary okna i usunięcie flagi
// navigator.webdriver, żeby Cloudflare na OLX i Google nie wykrywał automatyki.

const STEALTH_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0",
];
const STEALTH_VIEWPORTS = [
  { width: 1366, height: 900 },
  { width: 1440, height: 900 },
  { width: 1536, height: 960 },
  { width: 1280, height: 832 },
  { width: 1680, height: 1050 },
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Skrypt usuwający ślady automatyki — wstrzykiwany przed skryptami strony.
const STEALTH_SCRIPT = `(() => {
  try { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); } catch {}
  try { Object.defineProperty(navigator, "languages", { get: () => ["pl-PL", "pl", "en-US", "en"] }); } catch {}
  try { Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] }); } catch {}
  try {
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) window.navigator.permissions.query = (p) =>
      p && p.name === "notifications"
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(p);
  } catch {}
  try { window.chrome = window.chrome || { runtime: {} }; } catch {}
})();`;

let fingerprintGen = null;
if (FingerprintGenerator) {
  try {
    fingerprintGen = new FingerprintGenerator({
      devices: ["desktop"],
      browsers: [{ name: "chrome", minVersion: 120 }, { name: "firefox", minVersion: 120 }, "safari"],
      operatingSystems: ["macos", "windows"],
      locales: ["pl-PL", "en-US"],
    });
  } catch { fingerprintGen = null; }
}

/**
 * Nakłada maskowanie na ukryte okno: losowy UA + viewport, usunięcie
 * navigator.webdriver, a gdy dostępne — pełny fingerprint z biblioteki.
 * Zwraca wybrany User-Agent (do przekazania w loadURL).
 */
function applyStealth(win) {
  let ua = pickRandom(STEALTH_UAS);
  let fingerprint = null;
  if (fingerprintGen) {
    try {
      fingerprint = fingerprintGen.getFingerprint();
      const fpUa = fingerprint?.fingerprint?.navigator?.userAgent;
      if (fpUa) ua = fpUa;
    } catch { fingerprint = null; }
  }
  const vp = pickRandom(STEALTH_VIEWPORTS);
  try { win.setSize(vp.width, vp.height); } catch { /* okno może być już zniszczone */ }
  win.webContents.setUserAgent(ua);
  // Usunięcie webdriver przed każdym załadowaniem skryptów strony.
  win.webContents.on("dom-ready", () => {
    if (win.isDestroyed()) return;
    win.webContents.executeJavaScript(STEALTH_SCRIPT, true).catch(() => {});
    if (fingerprint && FingerprintInjector) {
      try {
        new FingerprintInjector().attachFingerprintToPlaywright?.(win.webContents, fingerprint);
      } catch { /* injector wspiera głównie Playwright — fallback już zadziałał */ }
    }
  });
  return ua;
}

// ---------- Google Maps — ukryty scraping w niewidocznym oknie (100% darmowe) ----------

const GMAPS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const GMAPS_LIMIT = 120;
const GMAPS_TIMEOUT_MS = 150000;

/**
 * Skrypt wstrzykiwany do strony Google Maps. Akceptuje ekran zgody (jeśli się
 * pojawi), scrolluje panel wyników z losowymi przerwami, aż skończą się wyniki
 * albo dojdzie do limitu, a potem wyciąga dane z każdej karty wyniku.
 */
const GMAPS_SCRAPER = (limit) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(250); }
    return null;
  };

  // Ekran zgody na cookies
  const consent = [...document.querySelectorAll("button, input[type=submit]")].find((b) =>
    /zaakceptuj wszystko|accept all|odrzuć wszystko|reject all/i.test(b.innerText || b.value || ""));
  if (consent) { consent.click(); return { consent: true }; }

  const feed = await waitFor(() => document.querySelector('div[role="feed"]'), 20000);
  if (!feed) {
    // Pojedynczy wynik (Google od razu otworzył wizytówkę) albo brak wyników
    return { items: [], single: !!document.querySelector("h1") };
  }

  let stable = 0;
  let last = 0;
  for (let i = 0; i < 80; i++) {
    feed.scrollBy(0, rand(700, 1400));
    await sleep(rand(900, 2100));
    const count = feed.querySelectorAll("a.hfpxzc").length;
    const end = /dotarłeś do końca listy|you've reached the end/i.test(feed.innerText);
    if (count >= ${limit} || end) break;
    if (count === last) { stable++; if (stable >= 5) break; } else stable = 0;
    last = count;
    if (Math.random() < 0.15) await sleep(rand(1500, 3000)); // „ludzka” pauza
  }

  const PHONE = /(?:\\+48[\\s-]?)?(?:\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{3}|\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2})/;
  const items = [];
  for (const link of [...feed.querySelectorAll("a.hfpxzc")].slice(0, ${limit})) {
    const card = link.closest(".Nv2PK") || link.parentElement;
    if (!card) continue;
    const name = link.getAttribute("aria-label") || card.querySelector(".qBF1Pd")?.textContent || "";
    const ratingText = card.querySelector(".MW4etd")?.textContent || "";
    const reviewsText = card.querySelector(".UY7F9")?.textContent || "";
    // Przycisk „Witryna” — każdy link http, który nie prowadzi do Google
    const site = [...card.querySelectorAll("a[href]")].find((a) =>
      a !== link && /^https?:/.test(a.href) && !/google\\./.test(new URL(a.href).hostname));
    const lines = [...card.querySelectorAll(".W4Efsd")].map((e) => e.innerText.trim()).filter(Boolean);
    const text = card.innerText || "";
    const phone = (card.querySelector(".UsdlK")?.textContent || text.match(PHONE)?.[0] || "").trim();
    const parts = lines.join(" · ").split("·").map((s) => s.trim()).filter(Boolean);
    const category = parts[0] && !/\\d,\\d|\\(/.test(parts[0]) ? parts[0] : null;
    const address = parts.find((p) => /\\d/.test(p) && !PHONE.test(p) && !/otwarte|zamknięte|open|closed|\\d,\\d/i.test(p)) || "";
    items.push({
      name: name.trim(),
      url: link.href,
      rating: parseFloat(ratingText.replace(",", ".")) || 0,
      reviews: parseInt(reviewsText.replace(/\\D/g, ""), 10) || 0,
      phone,
      website: site ? site.href : null,
      category,
      address,
    });
  }
  return { items };
})()`;

let gmapsQueue = Promise.resolve();

function scrapeGoogleMaps(keyword, city) {
  const run = () =>
    new Promise((resolve) => {
      const win = new BrowserWindow({
        show: false,
        width: 1366,
        height: 900,
        webPreferences: {
          offscreen: true,
          partition: "persist:gmaps",
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const stealthUa = applyStealth(win); // rotacja UA + viewport + usunięcie webdriver
      win.webContents.setAudioMuted(true);
      let finished = false;
      let consentTries = 0;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ ok: false, error: "Google Maps nie odpowiedział w czasie." }),
        GMAPS_TIMEOUT_MS,
      );

      win.webContents.on("did-finish-load", async () => {
        try {
          await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
          const url = win.webContents.getURL();
          if (/\/sorry\//.test(url)) {
            return finish({ ok: false, status: 429, error: "Google tymczasowo zablokował zapytania (captcha). Odczekaj kilka minut." });
          }
          const res = await win.webContents.executeJavaScript(GMAPS_SCRAPER(GMAPS_LIMIT), true);
          if (res?.consent) {
            if (++consentTries > 2) finish({ ok: false, error: "Nie udało się zamknąć ekranu zgody Google." });
            return; // po kliknięciu zgody strona przeładuje się sama
          }
          finish({ ok: true, items: res?.items ?? [] });
        } catch (err) {
          finish({ ok: false, error: String(err?.message || err) });
        }
      });
      win.webContents.on("did-fail-load", (_e, code, desc) => {
        if (code === -3) return; // przerwane przekierowanie — normalne
        finish({ ok: false, error: `Nie udało się wczytać Google Maps (${desc}).` });
      });

      const q = encodeURIComponent(`${keyword} ${city}`).replace(/%20/g, "+");
      win.loadURL(`https://www.google.com/maps/search/${q}?hl=pl`, { userAgent: stealthUa });
    });
  const p = gmapsQueue.then(run, run);
  gmapsQueue = p.catch(() => {});
  return p;
}

// ---------- Audytor „pseudostron" ----------
const SOCIAL_HOSTS = /(facebook\.com|fb\.com|instagram\.com|tiktok\.com|linkedin\.com|youtube\.com|booksy\.com|wa\.me)/i;
const ISSUE_DEAD = "🚨 Strona wygasła / Błąd serwera";
const ISSUE_SSL = "🔓 Brak certyfikatu SSL (Niezabezpieczona)";
const ISSUE_MOBILE = "📱 Brak wersji mobilnej (Stara strona)";

async function auditFetch(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": HARVEST_UA, "Accept-Language": "pl-PL,pl;q=0.9" },
    signal: AbortSignal.timeout(5000),
  });
  return res;
}

async function auditWebsiteHealth(rawUrl) {
  let url = String(rawUrl ?? "").trim();
  if (!url) return { isTargetLead: true, issueTag: null };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  // Profil w social media to nie strona — traktujemy jak brak strony.
  if (SOCIAL_HOSTS.test(url)) return { isTargetLead: true, issueTag: null };
  const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
  if (!host) return { isTargetLead: true, issueTag: ISSUE_DEAD };

  let res = null;
  let httpsOk = false;
  try {
    res = await auditFetch(`https://${host}${new URL(url).pathname}`);
    httpsOk = true;
  } catch {
    // HTTPS nie działa (brak/błędny certyfikat albo martwa domena) — próbujemy po http://
    try {
      res = await auditFetch(`http://${host}${new URL(url).pathname}`);
    } catch {
      return { isTargetLead: true, issueTag: ISSUE_DEAD };
    }
  }
  if (!res || res.status >= 400) return { isTargetLead: true, issueTag: ISSUE_DEAD };
  if (!httpsOk || !String(res.url || "").startsWith("https://")) {
    return { isTargetLead: true, issueTag: ISSUE_SSL };
  }
  let html = "";
  try { html = (await res.text()).slice(0, 400000); } catch { return { isTargetLead: true, issueTag: ISSUE_DEAD }; }
  const $ = cheerio.load(html);
  if ($('meta[name="viewport" i]').length === 0) return { isTargetLead: true, issueTag: ISSUE_MOBILE };
  return { isTargetLead: false, issueTag: null };
}

/**
 * Wyszukuje firmy w Google Maps. Zwraca wyłącznie wizytówki z numerem
 * telefonu i BEZ uzupełnionej strony www — resztę odrzucamy od razu.
 */
async function searchMaps(_e, payload) {
  const keyword = String(payload?.keyword ?? "").trim();
  const city = String(payload?.city ?? "").trim();
  const auditSites = payload?.auditSites === true;
  if (!keyword || !city) return { ok: false, error: "Brak frazy lub miasta." };

  const cacheId = require("crypto")
    .createHash("sha1")
    .update(`gmaps:${auditSites ? "audit:" : ""}${keyword.toLowerCase()}:${city.toLowerCase()}`)
    .digest("hex");
  const cached = cacheRead(cacheId);
  if (cached) {
    cacheHits++;
    return { ok: true, ...cached, fromCache: true };
  }

  const res = await scrapeGoogleMaps(keyword, city);
  if (!res.ok) return res;

  const leads = [];
  const seen = new Set();
  let rejectedPhones = 0;
  let audited = 0;
  for (const it of res.items) {
    if (!it.name || !it.phone) continue;
    let issueTag = null;
    if (it.website) {
      if (!auditSites) continue;
      if (!validatePolishMobile(it.phone).isValidMobile) { rejectedPhones++; continue; }
      audited++;
      const audit = await auditWebsiteHealth(it.website);
      if (!audit.isTargetLead) continue; // dobra strona — odrzucamy
      issueTag = audit.issueTag;
    }
    // Tylko polskie numery komórkowe — stacjonarne i błędne odrzucamy.
    const check = validatePolishMobile(it.phone);
    if (!check.isValidMobile) {
      rejectedPhones++;
      continue;
    }
    const id = (it.url.match(/!1s([^!]+)/)?.[1] ?? it.url).slice(0, 120);
    if (seen.has(id)) continue;
    seen.add(id);
    leads.push({
      id,
      name: it.name,
      phone: check.formatted,
      address: it.address,
      city,
      rating: it.rating,
      reviews: it.reviews,
      category: it.category,
      mapsUrl: it.url,
      website: it.website || null,
      issueTag,
    });
  }
  const out = { leads, total: res.items.length, rejectedPhones, audited };
  cacheWrite(cacheId, city, out);
  return { ok: true, ...out, fromCache: false };
}
ipcMain.handle("gmaps:search", searchMaps);

// ---------- CEIDG — nowo założone firmy (oficjalne API dane.biznes.gov.pl) ----------

const CEIDG_BASE = "https://dane.biznes.gov.pl/api/ceidg/v2";
const CEIDG_DETAIL_LIMIT = 60;

const cleanPhone = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 9) return "";
  return d.slice(-9);
};

async function ceidgGet(url, key) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (res.status === 204) return { ok: true, json: {} };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: "CEIDG odrzucił klucz API (401). Sprawdź klucz w Ustawieniach." };
  }
  if (res.status === 429) {
    return { ok: false, status: 429, error: "Przekroczono limit zapytań CEIDG (429). Odczekaj chwilę i spróbuj ponownie." };
  }
  if (!res.ok) return { ok: false, status: res.status, error: `CEIDG odpowiedział błędem [${res.status}].` };
  return { ok: true, json: await res.json() };
}

function ceidgAddress(a) {
  if (!a) return { adres: "", miasto: "" };
  const street = [a.ulica, [a.budynek, a.lokal].filter(Boolean).join("/")].filter(Boolean).join(" ");
  return {
    adres: [street, [a.kod, a.miasto].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    miasto: a.miasto ?? "",
  };
}

// ---------- OSINT Harvester „NIP-to-Phone" ----------

const validateAndFormatPolishMobile = validatePolishMobile;
const HARVEST_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HARVEST_DIRS = /(pkt\.pl|panoramafirm\.pl|aleo\.com|facebook\.com)/i;
const PHONE_RE = /(?:\+48|0048)?[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}|\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;

async function harvestFetch(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": HARVEST_UA, "Accept-Language": "pl-PL,pl;q=0.9" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 500000);
  } catch {
    return "";
  }
}

function findMobileInText(text, nip) {
  const nipDigits = String(nip ?? "").replace(/\D/g, "");
  for (const m of String(text).match(PHONE_RE) ?? []) {
    const digits = m.replace(/\D/g, "");
    if (nipDigits && nipDigits.includes(digits.slice(-9))) continue; // to fragment NIP-u
    const check = validateAndFormatPolishMobile(m);
    if (check.isValidMobile) return check.formatted;
  }
  return null;
}

async function harvestPhoneForCompany({ nazwa, nip, miasto }) {
  const queries = [];
  if (nip) queries.push(`"${nip}" telefon`);
  if (nazwa) queries.push(`"${nazwa}" ${miasto ? `"${miasto}" ` : ""}telefon`);
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(1500 + Math.random() * 1500);
    const html = await harvestFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(queries[i])}`);
    if (!html) continue;
    const $ = cheerio.load(html);
    const text = $(".result__title, .result__snippet, .result__a").map((_, el) => $(el).text()).get().join(" \n ");
    const found = findMobileInText(text, nip);
    if (found) return found;
    // Pierwszy wynik z katalogu firm — wchodzimy w stronę.
    let dirUrl = null;
    $("a.result__a").each((_, el) => {
      if (dirUrl) return;
      let href = $(el).attr("href") || "";
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]);
      if (HARVEST_DIRS.test(href)) dirUrl = href.startsWith("//") ? `https:${href}` : href;
    });
    if (dirUrl) {
      await sleep(1000 + Math.random() * 1000);
      const page = await harvestFetch(dirUrl);
      if (page) {
        const $$ = cheerio.load(page);
        const tel = $$('a[href^="tel:"]').map((_, el) => $$(el).attr("href")).get().join(" ");
        const hit = findMobileInText(`${tel} ${$$("body").text()}`, nip);
        if (hit) return hit;
      }
    }
  }
  return null;
}

async function searchCeidg(e, payload) {
  const enableDeepHarvest = payload?.enableDeepHarvest === true;
  const sendProgress = (data) => { try { e.sender.send("ceidg-progress", data); } catch {} };
  const key = String(readSettings().ceidgApiKey ?? "").trim();
  if (!key) return { ok: false, error: "Brak klucza API CEIDG. Wpisz go w zakładce Ustawienia." };
  const dateFrom = String(payload?.dateFrom ?? "").slice(0, 10);
  const pkd = String(payload?.pkd ?? "")
    .split(/[,;\s]+/)
    .map((c) => c.trim().toUpperCase().replace(/\./g, ""))
    .filter(Boolean);
  const voivodeship = String(payload?.voivodeship ?? "").trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return { ok: false, error: "Niepoprawna data." };

  try {
    const params = new URLSearchParams({ dataod: dateFrom, dataRozpoczeciaDzialalnosciOd: dateFrom, status: "AKTYWNY", limit: "50" });
    if (pkd.length) params.set("pkd", pkd.join(","));
    if (voivodeship) params.set("wojewodztwo", voivodeship);

    // Lista firm (z paginacją, max 5 stron)
    const items = [];
    let url = `${CEIDG_BASE}/firmy?${params}`;
    for (let page = 0; url && page < 5; page++) {
      const r = await ceidgGet(url, key);
      if (!r.ok) {
        if (items.length) break;
        return r;
      }
      items.push(...(r.json.firmy ?? []));
      url = r.json.links?.next || null;
      if (url) await sleep(400);
    }

    // Telefon bywa tylko w szczegółach firmy — dociągamy brakujące.
    const leads = [];
    let details = 0;
    let rejectedPhones = 0;
    let harvested = 0;
    let harvestAttempts = 0;
    let idx = 0;
    for (const f of items) {
      idx++;
      let firm = f;
      if (!firm.telefon && firm.id && details < CEIDG_DETAIL_LIMIT) {
        details++;
        await sleep(300);
        const d = await ceidgGet(`${CEIDG_BASE}/firma/${encodeURIComponent(firm.id)}`, key);
        if (d.ok) firm = { ...firm, ...((d.json.firma ?? [])[0] ?? d.json) };
        else if (d.status === 429) break;
      }
      if (firm.www) continue; // ma już stronę
      const owner = firm.wlasciciel ?? {};
      const { adres, miasto } = ceidgAddress(firm.adresDzialalnosci ?? firm.adresKorespondencyjny);
      // Tylko polskie numery komórkowe — stacjonarne i błędne odrzucamy.
      const check = validatePolishMobile(firm.telefon);
      let telefon = check.isValidMobile ? check.formatted : null;
      let zrodloTelefonu = telefon ? "CEIDG" : null;
      if (!telefon && enableDeepHarvest) {
        const nazwaFirmy = firm.nazwa || [owner.imie, owner.nazwisko].filter(Boolean).join(" ");
        if (harvestAttempts > 0) await sleep(3000 + Math.random() * 2000);
        harvestAttempts++;
        sendProgress({ index: idx, total: items.length, name: nazwaFirmy, harvested, phase: "searching" });
        telefon = await harvestPhoneForCompany({ nazwa: nazwaFirmy, nip: owner.nip ?? firm.nip, miasto });
        if (telefon) { harvested++; zrodloTelefonu = "OSINT Harvester"; }
        sendProgress({ index: idx, total: items.length, name: nazwaFirmy, harvested, phase: telefon ? "found" : "miss" });
      }
      if (!telefon) {
        if (cleanPhone(firm.telefon)) rejectedPhones++;
        continue;
      }
      const pkdList = [firm.pkdGlowny, ...(Array.isArray(firm.pkd) ? firm.pkd : [])]
        .map((p) => (typeof p === "string" ? p : p?.kod))
        .filter(Boolean);
      leads.push({
        id: `ceidg/${firm.id ?? owner.nip ?? telefon}`,
        nazwa: firm.nazwa || [owner.imie, owner.nazwisko].filter(Boolean).join(" "),
        wlasciciel: [owner.imie, owner.nazwisko].filter(Boolean).join(" ") || null,
        imie: owner.imie ?? null,
        adres,
        miasto,
        telefon,
        email: firm.email ?? null,
        nip: owner.nip ?? firm.nip ?? null,
        regon: owner.regon ?? firm.regon ?? null,
        kategoria: [...new Set(pkdList)].join(", ") || pkd.join(", ") || null,
        dataRozpoczecia: firm.dataRozpoczecia ?? null,
        zrodlo: "CEIDG",
        zrodlo_telefonu: zrodloTelefonu,
      });
    }
    return { ok: true, total: items.length, leads, rejectedPhones, harvested };
  } catch (err) {
    return { ok: false, error: `Brak połączenia z CEIDG: ${String(err?.message || err)}` };
  }
}
ipcMain.handle("ceidg:search", searchCeidg);

// ---------- OLX Deep Phone Harvester (Branża Ślubna & Usługi High-Ticket) ----------
// Dwustopniowy silnik: (1) publiczne API OLX + ekstrakcja numeru z opisu,
// (2) ukryte okno z auto-clickerem przycisku „Pokaż numer” dla ukrytych numerów.

const OLX_SOCIAL_RE = /(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|linkedin\.com)/i;
const OLX_SKIP_HOSTS = /(olx\.pl|otodom|allegro\.pl|sprzedajemy)/i;
const OLX_URL_RE = /https?:\/\/[^\s"'<>)\],;]+/gi;
/** Ile ogłoszeń bez numeru w opisie otwieramy auto-clickerem (każde to kilka sekund). */
const OLX_CLICK_BUDGET = 50;

/** Linki w opisie ogłoszenia: własna strona (odrzut) albo wyłącznie social media (tag). */
function olxLinksInDescription(text) {
  let socialOnly = false;
  for (const m of String(text ?? "").match(OLX_URL_RE) ?? []) {
    if (OLX_SKIP_HOSTS.test(m)) continue;
    if (OLX_SOCIAL_RE.test(m)) { socialOnly = true; continue; }
    return { ownSite: m, socialOnly: false };
  }
  return { ownSite: null, socialOnly };
}

async function olxApiGet(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": HARVEST_UA, Accept: "application/json", "Accept-Language": "pl-PL,pl;q=0.9" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Skrypt auto-clickera: akceptuje cookies, klika „Pokaż numer”, wyciąga telefon z DOM. */
const OLX_CLICKER = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cookieBtn = document.querySelector("#onetrust-accept-btn-handler");
  if (cookieBtn) { cookieBtn.click(); await sleep(800); }
  const btn =
    document.querySelector('button[data-testid="show-phone"]') ||
    document.querySelector('button[data-cy="ad-contact-phone"]') ||
    [...document.querySelectorAll("button")].find((b) => /zadzwoń|pokaż|wyświetl numer/i.test(b.textContent || ""));
  if (!btn) return { ok: false, error: "no-button" };
  btn.scrollIntoView({ block: "center" });
  btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await sleep(300 + Math.random() * 400);
  btn.click();
  await sleep(1200 + Math.random() * 800);
  const tel = document.querySelector('a[href^="tel:"]');
  if (tel) return { ok: true, phone: tel.getAttribute("href").replace(/^tel:/i, "") };
  const m = (document.body.innerText.match(/(?:\\+48[\\s-]?)?\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{3}/) || [])[0];
  return m ? { ok: true, phone: m } : { ok: false, error: "no-phone" };
})()`;

let olxQueue = Promise.resolve();

// Fallback odczytuje wszystkie karty, nie pierwszy link znaleziony na stronie.
const OLX_LIST_DOM = `(() => {
  const cards = [...document.querySelectorAll('[data-cy="l-card"], [data-testid="l-card"]')];
  return cards.map(card => {
    const link = card.querySelector('a[href*="/d/oferta/"], a[href*="/oferta/"]');
    if (!link) return null;
    const url = new URL(link.getAttribute('href'), location.origin);
    url.search = ''; url.hash = '';
    return {
      id: url.pathname.match(/-ID([^.\/]+)/)?.[1] || url.pathname,
      url: url.href,
      title: (card.querySelector('h4, h6, [data-cy="ad-card-title"]')?.textContent || link.textContent || '').trim(),
      location: { name: (card.querySelector('[data-testid="location-date"], [data-cy="ad-card-location"]')?.textContent || '').trim() }
    };
  }).filter(Boolean);
})()`;

function olxReadDom(offerUrl, script, waitForCards = false) {
  const run = async () => {
    const win = new BrowserWindow({
      show: false, width: 1280, height: 900,
      webPreferences: { offscreen: true, partition: 'persist:olx', contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setAudioMuted(true);
    try {
      return await Promise.race([
        (async () => {
          await win.loadURL(offerUrl, { userAgent: HARVEST_UA });
          for (let attempt = 0; attempt < 8; attempt++) {
            await sleep(1000);
            const result = await win.webContents.executeJavaScript(script, true);
            if (!waitForCards || result?.length) return result;
          }
          return [];
        })(),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 25000); }),
      ]);
    } catch { return null; }
    finally { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); }
  };
  let timer;
  const pending = olxQueue.then(run, run);
  olxQueue = pending.catch(() => {});
  return pending;
}

/** Odsłania ukryty numer w ukrytym oknie — symuluje człowieka klikającego „Pokaż numer”. */
function olxRevealPhone(offerUrl) {
  const run = () =>
    new Promise((resolve) => {
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          offscreen: true,
          partition: "persist:olx",
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const stealthUa = applyStealth(win); // rotacja UA + viewport + usunięcie webdriver
      win.webContents.setAudioMuted(true);
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), 25000);
      win.webContents.on("did-finish-load", async () => {
        try {
          await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1200));
          const res = await win.webContents.executeJavaScript(OLX_CLICKER, true);
          finish(res && res.ok ? { ok: true, phone: res.phone } : { ok: false, error: res?.error ?? "brak numeru" });
        } catch (err) {
          finish({ ok: false, error: String(err?.message || err) });
        }
      });
      win.webContents.on("did-fail-load", (_e, code) => {
        if (code === -3) return; // przerwane przekierowanie — normalne
        finish({ ok: false, error: "load-failed" });
      });
      win.loadURL(offerUrl, { userAgent: stealthUa });
    });
  const p = olxQueue.then(run, run);
  olxQueue = p.catch(() => {});
  return p;
}

/** Double-check w DuckDuckGo: czy ogłoszeniodawca ma jednak własną stronę www. */
async function olxDdgHasSite(nazwa, miasto) {
  const q = encodeURIComponent(`"${nazwa}" ${miasto}`.trim());
  const html = await harvestFetch(`https://html.duckduckgo.com/html/?q=${q}`);
  if (!html) return false;
  for (const m of html.matchAll(/uddg=([^&"'<>]+)/gi)) {
    let url;
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (EXCLUDED_SITE_HOSTS.test(host) || OLX_SKIP_HOSTS.test(host)) continue;
    return true; // pierwsza obca domena = prawdopodobnie własna strona
  }
  return false;
}

async function searchOlx(e, payload) {
  const query = String(payload?.query ?? "").trim();
  const city = String(payload?.city ?? "").trim();
  const voivodeship = String(payload?.voivodeship ?? "").trim();
  const maxResults = Math.min(Math.max(Math.floor(Number(payload?.maxResults) || 50), 5), 50);
  const checkDDG = payload?.checkDuckDuckGo === true;
  // Snajper „Reklamy wideo”: firmy z własną stroną są pożądane, więc ich nie odrzucamy.
  const keepOwnSite = payload?.keepOwnSite === true;
  if (!query) return { ok: false, error: "Brak frazy wyszukiwania." };
  const sendProgress = (data) => { try { e.sender.send("olx-progress", data); } catch {} };

  const blacklist = new Set();
  try {
    const conn = blockDb();
    if (conn) for (const r of conn.prepare("SELECT phone FROM blacklist").all()) blacklist.add(blacklistKey(r.phone));
  } catch {
    /* brak czarnej listy nie blokuje skanu */
  }

  const area = city || voivodeship;
  // Lokalizacja nie może być częścią frazy: większość ofert nie zawiera nazwy województwa w tytule.
  const normalizeArea = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().replace(/^wojew[oó]dztwo\s+/, '').trim();
  const locationResponse = area ? await olxApiGet(city
    ? `https://www.olx.pl/api/v1/cities/?query=${encodeURIComponent(city)}`
    : 'https://www.olx.pl/api/v1/regions/') : null;
  const locations = Array.isArray(locationResponse?.data) ? locationResponse.data : Array.isArray(locationResponse?.data?.data) ? locationResponse.data.data : [];
  const location = locations.find(row => normalizeArea(row.name) === normalizeArea(area));
  const locationParams = new URLSearchParams();
  if (location?.id) locationParams.set(city ? 'city_id' : 'region_id', String(location.id));
  // Gdy resolver lokalizacji jest niedostępny, zachowujemy dotychczasowy zakres zamiast szukać w całej Polsce.
  const effectiveQuery = area && !location?.id ? `${query} ${area}` : query;
  sendProgress({ phase: "list", index: 0, total: 0, name: `Pobieram listę ogłoszeń OLX: „${query}”`, harvested: 0 });
  const offers = await collectOffers({
    limit: maxResults,
    pause: () => sleep(800 + Math.random() * 700),
    fetchPage: (offset, limit) => {
      const params = new URLSearchParams(locationParams);
      params.set('offset', String(offset)); params.set('limit', String(limit)); params.set('query', effectiveQuery);
      return olxApiGet(`https://www.olx.pl/api/v1/offers/?${params}`);
    },
    fetchDomPage: async page => {
      const params = new URLSearchParams({ page: String(page) });
      if (location?.id) params.set(city ? 'search[city_id]' : 'search[region_id]', String(location.id));
      const url = `https://www.olx.pl/oferty/q-${encodeURIComponent(effectiveQuery.replace(/\s+/g, '-'))}/?${params}`;
      return await olxReadDom(url, OLX_LIST_DOM, true) ?? [];
    },
  });
  if (offers.length === 0) {
    return { ok: false, error: "OLX nie zwrócił ogłoszeń dla tej frazy (albo zablokował zapytanie). Spróbuj innej frazy lub odczekaj chwilę." };
  }

  const leads = [];
  const seen = new Set();
  const seenPhones = new Set();
  let rejectedPhones = 0;
  let clicked = 0;
  let skippedSite = 0;
  let clickBudget = OLX_CLICK_BUDGET;

  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    const title = String(o?.title ?? "").trim();
    const offerUrl = String(o?.url ?? "");
    const offerId = String(o?.id ?? offerUrl);
    if (!title || !offerUrl || seen.has(offerId)) continue;
    seen.add(offerId);

    const loc = String(o?.location?.city?.name ?? o?.location?.name ?? area ?? "");
    sendProgress({ phase: "description", index: i + 1, total: offers.length, name: title, harvested: leads.length });

    // Etap 1: pełny opis z API szczegółu ogłoszenia.
    const detail = o?.id ? await olxApiGet(`https://www.olx.pl/api/v1/offers/${encodeURIComponent(String(o.id))}/`) : null;
    const fullOffer = offerDetail(detail, o);
    let description = String(fullOffer?.description ?? "");
    if (!description) {
      description = String(await olxReadDom(offerUrl, `(() => document.querySelector('[data-cy="ad_description"], [data-testid="ad_description"]')?.innerText || '')()`) ?? '');
    }

    // Własna strona www w opisie -> odrzucamy (ma już stronę).
    const links = olxLinksInDescription(description);
    if (links.ownSite && !keepOwnSite) { skippedSite++; continue; }

    // Numer wprost z opisu — natychmiastowy lead, bez klikania.
    let phone = findMobileInText(description, "");
    let phoneSource = phone ? "OLX opis" : null;

    // Etap 2: auto-clicker odsłania ukryty numer (z limitem, żeby skan nie trwał wiecznie).
    if (!phone && clickBudget > 0) {
      clickBudget--;
      sendProgress({ phase: "click", index: i + 1, total: offers.length, name: title, harvested: leads.length });
      const revealed = await olxRevealPhone(offerUrl);
      if (revealed.ok) {
        const check = validatePolishMobile(revealed.phone);
        if (check.isValidMobile) { phone = check.formatted; phoneSource = "OLX auto-click"; clicked++; }
        else rejectedPhones++;
      }
      await sleep(1500 + Math.random() * 2000);
    }

    if (!phone) continue;
    const validated = validatePolishMobile(phone);
    if (!validated.isValidMobile) { rejectedPhones++; continue; }
    phone = validated.formatted;
    const key = blacklistKey(phone);
    if (!key || blacklist.has(key) || seenPhones.has(key)) continue;

    // Opcjonalny double-check w DuckDuckGo.
    if (checkDDG && !keepOwnSite) {
      await sleep(800 + Math.random() * 800);
      if (await olxDdgHasSite(title, loc)) { skippedSite++; continue; }
    }

    seenPhones.add(key);
    leads.push({
      id: `olx-${offerId}`,
      nazwa: title,
      telefon: phone,
      miasto: loc,
      adres: loc,
      kategoria: query,
      olxUrl: offerUrl,
      zrodlo: "OLX",
      zrodlo_telefonu: phoneSource,
      socialOnly: links.socialOnly,
      website: links.ownSite || null,
      // Snajper: wyróżnienie/promowanie ogłoszenia i imię osoby kontaktowej.
      isPromoted: Boolean(
        fullOffer?.promotion?.highlighted ||
          fullOffer?.promotion?.top_ad ||
          fullOffer?.promotion?.premium_ad_page ||
          o?.promotion?.highlighted ||
          o?.promotion?.top_ad,
      ),
      contactName: String(fullOffer?.contact?.name ?? fullOffer?.user?.name ?? o?.user?.name ?? "").trim() || null,
    });
    await sleep(600 + Math.random() * 900);
  }

  sendProgress({ phase: "done", index: offers.length, total: offers.length, name: "", harvested: leads.length });
  return { ok: true, total: offers.length, leads, rejectedPhones, clicked, skippedSite };
}
ipcMain.handle("olx:search", searchOlx);

// ---------- pobieranie publicznych stron (darmowe wzbogacanie danych) ----------

ipcMain.handle("enrich:fetch", async (_e, url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 LeadFinder/1.0" },
    });
    if (!res.ok) return { ok: false };
    return { ok: true, html: (await res.text()).slice(0, 400000) };
  } catch {
    return { ok: false };
  }
});

// ---------- Automatyczny Asystent Wolnych Domen .pl (whois-json + DNS) ----------

const PL_DIACRITICS = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
const stripPl = (s) =>
  String(s ?? "").toLowerCase().replace(/[ąćęłńóśźż]/g, (ch) => PL_DIACRITICS[ch] ?? ch);

// Słowa bez wartości dla domeny — formy prawne i ogólniki.
const DOMAIN_STOPWORDS =
  /\b(sp\.?\s*z\s*o\.?o\.?|spolka|s\.?\s*c\.?|f\.?\s*h\.?\s*u\.?|p\.?\s*h\.?\s*u\.?|uslugi|usluga|firma|przedsiebiorstwo|handlowa|handel|produkcja|i\s*wspolnicy|wspolnicy|polska|pol)\b/gi;

function domainTokens(companyName) {
  return stripPl(companyName)
    .replace(DOMAIN_STOPWORDS, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2);
}

/** Generuje 2 sensowne propozycje domeny .pl dla firmy. */
function suggestDomains(companyName, city) {
  const tokens = domainTokens(companyName);
  const cityToken = domainTokens(city)[0] ?? "";
  const suggestions = [];
  if (tokens.length >= 2) suggestions.push(tokens.slice(0, 3).join(""));
  if (tokens.length === 1) suggestions.push(tokens[0]);
  // Druga propozycja: nazwisko/słowo kluczowe + miasto (np. kowalski-kielce.pl)
  const last = tokens[tokens.length - 1] ?? "";
  if (last && cityToken) suggestions.push(`${last}-${cityToken}`);
  else if (tokens.length >= 2) suggestions.push(`${tokens[0]}-${tokens[tokens.length - 1]}`);
  return [...new Set(suggestions.filter((s) => s.length >= 3 && s.length <= 63))].slice(0, 2);
}

/**
 * Sprawdza dostępność domeny .pl: najpierw szybkie DNS (NS/A), a gdy DNS
 * milczy — WHOIS przez whois-json. Brak rekordów = domena najpewniej wolna.
 */
async function checkDomainAvailability(domain) {
  try {
    const ns = await dns.resolveNs(domain).catch(() => null);
    if (ns && ns.length) return { domain, available: false, method: "dns-ns" };
    const a = await dns.resolve4(domain).catch(() => null);
    if (a && a.length) return { domain, available: false, method: "dns-a" };
  } catch { /* przechodzimy do WHOIS */ }
  if (whoisJson) {
    try {
      const data = await whoisJson(domain, { timeout: 6000 });
      // NASK dla wolnych domen zwraca komunikat „No information available"
      // i puste pola — brak daty rejestracji oznacza domenę wolną.
      const created = data?.creationDate || data?.created || data?.registered;
      const noInfo = /no information available|not registered|brak danych/i.test(
        JSON.stringify(data ?? {}),
      );
      if (noInfo || !created) return { domain, available: true, method: "whois" };
      return { domain, available: false, method: "whois" };
    } catch { /* WHOIS niedostępny — ufamy DNS */ }
  }
  return { domain, available: true, method: "dns" };
}

/** Dla firmy bez strony WWW: propozycje domen + sprawdzenie, która jest wolna. */
async function suggestAndCheckDomain(companyName, city) {
  const suggestions = suggestDomains(companyName, city);
  const checked = [];
  for (const s of suggestions) {
    const domain = `${s}.pl`;
    const result = await checkDomainAvailability(domain);
    checked.push(result);
    if (result.available) return { ok: true, domain, available: true, suggestions: checked };
  }
  return { ok: true, domain: null, available: false, suggestions: checked };
}

// ---------- Snajper Top 50: głęboki skan dla 5-stopniowego sita ----------
const sniperScanner = createSniperScanner({
  scrapeGoogleMaps,
  searchOlx,
  searchCeidg,
  hasCeidgKey: () => Boolean(String(readSettings().ceidgApiKey ?? "").trim()),
  validatePolishMobile,
  validateEmail: validateEmailDeep,
  suggestDomains,
  checkDomainAvailability,
  fetchImpl: (url, init) => fetch(url, init),
  userAgent: HARVEST_UA,
});
let sniperRunning = false;
ipcMain.handle("sniper:runDeepScan", async (event, params) => {
  if (sniperRunning) return { ok: false, error: "Skan Snajpera już trwa — poczekaj na wynik." };
  sniperRunning = true;
  try {
    const result = await sniperScanner.runDeepScan(event, params);
    // Każdy skan USA jest przy okazji próbką dla rozpoznania rynku. Błąd zapisu nie może zepsuć skanu.
    if (result?.ok && params?.market === "US") {
      try { market.recordProbe({ nicheId: params.nicheId, city: params.city, raw: result.raw }); } catch { /* baza niedostępna */ }
    }
    return result;
  } finally {
    sniperRunning = false;
  }
});

// Rozpoznanie rynku: liczba firm z Census (bezpłatnie), własne próbki z Map i wyniki własnych kampanii.
const market = createMarket({
  db: () => { const h = dataStore(); return h.state === "sqlite" ? h.store.db : null; },
  read: (name, fallback) => readJson(dataFile(name), fallback),
  write: (name, value) => writeJson(dataFile(name), value),
  encrypt: t => { if (!safeStorage.isEncryptionAvailable()) throw new Error("Szyfrowanie klucza niedostępne."); return safeStorage.encryptString(t).toString("base64"); },
  decrypt: t => safeStorage.decryptString(Buffer.from(t, "base64")),
  fetchImpl: (url, init) => fetch(url, init),
  emailLeads: () => emailEngine?.list() ?? [],
});
ipcMain.handle("market:settings", () => market.settings());
ipcMain.handle("market:configure", (_e, value) => market.configure(value));
ipcMain.handle("market:test", () => market.test());
ipcMain.handle("market:ranking", (_e, filter) => market.ranking(filter));
ipcMain.handle("market:refresh", event =>
  market.refresh(data => { try { event.sender.send("market-progress", data); } catch { /* okno zamknięte */ } }));
// Jedna próbka na kliknięcie: zwykły skan Map dla niszy i miasta, bez dodawania firm do bazy.
ipcMain.handle("market:probe", async (event, payload) => {
  const niche = countryRules.markets.US.niches.find(n => n.id === payload?.nicheId);
  const city = String(payload?.city ?? "").trim();
  if (!niche || !/^.+,\s*[A-Za-z]{2}$/.test(city)) throw new Error("Wybierz niszę i miasto ze stanem, np. Tulsa, OK.");
  if (sniperRunning) throw new Error("Skan już trwa. Poczekaj na wynik.");
  sniperRunning = true;
  try {
    const result = await sniperScanner.runDeepScan(event, { market: "US", nicheId: niche.id, keyword: niche.query, city, sources: { maps: true, olx: false, ceidg: false } });
    if (!result?.ok) throw new Error(result?.error || "Mapy nie zwróciły firm.");
    const probe = market.recordProbe({ nicheId: niche.id, city, raw: result.raw });
    if (!probe) throw new Error("Skan nie zwrócił firm do policzenia.");
    return probe;
  } finally {
    sniperRunning = false;
  }
});

ipcMain.handle("domain:checkAvailability", async (_e, payload) => {
  const nazwa = String(payload?.nazwa ?? "").trim();
  const miasto = String(payload?.miasto ?? "").trim();
  if (!nazwa) return { ok: false, error: "Brak nazwy firmy." };
  return suggestAndCheckDomain(nazwa, miasto);
});

/**
 * Masowe sprawdzanie wolnych domen dla całej listy leadów bez strony WWW.
 * Wynik zapisuje w polu leada `suggested_free_domain` i raportuje postęp.
 */
ipcMain.handle("domain:checkBulk", async (event, ids) => {
  const leads = readLeads();
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  const targets = leads.filter(
    (l) =>
      (!wanted || wanted.has(l.id)) &&
      !l.strona &&
      !l.suggested_free_domain &&
      l.channel_type !== "EMAIL",
  );
  const send = (data) => { try { if (!event.sender.isDestroyed()) event.sender.send("domain-progress", data); } catch {} };
  let found = 0;
  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i];
    send({ index: i + 1, total: targets.length, name: lead.nazwa, found });
    const result = await suggestAndCheckDomain(lead.nazwa, lead.miasto ?? "");
    if (result.available && result.domain) {
      found++;
      const all = readLeads();
      const idx = all.findIndex((l) => l.id === lead.id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], suggested_free_domain: result.domain };
        writeLeads(all);
      }
    }
    await sleep(400 + Math.random() * 600); // grzecznościowe opóźnienie dla WHOIS/DNS
  }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("leads:changed");
  send({ index: targets.length, total: targets.length, name: "", found });
  return { ok: true, checked: targets.length, found };
});

// ---------- Głęboka walidacja e-maili: składnia + rekordy MX (deep-email-validator) ----------

const EMAIL_SYNTAX_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

/**
 * Weryfikuje adres e-mail przed wysyłką: poprawność składni, istnienie
 * domeny i rekordów MX. Chroni konto SMTP przed Hard Bounce i SPAM-em.
 */
async function validateEmailDeep(email) {
  const addr = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_SYNTAX_RE.test(addr)) return { ok: false, email: addr, reason: "bad-syntax" };
  const domain = addr.split("@")[1];
  if (deepEmailValidator) {
    try {
      const res = await deepEmailValidator.validate({
        email: addr,
        validateRegex: true,
        validateMx: true,
        validateTypo: false,
        validateDisposable: false,
        validateSMTP: false, // test SMTP bywa blokowany przez serwery — MX wystarczy
      });
      if (res?.valid) return { ok: true, email: addr, method: "deep-validator" };
      const mxValid = res?.validators?.mx?.valid;
      if (mxValid !== false && res?.reason !== "mx") {
        // walidator odrzucił z innego powodu niż MX — domena może istnieć
        const mx = await dns.resolveMx(domain).catch(() => null);
        if (mx && mx.length) return { ok: true, email: addr, method: "dns-mx" };
      }
      return { ok: false, email: addr, reason: res?.reason ?? "no-mx" };
    } catch { /* fallback na natywne DNS */ }
  }
  const mx = await dns.resolveMx(domain).catch(() => null);
  if (mx && mx.length) return { ok: true, email: addr, method: "dns-mx" };
  return { ok: false, email: addr, reason: "no-mx" };
}

ipcMain.handle("email:validateDeep", async (_e, email) => validateEmailDeep(email));

/** Waliduje listę adresów z grzecznościowym opóźnieniem — używane przy harvest i przed sendBulk. */
async function validateEmailList(leads, onProgress) {
  const out = [];
  let dropped = 0;
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    onProgress?.({ index: i + 1, total: leads.length, name: lead.nazwa ?? lead.email });
    if (!lead.email || lead.email_verified) { out.push(lead); continue; }
    const check = await validateEmailDeep(lead.email);
    if (check.ok) out.push({ ...lead, email_verified: true });
    else dropped++; // nieistniejąca domena — odrzucamy, chroni przed Hard Bounce
    await sleep(150 + Math.random() * 250);
  }
  return { leads: out, dropped };
}

// ---------- weryfikacja numeru telefonu (czy to numer firmy, a nie katalogu) ----------

const DIRECTORY_HOSTS =
  /(pkt\.pl|panoramafirm|aleo\.com|gowork|oferia|fixly|booksy|zumi|targeo|firmy\.net|bazafirm|biznesfinder|nip24|rejestr\.io|krs|infoveriti|yellowpages|olx|allegro|gumtree|ogloszenia|katalog|baza-firm|spis|whocall|kto-dzwonil|ktodzwonil|nieznanynumer|numer-telefonu|telefon-info)/i;

const phoneDigits = (value) => String(value ?? "").replace(/\D/g, "").slice(-9);

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 LeadFinder/1.0" },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 400000);
  } catch {
    return null;
  }
}

/**
 * Sprawdza, na ilu różnych stronach pojawia się numer. Numery, które wiszą
 * w wielu katalogach firmowych, to zwykle centralki agregatorów, nie firma.
 */
ipcMain.handle("phone:verify", async (_e, phone) => {
  const digits = phoneDigits(phone);
  if (digits.length < 9) return { ok: false, domains: 0, directories: 0, verdict: "unknown" };

  const html = await fetchHtml(`https://duckduckgo.com/html/?q=%22${digits}%22`);
  if (!html) return { ok: false, domains: 0, directories: 0, verdict: "unknown" };

  const hosts = new Set();
  let directories = 0;
  for (const m of html.matchAll(/uddg=([^&"'<>]+)/gi)) {
    let url;
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (/duckduckgo|bing\.com|google\./.test(host)) continue;
    hosts.add(host);
    if (DIRECTORY_HOSTS.test(host)) directories++;
  }

  const domains = hosts.size;
  // dużo katalogów przy jednym numerze = numer krąży po agregatorach
  const verdict = directories >= 4 || (domains >= 12 && directories >= 3) ? "shared" : "direct";
  return { ok: true, domains, directories, verdict };
});

// ---------- rygorystyczna weryfikacja stron WWW (całkowicie darmowa) ----------

// Domeny, które nie są własną stroną firmy — pomijamy je od razu.
const EXCLUDED_SITE_HOSTS =
  /(facebook|fb\.com|instagram|linkedin|tiktok|youtube|twitter|x\.com|google\.|goo\.gl|maps\.app|duckduckgo|bing\.com|yahoo|wikipedia|oferteo|olx|allegro|otomoto|gumtree|pkt\.pl|panoramafirm|aleo\.com|gowork|oferia|fixly|booksy|zumi|targeo|firmy\.net|bazafirm|biznesfinder|nip24|rejestr\.io|krs|infoveriti|yellowpages|ceneo|yelp|tripadvisor|ogloszenia|katalog|spis)/i;

/** Pobiera stronę z krótkim limitem czasu i ignorowaniem błędów certyfikatu. */
function fetchPageText(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const lib = url.startsWith("http://") ? require("http") : require("https");
      const req = lib.request(
        url,
        {
          method: "GET",
          rejectUnauthorized: false,
          timeout: timeoutMs,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
          },
        },
        (res) => {
          // przekierowanie (max jedno) — podążamy za nowym adresem
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, url).toString();
            fetchPageText(next, timeoutMs).then(finish).catch(() => finish(null));
            return;
          }
          if (res.statusCode >= 400) {
            res.resume();
            finish(null);
            return;
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
            if (data.length > 400000) req.destroy();
          });
          res.on("end", () => finish(data));
          res.on("error", () => finish(null));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}

/** Usuwa znaczniki HTML i sprowadza cyfry numeru do jednej postaci. */
const pageDigits = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\D/g, "");

/**
 * Szuka strony firmy w wynikach DuckDuckGo i sprawdza, czy widnieje na niej
 * numer leada. Dopasowanie = firma ma jednak stronę internetową.
 */
async function findOwnSiteWithPhone(nazwa, miasto, telefon) {
  const digits = phoneDigits(telefon);
  if (digits.length < 9 || !nazwa) return null;

  const query = encodeURIComponent(`${nazwa} ${miasto ?? ""}`.trim());
  const results = await fetchPageText(`https://duckduckgo.com/html/?q=${query}`, 8000);
  if (!results) return null;

  const urls = [];
  for (const m of results.matchAll(/uddg=([^&"'<>]+)/gi)) {
    let url;
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (EXCLUDED_SITE_HOSTS.test(host)) continue;
    if (urls.some((u) => u.host === host)) continue;
    urls.push({ url, host });
    if (urls.length >= 3) break;
  }

  for (const item of urls) {
    try {
      const html = await fetchPageText(item.url, 5000);
      if (!html) continue;
      if (pageDigits(html).includes(digits)) return `https://${item.host}`;
    } catch {
      /* blokada Cloudflare lub błąd sieci — próbujemy kolejnej strony */
    }
  }
  return null;
}

ipcMain.handle("website:check", async (_e, lead) => {
  try {
    const url = await findOwnSiteWithPhone(lead?.nazwa, lead?.miasto, lead?.telefon);
    return { ok: true, hasSite: Boolean(url), url };
  } catch (err) {
    return { ok: false, hasSite: false, url: null, error: String(err?.message || err) };
  }
});

/**
 * Podwójna weryfikacja podczas skanowania: szukamy firmy w DuckDuckGo.
 * Jeśli w top 3 wynikach pojawi się domena spoza listy katalogów i agregatorów,
 * firma najpewniej ma własną stronę — zgłaszamy hasSite: true.
 */
ipcMain.handle("website:verifyDDG", async (_e, payload) => {
  try {
    const nazwa = String(payload?.nazwa ?? "").trim();
    const miasto = String(payload?.miasto ?? "").trim();
    if (!nazwa) return { ok: false, hasSite: false, url: null };

    const query = encodeURIComponent(`${nazwa} ${miasto}`.trim());
    const html = await fetchPageText(`https://duckduckgo.com/html/?q=${query}`, 8000);
    if (!html) return { ok: true, hasSite: false, url: null };

    const hosts = [];
    for (const m of html.matchAll(/uddg=([^&"'<>]+)/gi)) {
      let url;
      try {
        url = decodeURIComponent(m[1]);
      } catch {
        continue;
      }
      let host;
      try {
        host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        continue;
      }
      if (EXCLUDED_SITE_HOSTS.test(host)) continue;
      if (hosts.some((h) => h.host === host)) continue;
      hosts.push({ host, url });
      if (hosts.length >= 3) break;
    }

    const hit = hosts[0] ?? null;
    return { ok: true, hasSite: Boolean(hit), url: hit ? `https://${hit.host}` : null };
  } catch (err) {
    return { ok: false, hasSite: false, url: null, error: String(err?.message || err) };
  }
});

/**
 * Sprawdza wskazane leady i usuwa z bazy te, które mają własną stronę.
 */
ipcMain.handle("website:purge", async (event, ids) => {
  const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null;
  const targets = readLeads().filter((l) => l.telefon && (!wanted || wanted.has(l.id)));
  const hits = [];
  let checked = 0;

  for (const lead of targets) {
    try {
      const url = await findOwnSiteWithPhone(lead.nazwa, lead.miasto, lead.telefon);
      if (url) {
        writeLeads(readLeads().filter((l) => l.id !== lead.id));
        hits.push({ id: lead.id, nazwa: lead.nazwa, url });
      }
    } catch {
      /* pojedynczy błąd nie przerywa całej weryfikacji */
    }
    checked++;
    if (!event.sender.isDestroyed()) {
      event.sender.send("website-progress", { index: checked, total: targets.length });
    }
    await sleep(300);
  }

  return { ok: true, checked, removed: hits.length, hits };
});


// ---------- historia rozmów z aplikacji Wiadomości (~/Library/Messages/chat.db) ----------

const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
let chatDbError = null;

/** Otwiera systemową bazę Wiadomości tylko do odczytu. null = brak dostępu. */
function openChatDb() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const conn = new DatabaseSync(CHAT_DB, { readOnly: true });
    // szybki test uprawnień — bez tego błąd wyszedłby dopiero przy zapytaniu
    conn.prepare("SELECT ROWID FROM handle LIMIT 1").get();
    chatDbError = null;
    return conn;
  } catch (err) {
    chatDbError = String(err?.message || err);
    console.warn(
      "Brak dostępu do historii aplikacji Wiadomości (chat.db). " +
        "Włącz Pełny dostęp do dysku dla LeadFinder w Ustawieniach systemowych → " +
        "Prywatność i bezpieczeństwo. Weryfikacja duplikatów działa tylko na lokalnej bazie. " +
        "Szczegóły: " +
        chatDbError,
    );
    return null;
  }
}

/** Czy numer występuje w historii rozmów. null = nie dało się sprawdzić. */
function historyHasPhone(conn, phone) {
  if (!conn) return null;
  const digits = phoneDigits(phone);
  if (digits.length < 9) return null;
  try {
    const row = conn.prepare("SELECT ROWID FROM handle WHERE id LIKE ? LIMIT 1").get(`%${digits}`);
    return Boolean(row);
  } catch (err) {
    console.warn("Nie udało się sprawdzić historii Wiadomości:", String(err?.message || err));
    return null;
  }
}

function closeChatDb(conn) {
  try {
    conn?.close();
  } catch {
    /* zamknięcie i tak nastąpi przy wyjściu z procesu */
  }
}

ipcMain.handle("messages:historyStatus", () => {
  const conn = openChatDb();
  const available = Boolean(conn);
  closeChatDb(conn);
  return available ? { available: true } : { available: false, error: chatDbError ?? undefined };
});

// Apple zapisuje daty jako czas od 2001-01-01 (sekundy na starszych macOS, nanosekundy od 10.13).
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

// Wspólna logika: sprawdza chat.db i zwraca leady, które odpisały.
function checkRepliesNow() {
  const conn = openChatDb();
  if (!conn) return { ok: false, checked: 0, updated: 0, repliedLeads: [], error: chatDbError ?? "Brak dostępu do chat.db" };
  let checked = 0;
  const repliedLeads = [];
  const replies = [];
  try {
    const all = readLeads();
    const stmt = conn.prepare(
      `SELECT m.ROWID AS rowid, m.text AS text,
         (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) AS sec
       FROM message m JOIN handle h ON m.handle_id = h.ROWID
       WHERE h.id LIKE ? AND m.is_from_me = 0
         AND (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) > ?
       ORDER BY m.date DESC LIMIT 1`,
    );
    for (const lead of all) {
      if (lead.status !== "wyslano_wiadomosc" || !lead.sms_sent_at || !lead.telefon) continue;
      const digits = phoneDigits(lead.telefon);
      const sentMs = Date.parse(lead.sms_sent_at);
      if (digits.length < 9 || Number.isNaN(sentMs)) continue;
      checked++;
      const sentApple = Math.floor((sentMs - APPLE_EPOCH_MS) / 1000);
      try {
        const row = stmt.get(`%${digits}`, sentApple);
        if (row) {
          const now = new Date().toISOString();
          const sec = Number(row.sec);
          lead.status = "odpisal";
          lead.replied_at = Number.isFinite(sec) ? new Date(APPLE_EPOCH_MS + sec * 1000).toISOString() : now;
          // Atrybucja: pierwsza odpowiedź klienta = moment zaangażowania.
          if (!lead.engaged_at) lead.engaged_at = lead.replied_at;
          lead.status_changed_at = now;
          // Treść odpowiedzi dla skrzynki; pusta, gdy macOS trzyma ją tylko w formacie binarnym.
          const text = typeof row.text === "string" ? row.text : "";
          const verdict = classifyRules(text);
          lead.reply_category = verdict.category;
          replies.push({ lead: { ...lead }, text, rowid: row.rowid, at: Date.parse(lead.replied_at) });
          repliedLeads.push(lead);
        }
      } catch (err) {
        console.warn("Błąd sprawdzania odpowiedzi:", String(err?.message || err));
      }
    }
    if (repliedLeads.length > 0) writeLeads(all);
    return { ok: true, checked, updated: repliedLeads.length, repliedLeads, replies };
  } catch (err) {
    return { ok: false, checked, updated: repliedLeads.length, repliedLeads, replies, error: String(err?.message || err) };
  } finally {
    closeChatDb(conn);
  }
}

// ---------- Strażnik dostarczalności (błędy wysyłki w chat.db) ----------
const deliveryFailures = []; // znaczniki czasu błędów (ms) — do wykrywania serii
let deliveryPauseNotified = 0;

function checkDeliveryNow(existingConn) {
  const conn = existingConn ?? openChatDb();
  if (!conn) return { ok: false, failed: [] };
  const failed = [];
  try {
    const all = readLeads();
    const stmt = conn.prepare(
      `SELECT m.ROWID, m.error, m.is_delivered,
         (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) AS sec
       FROM message m JOIN handle h ON m.handle_id = h.ROWID
       WHERE h.id LIKE ? AND m.is_from_me = 1
         AND (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) >= ?
       ORDER BY m.date DESC LIMIT 1`,
    );
    for (const lead of all) {
      if (lead.status !== "wyslano_wiadomosc" || !lead.sms_sent_at || !lead.telefon) continue;
      const digits = phoneDigits(lead.telefon);
      const sentMs = Date.parse(lead.sms_sent_at);
      if (digits.length < 9 || Number.isNaN(sentMs)) continue;
      const sentApple = Math.floor((sentMs - APPLE_EPOCH_MS) / 1000) - 120;
      try {
        const row = stmt.get(`%${digits}`, sentApple);
        if (row && Number(row.error) !== 0) {
          const now = new Date().toISOString();
          lead.status = "blad_dostarczenia";
          lead.status_changed_at = now;
          lead.delivery_error = Number(row.error);
          failed.push(lead);
        }
      } catch (err) {
        console.warn("Błąd sprawdzania dostarczenia:", String(err?.message || err));
      }
    }
    if (failed.length) {
      writeLeads(all);
      const bl = blockDb();
      for (const lead of failed) {
        const key = blacklistKey(lead.telefon);
        if (bl && key) {
          try { bl.prepare("INSERT OR IGNORE INTO blacklist (phone, added_at) VALUES (?, ?)").run(key, Date.now()); } catch {}
        }
        deliveryFailures.push(Date.now());
      }
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send("leads:changed"); } catch {}
      }
      guardDeliveryStreak();
    }
    return { ok: true, failed };
  } catch (err) {
    return { ok: false, failed, error: String(err?.message || err) };
  } finally {
    if (!existingConn) closeChatDb(conn);
  }
}

// 3 błędy w ciągu 15 minut → pauza kolejki + powiadomienie.
function guardDeliveryStreak() {
  const since = Date.now() - 15 * 60 * 1000;
  while (deliveryFailures.length && deliveryFailures[0] < since) deliveryFailures.shift();
  if (deliveryFailures.length < 3) return;
  deliveryFailures.length = 0;
  if (typeof bulkPaused !== "undefined") bulkPaused = true;
  try { bulkLimiter.updateSettings({ reservoir: 0 }); } catch {}
  if (Date.now() - deliveryPauseNotified < 60 * 1000) return;
  deliveryPauseNotified = Date.now();
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({
      title: "⚠️ Wstrzymano wysyłkę SMS!",
      body: "Wykryto 3 błędy dostarczenia z rzędu – sprawdź zasięg lub pakiet na karcie SIM",
    });
    n.on("click", focusMainWindow);
    n.show();
  } catch {}
}

function notifyReplies(result) {
  if (!result.ok || !result.repliedLeads.length) return;
  // Każda odpowiedź SMS trafia do skrzynki: odmowy są blokowane, reszta dostaje szkic do zatwierdzenia.
  for (const r of result.replies ?? []) {
    inbox
      ?.ingest({ channel: "sms", lead: r.lead, address: r.lead.telefon, text: r.text, at: r.at, externalId: r.rowid, outbound: r.lead.sms_exact_text })
      .catch((err) => console.warn("Skrzynka odpowiedzi:", String(err?.message || err)));
  }
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send("leads:changed"); } catch {}
  }
  if (!Notification.isSupported()) return;
  for (const lead of result.repliedLeads) {
    // Odmowa to nie „gorący lead” — bez powiadomienia.
    if (BLOCKING_REPLIES.has(lead.reply_category)) continue;
    try {
      const n = new Notification({
        title: "🔥 Nowy gorący lead!",
        body: `Firma ${lead.nazwa || lead.telefon} właśnie odpisała na Twoją wiadomość.`,
      });
      n.on("click", focusMainWindow);
      n.show();
    } catch (err) {
      console.warn("Powiadomienie nieudane:", String(err?.message || err));
    }
  }
}

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  win.focus();
}

const REPLY_MONITOR_MS = 5 * 60 * 1000;
let replyMonitor = null;
let monitorRunning = false;
function startBackgroundReplyMonitor() {
  if (replyMonitor) return;
  const tick = () => {
    if (monitorRunning) return;
    monitorRunning = true;
    try {
      // Brak Pełnego Dostępu do Dysku → result.ok = false, bez crasha
      notifyReplies(checkRepliesNow());
      checkDeliveryNow();
    } catch (err) {
      console.warn("Monitor odpowiedzi:", String(err?.message || err));
    } finally {
      monitorRunning = false;
    }
  };
  setTimeout(tick, 30 * 1000);
  replyMonitor = setInterval(tick, REPLY_MONITOR_MS);
}

// ---------- czarna lista numerów (SQLite) ----------
function blacklistKey(phone) {
  // Preferujemy zwalidowane 9 cyfr numeru komórkowego; przy błędnym numerze
  // wracamy do surowych cyfr, żeby czarna lista działała też dla stacjonarnych.
  const check = validatePolishMobile(phone);
  if (check.nineDigits) return check.nineDigits;
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
}
ipcMain.handle("blacklist:add", (_e, phone) => {
  const key = blacklistKey(phone);
  if (!key) return { ok: false, error: "Nieprawidłowy numer" };
  const conn = blockDb();
  if (!conn) return { ok: false, error: "Baza czarnej listy niedostępna" };
  try {
    conn.prepare("INSERT OR IGNORE INTO blacklist (phone, added_at) VALUES (?, ?)").run(key, Date.now());
    return { ok: true, phone: key };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("blacklist:getAll", () => {
  const conn = blockDb();
  if (!conn) return [];
  try {
    return conn.prepare("SELECT phone FROM blacklist").all().map((r) => String(r.phone));
  } catch {
    return [];
  }
});

ipcMain.handle("messages:syncReplies", () => {
  const r = checkRepliesNow();
  if (r.ok && r.repliedLeads.length) notifyReplies(r);
  const d = checkDeliveryNow();
  return { ok: r.ok, checked: r.checked, updated: r.updated, failed: d.failed.length, error: r.error };
});

// ---------- masowa wysyłka wiadomości (SMS z zapasowym iMessage) ----------

// Najpierw usługa "SMS" (bramka operatora przez iPhone'a — działa też do Androida),
// a gdy jej nie ma, wysyłamy przez iMessage. Opcjonalny 3. argument to nazwa
// konkretnej linii (Dual eSIM) — wtedy wybieramy usługę SMS o tej nazwie.
const APPLESCRIPT = `on run argv
  set targetNumber to item 1 of argv
  set msgText to item 2 of argv
  set serviceName to ""
  if (count of argv) > 2 then set serviceName to item 3 of argv
  tell application "Messages"
    try
      if serviceName is not "" then
        set smsService to 1st account whose service type = SMS and name = serviceName
      else
        set smsService to 1st account whose service type = SMS
      end if
      set smsBuddy to participant targetNumber of smsService
      send msgText to smsBuddy
      return "sms"
    on error
      try
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant targetNumber of targetService
        send msgText to targetBuddy
        return "imessage"
      on error errMsg
        error errMsg
      end try
    end try
  end tell
end run
`;

let cancelRequested = false;
let sending = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runScript(scriptPath, phone, body, serviceName) {
  const args = serviceName ? [scriptPath, phone, body, serviceName] : [scriptPath, phone, body];
  return new Promise((resolve) => {
    execFile("osascript", args, { timeout: 30000 }, (err, stdout) => {
      if (err) resolve({ ok: false, error: String(err.message || err) });
      else resolve({ ok: true, channel: String(stdout || "").trim() || "sms" });
    });
  });
}

// Dwie próby: SMS-em przez operatora, a po nieudanej — jeszcze raz (wtedy iMessage).
async function sendOne(scriptPath, phone, body, serviceName) {
  // Ambiguous failures must never cause a second opening SMS.
  return runScript(scriptPath, phone, body, serviceName);
}

// ---------- kolejka anty-banowa (Bottleneck) ----------
// Single-flight sender; interruptible clock owns spacing so live changes apply immediately.
const bulkLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 0 });
const speedClock = createSpeedClock();
function setSpeedConfig(value) {
  const config = speedClock.set(value);
  bulkLimiter.updateSettings({ maxConcurrent: 1, minTime: 0 });
  return { ok: true, ...config };
}
let bulkPaused = false;
const bulkState = {
  sent: 0,
  queued: 0,
  total: 0,
  nextAt: null,
  sim: null,
  waitingHours: false,
};

// Blokada godzinowa: wysyłka tylko 08:30–17:00 (chyba że forceSend).
function withinWorkingHours() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 8 * 60 + 30 && minutes < 17 * 60;
}

// Przerywalny sen — reaguje na pauzę i stop co pół sekundy.
async function waitForNextSms() {
  while (speedClock.remaining() > 0 || bulkPaused) {
    if (cancelRequested) return;
    if (bulkPaused) {
      const before = Date.now();
      await sleep(100);
      speedClock.postpone(Date.now() - before);
    } else await sleep(Math.min(100, speedClock.remaining()));
  }
}

async function sendBulk(event, items, options) {
  if (sending) return [];
  sending = true;
  cancelRequested = false;
  bulkPaused = false;
  if (options?.speedMode || options?.minDelayMs !== undefined || options?.maxDelayMs !== undefined) setSpeedConfig(options);
  speedClock.clear();
  try { bulkLimiter.updateSettings({ reservoir: null }); } catch {}

  const forceSend = options?.forceSend === true;
  const dualSim = options?.dualSim === true;
  const sim1 = String(options?.sim1Name ?? "").trim();
  const sim2 = String(options?.sim2Name ?? "").trim();

  const scriptPath = path.join(os.tmpdir(), "leadfinder-imessage.scpt");
  fs.writeFileSync(scriptPath, APPLESCRIPT);

  const results = [];
  let attempted = 0;
  // Jedno połączenie z historią Wiadomości na całą serię — zamykamy je na końcu.
  const chatDb = openChatDb();
  Object.assign(bulkState, {
    sent: 0, queued: items.length, total: items.length,
    nextAt: null, sim: null, waitingHours: false,
  });
  try {
    for (let i = 0; i < items.length; i++) {
      if (cancelRequested) break;
      const item = items[i];

      // Dual eSIM: parzyste indeksy z pierwszej linii, nieparzyste z drugiej.
      const simName = dualSim ? (attempted % 2 === 0 ? sim1 : sim2) || null : null;
      bulkState.sim = simName;

      // Zabezpieczenie przed dublem: jeśli pod ten numer wiadomość już poszła, pomijamy.
      const digits = phoneDigits(item.phone);
      const already = readLeads().find(
        (l) => (l.sms_sent_at || l.sms_reserved_at) && phoneDigits(l.telefon) === digits && digits.length === 9,
      );

      // Drugie zabezpieczenie: numer widnieje już w historii rozmów na tym Macu.
      const history = historyHasPhone(chatDb, item.phone);
      const inHistory = already ? false : history === true;

      let res;
      if (already) {
        res = {
          ok: false,
          skipped: true,
          reason: "local",
          sentAt: already.sms_sent_at,
          error: "Wiadomość już wysłana",
        };
      } else if (inHistory) {
        res = {
          ok: false,
          skipped: true,
          reason: "history",
          error: "Numer jest już w historii Wiadomości",
        };
      } else if (!validatePolishMobile(item.phone).isValidMobile || history === null) {
        res = { ok: false, skipped: true, error: "Niepoprawny numer lub brak dostępu do historii — wysyłka zablokowana" };
      } else {
        // Blokada godzinowa — poza 08:30–17:00 kolejka czeka.
        while (!forceSend && !withinWorkingHours() && !cancelRequested) {
          bulkState.waitingHours = true;
          bulkState.nextAt = null;
          await sleep(30000);
        }
        bulkState.waitingHours = false;
        if (cancelRequested) break;

        while (bulkPaused && !cancelRequested) await sleep(500);
        if (cancelRequested) break;
        // Hours/pause waits can be long: recheck history at the actual send boundary.
        const freshHistory = historyHasPhone(chatDb, item.phone);
        if (freshHistory !== false) {
          results.push({id:item.id,ok:false,skipped:true,reason:"history",error:"Numer w historii lub historia niedostępna"});
          continue;
        }
        // Wspólna lista blokad: rezygnacja zgłoszona dowolnym kanałem (SMS lub e-mail) wstrzymuje wysyłkę.
        const blocks = blockDb();
        if (!blocks) {
          results.push({id:item.id,ok:false,skipped:true,reason:"blocked",error:"Lista blokad niedostępna — wysyłka wstrzymana"});
          continue;
        }
        if (blocks.prepare("SELECT 1 AS hit FROM blacklist WHERE phone = ?").get(blacklistKey(item.phone))) {
          results.push({id:item.id,ok:false,skipped:true,reason:"blocked",error:"Numer jest na liście blokad"});
          continue;
        }
        // Persist the one-attempt reservation before invoking macOS, surviving a crash.
        const reservedAt = new Date().toISOString();
        writeLeads(readLeads().map(l => phoneDigits(l.telefon) === digits ? {...l, sms_reserved_at: reservedAt} : l));
        const ledger = readJson(dataFile("sms-ledger.json"), {});
        if (ledger[digits]) {
          res = {ok: false, skipped: true, reason: "local", error: "Numer ma już zarezerwowaną wiadomość"};
        } else {
          ledger[digits] = reservedAt;
          writeJson(dataFile("sms-ledger.json"), ledger);
          attempted++;
          res = await bulkLimiter.schedule(() => sendOne(scriptPath, item.phone, item.body, simName));
        }
      }

      // Znacznik zapisujemy po powodzeniu oraz gdy numer jest już w historii rozmów
      // (żeby kolejne serie pomijały go bez odpytywania bazy systemowej).
      if (res.ok || inHistory) {
        const now = new Date().toISOString();
        writeLeads(
          readLeads().map((l) =>
            l.id === item.id || (digits.length === 9 && phoneDigits(l.telefon) === digits)
              ? {
                  ...l,
                  sms_sent_at: now,
                  ...(res.ok ? {status: "wyslano_wiadomosc", status_changed_at: now} : {}),
                  // Atrybucja: dokładna treść i kombinacja Spintax wysłanego SMS-a.
                  sms_exact_text: item.body ?? l.sms_exact_text ?? null,
                  sms_template_id: item.templateId ?? l.sms_template_id ?? null,
                  sms_combination_signature: item.signature ?? l.sms_combination_signature ?? null,
                }
              : l,
          ),
        );
      }

      results.push({ id: item.id, ...res });
      bulkState.sent = results.filter((r) => r.ok).length;
      bulkState.queued = items.length - results.length;
      if (!event.sender.isDestroyed()) {
        event.sender.send("bulk-progress", {
          index: i,
          total: items.length,
          id: item.id,
          ...res,
        });
      }
      // Strażnik dostarczalności: sprawdzamy błędy wysyłki na bieżąco.
      if (res.ok) {
        // Delivery monitoring also runs independently; never stall the queue for it.
        try { checkDeliveryNow(chatDb); } catch {}
      }
      // Live tempo: change the outstanding deadline instead of starting another wait.
      if (i < items.length - 1 && !cancelRequested && !res.skipped) {
        speedClock.begin();
        await waitForNextSms();
        speedClock.clear();
      }
    }
  } finally {
    closeChatDb(chatDb);
    sending = false;
    speedClock.clear();
    Object.assign(bulkState, { queued: 0, nextAt: null, sim: null, waitingHours: false });
  }
  return results;
}
ipcMain.handle("bulk-send", sendBulk);

ipcMain.on("bulk-cancel", () => {
  cancelRequested = true;
});

// Sterowanie kolejką wysyłki na żywo.
ipcMain.handle("messages:pauseBulk", () => {
  bulkPaused = true;
  return { ok: true };
});
ipcMain.handle("messages:resumeBulk", () => {
  bulkPaused = false;
  return { ok: true };
});
ipcMain.handle("messages:setSpeedConfig", (_e, value) => setSpeedConfig(value ?? {}));
ipcMain.handle("messages:bulkStatus", () => ({
  running: sending,
  paused: bulkPaused,
  sent: bulkState.sent,
  queued: bulkState.queued,
  total: bulkState.total,
  nextInSec: speedClock.nextAt === null ? null : Math.ceil(speedClock.remaining() / 1000),
  ...speedClock.config,
  sim: bulkState.sim,
  waitingHours: bulkState.waitingHours,
}));

// ---------- lokalny serwer plików interfejsu ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Stały port = stały adres interfejsu, dzięki czemu ustawienia zapisane
// w przeglądarce (szablon wiadomości, licznik, statystyki mapy) przetrwają
// zamknięcie aplikacji.
const UI_PORTS = [47318, 47319, 47320, 47321];

function startServer() {
  const handler = (req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(CLIENT_DIR, urlPath);
    if (!file.startsWith(CLIENT_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = SHELL;
    }
    if (!fs.existsSync(file)) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Brak pliku interfejsu: " + path.basename(file));
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.end());
    stream.pipe(res);
  };

  const tryPort = (index) =>
    new Promise((resolve) => {
      const server = http.createServer(handler);
      const port = UI_PORTS[index];
      server.once("error", () => {
        server.close();
        if (index + 1 < UI_PORTS.length) resolve(tryPort(index + 1));
        else {
          const fallback = http.createServer(handler);
          fallback.listen(0, "127.0.0.1", () => resolve(fallback.address().port));
        }
      });
      server.listen(port, "127.0.0.1", () => resolve(port));
    });

  return tryPort(0);
}

// Serwer UI startuje raz — widget i okno główne korzystają z tego samego portu.
let serverPortPromise = null;
function startServerOnce() {
  if (!serverPortPromise) serverPortPromise = startServer();
  return serverPortPromise;
}

let mainWindow = null;

async function createWindow() {
  const port = await startServerOnce();
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "LeadFinder B2B",
    backgroundColor: "#00000000",
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
  return win;
}

// ---------- Widget pulpitowy (Apple-style) ----------
let widgetWindow = null;
let widgetMenuItem = null;

async function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }
  const port = await startServerOnce();
  widgetWindow = new BrowserWindow({
    width: 380,
    height: 480,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    frame: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "LeadFinder Widget",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  widgetWindow.loadURL(`http://127.0.0.1:${port}/widget`);
  widgetWindow.on("closed", () => {
    widgetWindow = null;
    if (widgetMenuItem) widgetMenuItem.checked = false;
  });
}

function toggleWidget(show) {
  if (show) void createWidgetWindow();
  else if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
}

function buildAppMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "Widok",
      submenu: [
        {
          id: "toggle-widget",
          label: "Pokaż pulpitowy widget B2B",
          type: "checkbox",
          checked: false,
          click: (item) => {
            widgetMenuItem = item;
            toggleWidget(item.checked);
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const WIDGET_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

ipcMain.handle("widget:getStats", () => {
  const leads = readLeads();
  const emails = readJson(dataFile("email-leads.json"), []).filter((r) => r.channel_type === "EMAIL");
  const today = new Date().toISOString().slice(0, 10);
  let sent = { total: 0, today: 0, day: today };
  try {
    sent = JSON.parse(readJson(PREFS_FILE(), {})["leadfinder.sent-messages"] || "{}");
  } catch { /* licznik jeszcze nie istnieje */ }
  const sentToday = sent.day === today ? Number(sent.today) || 0 : 0;
  const dayName = WIDGET_DAYS[new Date().getDay()];
  const ap = autopilot ? autopilot.snapshot() : null;
  const plan = ap?.weeklySchedule?.find((p) => p.day === dayName);
  const pending = (ap?.batches ?? [])
    .filter((b) => b.status === "pending" || b.status === "scheduled")
    .map((b) => ({
      id: b.id,
      source: b.source,
      status: b.status,
      count: b.leads?.length ?? 0,
      sendAt: b.sendAt || null,
      channel: b.channel_type || "SMS",
    }));
  return {
    leadsSms: leads.length,
    leadsEmail: emails.length,
    hot: leads.filter((l) => l.status === "odpisal").length,
    sentToday,
    sentTotal: Number(sent.total) || 0,
    plan: plan?.enabled
      ? {
          scanTime: plan.scanTime,
          source: plan.source,
          query: plan.queryOrPkd,
          voivodeship: plan.voivodeship,
          limit: plan.dailyTargetLimit,
          channel: plan.channel_type || "SMS",
        }
      : null,
    pending,
    autopilotActive: Boolean(ap?.weeklySchedule?.some((p) => p.enabled)),
  };
});

ipcMain.handle("widget:show", async () => {
  await createWidgetWindow();
  widgetMenuItem = Menu.getApplicationMenu()?.getMenuItemById("toggle-widget") || null;
  if (widgetMenuItem) widgetMenuItem.checked = true;
});

ipcMain.handle("widget:openMain", async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : await createWindow();
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (win.isFullScreen()) {
    await new Promise(resolve => { win.once("leave-full-screen", resolve); win.setFullScreen(false); });
  }
  const display = secondaryDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay());
  const origin = widgetWindow && !widgetWindow.isDestroyed() ? widgetWindow.getBounds() : win.getBounds();
  win.show();
  win.focus();
  await animateWindowToSecondaryDisplay(win, origin, display, { reducedMotion: Boolean(nativeTheme.prefersReducedMotion) });
});

app.whenReady().then(() => {
  // Otwarcie bazy (z jednorazową migracją) i codzienna kopia zapasowa.
  try {
    const handle = dataStore();
    if (handle.state === "sqlite") handle.store.backupIfDue();
  } catch (err) {
    console.warn("Kopia zapasowa bazy nie powiodła się:", String(err?.message || err));
  }
  buildAppMenu();
  createWindow();
  startBackgroundReplyMonitor();
  initAutopilot();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let autopilot;
let emailEngine;
let inbox;

/** Jedna odpowiedź SMS do klienta, który już odpisał (zatwierdzona w skrzynce). */
async function sendSmsReply(phone, body) {
  if (!validatePolishMobile(phone).isValidMobile) throw new Error("Niepoprawny numer telefonu.");
  const scriptPath = path.join(os.tmpdir(), "leadfinder-imessage.scpt");
  fs.writeFileSync(scriptPath, APPLESCRIPT);
  const res = await bulkLimiter.schedule(() => runScript(scriptPath, phone, body));
  if (!res.ok) throw new Error(res.error || "Wiadomości nie wysłały SMS-a.");
  return res;
}

const CATEGORY_ICON = { odmowa: "🚫", nieufnosc: "🚫", autoodpowiedz: "🤖", nie_teraz: "⏳", cena: "💰", zainteresowany: "🔥", pytanie: "❓", inne: "✉️" };
const CATEGORY_NAME = { odmowa: "odmowa", nieufnosc: "nieufność", autoodpowiedz: "autoodpowiedź", nie_teraz: "nie teraz", cena: "pytanie o cenę", zainteresowany: "zainteresowany", pytanie: "pytanie", inne: "inne" };

/** Powiadomienie o nowej odpowiedzi: okno aplikacji i Telegram ze szkicem oraz przyciskami decyzji. */
function announceInboxMessage(m) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send("inbox:changed"); } catch {}
  }
  if (!autopilot?.notifyOwner || m.status === "ignored") return;
  const who = m.leadName || m.address || "klient";
  const head = `${CATEGORY_ICON[m.category] || "✉️"} ${who} (${m.channel === "email" ? "e-mail" : "SMS"}): ${CATEGORY_NAME[m.category] || m.category}`;
  const quote = m.body ? `\n„${String(m.body).slice(0, 600)}”` : "\n(treść niedostępna — otwórz Wiadomości na Macu)";
  if (m.status === "blocked") {
    autopilot.notifyOwner(`${head}${quote}\n\nKontakt zablokowany. Nie dostanie kolejnej wiadomości.`);
    return;
  }
  const buttons = [];
  if (!m.needsEdit) buttons.push({ text: "✅ Wyślij", callback_data: `INBOX:ok:${m.id}` });
  buttons.push({ text: "⏭ Pomiń", callback_data: `INBOX:no:${m.id}` }, { text: "🚫 Zablokuj", callback_data: `INBOX:bl:${m.id}` });
  const draft = m.needsEdit ? "\n\nBrak gotowej odpowiedzi — napisz ją w aplikacji (Skrzynka)." : `\n\nPropozycja odpowiedzi${m.draftFromAi ? " (AI)" : ""}:\n${m.draft}`;
  autopilot.notifyOwner(`${head}${quote}${draft}`, { inline_keyboard: [buttons] });
}
const localEvent = {sender: {send() {}, isDestroyed: () => true}};
function initAutopilot() {
  const changed = () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send("autopilot:changed"); };
  ({ emailEngine, inbox } = createOutreach({
    email: {
      file:dataFile,read:readJson,write:writeJson,db:blockDb,sleep,fetch:harvestFetch,
      ceidg:ceidgGet,ceidgBase:CEIDG_BASE,ceidgKey:()=>readSettings().ceidgApiKey,
      changed:()=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send("email:changed");},
      encrypt:t=>{if(!safeStorage.isEncryptionAvailable())throw new Error("Szyfrowanie skrzynki niedostępne.");return safeStorage.encryptString(t).toString("base64");},
      decrypt:t=>safeStorage.decryptString(Buffer.from(t,"base64")),
      templates:()=>{try{return JSON.parse(readJson(PREFS_FILE(),{})["leadfinder.email-templates"]||"{}");}catch{return {};}},
      website:async (url,email)=>{
        const domain=email.split("@")[1];
        if(!url&&!['gmail.com','wp.pl','onet.pl','interia.pl','o2.pl','outlook.com','hotmail.com','yahoo.com'].includes(domain))url=`https://${domain}`;
        if(!url)return "NO_WEBSITE";
        try{const audit=await auditWebsiteHealth(url);if(!audit.isTargetLead)return "HEALTHY";return /ssl/i.test(audit.issueTag||"")?"NO_SSL":/wygas|błąd/i.test(audit.issueTag||"")?"EXPIRED_OR_ERROR":"UNKNOWN";}catch{return "UNKNOWN";}
      },
    },
    inboxDb: () => { const h = dataStore(); return h.state === "sqlite" ? h.store.db : null; },
    read: (name, fallback) => readJson(dataFile(name), fallback),
    write: (name, value) => writeJson(dataFile(name), value),
    encrypt: t => { if (!safeStorage.isEncryptionAvailable()) throw new Error("Szyfrowanie klucza niedostępne."); return safeStorage.encryptString(t).toString("base64"); },
    decrypt: t => safeStorage.decryptString(Buffer.from(t, "base64")),
    fetchImpl: (url, init) => fetch(url, init),
    blockPhone: address => {
      const key = blacklistKey(address), c = blockDb();
      if (key && c) c.prepare("INSERT OR IGNORE INTO blacklist (phone, added_at) VALUES (?, ?)").run(key, Date.now());
    },
    // Bez działającej bazy traktujemy każdy kontakt jak zablokowany (wysyłka wstrzymana).
    isBlocked: ({ channel, address }) => { const h = dataStore(); return h.state !== "sqlite" || h.store.suppression.isBlocked(channel === "email" ? { email: address } : { phone: address }); },
    sendSms: sendSmsReply,
    notify: announceInboxMessage,
  }));
  autopilot = createAutopilot({
    inboxCallback: data => inbox.handleCallback(data),
    file: dataFile, read: readJson, write: writeJson, changed,
    leads: () => [...readLeads(), ...Object.keys(readJson(dataFile("sms-ledger.json"), {})).map(telefon => ({telefon, sms_reserved_at: true}))],
    blocked: () => {const c=blockDb(); return c ? c.prepare("SELECT phone FROM blacklist").all().map(r=>r.phone) : [];},
    validPhone: p => validatePolishMobile(p).isValidMobile,
    email:emailEngine,
    openHistory: openChatDb, closeHistory: closeChatDb, history: historyHasPhone,
    block: () => powerSaveBlocker.start("prevent-app-suspension"),
    unblock: id => {if(powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);},
    encrypt: t => {if(!safeStorage.isEncryptionAvailable()) throw new Error("Szyfrowanie tokenu na Macu jest niedostępne."); return safeStorage.encryptString(t).toString("base64");},
    decrypt: t => safeStorage.decryptString(Buffer.from(t,"base64")),
    isSending: () => sending,
    // Telefon jako pilot TV: komendy z Telegrama sterują interfejsem na ekranie Maca.
    remoteCommand: cmd => {
      const wins = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
      if (!wins.length) return false;
      for (const w of wins) w.webContents.send("remote:command", cmd);
      return true;
    },
    pauseBulk: () => { bulkPaused = true; },
    resumeBulk: () => { bulkPaused = false; },
    bulkStatus: () => ({ running: sending, paused: bulkPaused, sent: bulkState.sent, queued: bulkState.queued, total: bulkState.total }),
    send: async (items, speed) => {
      const results = await sendBulk(localEvent, items, {forceSend: false, ...speed});
      const count = results.filter(r=>r.ok).length;
      if(count) {
        const prefs=readJson(PREFS_FILE(),{}), today=new Date().toISOString().slice(0,10);
        let prev={total:0,today:0,day:today};try {prev=JSON.parse(prefs["leadfinder.sent-messages"]||"{}");}catch {}
        const counter={total:(Number(prev.total)||0)+count,today:(prev.day===today?Number(prev.today)||0:0)+count,day:today};
        prefs["leadfinder.sent-messages"]=JSON.stringify(counter);writeJson(PREFS_FILE(),prefs);
        for(const w of BrowserWindow.getAllWindows()) if(!w.isDestroyed()) {w.webContents.send("autopilot:counter",counter);w.webContents.send("leads:changed");}
      }
      return results;
    },
    insert: rows => {writeLeads([...readLeads(), ...rows.map(r=>({...r,created_at:new Date().toISOString(),status:"nowy"}))]); for(const w of BrowserWindow.getAllWindows()) w.webContents.send("leads:changed");},
    hasWebsite: async row => {
      const html=await fetchPageText(`https://duckduckgo.com/html/?q=${encodeURIComponent(`${row.nazwa} ${row.miasto||""}`)}`,8000);
      if(!html || /anomaly|captcha/i.test(html)) throw new Error("DuckDuckGo nie pozwolił zweryfikować stron — misja wstrzymana bez wysyłki.");
      return Boolean(await findOwnSiteWithPhone(row.nazwa,row.miasto,row.telefon));
    },
    scan: async p => {
      let r;
      if(p.source==="CEIDG") r=await searchCeidg(localEvent,{pkd:p.queryOrPkd,voivodeship:p.voivodeship,dateFrom:new Date(Date.now()-7*86400000).toISOString().slice(0,10)});
      else if(p.source==="OLX") r=await searchOlx(localEvent,{query:p.queryOrPkd,voivodeship:p.voivodeship,maxResults:p.dailyTargetLimit,checkDuckDuckGo:true});
      else {
        const rows=[];
        for(const city of p.cities || [p.voivodeship]) {
          const part=await searchMaps(localEvent,{keyword:p.queryOrPkd,city,auditSites:true});
          if(!part.ok) throw new Error(part.error);
          rows.push(...part.leads); if(rows.length>=p.dailyTargetLimit) break;
        }
        r={ok:true,leads:rows};
      }
      if(!r.ok) throw new Error(r.error);
      return r.leads.map(l=>({...l,nazwa:l.nazwa||l.name,telefon:l.telefon||l.phone,miasto:l.miasto||l.city,strona:l.website||null,zrodlo:p.source==="GOOGLE_MAPS"?"Google Maps":p.source,kategoria:l.kategoria||l.category||p.queryOrPkd,wojewodztwo:p.voivodeship,website_issue_type:p.source==="OLX"?"OLX_NO_WEBSITE": /ssl/i.test(l.issueTag||"")?"NO_SSL":/mobil/i.test(l.issueTag||"")?"NO_MOBILE":l.issueTag?"EXPIRED_OR_ERROR":"NO_WEBSITE"}));
    },
    message: l => {
      const defaults=require("./issue-defaults.json");
      let templates={}; try {templates=JSON.parse(readJson(PREFS_FILE(),{})["leadfinder.issue-templates"]||"{}");} catch {}
      const type=l.website_issue_type||"NO_WEBSITE";
      let body=templates[type]||defaults[type];
      body=body.replace(/\{(\w+)\}/g,(_,k)=>String(({...l,branza:l.kategoria,wolna_domena:l.suggested_free_domain||""})[k]||""));
      // Resolve innermost spintax groups until none remain.
      while(/\{[^{}]*\|[^{}]*\}/.test(body)) body=body.replace(/\{([^{}]*\|[^{}]*)\}/g,(_,s)=>{const a=s.split("|");return a[Math.floor(Math.random()*a.length)];});
      return {sms_exact_text:body.replace(/\s{2,}/g," ").trim(),sms_combination_signature:`[TYP: ${type}]`};
    },
    remoteEvents: (selfPhone, commandCursor, replyCursor) => {
      const conn=openChatDb();
      if(!conn) return {commandCursor,replyCursor,approve:false,replies:[]};
      try {
        const max=Number(conn.prepare("SELECT MAX(ROWID) AS n FROM message").get()?.n||0);
        const self=validatePolishMobile(selfPhone);
        const approve=commandCursor!==null && self.isValidMobile && !!conn.prepare("SELECT m.ROWID FROM message m JOIN handle h ON h.ROWID=m.handle_id WHERE m.ROWID>? AND m.is_from_me=1 AND h.id LIKE ? AND UPPER(TRIM(m.text)) IN ('START SMS','AKCEPTUJ') LIMIT 1").get(commandCursor,`%${self.nineDigits}`);
        const replies=[];
        if(replyCursor!==null) for(const row of conn.prepare("SELECT m.text,h.id FROM message m JOIN handle h ON h.ROWID=m.handle_id WHERE m.ROWID>? AND m.is_from_me=0 ORDER BY m.ROWID").all(replyCursor)) {
          const lead=readLeads().find(l=>l.sms_sent_at&&phoneDigits(l.telefon)===phoneDigits(row.id));
          if(lead) replies.push({name:lead.nazwa,phone:lead.telefon,text:row.text});
        }
        return {commandCursor:max,replyCursor:max,approve,replies};
      } finally {closeChatDb(conn);}
    },
  });
  const stop=autopilot.start(); app.on("before-quit",stop);
}
for (const name of ["list", "counts", "approve", "dismiss", "block", "settings", "configure", "testAi"]) {
  ipcMain.handle(`inbox:${name}`, async (_e, ...args) => {
    if (!inbox) throw new Error("Skrzynka odpowiedzi uruchamia się.");
    const result = await inbox[name](...args);
    if (["approve", "dismiss", "block"].includes(name)) {
      for (const w of BrowserWindow.getAllWindows()) { try { if (!w.isDestroyed()) w.webContents.send("inbox:changed"); } catch {} }
    }
    return result;
  });
}
for(const name of ["snapshot","configure","run","action","test","testReport","remoteReport"]) ipcMain.handle(`autopilot:${name}`,async (_e,...args)=>{
  if(!autopilot) throw new Error("Autopilot uruchamia się.");
  return autopilot[name](...args);
});
for(const name of ["list","insert","update","remove","blacklist","blocked","checkDomain","settings","configure","test","syncReplies","status","control"])ipcMain.handle(`email:${name}`,async (_e,...args)=>{if(!emailEngine)throw new Error("Moduł e-mail uruchamia się.");return emailEngine[name](...args);});
// sendBulk z głęboką walidacją MX przed pierwszą próbą SMTP — odrzuca adresy
// z nieistniejącymi domenami, żeby chronić konto przed Hard Bounce.
ipcMain.handle("email:sendBulk",async (event,ids,consent)=>{
  if(!emailEngine) throw new Error("Moduł e-mail uruchamia się.");
  const all=await emailEngine.list();
  const targets=all.filter(l=>ids.includes(l.id)&&l.email);
  const {leads:valid,dropped}=await validateEmailList(targets,p=>{try{if(!event.sender.isDestroyed())event.sender.send("email:progress",{name:`Weryfikacja MX: ${p.name}`,found:0});}catch{}});
  if(dropped>0){
    const validIds=new Set(valid.map(l=>l.id));
    for(const l of targets) if(!validIds.has(l.id)) await emailEngine.update(l.id,{status:"blad_wysylki",notatki:`Odrzucono przy weryfikacji MX (${l.email})`});
  }
  for(const l of valid) if(l.email_verified) await emailEngine.update(l.id,{email_verified:true});
  return emailEngine.sendBulk(valid.map(l=>l.id),consent);
});
// Harvest z walidacją MX każdego znalezionego adresu — tylko istniejące skrzynki trafiają do bazy.
ipcMain.handle("email:harvestByNiche",async (event,params)=>{
  if(!emailEngine) throw new Error("Moduł e-mail uruchamia się.");
  const result=await emailEngine.harvest(params,p=>{if(!event.sender.isDestroyed())event.sender.send("email:progress",p);});
  const leads=result?.leads??[];
  if(leads.length){
    try{if(!event.sender.isDestroyed())event.sender.send("email:progress",{name:"Weryfikacja rekordów MX znalezionych adresów…",found:leads.length});}catch{}
    const {leads:valid,dropped}=await validateEmailList(leads);
    return {...result,leads:valid,warnings:[...(result.warnings??[]),...(dropped?[`Odrzucono ${dropped} adresów z nieistniejącymi domenami (brak MX).`]:[])]};
  }
  return result;
});
