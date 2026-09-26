import { describe, expect, it } from "vitest";

import { compareNames, matchBusinessIdentity, sameWord } from "./identity-match";

const smile = { displayName: "Smile Dental, Clapham", location: "Clapham" };

describe("matchBusinessIdentity (G9): speech-recognition-style mishearings", () => {
  it.each([
    ["Smile Dental", "match"],
    ["smile dent all", "match"],
    ["Smiles Dental", "unclear"],
    ["Good morning, Smile Dental", "match"],
    ["Smile Dental, how can I help?", "match"],
    ["the Smile Dental Practice", "match"],
    ["Smile Dental Clapham", "match"],
    ["smile dental ltd", "match"],
    ["Bright Smile", "unclear"],
    ["Smile", "unclear"],
    ["Pizza Palace", "mismatch"],
    ["Clapham Dental Care", "unclear"],
    ["hello?", "unclear"],
    ["Good morning", "unclear"],
    ["Reception", "unclear"],
    ["Yes speaking", "unclear"],
    // Different businesses that share a category word (review, PR 1.5): never a match.
    ["Style Dental", "unclear"],
    ["Smile Dental Balham", "unclear"],
    ["Bright Dental", "unclear"],
    ["", "unclear"],
    ["the practice", "unclear"],
  ] as const)("%j → %s", (heard, verdict) => {
    expect(matchBusinessIdentity({ name: heard }, smile)).toBe(verdict);
  });

  it("an alias counts as the name", () => {
    expect(matchBusinessIdentity({ name: "SDC" }, smile)).toBe("mismatch");
    expect(matchBusinessIdentity({ name: "SDC" }, smile, ["SDC"])).toBe("match");
  });

  it("a heard location has to agree too", () => {
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Balham" }, smile)).toBe(
      "unclear",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Clapham" }, smile)).toBe(
      "match",
    );
    expect(matchBusinessIdentity({ name: "Smile Dental", location: "Brixton" }, smile)).toBe(
      "unclear",
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

  it.each([
    ["Oak Dental", "Park Dental"],
    ["Boots Pharmacy", "Roots Pharmacy"],
    ["Bupa Dental Care Clapham", "Bupa Dental Care, Balham"],
  ])("%j is not %j", (heard, displayName) => {
    expect(matchBusinessIdentity({ name: heard }, { displayName })).not.toBe("match");
  });

  it.each([
    [{ displayName: "Clapham Dental", location: "Clapham" }, "Dental practice"],
    [{ displayName: "Clapham Pharmacy", location: "Clapham" }, "Pharmacy"],
    [{ displayName: "Clapham Medical Centre", location: "Clapham" }, "the medical centre"],
    [{ displayName: "Clapham Family Dental", location: "Clapham" }, "Family Dental"],
    [{ displayName: "Dental Practice" }, "Dental Practice"],
  ])("category words alone never confirm %j (heard %j)", (business, heard) => {
    expect(matchBusinessIdentity({ name: heard }, business)).toBe("unclear");
  });

  it("a place that is part of the name still has to be said", () => {
    const clapham = { displayName: "Clapham Dental", location: "Clapham" };
    expect(matchBusinessIdentity({ name: "Clapham Dental" }, clapham)).toBe("match");
    const suffixed = { displayName: "Smile Dental Clapham", location: "Clapham" };
    expect(matchBusinessIdentity({ name: "Smile Dental" }, suffixed)).toBe("match");
  });

  it.each([
    ["Kennington Dental", "Kensington Dental"],
    ["Barnet Dental", "Barnes Dental"],
    ["Charlton Dental", "Carlton Dental"],
  ])(
    "a one-letter slip in a place-like name is unclear, not a match: %j vs %j",
    (heard, displayName) => {
      expect(matchBusinessIdentity({ name: heard }, { displayName })).toBe("unclear");
    },
  );

  it("words: exact for short ones, one slip for longer ones with the same first letter", () => {
    expect(sameWord("smiles", "smile")).toBe(true);
    expect(sameWord("dentall", "dental")).toBe(true);
    expect(sameWord("style", "smile")).toBe(false);
    expect(sameWord("roots", "boots")).toBe(false);
    expect(sameWord("rental", "dental")).toBe(false);
    expect(sameWord("oak", "oat")).toBe(false);
    expect(sameWord("pharmacie", "pharmacy")).toBe(true);
  });

  it("compareNames", () => {
    expect(compareNames("smile dent all", "Smile Dental")).toBe("match");
    expect(compareNames("smile", "Smile Dental")).toBe("unclear");
    expect(compareNames("smile dental clapham", "Smile Dental")).toBe("unclear");
    expect(compareNames("pizza", "Smile Dental")).toBe("mismatch");
    expect(compareNames("smiles dental", "Smile Dental")).toBe("unclear");
    expect(compareNames("", "Smile Dental")).toBe("unclear");
  });
});
