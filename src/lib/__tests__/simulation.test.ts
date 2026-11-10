import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  runSimulation,
  SABOTAGES,
} = require("../../../electron/simulation.cjs");

type Report = {
  ok: boolean;
  invariants: Array<{
    id: string;
    ok: boolean;
    checked: number;
    detail: string;
  }>;
  funnel: Record<string, number>;
  classifier: {
    falseBlocks: number;
    refusals: { total: number; withReadyDraft: number };
  };
};
const small = { companies: 70, days: 7, smsLeads: 16 };
const failed = (r: Report) =>
  r.invariants.filter((i) => !i.ok).map((i) => i.id);

describe("wirtualny świat", () => {
  it("dotrzymuje wszystkich zasad w trzech różnych światach", async () => {
    for (const seed of [1, 2, 3]) {
      const report: Report = await runSimulation({ ...small, seed });
      expect(failed(report), `świat ${seed}`).toEqual([]);
      // Zasady muszą być naprawdę sprawdzone na danych, a nie spełnione na pustym zbiorze.
      for (const inv of report.invariants)
        expect(inv.checked, inv.id).toBeGreaterThan(0);
      expect(report.funnel["coldDelivered"]).toBeGreaterThan(30);
      expect(report.funnel["answered"]).toBeGreaterThan(5);
      expect(report.classifier.refusals.total).toBeGreaterThan(5);
    }
  }, 120_000);

  it("działa także bez AI i wtedy żadna odmowa nie dostaje gotowej propozycji", async () => {
    const report: Report = await runSimulation({
      ...small,
      seed: 4,
      ai: false,
    });
    expect(failed(report)).toEqual([]);
    expect(report.classifier.refusals.withReadyDraft).toBe(0);
    expect(report.classifier.falseBlocks).toBe(0);
  }, 60_000);

  it("ten sam numer świata daje ten sam wynik", async () => {
    const a: Report = await runSimulation({ ...small, seed: 9 });
    const b: Report = await runSimulation({ ...small, seed: 9 });
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
  }, 60_000);

  const expected: Record<string, string> = {
    "bez-stopki": "stopka",
    "nocna-zmiana": "okno",
    "dziurawa-blokada": "blokada-wspolna",
    "jawny-sekret": "sekrety",
    "prawdziwa-siec": "siec",
  };
  it.each(SABOTAGES as string[])(
    "wykrywa celowe zepsucie: %s",
    async (sabotage) => {
      const report: Report = await runSimulation({
        ...small,
        seed: 1,
        sabotage,
      });
      expect(report.ok).toBe(false);
      expect(failed(report)).toContain(expected[sabotage]);
    },
    60_000,
  );
});
