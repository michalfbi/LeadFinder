import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewDraft } from "../inbox-store";
const require = createRequire(import.meta.url);
const {
  createInbox,
  classifyRules,
  buildDraft,
  parseAiJson,
  BLOCKING,
} = require("../../../electron/inbox.cjs");
const {
  extractPlainText,
  stripQuoted,
} = require("../../../electron/reply-text.cjs");
const { createStore } = require("../../../electron/store.cjs");
const rules = require("../../../reply-rules.json");

type Labelled = { lang: string; category: string; text: string };
const tuned: Labelled[] = require("./fixtures/replies-labelled.json");
const heldout: Labelled[] = require("./fixtures/replies-heldout.json");
const fresh: Labelled[] = require("./fixtures/replies-fresh.json");

const READY_DRAFT = new Set(
  Object.keys(rules.categories).filter(
    (c) => rules.templates.US[c] || rules.templates.PL[c],
  ),
);

function score(set: Labelled[]) {
  let correct = 0;
  let blockTotal = 0;
  let blockHit = 0;
  let falseBlocks = 0;
  let refusalWithReadyDraft = 0;
  for (const row of set) {
    const got = classifyRules(row.text).category;
    if (got === row.category) correct++;
    if (BLOCKING.has(row.category)) {
      blockTotal++;
      if (BLOCKING.has(got)) blockHit++;
      else if (READY_DRAFT.has(got)) refusalWithReadyDraft++;
    } else if (BLOCKING.has(got)) falseBlocks++;
  }
  return {
    accuracy: correct / set.length,
    blockRecall: blockHit / blockTotal,
    falseBlocks,
    refusalWithReadyDraft,
  };
}

describe("klasyfikacja regułami", () => {
  it("zestaw wzorcowy (111 odpowiedzi PL/EN): wszystkie odmowy i nieufność zablokowane", () => {
    expect(tuned.length).toBeGreaterThanOrEqual(100);
    const s = score(tuned);
    expect(s.blockRecall).toBe(1);
    expect(s.falseBlocks).toBe(0);
    expect(s.accuracy).toBeGreaterThanOrEqual(0.98);
  });

  it("żadna odmowa z żadnego zestawu nie dostaje gotowego szkicu odpowiedzi i nikt nie jest blokowany przez pomyłkę", () => {
    for (const set of [tuned, heldout, fresh]) {
      const s = score(set);
      expect(s.refusalWithReadyDraft).toBe(0);
      expect(s.falseBlocks).toBe(0);
    }
  });

  it("zestaw świeży pokazuje granicę reguł: nieznane sformułowania wymagają AI albo decyzji właściciela", () => {
    // Zestaw nie był używany do strojenia reguł. Próg pilnuje tylko, żeby reguły się nie pogorszyły.
    const s = score(fresh);
    expect(s.blockRecall).toBeGreaterThanOrEqual(0.3);
    expect(s.blockRecall).toBeLessThan(0.98);
  });

  it("kolejność reguł: odmowa wygrywa z zainteresowaniem, przeczenie unieważnia „sure”", () => {
    expect(
      classifyRules("Not interested, but thanks for the offer to send it over.")
        .category,
    ).toBe("odmowa");
    expect(classifyRules("I'm not sure what this is about").category).not.toBe(
      "zainteresowany",
    );
    expect(classifyRules("No, how much is it?").category).toBe("odmowa");
    expect(
      classifyRules("Antispam filters are annoying, sure send it").category,
    ).toBe("zainteresowany");
    expect(classifyRules("").category).toBe("inne");
  });

  it("cytat naszej stopki nie decyduje o klasyfikacji", () => {
    const reply =
      'Sure, send it over.\n\nOn Tue, Nov 3, 2026 at 10:02 AM Michal <m@x.com> wrote:\n> Not interested? Reply "unsubscribe" and I won\'t email you again.';
    expect(stripQuoted(reply)).toBe("Sure, send it over.");
    expect(classifyRules(reply).category).toBe("zainteresowany");
  });
});

