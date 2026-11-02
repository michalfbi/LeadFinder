import { describe, it, expect } from "vitest";
import { suggestDomains } from "../domain-check";

describe("Asystent wolnych domen .pl", () => {
  it("czyści nazwę z polskich znaków i form prawnych", () => {
    const s = suggestDomains("Stolarstwo Kowalski Sp. z o.o.", "Kielce");
    expect(s[0]).toBe("stolarstwokowalski");
    expect(s.join(" ")).not.toMatch(/[ąćęłńóśźż]/);
  });
  it("usuwa ogólniki typu FHU i Usługi", () => {
    const s = suggestDomains("FHU Usługi Transportowe Nowak", "Łódź");
    expect(s.join(" ")).not.toMatch(/fhu|uslugi/i);
    expect(s[0]).toContain("nowak");
  });
  it("druga propozycja to nazwisko z miastem", () => {
    const s = suggestDomains("Stolarstwo Kowalski", "Kielce");
    expect(s).toContain("kowalski-kielce");
  });
  it("zwraca maksymalnie 2 propozycje bez duplikatów", () => {
    const s = suggestDomains("Pracownia Forma Design Studio", "Warszawa");
    expect(s.length).toBeLessThanOrEqual(2);
    expect(new Set(s).size).toBe(s.length);
  });
  it("odrzuca zbyt krótkie propozycje", () => {
    const s = suggestDomains("AB", "PL");
    expect(s.every((d) => d.length >= 3)).toBe(true);
  });
});
