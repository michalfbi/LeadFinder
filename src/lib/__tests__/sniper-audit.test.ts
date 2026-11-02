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
