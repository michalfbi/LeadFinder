import { describe, expect, it } from "vitest";
import type { SniperRawLead, TechAuditResult } from "../leads-store";
import {
  generateSimulatedRawLeads,
  isCorporateName,
  offerMessageForRow,
  runFiveStageSieve,
  sniperLeadToRow,
  sniperMessageFor,
  toPolishVocative,
} from "../sniper-sieve";
import { smsSegments, spinSpintaxSeeded } from "../message-template";

const NOW = new Date("2026-11-02T12:00:00Z");

function raw(patch: Partial<SniperRawLead> = {}): SniperRawLead {
  return {
    id: patch.id ?? "lead-1",
    source: "GOOGLE_MAPS",
    nazwa: "Stolarstwo Nowak",
    telefon: "+48601234567",
    miasto: "Kielce",
    adres: "ul. Długa 1, Kielce",
    kategoria: "Meble Kuchenne na Wymiar",
    website: null,
    email: null,
    owner_name: null,
    rating: 4.8,
    reviews: 42,
    is_promoted_ad: false,
    social_only: false,
    ceidg_start_date: null,
    nip: null,
    mapy_url: null,
    olx_url: null,
    tech_audit: null,
    whois_free_domain: "stolarstwo-nowak.pl",
    ...patch,
  };
}

function audit(patch: Partial<TechAuditResult> = {}): TechAuditResult {
  return {
    httpStatus: 200,
    hasSsl: true,
    hasMobileViewport: true,
    detectedCmsOrBuilder: "WordPress",
    hasAdPixels: false,
    copyrightYear: 2024,
    responseTimeMs: 800,
    whoisFreeDomain: null,
    ...patch,
  };
}

describe("wołacz polskich imion", () => {
  it.each([
    ["Marek", "Panie Marku"],
    ["Tomasz", "Panie Tomaszu"],
    ["Łukasz", "Panie Łukaszu"],
    ["Piotr", "Panie Piotrze"],
    ["Krzysztof", "Panie Krzysztofie"],
    ["Paweł", "Panie Pawle"],
    ["Michał", "Panie Michale"],
    ["Jan", "Panie Janie"],
    ["Anna", "Pani Anno"],
    ["Katarzyna", "Pani Katarzyno"],
    ["Wojciech", "Panie Wojciechu"],
    ["Robert", "Panie Robercie"],
    ["Dawid", "Panie Dawidzie"],
    ["Zbigniew", "Panie Zbigniewie"],
    ["Grzegorz", "Panie Grzegorzu"],
    ["Kacper", "Panie Kacprze"],
    ["Jacek", "Panie Jacku"],
    ["Jerzy", "Panie Jerzy"],
    ["Maria", "Pani Mario"],
    ["Kasia", "Pani Kasiu"],
  ])("%s → %s", (name, expected) => {
    expect(toPolishVocative(name)).toBe(expected);
  });

  it("wyłuskuje imię z tekstu kontaktowego", () => {
    expect(toPolishVocative("Kontakt: Tomasz")).toBe("Panie Tomaszu");
    expect(toPolishVocative("Marek Kowalski")).toBe("Panie Marku");
    expect(toPolishVocative("MAREK")).toBe("Panie Marku");
  });

  it("dla nieznanego imienia zwraca pusty zwrot", () => {
    expect(toPolishVocative("Xyzzy")).toBe("");
    expect(toPolishVocative("")).toBe("");
    expect(toPolishVocative(null)).toBe("");
  });
});

