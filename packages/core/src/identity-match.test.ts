import { describe, expect, it } from "vitest";

import { matchBusinessIdentity, nameSimilarity } from "./identity-match";

const smile = { displayName: "Smile Dental, Clapham", location: "Clapham" };

describe("matchBusinessIdentity (G9): speech-recognition-style mishearings", () => {
  it.each([
    ["Smile Dental", "match"],
    ["smile dent all", "match"],
    ["Smiles Dental", "match"],
    ["the Smile Dental Practice", "match"],
    ["Smile Dental Clapham", "match"],
    ["smile dental ltd", "match"],
    ["Bright Smile", "unclear"],
    ["Smile", "unclear"],
    ["Pizza Palace", "mismatch"],
    ["Clapham Dental Care", "unclear"],
    ["hello?", "mismatch"],
    ["", "unclear"],
    ["the practice", "unclear"],
  ] as const)("%j → %s", (heard, verdict) => {
    expect(matchBusinessIdentity({ name: heard }, smile)).toBe(verdict);
  });

  it("an alias counts as the name", () => {
    expect(matchBusinessIdentity({ name: "SDC" }, smile)).toBe("mismatch");
    expect(matchBusinessIdentity({ name: "SDC" }, smile, ["SDC"])).toBe("match");
  });

  it("a heard location has to agree too (a similar-sounding one is unclear, so the agent asks)", () => {
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Balham" }, smile)).toBe(
      "unclear",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Clapham" }, smile)).toBe(
      "match",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Brixton" }, smile)).toBe(
      "mismatch",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Clapham North" }, smile)).toBe(
      "unclear",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "the" }, smile)).toBe("match");
    expect(
      matchBusinessIdentity(
        { name: "Smile Dental", location: "Balham" },
        { displayName: "Smile Dental" },
      ),
    ).toBe("match");
  });

  it("a display name of only generic words can't be matched, so it's unclear", () => {
    expect(matchBusinessIdentity({ name: "The Practice" }, { displayName: "The Practice" })).toBe(
      "unclear",
    );
  });

  it("similarity is 1 for the same name and 0 for nothing in common", () => {
    expect(nameSimilarity("Smile Dental", "smile   DENTAL")).toBe(1);
    expect(nameSimilarity("abc", "xyz")).toBe(0);
    expect(nameSimilarity("", "")).toBe(0);
  });
});