describe("treść e-maila", () => {
  it("wybiera część tekstową z wiadomości wieloczęściowej i dekoduje quoted-printable", () => {
    const raw = [
      "--000abc",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Dzi=C4=99kuj=C4=99, prosz=C4=99 przes=C5=82a=C4=87 projekt=",
      " strony.",
      "--000abc",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      "<div>Dziękuję</div>",
      "--000abc--",
    ].join("\r\n");
    expect(extractPlainText(raw)).toBe(
      "Dziękuję, proszę przesłać projekt strony.",
    );
    expect(extractPlainText("Plain reply")).toBe("Plain reply");
    expect(
      extractPlainText(
        "--b1\nContent-Type: text/html\n\n<p>Sure<br>send it</p>\n--b1--",
      ),
    ).toMatch(/Sure\s+send it/);
    expect(
      extractPlainText(Buffer.from("No thanks").toString("base64"), "base64"),
    ).toBe("No thanks");
  });
});

describe("szkice z szablonów", () => {
  const lead = { id: "l1", nazwa: "Miller Roofing", market: "US" };
  it("wstawia dane właściciela, a puste pola uzupełnia domyślnymi", () => {
    const draft = buildDraft(
      "cena",
      "US",
      { price: "$1,200 flat", signature: "Michal", calendarUrl: "" },
      lead,
    );
    expect(draft.needsEdit).toBe(false);
    expect(draft.text).toContain(
      "A complete website for Miller Roofing is $1,200 flat.",
    );
    expect(draft.text).toContain("Turnaround is 7 business days");
    expect(draft.text.endsWith("Best,\nMichal")).toBe(true);
    expect(draft.text).not.toMatch(/\{\w+\}/);
  });
  it("link do kalendarza pojawia się tylko, gdy jest ustawiony", () => {
    expect(buildDraft("zainteresowany", "US", {}, lead).text).not.toContain(
      "pick a time",
    );
    expect(
      buildDraft(
        "zainteresowany",
        "US",
        { calendarUrl: "https://cal.example/m" },
        lead,
      ).text,
    ).toContain("pick a time here: https://cal.example/m");
  });
  it("dla pytań i nieznanych odpowiedzi nie ma gotowca", () => {
    expect(buildDraft("pytanie", "US", {}, lead)).toEqual({
      text: "",
      needsEdit: true,
    });
    expect(buildDraft("inne", "PL", {}, lead)).toEqual({
      text: "",
      needsEdit: true,
    });
  });
});