describe("sito 1 — decydent i komórka", () => {
  it("odrzuca numer stacjonarny i z czarnej listy", () => {
    const res = runFiveStageSieve([raw({ telefon: "+48413456789" })], {
      now: NOW,
      minScoreThreshold: 0,
    });
    expect(res.top).toHaveLength(0);
    expect(res.rejected[0]!.rejection_reason).toBe(
      "Numer stacjonarny lub zablokowany",
    );
    const blocked = runFiveStageSieve([raw()], {
      now: NOW,
      minScoreThreshold: 0,
      blacklist: ["601 234 567"],
    });
    expect(blocked.rejected[0]!.rejection_reason).toBe(
      "Numer stacjonarny lub zablokowany",
    );
  });

  it("odrzuca korporacje i firmy z ponad 130 opiniami", () => {
    expect(isCorporateName("Meble Polska Sp. z o.o.")).toBe(true);
    expect(isCorporateName("Supermarketing Kowalski")).toBe(false);
    const big = runFiveStageSieve([raw({ reviews: 131 })], {
      now: NOW,
      minScoreThreshold: 0,
    });
    expect(big.rejected[0]!.rejection_reason).toBe(
      "Zbyt duża firma (ryzyko sekretariatu/call center)",
    );
  });

  it("pomija numery, które są już w bazie, i duplikaty w paczce", () => {
    const res = runFiveStageSieve([raw({ id: "a" }), raw({ id: "b" })], {
      now: NOW,
      minScoreThreshold: 0,
    });
    expect(res.top).toHaveLength(1);
    expect(res.rejected[0]!.rejection_reason).toBe(
      "Duplikat numeru w tej paczce",
    );
    const known = runFiveStageSieve([raw()], {
      now: NOW,
      minScoreThreshold: 0,
      existingPhones: ["601234567"],
    });
    expect(known.rejected[0]!.rejection_reason).toMatch(/już w bazie/);
  });

  it("nagradza znanego decydenta formą w wołaczu", () => {
    const res = runFiveStageSieve(
      [raw({ source: "OLX", owner_name: "Kontakt: Marek" })],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(res.top[0]!.owner_vocative).toBe("Panie Marku");
    expect(res.top[0]!.score_reasons[0]).toBe("👤 Decydent: Panie Marku (+15)");
  });
});

describe("sito 2 — audyt techniczny", () => {
  it("odrzuca nowoczesną, szybką stronę", () => {
    const res = runFiveStageSieve(
      [raw({ website: "https://nowak.pl", tech_audit: audit() })],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(res.rejected[0]!.rejection_reason).toBe(
      "Posiada nowoczesną, sprawną stronę WWW",
    );
    expect(res.rejected[0]!.sieve_stage_reached).toBe(2);
  });

  it("awaria strony to EXPIRED_OR_BROKEN_SITE z +35 i piksele +15", () => {
    const res = runFiveStageSieve(
      [
        raw({
          website: "https://nowak.pl",
          tech_audit: audit({ httpStatus: 503, hasAdPixels: true }),
          whois_free_domain: null,
        }),
      ],
      { now: NOW, minScoreThreshold: 0 },
    );
    const lead = res.top[0]!;
    expect(lead.intent_category).toBe("EXPIRED_OR_BROKEN_SITE");
    expect(lead.score_reasons).toContain(
      "🚨 Awaria strony WWW (Błąd HTTP/DNS) (+35)",
    );
    expect(lead.score_reasons).toContain(
      "🎯 Aktywne piksele reklamowe na słabej stronie (+15)",
    );
    expect(lead.tech_diagnosis).toBe("strona zwraca błąd 503");
  });

  it("Facebook lub darmowy kreator daje SOCIAL_OR_FREE_BUILDER", () => {
    const fb = runFiveStageSieve(
      [raw({ website: "https://facebook.com/nowak", reviews: 2, rating: 5 })],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(fb.rejected[0]!.rejection_reason).toBe(
      "Brak śladów aktywności rynkowej (Zombie)",
    );
    const wix = runFiveStageSieve(
      [raw({ website: "https://nowak.wixsite.com/meble" })],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(wix.top[0]!.intent_category).toBe("SOCIAL_OR_FREE_BUILDER");
    expect(wix.top[0]!.tech_diagnosis).toBe(
      "na darmową podstronę w kreatorze (nowak.wixsite.com)",
    );
  });

  it("nie zgaduje diagnozy, gdy strony nie udało się zbadać", () => {
    const res = runFiveStageSieve(
      [raw({ website: "https://nowak.pl", tech_audit: null })],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(res.rejected[0]!.rejection_reason).toMatch(/nie zgadujemy/);
  });
});

describe("sito 3–5 — sygnały pieniędzy, domena i odcięcie", () => {
  it("lider opinii bez strony z wolną domeną i e-mailem z Gmaila", () => {
    const res = runFiveStageSieve([raw({ email: "nowak@gmail.com" })], {
      now: NOW,
      minScoreThreshold: 0,
    });
    const lead = res.top[0]!;
    expect(lead.intent_category).toBe("HIGH_REVIEWS_NO_SITE");
    expect(lead.hot_score).toBe(25 + 20 + 10 + 15);
    const strict = runFiveStageSieve([raw({ email: "nowak@gmail.com" })], {
      now: NOW,
    });
    expect(strict.top).toHaveLength(0);
    expect(strict.rejected[0]!.rejection_reason).toBe(
      "Za niski Hot Score (70 < 75)",
    );
    expect(strict.rejected[0]!.sieve_stage_reached).toBe(5);
  });

  it("płatne OLX bez strony z decydentem przekracza próg 75", () => {
    const res = runFiveStageSieve(
      [
        raw({
          source: "OLX",
          owner_name: "Tomasz",
          is_promoted_ad: true,
          rating: null,
          reviews: 0,
        }),
      ],
      { now: NOW },
    );
    const lead = res.top[0]!;
    expect(lead.intent_category).toBe("PAID_AD_NO_SITE");
    expect(lead.hot_score).toBe(15 + 25 + 25 + 15);
    expect(lead.sieve_passed).toBe(true);
  });

  it("świeża firma z CEIDG w branży high-ticket dostaje +20", () => {
    const res = runFiveStageSieve(
      [
        raw({
          source: "CEIDG",
          reviews: 0,
          rating: null,
          ceidg_start_date: "2026-10-25",
          owner_name: "Anna Nowak",
        }),
      ],
      { now: NOW, highTicket: true, minScoreThreshold: 0 },
    );
    expect(
      res.top[0]!.score_reasons.some((r) =>
        r.startsWith("🆕 Nowa firma z CEIDG (8 dni)"),
      ),
    ).toBe(true);
    expect(res.top[0]!.owner_vocative).toBe("Pani Anno");
  });

  it("wyłączona bramka nie przyznaje punktów", () => {
    const lead = raw({
      source: "OLX",
      owner_name: "Tomasz",
      is_promoted_ad: true,
      reviews: 0,
      rating: null,
    });
    const on = runFiveStageSieve([lead], { now: NOW, minScoreThreshold: 0 });
    const off = runFiveStageSieve([lead], {
      now: NOW,
      minScoreThreshold: 0,
      gates: { paidAds: false },
    });
    expect(on.top[0]!.hot_score - off.top[0]!.hot_score).toBe(25);
  });

  it("wybiera lokalnego konkurenta z nowoczesną stroną z tego samego miasta", () => {
    const res = runFiveStageSieve(
      [
        raw({ id: "a" }),
        raw({
          id: "rival",
          nazwa: "Meblex Kielce",
          telefon: "+48609876543",
          website: "https://meblex.pl",
          tech_audit: audit(),
          reviews: 80,
          rating: 4.7,
        }),
      ],
      { now: NOW, minScoreThreshold: 0 },
    );
    expect(res.top.find((l) => l.id === "a")!.local_competitor).toBe(
      "Meblex Kielce",
    );
  });

  it("tnie do Top 50 posortowanych malejąco i liczy lejek", () => {
    const params = {
      nicheId: "meble-kuchnie",
      keyword: "meble na wymiar",
      pkd: "31.02.Z",
      city: "Kielce",
      voivodeship: "świętokrzyskie",
      sources: { maps: true, olx: true, ceidg: true },
    };
    const rawLeads = generateSimulatedRawLeads(params, NOW, 450);
    const a = runFiveStageSieve(rawLeads, { now: NOW, highTicket: true });
    const b = runFiveStageSieve(rawLeads, { now: NOW, highTicket: true });
    expect(a.top.map((l) => l.id)).toEqual(b.top.map((l) => l.id));
    expect(a.top.length).toBeLessThanOrEqual(50);
    expect(a.top.every((l) => l.hot_score >= 75)).toBe(true);
    for (let i = 1; i < a.top.length; i++)
      expect(a.top[i - 1]!.hot_score).toBeGreaterThanOrEqual(
        a.top[i]!.hot_score,
      );
    const f = a.funnel;
    expect(f.totalScanned).toBe(450);
    expect(f.passedStage1).toBeGreaterThanOrEqual(f.passedStage2);
    expect(f.passedStage2).toBeGreaterThanOrEqual(f.passedStage3);
    expect(f.passedStage3).toBeGreaterThanOrEqual(f.finalTop50);
    expect(a.top.length + a.rejected.length).toBe(450);
  });
});

describe("szablony Snajpera", () => {
  it("Spintax z ziarnem jest powtarzalny", () => {
    const t = "{A|B|C} {D|E}";
    expect(spinSpintaxSeeded(t, "x").text).toBe(spinSpintaxSeeded(t, "x").text);
  });

  it("buduje SMS bez niepodstawionych zmiennych i z właściwą formą", () => {
    const res = runFiveStageSieve(
      [
        raw({
          source: "OLX",
          owner_name: "Tomasz",
          is_promoted_ad: true,
          reviews: 0,
          rating: null,
        }),
      ],
      { now: NOW, nicheLabel: "Meble Kuchenne na Wymiar" },
    );
    const msg = sniperMessageFor(res.top[0]!);
    expect(msg.body).toMatch(
      /^(Dzień dobry|Witam), Panie Tomaszu, trafiłem na Pana wyróżnione ogłoszenie/,
    );
    expect(msg.body).toContain("stolarstwo-nowak.pl");
    expect(msg.body).toContain("wystarczy odpisać NIE");
    expect(msg.body).not.toMatch(/[{}|]/);
    expect(msg.templateId).toContain("Płatne OLX");
  });

  it("bez imienia używa formy „Państwo” i nie wymyśla faktów", () => {
    const res = runFiveStageSieve([raw({ whois_free_domain: null })], {
      now: NOW,
      minScoreThreshold: 0,
    });
    const msg = sniperMessageFor(res.top[0]!, { optOut: false });
    expect(msg.body).toContain(
      "Mają Państwo świetne opinie (42 recenzje, średnia 4,8⭐)",
    );
    expect(msg.body).not.toContain("domena");
    expect(msg.body).not.toContain("NIE");
  });

  it("liczy części SMS z polskimi znakami", () => {
    expect(smsSegments("abc")).toEqual({
      chars: 3,
      segments: 1,
      unicode: false,
    });
    expect(smsSegments("ą".repeat(71)).segments).toBe(2);
  });

  it("wiersz do bazy zachowuje zgodność z dotychczasowymi polami", () => {
    const res = runFiveStageSieve(
      [
        raw({
          website: "http://nowak.pl",
          tech_audit: audit({ hasSsl: false }),
        }),
      ],
      { now: NOW, minScoreThreshold: 0 },
    );
    const row = sniperLeadToRow(
      res.top[0]!,
      "świętokrzyskie",
      NOW.toISOString(),
    );
    expect(row["website_issue_type"]).toBe("NO_SSL");
    expect(row["status"]).toBe("nowy");
    expect(row["hot_score"]).toBe(res.top[0]!.hot_score);
  });
});

describe("oferta: reklamy wideo AI", () => {
  const video = { now: NOW, offer: "video_ads" as const, minScoreThreshold: 0 };

  it("nie odrzuca nowoczesnej strony, a piksel reklamowy daje +30", () => {
    const res = runFiveStageSieve(
      [
        raw({
          website: "https://nowak.pl",
          tech_audit: audit({ hasAdPixels: true }),
        }),
      ],
      video,
    );
    const lead = res.top[0]!;
    expect(lead.offer).toBe("video_ads");
    expect(lead.intent_category).toBe("VIDEO_ACTIVE_ADVERTISER");
    expect(lead.score_reasons).toContain(
      "🎯 Piksel reklamowy Meta/Google Ads — firma inwestuje w reklamy (+30)",
    );
    expect(lead.score_reasons).toContain(
      "✅ Sprawna strona — reklama ma dokąd kierować (+10)",
    );
    expect(lead.suggested_free_domain).toBeNull();
  });

  it("niedziałająca strona trafia do oferty WWW, a brak budżetu odpada", () => {
    const broken = runFiveStageSieve(
      [
        raw({
          website: "https://nowak.pl",
          tech_audit: audit({ httpStatus: 500 }),
        }),
      ],
      video,
    );
    expect(broken.rejected[0]!.rejection_reason).toMatch(
      /lepszy kandydat na ofertę „Strony WWW”/,
    );
    const noBudget = runFiveStageSieve(
      [raw({ reviews: 6, rating: 4.9 })],
      video,
    );
    expect(noBudget.rejected[0]!.rejection_reason).toMatch(
      /^Brak sygnałów budżetu/,
    );
  });

  it("dopuszcza większe firmy niż oferta WWW (do 400 opinii)", () => {
    const lead = raw({ reviews: 250, rating: 4.7 });
    expect(
      runFiveStageSieve([lead], { now: NOW, minScoreThreshold: 0 }).top,
    ).toHaveLength(0);
    expect(runFiveStageSieve([lead], video).top[0]!.intent_category).toBe(
      "VIDEO_REVIEW_LEADER",
    );
  });

  it("branża wizualna i high-ticket dokładają punkty, gdy bramka jest włączona", () => {
    const base = raw({ reviews: 40, rating: 4.8 });
    const on = runFiveStageSieve([base], {
      ...video,
      visualNiche: true,
      highTicket: true,
    });
    const off = runFiveStageSieve([base], {
      ...video,
      visualNiche: true,
      highTicket: true,
      gates: { visualNiche: false },
    });
    expect(on.top[0]!.hot_score - off.top[0]!.hot_score).toBe(30);
  });

  it("zapisuje typ oferty i buduje SMS o reklamie wideo z ceną", () => {
    const res = runFiveStageSieve(
      [
        raw({
          source: "OLX",
          owner_name: "Tomasz",
          is_promoted_ad: true,
          reviews: 0,
          rating: null,
        }),
      ],
      { ...video, nicheLabel: "Wrapping & Folie PPF" },
    );
    const lead = res.top[0]!;
    const row = sniperLeadToRow(lead, "świętokrzyskie", NOW.toISOString());
    expect(row["offer_type"]).toBe("video_ads");
    expect(row["website_issue_type"]).toBeNull();
    const msg = sniperMessageFor(lead, { price: "3 wersje reklamy za 990 zł" });
    expect(msg.body).toMatch(
      /^(Dzień dobry|Witam), Panie Tomaszu, trafiłem na Pana wyróżnione ogłoszenie na OLX \(wrapping i folie ppf, Kielce\)/,
    );
    expect(msg.body).toContain("(3 wersje reklamy za 990 zł)");
    expect(msg.body).toContain("Pana pracę");
    expect(msg.body).not.toMatch(/[{}|]/);
    expect(msg.body).not.toContain("domena");
    expect(msg.templateId).toBe("🎬 Wideo · Promowane OLX");
  });

  it("pusta cena usuwa nawias, a wiersz z bazy dostaje ten sam szablon", () => {
    const res = runFiveStageSieve([raw({ reviews: 40, rating: 4.8 })], video);
    const lead = res.top[0]!;
    expect(sniperMessageFor(lead, { price: "" }).body).not.toContain("()");
    const row = {
      ...(sniperLeadToRow(lead, null, NOW.toISOString()) as Record<
        string,
        unknown
      >),
      id: lead.id,
      created_at: NOW.toISOString(),
    };
    const fromRow = offerMessageForRow(row as never);
    expect(fromRow.body).toBe(sniperMessageFor(lead).body);
    const legacy = offerMessageForRow({
      ...(row as object),
      offer_type: "video_ads",
      intent_category: null,
    } as never);
    expect(legacy.templateId).toBe("🎬 Wideo · Branża wizualna");
  });
});
