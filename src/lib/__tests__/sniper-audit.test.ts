import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const {
  analyzeHtml,
  auditSite,
  createSniperScanner,
} = require("../../../electron/sniper-audit.cjs");

const OLD_PAGE = `<html><head><meta name="generator" content="WordPress 4.9.8"></head>
<body><script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<footer>&copy; 2012 - 2016 Stolarstwo Nowak</footer></body></html>`;

const MODERN_PAGE = `<html><head><meta name="viewport" content="width=device-width"></head>
<body><footer>© 2025 Meblex</footer></body></html>`;

function response(status: number, body: string, url: string) {
  return { status, url, text: async () => body };
}

describe("analizator DOM (Wappalyzer/Lighthouse-lite)", () => {
  it("wykrywa stary WordPress, piksel Meta i rok w stopce", () => {
    expect(analyzeHtml(OLD_PAGE)).toEqual({
      hasMobileViewport: false,
      detectedCmsOrBuilder: "WordPress Old",
      hasAdPixels: true,
      copyrightYear: 2016,
    });
  });

  it("wykrywa tag Google Ads i nowoczesny viewport", () => {
    const html = `<meta name="viewport" content="x"><script src="https://www.googletagmanager.com/gtag/js?id=AW-123"></script>`;
    const r = analyzeHtml(html);
    expect(r.hasMobileViewport).toBe(true);
    expect(r.hasAdPixels).toBe(true);
  });
});

describe("audyt strony", () => {
  it("brak HTTPS → próba po HTTP i hasSsl=false", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://"))
        throw Object.assign(new Error("tls"), {
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
        });
      return response(200, OLD_PAGE, url);
    };
    let t = 0;
    const r = await auditSite("nowak.pl", {
      fetchImpl,
      now: () => (t += 1200),
      userAgent: "test",
    });
    expect(calls).toEqual(["https://nowak.pl/", "http://nowak.pl/"]);
    expect(r.httpStatus).toBe(200);
    expect(r.hasSsl).toBe(false);
    expect(r.responseTimeMs).toBe(1200);
  });

  it("błąd DNS → httpStatus null i znacznik braku domeny", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new Error("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      });
    };
    const r = await auditSite("https://wygasla.pl", {
      fetchImpl,
      userAgent: "test",
    });
    expect(r.httpStatus).toBeNull();
    expect(r.dnsMissing).toBe(true);
  });
});