describe("skrzynka", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup(
    ai?: (body: {
      prompt: string;
      system_prompt: string;
      model: string;
    }) => unknown,
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leadfinder-inbox-"));
    dirs.push(dir);
    const store = createStore({ dir });
    const files: Record<string, unknown> = {};
    const blocked: Array<{ channel: string; address: string; reason: string }> =
      [];
    const sent: Array<{ channel: string; address: string; body: string }> = [];
    const notified: string[] = [];
    const aiCalls: unknown[] = [];
    const inbox = createInbox({
      db: () => store.db,
      read: (name: string, fallback: unknown) => files[name] ?? fallback,
      write: (name: string, value: unknown) => (files[name] = value),
      encrypt: (t: string) => `enc:${t}`,
      decrypt: (t: string) => t.replace(/^enc:/, ""),
      fetchImpl: async (
        _url: string,
        init: { body: string; headers: Record<string, string> },
      ) => {
        const body = JSON.parse(init.body);
        aiCalls.push({ body, auth: init.headers["Authorization"] });
        const out = ai
          ? ai(body)
          : { category: "inne", confidence: 0.5, reply: "" };
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              output: typeof out === "string" ? out : JSON.stringify(out),
            }),
        };
      },
      block: (b: { channel: string; address: string; reason: string }) =>
        blocked.push(b),
      isBlocked: ({ address }: { address: string }) =>
        blocked.some((b) => b.address === address),
      send: async (m: { channel: string; address: string; body: string }) => {
        if (m.body.includes("FAIL")) throw new Error("SMTP odrzucił wiadomość");
        sent.push(m);
      },
      notify: (m: { id: string }) => notified.push(m.id),
    });
    return { inbox, store, blocked, sent, notified, aiCalls, files };
  }
  const lead = {
    id: "e1",
    nazwa: "Miller Roofing",
    miasto: "Tulsa, OK",
    market: "US",
  };
  const reply = (text: string, extra = {}) => ({
    channel: "email",
    lead,
    address: "info@millerroofing.com",
    text,
    at: 1000,
    externalId: text,
    ...extra,
  });

  it("odmowa blokuje kontakt i nie tworzy szkicu; ta sama wiadomość drugi raz nic nie robi", async () => {
    const { inbox, blocked, notified, store } = setup();
    const m = await inbox.ingest(reply("Please remove me from your list."));
    expect(m).toMatchObject({
      status: "blocked",
      category: "odmowa",
      draft: "",
    });
    expect(blocked).toEqual([
      expect.objectContaining({
        channel: "email",
        address: "info@millerroofing.com",
        reason: "odmowa",
      }),
    ]);
    expect(
      await inbox.ingest(reply("Please remove me from your list.")),
    ).toBeNull();
    expect(notified).toHaveLength(1);
    await expect(inbox.approve(m.id, "Hello again")).rejects.toThrow(
      "już obsłużona",
    );
    store.close();
  });

  it("zainteresowany dostaje szkic; zatwierdzenie wysyła dokładnie zatwierdzoną treść", async () => {
    const { inbox, sent, store } = setup();
    inbox.configure({
      data: { US: { signature: "Michal", mockupTime: "24 hours" } },
    });
    const m = await inbox.ingest(reply("Sure, send it over."));
    expect(m).toMatchObject({
      status: "pending",
      category: "zainteresowany",
      needsEdit: false,
      source: "rules",
    });
    expect(m.draft).toContain("within 24 hours");
    const done = await inbox.approve(m.id, `${m.draft}\n\nP.S. Tuesday works.`);
    expect(done.status).toBe("sent");
    expect(sent).toEqual([
      {
        channel: "email",
        leadId: "e1",
        address: "info@millerroofing.com",
        body: `${m.draft}\n\nP.S. Tuesday works.`,
      },
    ]);
    await expect(inbox.approve(m.id)).rejects.toThrow("już obsłużona");
    expect(inbox.counts()).toMatchObject({ sent: 1, pending: 0 });
    store.close();
  });

  it("nie wysyła do kontaktu zablokowanego po przygotowaniu szkicu ani treści z pustymi polami", async () => {
    const { inbox, sent, blocked, store } = setup();
    const a = await inbox.ingest(reply("How much?"));
    await expect(inbox.approve(a.id, "Price is {price}")).rejects.toThrow(
      "nieuzupełnione",
    );
    blocked.push({
      channel: "email",
      address: "info@millerroofing.com",
      reason: "manual",
    });
    await expect(inbox.approve(a.id)).rejects.toThrow("liście blokad");
    expect(inbox.get(a.id).status).toBe("blocked");
    expect(sent).toHaveLength(0);
    store.close();
  });

  it("błąd wysyłki zostawia odpowiedź do ponownej decyzji, bez duplikatu", async () => {
    const { inbox, sent, store } = setup();
    const m = await inbox.ingest(reply("Yes please"));
    await expect(inbox.approve(m.id, "FAIL")).rejects.toThrow("SMTP");
    expect(inbox.get(m.id)).toMatchObject({
      status: "pending",
      sendError: "SMTP odrzucił wiadomość",
    });
    await inbox.approve(m.id, "Second try");
    expect(sent).toHaveLength(1);
    store.close();
  });

  it("bez AI niepewna odpowiedź czeka na właściciela bez szkicu", async () => {
    const { inbox, aiCalls, store } = setup();
    const m = await inbox.ingest(reply("We just had ours redone in March."));
    expect(m).toMatchObject({
      status: "pending",
      category: "inne",
      needsEdit: true,
      draft: "",
    });
    expect(aiCalls).toHaveLength(0);
    expect(await inbox.handleCallback(`INBOX:ok:${m.id}`)).toMatch(
      /wymaga uzupełnienia/,
    );
    expect(await inbox.handleCallback(`INBOX:bl:${m.id}`)).toMatch(
      /Zablokowano/,
    );
    store.close();
  });

  it("AI łapie odmowę, której reguły nie znają, i blokuje kontakt", async () => {
    const { inbox, blocked, aiCalls, store } = setup(() => ({
      category: "odmowa",
      confidence: 0.9,
      reply: "",
    }));
    inbox.configure({
      ai: { enabled: true, key: "fal-secret", model: "openai/gpt-4o" },
    });
    const m = await inbox.ingest(
      reply("We just had ours redone in March.", {
        outbound: "Hi, I was looking at your website...",
      }),
    );
    expect(m).toMatchObject({
      status: "blocked",
      category: "odmowa",
      source: "ai",
    });
    expect(blocked).toHaveLength(1);
    expect(aiCalls[0]).toMatchObject({
      auth: "Key fal-secret",
      body: { model: "openai/gpt-4o" },
    });
    expect((aiCalls[0] as { body: { prompt: string } }).body.prompt).toContain(
      "We just had ours redone in March.",
    );
    store.close();
  });

  it("AI nie może cofnąć blokady z reguł ani podmienić pewnej klasyfikacji", async () => {
    const { inbox, aiCalls, store } = setup(() => ({
      category: "zainteresowany",
      confidence: 0.99,
      reply: "Great!",
    }));
    inbox.configure({ ai: { enabled: true, key: "k" } });
    const refused = await inbox.ingest(reply("Not interested."));
    expect(refused.status).toBe("blocked");
    const price = await inbox.ingest(reply("How much?"));
    expect(price).toMatchObject({ category: "cena", source: "rules" });
    expect(aiCalls).toHaveLength(0);
    store.close();
  });

  it("AI pisze szkic dla pytania; śmieciowa odpowiedź modelu i limit dzienny nie psują skrzynki", async () => {
    let mode = "ok";
    const { inbox, store } = setup(() =>
      mode === "ok"
        ? 'Here you go: {"category":"pytanie","confidence":0.8,"reply":"Yes, you keep your current domain."} Thanks'
        : "I cannot help with that",
    );
    inbox.configure({ ai: { enabled: true, key: "k", dailyLimit: 2 } });
    const q = await inbox.ingest(reply("Can you keep my current domain?"));
    expect(q).toMatchObject({
      category: "pytanie",
      needsEdit: false,
      draftFromAi: true,
      draft: "Yes, you keep your current domain.",
    });
    mode = "garbage";
    const g = await inbox.ingest(reply("Do you host it too?"));
    expect(g).toMatchObject({
      status: "pending",
      needsEdit: true,
      aiError: expect.stringMatching(/nieoczekiwanym formacie/),
    });
    const limited = await inbox.ingest(reply("Are you local to Tulsa?"));
    expect(limited.aiError).toMatch(/Dzienny limit zapytań AI \(2\)/);
    expect(inbox.settings().ai).toMatchObject({
      enabled: true,
      keyConfigured: true,
      usedToday: 2,
    });
    store.close();
  });

  it("klucz API jest szyfrowany i nie wraca do interfejsu", () => {
    const { inbox, files, store } = setup();
    const out = inbox.configure({ ai: { key: "fal-secret" } });
    expect(JSON.stringify(out)).not.toContain("fal-secret");
    expect(JSON.stringify(files)).toContain("enc:fal-secret");
    expect(out.ai.keyConfigured).toBe(true);
    store.close();
  });

  it("odczyt odpowiedzi modelu", () => {
    expect(
      parseAiJson('{"category":"cena","confidence":2,"reply":" x "}'),
    ).toEqual({ category: "cena", confidence: 1, reply: "x" });
    expect(parseAiJson('{"category":"wymyslona","confidence":0.9}')).toBeNull();
    expect(parseAiJson("no json here")).toBeNull();
  });
});

describe("podgląd w przeglądarce", () => {
  it("buduje szkice identycznie jak silnik", () => {
    const lead = { nazwa: "Brooks Roofing" };
    const variants = [
      {},
      {
        price: "$1,200 flat",
        signature: "Michal",
        calendarUrl: "https://cal.example/m",
      },
      { signature: "", calendarUrl: " " },
    ];
    for (const market of ["US", "PL"] as const) {
      for (const category of Object.keys(rules.categories)) {
        for (const data of variants) {
          expect(
            previewDraft(category as never, market, data, lead.nazwa),
          ).toBe(buildDraft(category, market, data, lead).text);
        }
      }
    }
  });
});
