// Snajper Top 50 — głęboki skan dla 5-stopniowego sita.
// Zbiera surowe firmy (Mapy Google / OLX / CEIDG), robi audyt techniczny stron
// (HTTP, TLS, viewport, CMS, piksele reklamowe, rok w stopce) oraz sprawdza
// wolne domeny .pl. Punktację i odcięcie Top 50 liczy renderer w
// src/lib/sniper-sieve.ts — tutaj zbieramy tylko fakty.
// Skanery i sieć są wstrzykiwane, więc logikę da się testować bez Electrona.

const cheerio = require("cheerio");
const rules = require("../sniper-rules.json");

const AUDIT_TIMEOUT_MS = 6000;
const AUDIT_CONCURRENCY = 4;
const DOMAIN_CONCURRENCY = 3;
const COMPETITOR_AUDITS = 12;

function hostOf(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSocialUrl(url) {
  const host = hostOf(url);
  return (
    Boolean(host) &&
    rules.socialHosts.some((h) => host === h || host.endsWith(`.${h}`))
  );
}

function isFreeBuilderUrl(url) {
  const host = hostOf(url);
  return Boolean(host) && rules.freeBuilderHosts.some((h) => host.includes(h));
}

function isCorporateName(name) {
  const text = ` ${String(name ?? "")
    .toLocaleLowerCase("pl")
    .replace(/\s+/g, " ")} `;
  return rules.corporateWords.some((word) => {
    const escaped = word
      .toLocaleLowerCase("pl")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^a-ząćęłńóśźż0-9])${escaped}(?=$|[^a-ząćęłńóśźż0-9])`,
      "i",
    ).test(text);
  });
}

/** Analiza HTML w stylu Wappalyzer/Lighthouse-lite — czysta funkcja. */
function analyzeHtml(html) {
  const source = String(html ?? "");
  const $ = cheerio.load(source);
  const hasMobileViewport = $('meta[name="viewport" i]').length > 0;
  const generator = String($('meta[name="generator" i]').attr("content") ?? "");

  let detectedCmsOrBuilder = "Własny kod";
  const wpVersion = generator.match(/wordpress\s*([\d.]+)/i)?.[1] ?? null;
  if (
    /wordpress/i.test(generator) ||
    /\/wp-content\/|\/wp-includes\//i.test(source)
  ) {
    const major = wpVersion ? Number(wpVersion.split(".")[0]) : null;
    detectedCmsOrBuilder =
      major !== null && major < 6 ? "WordPress Old" : "WordPress";
  } else if (
    /static\.wixstatic\.com|wix\.com/i.test(source) ||
    /wix/i.test(generator)
  ) {
    detectedCmsOrBuilder = "Wix";
  } else if (/joomla/i.test(generator) || /\/media\/jui\//i.test(source)) {
    detectedCmsOrBuilder = "Joomla";
  } else if (/drupal/i.test(generator)) {
    detectedCmsOrBuilder = "Drupal";
  } else if (
    /webflow/i.test(generator) ||
    /assets\.website-files\.com/i.test(source)
  ) {
    detectedCmsOrBuilder = "Webflow";
  } else if (/cdn\.shopify\.com/i.test(source)) {
    detectedCmsOrBuilder = "Shopify";
  } else if (/squarespace/i.test(source)) {
    detectedCmsOrBuilder = "Squarespace";
  } else if (/prestashop/i.test(generator) || /prestashop/i.test(source)) {
    detectedCmsOrBuilder = "PrestaShop";
  } else if (/webnode/i.test(source)) {
    detectedCmsOrBuilder = "Webnode";
  }

  const hasAdPixels =
    /connect\.facebook\.net\/[a-z_A-Z]+\/fbevents\.js/.test(source) ||
    /fbq\(\s*['"]init['"]/.test(source) ||
    /googletagmanager\.com\/gtag\/js\?id=AW-/i.test(source) ||
    /gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i.test(source);

  // Bierzemy najnowszy rok z noty copyright (zakres „2015–2024” → 2024).
  let copyrightYear = null;
  const text = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const re =
    /(?:©|&copy;|&#169;|copyright)\s*(?:\(c\)\s*)?(?:((?:19|20)\d{2})\s*(?:[-–—]|&ndash;|&mdash;)\s*)?((?:19|20)\d{2})/gi;
  for (const m of text.matchAll(re)) {
    const year = Number(m[2]);
    if (
      year >= 1995 &&
      year <= 2100 &&
      (copyrightYear === null || year > copyrightYear)
    )
      copyrightYear = year;
  }

  return {
    hasMobileViewport,
    detectedCmsOrBuilder,
    hasAdPixels,
    copyrightYear,
  };
}

function errorCode(err) {
  return String(err?.cause?.code ?? err?.code ?? err?.name ?? "");
}

/**
 * Audyt techniczny jednej strony. fetchImpl jest wstrzykiwany (globalny fetch
 * w Electronie). Zwraca TechAuditResult; whoisFreeDomain uzupełnia skaner.
 */
async function auditSite(
  rawUrl,
  { fetchImpl, now = () => Date.now(), userAgent },
) {
  const host = hostOf(rawUrl);
  const empty = {
    httpStatus: null,
    hasSsl: false,
    hasMobileViewport: false,
    detectedCmsOrBuilder: "Brak",
    hasAdPixels: false,
    copyrightYear: null,
    responseTimeMs: null,
    whoisFreeDomain: null,
    dnsMissing: false,
  };
  if (!host) return empty;
  let path = "/";
  try {
    path =
      new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
        .pathname || "/";
  } catch {
    path = "/";
  }
  const headers = {
    "User-Agent": userAgent,
    "Accept-Language": "pl-PL,pl;q=0.9",
  };
  const attempt = async (url) => {
    const started = now();
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
    });
    const html = res.status < 400 ? (await res.text()).slice(0, 600000) : "";
    return { res, html, ms: now() - started };
  };

  let result = null;
  let httpsOk = false;
  let dnsMissing = false;
  try {
    result = await attempt(`https://${host}${path}`);
    httpsOk = true;
  } catch (err) {
    if (/ENOTFOUND|EAI_AGAIN/.test(errorCode(err))) dnsMissing = true;
    try {
      result = await attempt(`http://${host}${path}`);
      dnsMissing = false;
    } catch (err2) {
      if (/ENOTFOUND|EAI_AGAIN/.test(errorCode(err2))) dnsMissing = true;
      return { ...empty, dnsMissing };
    }
  }
  const finalUrl = String(result.res.url || "");
  const hasSsl =
    httpsOk && (finalUrl === "" || finalUrl.startsWith("https://"));
  if (result.res.status >= 400) {
    return {
      ...empty,
      httpStatus: result.res.status,
      hasSsl,
      responseTimeMs: result.ms,
    };
  }
  const dom = analyzeHtml(result.html);
  return {
    httpStatus: result.res.status,
    hasSsl,
    hasMobileViewport: dom.hasMobileViewport,
    detectedCmsOrBuilder: dom.detectedCmsOrBuilder,
    hasAdPixels: dom.hasAdPixels,
    copyrightYear: dom.copyrightYear,
    responseTimeMs: result.ms,
    whoisFreeDomain: null,
    dnsMissing: false,
  };
}