describe("skaner Snajpera", () => {
  it("zbiera Mapy/OLX, audytuje tylko sensowne strony i sprawdza domeny", async () => {
    const audited: string[] = [];
    const scanner = createSniperScanner({
      scrapeGoogleMaps: async () => ({
        ok: true,
        items: [
          {
            name: "Stolarstwo Nowak",
            phone: "601 234 567",
            website: "https://nowak.pl",
            rating: 4.8,
            reviews: 40,
            url: "x!1sAAA!",
          },
          {
            name: "Meblex",
            phone: "602 345 678",
            website: "https://meblex.pl",
            rating: 4.7,
            reviews: 80,
            url: "x!1sBBB!",
          },
          {
            name: "Sieć Mebli Polska",
            phone: "41 222 33 44",
            website: "https://siec.pl",
            rating: 4.1,
            reviews: 900,
            url: "x!1sCCC!",
          },
          {
            name: "Jan Kowalski Meble",
            phone: "603 456 789",
            website: null,
            rating: 4.9,
            reviews: 30,
            url: "x!1sDDD!",
          },
        ],
      }),
      searchOlx: async () => ({
        ok: true,
        leads: [
          {
            id: "olx-1",
            nazwa: "Kuchnie na wymiar",
            telefon: "+48604567890",
            miasto: "Kielce",
            isPromoted: true,
            contactName: "Tomasz",
            socialOnly: false,
            olxUrl: "u",
          },
        ],
      }),
      searchCeidg: async () => ({ ok: true, leads: [] }),
      hasCeidgKey: () => false,
      validatePolishMobile: (p: string) => ({
        isValidMobile: /^(\+48)?\s?6\d{2}/.test(String(p).replace(/\s/g, "")),
      }),
      suggestDomains: (name: string) => [
        name.toLowerCase().replace(/[^a-z]/g, ""),
      ],
      checkDomainAvailability: async (domain: string) => ({
        available: domain.startsWith("jan") || domain.startsWith("kuchnie"),
      }),
      fetchImpl: async (url: string) => {
        audited.push(url);
        return response(
          200,
          url.includes("meblex") ? MODERN_PAGE : OLD_PAGE,
          url,
        );
      },
      userAgent: "test",
    });
    const sent: unknown[] = [];
    const res = await scanner.runDeepScan(
      { sender: { send: (_c: string, d: unknown) => sent.push(d) } },
      {
        keyword: "meble",
        city: "Kielce",
        voivodeship: "świętokrzyskie",
        pkd: "31.02.Z",
        sources: { maps: true, olx: true, ceidg: true },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.raw).toHaveLength(5);
    expect(res.notes).toContain(
      "CEIDG pominięte — brak klucza API w Ustawieniach.",
    );
    expect(audited.some((u: string) => u.includes("siec.pl"))).toBe(false);
    const olx = res.raw.find((r: { id: string }) => r.id === "olx-1");
    expect(olx.is_promoted_ad).toBe(true);
    expect(olx.owner_name).toBe("Tomasz");
    expect(olx.whois_free_domain).toBe("kuchnienawymiar.pl");
    expect(
      res.raw.find((r: { nazwa: string }) => r.nazwa === "Jan Kowalski Meble")
        .whois_free_domain,
    ).toBe("jankowalskimeble.pl");
    expect(
      res.raw.find((r: { nazwa: string }) => r.nazwa === "Stolarstwo Nowak")
        .tech_audit.detectedCmsOrBuilder,
    ).toBe("WordPress Old");
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe("skaner Snajpera — oferta wideo", () => {
  it("zostawia OLX z własną stroną, pomija CEIDG i sprawdzanie domen", async () => {
    let olxParams: Record<string, unknown> = {};
    let domainChecks = 0;
    const scanner = createSniperScanner({
      scrapeGoogleMaps: async () => ({
        ok: true,
        items: [
          {
            name: "Detailing Nowak",
            phone: "601 234 567",
            website: "https://nowak.pl",
            rating: 4.9,
            reviews: 220,
            url: "x!1sAAA!",
          },
        ],
      }),
      searchOlx: async (_e: unknown, params: Record<string, unknown>) => {
        olxParams = params;
        return {
          ok: true,
          leads: [
            {
              id: "olx-2",
              nazwa: "Folie PPF",
              telefon: "+48604567890",
              miasto: "Kielce",
              website: "https://folie.pl",
              olxUrl: "u",
            },
          ],
        };
      },
      searchCeidg: async () => {
        throw new Error("CEIDG nie powinien być odpytany");
      },
      hasCeidgKey: () => true,
      validatePolishMobile: () => ({ isValidMobile: true }),
      suggestDomains: () => ["x"],
      checkDomainAvailability: async () => {
        domainChecks++;
        return { available: true };
      },
      fetchImpl: async (url: string) => response(200, MODERN_PAGE, url),
      userAgent: "test",
    });
    const res = await scanner.runDeepScan(null, {
      keyword: "folie ppf",
      city: "Kielce",
      voivodeship: "",
      pkd: "45.20.Z",
      offer: "video_ads",
      sources: { maps: true, olx: true, ceidg: true },
    });
    expect(res.ok).toBe(true);
    expect(olxParams["keepOwnSite"]).toBe(true);
    expect(domainChecks).toBe(0);
    expect(res.notes[0]).toMatch(/CEIDG pominięte/);
    // 220 opinii: przy ofercie wideo firma nadal jest audytowana (limit 400).
    expect(
      res.raw.find((r: { id: string }) => r.id.startsWith("gmaps/")).tech_audit
        .httpStatus,
    ).toBe(200);
    expect(res.raw.find((r: { id: string }) => r.id === "olx-2").website).toBe(
      "https://folie.pl",
    );
  });
});

describe("skaner Snajpera — rynek USA", () => {
  const {
    pickBusinessEmail,
    extractPageEmails,
  } = require("../../../electron/sniper-audit.cjs");

  it("wybiera adres firmy i pomija atrapy oraz cudze domeny", () => {
    const html = `<body><img src="logo@2x.png"><a href="mailto:Info@MillerRoofing.com?subject=Hi">Email</a> webmaster@agency.io you@example.com miller.roofing@gmail.com</body>`;
    const emails = extractPageEmails(html);
    expect(emails).toContain("info@millerroofing.com");
    expect(emails).not.toContain("logo@2x.png");
    expect(emails).not.toContain("you@example.com");
    expect(pickBusinessEmail(emails, "millerroofing.com")).toBe(
      "info@millerroofing.com",
    );
    expect(
      pickBusinessEmail(
        ["webmaster@agency.io", "miller.roofing@gmail.com"],
        "millerroofing.com",
      ),
    ).toBe("miller.roofing@gmail.com");
    expect(
      pickBusinessEmail(["webmaster@agency.io"], "millerroofing.com"),
    ).toBeNull();
  });

  it("używa tylko Map, nie wymaga polskiej komórki i znajduje e-mail na podstronie kontaktu", async () => {
    const fetched: string[] = [];
    const scanner = createSniperScanner({
      scrapeGoogleMaps: async (keyword: string, city: string) => ({
        ok: true,
        items: [
          {
            name: "Miller Roofing",
            phone: "(918) 555-0123",
            website: "http://millerroofing.com",
            rating: 4.8,
            reviews: 42,
            url: "x!1sAAA!",
            _q: `${keyword} ${city}`,
          },
          {
            name: "Summit Roofing",
            phone: "(918) 555-0199",
            website: "https://summitroofing.com",
            rating: 4.9,
            reviews: 60,
            url: "x!1sBBB!",
          },
          {
            name: "No Site Roofing",
            phone: "(918) 555-0111",
            website: null,
            rating: 4.5,
            reviews: 12,
            url: "x!1sCCC!",
          },
        ],
      }),
      searchOlx: async () => {
        throw new Error("OLX nie powinien być odpytany");
      },
      searchCeidg: async () => {
        throw new Error("CEIDG nie powinien być odpytany");
      },
      hasCeidgKey: () => true,
      validatePolishMobile: () => ({ isValidMobile: false }),
      validateEmail: async (email: string) => ({
        ok: !email.includes("bounce"),
      }),
      suggestDomains: () => {
        throw new Error("domeny .pl nie dotyczą USA");
      },
      checkDomainAvailability: async () => ({ available: true }),
      fetchImpl: async (url: string) => {
        fetched.push(url);
        if (url.includes("summitroofing"))
          return response(200, MODERN_PAGE, url);
        if (url.endsWith("/contact"))
          return response(
            200,
            `<body>Call us or email office@millerroofing.com</body>`,
            url,
          );
        return response(
          200,
          `${OLD_PAGE}<a href="/contact">Contact us</a>`,
          url,
        );
      },
      userAgent: "test",
    });
    const res = await scanner.runDeepScan(null, {
      keyword: "roofing contractor",
      city: "Tulsa, OK",
      voivodeship: "OK",
      pkd: "",
      market: "US",
      sources: { maps: true, olx: true, ceidg: true },
    });
    expect(res.ok).toBe(true);
    const miller = res.raw.find(
      (r: { nazwa: string }) => r.nazwa === "Miller Roofing",
    );
    expect(miller.email).toBe("office@millerroofing.com");
    expect(miller.tech_audit.hasMobileViewport).toBe(false);
    // Nowoczesna strona: nie szukamy e-maila, bo sito i tak ją odrzuci.
    expect(
      res.raw.find((r: { nazwa: string }) => r.nazwa === "Summit Roofing")
        .email,
    ).toBeNull();
    expect(fetched.some((u) => u.includes("summitroofing.com/contact"))).toBe(
      false,
    );
    expect(
      res.notes.some((n: string) =>
        /Adres e-mail znaleziono dla 1 z 1/.test(n),
      ),
    ).toBe(true);
  });
});
