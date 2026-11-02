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
    const raw = [];
    const keyword = String(params?.keyword ?? "").trim();
    const city = String(params?.city ?? "").trim();
    const voivodeship = String(params?.voivodeship ?? "").trim();
    const sources = params?.sources ?? { maps: true, olx: true, ceidg: true };
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
              reviews: 0,
              is_promoted_ad: l.isPromoted === true,
              social_only: l.socialOnly === true,
              olx_url: l.olxUrl || null,
            }),
          );
        }
      }
    }

    if (sources.ceidg) {
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
  function worthAuditing(r) {
    return (
      deps.validatePolishMobile(r.telefon ?? "").isValidMobile &&
      !isCorporateName(r.nazwa) &&
      (r.reviews ?? 0) <= rules.thresholds.maxReviews
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
      const toAudit = raw.filter((r) => ownSite(r) && worthAuditing(r));
      const rivals = raw
        .filter(
          (r) =>
            ownSite(r) &&
            !worthAuditing(r) &&
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
      const needsDomain = raw.filter((r) => {
        if (!worthAuditing(r)) return false;
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
  analyzeHtml,
  auditSite,
  createSniperScanner,
  isCorporateName,
  isSocialUrl,
  isFreeBuilderUrl,
  hostOf,
  mapLimit,
};