const EMAIL_FIND_RE =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g;
const FREE_MAILBOXES = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
  "msn.com",
  "live.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
  "wp.pl",
  "onet.pl",
  "interia.pl",
  "o2.pl",
]);
const GENERIC_LOCAL_PARTS = [
  "info",
  "contact",
  "office",
  "hello",
  "sales",
  "admin",
  "service",
  "support",
  "estimates",
  "quotes",
];
const PLACEHOLDER_EMAIL_RE =
  /^(?:you|your|name|email|user|example|test|someone|john\.?doe|jane\.?doe|firstname|username)@|@(?:example|domain|email|yourdomain|mysite|sentry|wixpress|godaddy)\./;

/** Adresy e-mail z kodu strony: linki mailto i tekst, bez plików graficznych i atrap. */
function extractPageEmails(html) {
  const $ = cheerio.load(String(html ?? ""));
  const chunks = [];
  $('a[href^="mailto:" i]').each((_, el) => {
    try {
      chunks.push(
        decodeURIComponent(String($(el).attr("href")).slice(7).split("?")[0]),
      );
    } catch {
      /* uszkodzony link mailto */
    }
  });
  $("script,style,noscript,svg").remove();
  chunks.push($("body").text());
  const found = new Set();
  for (const chunk of chunks) {
    for (const match of String(chunk).match(EMAIL_FIND_RE) ?? []) {
      const email = match.toLowerCase().replace(/\.$/, "");
      if (email.length > 254) continue;
      if (/\.(?:png|jpe?g|gif|webp|svg|avif|css|js)$/.test(email)) continue;
      if (PLACEHOLDER_EMAIL_RE.test(email)) continue;
      found.add(email);
    }
  }
  return [...found];
}

