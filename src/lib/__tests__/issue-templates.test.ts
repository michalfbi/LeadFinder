import { describe, expect, it } from "vitest";
import { buildIssueMessage, DEFAULT_ISSUE_TEMPLATES, issueTypeOf } from "../issue-templates";

describe("ruter szablonów wg diagnozy", () => {
  it("rozpoznaje typ z opisu audytora", () => {
    expect(issueTypeOf({ strona_problem: "🚨 Strona wygasła / Błąd serwera" })).toBe("EXPIRED_OR_ERROR");
    expect(issueTypeOf({ strona_problem: "🔓 Brak certyfikatu SSL" })).toBe("NO_SSL");
    expect(issueTypeOf({ strona_problem: null })).toBe("NO_WEBSITE");
    expect(issueTypeOf({ website_issue_type: "NO_MOBILE", strona_problem: null })).toBe("NO_MOBILE");
  });
  it("wstawia typ do podpisu i podstawia zmienne", () => {
    const r = buildIssueMessage(DEFAULT_ISSUE_TEMPLATES, "EXPIRED_OR_ERROR", { nazwa: "Firma X", miasto: "Kielce" });
    expect(r.signature.startsWith("[TYP: Strona wygasła]")).toBe(true);
    expect(r.body).toContain("Firma X (Kielce)");
    expect(r.body).not.toMatch(/[{}|]/);
  });
});
