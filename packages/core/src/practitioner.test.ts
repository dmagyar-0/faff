import { describe, expect, it } from "vitest";

import { normalisePractitioner, samePractitioner } from "./practitioner";

describe("normalisePractitioner", () => {
  it.each([
    ["Dr Patel", "patel"],
    ["dr. patel", "patel"],
    ["DR PATEL", "patel"],
    ["Mrs  Anne-Marie O'Neill", "anne marie o neill"],
    ["Prof. Łukasz Nowak", "łukasz nowak"],
    ["Mx Sam Lee", "sam lee"],
    ["Ｄｒ Ｐａｔｅｌ", "patel"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePractitioner(input)).toBe(expected);
  });
});

describe("samePractitioner", () => {
  it("ignores case, titles and punctuation", () => {
    expect(samePractitioner("Dr. Patel", "patel")).toBe(true);
    expect(samePractitioner("Miss Jones", "Ms Jones")).toBe(true);
  });

  it("tells different people apart", () => {
    expect(samePractitioner("Dr Patel", "Dr Jones")).toBe(false);
    expect(samePractitioner("Dr Sam Patel", "Dr Patel")).toBe(false);
  });
});