/**
 * Wybiera adres firmy: najpierw ogólny we własnej domenie (info@, contact@),
 * potem dowolny we własnej domenie, na końcu darmowa skrzynka. Adresy w cudzych
 * domenach (np. agencji, która robiła stronę) pomijamy.
 */
function pickBusinessEmail(emails, siteHost) {
  const host = String(siteHost ?? "").replace(/^www\./, "");
  const own = emails.filter(
    (e) => host && (e.endsWith(`@${host}`) || e.endsWith(`.${host}`)),
  );
  for (const local of GENERIC_LOCAL_PARTS) {
    const hit = own.find((e) => e.startsWith(`${local}@`));
    if (hit) return hit;
  }
  if (own.length) return own[0];
  return emails.find((e) => FREE_MAILBOXES.has(e.split("@")[1])) ?? null;
}

/** Szuka adresu e-mail firmy na stronie głównej i podstronie kontaktowej. */
async function findSiteEmail(rawUrl, { fetchImpl, userAgent }) {
  const host = hostOf(rawUrl);
  if (!host) return null;
  const start = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const headers = {
    "User-Agent": userAgent,
    "Accept-Language": "en-US,en;q=0.9",
  };
  const load = async (url) => {
    try {
      const res = await fetchImpl(url, {
        redirect: "follow",
        headers,
        signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
      });
      return res.status < 400 ? (await res.text()).slice(0, 600000) : "";
    } catch {
      return "";
    }
  };
  const home = await load(start);
  if (!home) return null;
  const emails = extractPageEmails(home);
  let pick = pickBusinessEmail(emails, host);
  if (pick) return pick;
  const $ = cheerio.load(home);
  const links = [];
  $("a[href]").each((_, el) => {
    const label = `${$(el).attr("href")} ${$(el).text()}`;
    if (!/contact|about|get-in-touch|kontakt/i.test(label)) return;
    try {
      const u = new URL($(el).attr("href"), start);
      if (
        hostOf(u.href) === host &&
        /^https?:$/.test(u.protocol) &&
        !links.includes(u.href)
      )
        links.push(u.href);
    } catch {
      /* niepoprawny adres */
    }
  });
  for (const url of links.slice(0, 2)) {
    const page = await load(url);
    if (!page) continue;
    pick = pickBusinessEmail([...emails, ...extractPageEmails(page)], host);
    if (pick) return pick;
  }
  return null;
}

/** Uruchamia zadania z ograniczoną współbieżnością, zachowując kolejność wyników. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function baseRaw(patch) {
  return {
    id: "",
    source: "GOOGLE_MAPS",
    nazwa: "",
    telefon: null,
    miasto: null,
    adres: null,
    kategoria: null,
    website: null,
    email: null,
    owner_name: null,
    rating: null,
    reviews: null,
    is_promoted_ad: false,
    social_only: false,
    ceidg_start_date: null,
    nip: null,
    mapy_url: null,
    olx_url: null,
    tech_audit: null,
    whois_free_domain: null,
    ...patch,
  };
}

function isoDaysAgo(days, nowMs) {
  return new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Fabryka skanera. deps:
 *  scrapeGoogleMaps(keyword, city) → { ok, items, error }
 *  searchOlx(event, params) → { ok, leads, error }
 *  searchCeidg(event, params) → { ok, leads, error }
 *  hasCeidgKey() → boolean
 *  validatePolishMobile(phone) → { isValidMobile }
 *  suggestDomains(name, city) → string[]
 *  checkDomainAvailability(domain) → { available }
 *  fetchImpl, userAgent, now()
 */
function createSniperScanner(deps) {
  const now = deps.now ?? (() => Date.now());

  async function collect(params, progress, notes) {
    const video = params?.offer === "video_ads";
    const abroad = Boolean(params?.market) && params.market !== "PL";
    const raw = [];
    const keyword = String(params?.keyword ?? "").trim();
    const city = String(params?.city ?? "").trim();
    const voivodeship = String(params?.voivodeship ?? "").trim();
    // OLX i CEIDG to polskie źródła — poza Polską zostają same Mapy Google.
    const sources = abroad
      ? { maps: true, olx: false, ceidg: false }
      : (params?.sources ?? { maps: true, olx: true, ceidg: true });
    const relay = { sender: { send: () => {} } };

    if (sources.maps) {
      if (!city) notes.push("Mapy Google pominięte — podaj miasto.");
      else {
        progress({
          phase: "collect",
          label: `Mapy Google: „${keyword}” w ${city}`,
          index: 0,
          total: 3,
        });
        const res = await deps.scrapeGoogleMaps(keyword, city);
        if (!res?.ok)
          notes.push(`Mapy Google: ${res?.error ?? "brak wyników"}`);
        else {
          for (const it of res.items ?? []) {
            if (!it?.name) continue;
            const id =
              String(it.url ?? "").match(/!1s([^!]+)/)?.[1] ??
              `${it.name}|${it.address ?? ""}`;
            raw.push(
              baseRaw({
                id: `gmaps/${id}`.slice(0, 160),
                source: "GOOGLE_MAPS",
                nazwa: String(it.name).trim(),
                telefon: it.phone || null,
                miasto: city,
                adres: it.address || null,
                kategoria: it.category || keyword,
                website: it.website || null,
                rating: Number(it.rating) || null,
                reviews: Number(it.reviews) || 0,
                mapy_url: it.url || null,
              }),
            );
          }
        }
      }
    }

    if (sources.olx) {
      progress({
        phase: "collect",
        label: `OLX Usługi: „${keyword}”`,
        index: 1,
        total: 3,
      });
      const res = await deps.searchOlx(relay, {
        query: keyword,
        city,
        voivodeship,
        maxResults: 50,
        // Wideo: ogłoszeniodawca z własną stroną to dobry klient, nie odrzucamy go.
        keepOwnSite: video,
      });
      if (!res?.ok) notes.push(`OLX: ${res?.error ?? "brak wyników"}`);
      else {
        for (const l of res.leads ?? []) {
          raw.push(
            baseRaw({
              id: String(l.id),
              source: "OLX",
              nazwa: String(l.nazwa ?? "").trim(),
              telefon: l.telefon || null,
              miasto: l.miasto || city || null,
              adres: l.adres || null,
              kategoria: l.kategoria || keyword,
              owner_name: l.contactName || null,
              website: l.website || null,
              reviews: 0,
              is_promoted_ad: l.isPromoted === true,
              social_only: l.socialOnly === true,
              olx_url: l.olxUrl || null,
            }),
          );
        }
      }
    }

    if (sources.ceidg && video) {
      notes.push(
        "CEIDG pominięte — przy reklamach wideo liczą się firmy z budżetem, a nie świeże rejestracje.",
      );
    } else if (sources.ceidg) {
      if (!deps.hasCeidgKey())
        notes.push("CEIDG pominięte — brak klucza API w Ustawieniach.");
      else if (!params?.pkd)
        notes.push("CEIDG pominięte — nisza nie ma kodu PKD.");
      else {
        progress({
          phase: "collect",
          label: "CEIDG: firmy założone w ostatnich 14 dniach",
          index: 2,
          total: 3,
        });
        const res = await deps.searchCeidg(relay, {
          dateFrom: isoDaysAgo(rules.thresholds.newCompanyDays, now()),
          pkd: params.pkd,
          voivodeship,
          enableDeepHarvest: false,
        });
        if (!res?.ok) notes.push(`CEIDG: ${res?.error ?? "brak wyników"}`);
        else {
          for (const l of res.leads ?? []) {
            raw.push(
              baseRaw({
                id: String(l.id),
                source: "CEIDG",
                nazwa: String(l.nazwa ?? "").trim(),
                telefon: l.telefon || null,
                miasto: l.miasto || null,
                adres: l.adres || null,
                kategoria: l.kategoria || null,
                email: l.email || null,
                owner_name: l.wlasciciel || l.imie || null,
                reviews: 0,
                ceidg_start_date: l.dataRozpoczecia
                  ? String(l.dataRozpoczecia).slice(0, 10)
                  : null,
                nip: l.nip || null,
              }),
            );
          }
        }
      }
    }
    return raw;
  }

  /** Lustro sita 1 — oszczędza audyty dla numerów, które i tak odpadną. */
  function worthAuditing(r, maxReviews, abroad = false) {
    return (
      (abroad || deps.validatePolishMobile(r.telefon ?? "").isValidMobile) &&
      !isCorporateName(r.nazwa) &&
      (r.reviews ?? 0) <= maxReviews
    );
  }

  async function runDeepScan(event, params) {
    const send = (data) => {
      try {
        event?.sender?.send("sniper-progress", data);
      } catch {
        /* okno mogło zostać zamknięte */
      }
    };
    const notes = [];
    const video = params?.offer === "video_ads";
    const abroad = Boolean(params?.market) && params.market !== "PL";
    const maxReviews = video
      ? rules.video.thresholds.maxReviews
      : rules.thresholds.maxReviews;
    try {
      const raw = await collect(params, send, notes);
      if (raw.length === 0) {
        return {
          ok: false,
          error: notes.length
            ? notes.join(" ")
            : "Żadne źródło nie zwróciło firm.",
          notes,
        };
      }

      // Audyt: kandydaci z własną domeną + kilka mocnych firm jako pula konkurentów.
      const ownSite = (r) =>
        r.website && !isSocialUrl(r.website) && !isFreeBuilderUrl(r.website);
      const toAudit = raw.filter(
        (r) => ownSite(r) && worthAuditing(r, maxReviews, abroad),
      );
      const rivals = raw
        .filter(
          (r) =>
            ownSite(r) &&
            !worthAuditing(r, maxReviews, abroad) &&
            (r.rating ?? 0) >= rules.thresholds.competitorMinRating,
        )
        .slice(0, COMPETITOR_AUDITS);
      const auditList = [...toAudit, ...rivals];
      let audited = 0;
      await mapLimit(auditList, AUDIT_CONCURRENCY, async (r) => {
        const audit = await auditSite(r.website, {
          fetchImpl: deps.fetchImpl,
          userAgent: deps.userAgent,
          now,
        });
        const { dnsMissing, ...techAudit } = audit;
        r.tech_audit = techAudit;
        r.__dnsMissing = dnsMissing;
        audited++;
        send({
          phase: "audit",
          label: `Audyt: ${r.nazwa}`,
          index: audited,
          total: auditList.length,
        });
      });

      // Wolne domeny: brak strony / social / kreator / awaria strony.
      // Wolne domeny są argumentem tylko w ofercie WWW.
      // Poza Polską kontaktujemy się e-mailem: szukamy adresu na stronie firmy.
      // Pomijamy nowoczesne strony (sito i tak je odrzuci) i strony, które nie działają.
      if (abroad) {
        const modern = (a) =>
          a &&
          a.httpStatus !== null &&
          a.httpStatus < 400 &&
          a.hasSsl &&
          a.hasMobileViewport &&
          a.responseTimeMs !== null &&
          a.responseTimeMs < rules.thresholds.fastSiteMs &&
          (a.copyrightYear === null ||
            a.copyrightYear >= rules.thresholds.outdatedBeforeYear);
        const reachable = raw.filter((r) => {
          if (
            !r.website ||
            isSocialUrl(r.website) ||
            !worthAuditing(r, maxReviews, abroad)
          )
            return false;
          if (isFreeBuilderUrl(r.website)) return true;
          const a = r.tech_audit;
          return a && a.httpStatus !== null && a.httpStatus < 400 && !modern(a);
        });
        let searched = 0;
        await mapLimit(reachable, AUDIT_CONCURRENCY, async (r) => {
          const email = await findSiteEmail(r.website, {
            fetchImpl: deps.fetchImpl,
            userAgent: deps.userAgent,
          });
          if (email) {
            const check = deps.validateEmail
              ? await deps.validateEmail(email).catch(() => null)
              : { ok: true };
            if (check?.ok) r.email = email;
          }
          searched++;
          send({
            phase: "audit",
            label: `E-mail: ${r.nazwa}`,
            index: searched,
            total: reachable.length,
          });
        });
        const withEmail = raw.filter((r) => r.email).length;
        notes.push(
          `Adres e-mail znaleziono dla ${withEmail} z ${reachable.length} firm ze słabą stroną.`,
        );
      }

      const needsDomain = raw.filter((r) => {
        if (video || abroad) return false;
        if (!worthAuditing(r, maxReviews, abroad)) return false;
        if (!ownSite(r)) return true;
        const a = r.tech_audit;
        return a && (a.httpStatus === null || a.httpStatus >= 400);
      });
      let checked = 0;
      await mapLimit(needsDomain, DOMAIN_CONCURRENCY, async (r) => {
        let free = null;
        // Wygasła własna domena (brak DNS) to najmocniejszy haczyk: „Pana domena jest wolna”.
        if (r.__dnsMissing && hostOf(r.website).endsWith(".pl")) {
          const own = await deps
            .checkDomainAvailability(hostOf(r.website))
            .catch(() => null);
          if (own?.available) free = hostOf(r.website);
        }
        if (!free) {
          for (const s of deps.suggestDomains(r.nazwa, r.miasto ?? "")) {
            const res = await deps
              .checkDomainAvailability(`${s}.pl`)
              .catch(() => null);
            if (res?.available) {
              free = `${s}.pl`;
              break;
            }
          }
        }
        r.whois_free_domain = free;
        if (r.tech_audit) r.tech_audit.whoisFreeDomain = free;
        checked++;
        send({
          phase: "domains",
          label: `Domena .pl: ${r.nazwa}`,
          index: checked,
          total: needsDomain.length,
        });
      });

      for (const r of raw) delete r.__dnsMissing;
      send({
        phase: "done",
        label: "Zebrano dane do sita",
        index: raw.length,
        total: raw.length,
      });
      return { ok: true, raw, notes };
    } catch (err) {
      return {
        ok: false,
        error: `Skan Snajpera przerwany: ${String(err?.message || err)}`,
        notes,
      };
    }
  }

  return { runDeepScan };
}

module.exports = {
  extractPageEmails,
  pickBusinessEmail,
  findSiteEmail,
  analyzeHtml,
  auditSite,
  createSniperScanner,
  isCorporateName,
  isSocialUrl,
  isFreeBuilderUrl,
  hostOf,
  mapLimit,
};
