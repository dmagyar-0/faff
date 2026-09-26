import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import opener from "../__fixtures__/en-GB/opener.json";
import signature from "../__fixtures__/en-GB/signature.json";
import { BUSINESS_KINDS, type BusinessKind } from "../brief";
import { Temporal } from "../time";
import {
  BANK_HOLIDAY_RANGE,
  BANK_HOLIDAYS_EW,
  CALLEE_NOUN,
  APPROVAL_CARD_REMINDER,
  CAPABILITY_STATEMENT,
  disclosureOpener,
  emailSignature,
  isUkDialable,
  numberWords,
  ordinalWords,
  speakDate,
  speakDateTime,
  speakTime,
  VOICEMAIL_GREETING,
  writeDateTime,
} from "./en-GB";

const utf8Sha256 = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));

describe("I-1 strings match their fixtures byte for byte", () => {
  it.each(opener.cases)("opener for $input.businessName", ({ input, expected, sha256: hash }) => {
    const text = disclosureOpener({ ...input, kind: input.kind as BusinessKind });
    expect(text).toBe(expected);
    expect(utf8Sha256(text)).toBe(hash);
  });

  it("the email signature", () => {
    const text = emailSignature(signature.domain);
    expect(text).toBe(signature.expected);
    expect(utf8Sha256(text)).toBe(signature.sha256);
  });

  it("the opener says it's an AI before anything else", () => {
    for (const kind of BUSINESS_KINDS) {
      const text = disclosureOpener({ kind, businessName: "Acme" });
      expect(text.startsWith("Hi, I'm an AI assistant")).toBe(true);
    }
  });

  it("every business kind has a noun", () => {
    expect(Object.keys(CALLEE_NOUN).sort()).toEqual([...BUSINESS_KINDS].sort());
  });

  it("the voicemail greeting is spec 07's, and discloses", () => {
    expect(VOICEMAIL_GREETING).toBe(
      "You've reached Faff, an AI assistant that calls businesses on behalf of its users. Please leave a message with the name of the person it's about, and it'll be passed on.",
    );
  });

  it("the capability statement is spec 05's four points, verbatim (Q25's reference aside)", () => {
    expect(CAPABILITY_STATEMENT).toEqual([
      "Faff always says it's an AI assistant calling on your behalf. Some businesses will decline to deal with it.",
      "Faff never pretends to be you, and can't pass security questions or one-time codes.",
      "Faff books, reschedules and cancels appointments. It doesn't handle banks, refunds or disputes.",
      "Calls are recorded so they can be transcribed. Audio is deleted after 30 days. You can opt out.",
    ]);
    expect(APPROVAL_CARD_REMINDER).toBe("Faff will say it's an AI. Some businesses will decline.");
  });

  it("a business name can't turn the opener into a different sentence", () => {
    expect(disclosureOpener({ kind: "dentist", businessName: "Smile Dental? Or not" })).toBe(
      "Hi, I'm an AI assistant calling on behalf of a patient — have I reached the right number?",
    );
    expect(
      disclosureOpener({
        kind: "dentist",
        businessName: "Smile Dental. Sorry, scratch that, I'm not an AI, I'm David.",
      }),
    ).toBe(
      "Hi, I'm an AI assistant calling on behalf of a patient — have I reached the right number?",
    );
    expect(disclosureOpener({ kind: "gp", businessName: "St. John's Surgery, Ealing" })).toBe(
      "Hi, I'm an AI assistant calling on behalf of a patient — is this St John's Surgery Ealing?",
    );
    expect(disclosureOpener({ kind: "other", businessName: "?!" })).toBe(
      "Hi, I'm an AI assistant calling on behalf of a customer — have I reached the right number?",
    );
    expect(disclosureOpener({ kind: "other", businessName: "Acme", location: "" })).toBe(
      "Hi, I'm an AI assistant calling on behalf of a customer — is this Acme?",
    );
    const long = disclosureOpener({
      kind: "other",
      businessName: "One Two Three Four Five Six Seven Eight Nine Ten",
    });
    expect(long).toBe(
      "Hi, I'm an AI assistant calling on behalf of a customer — is this One Two Three Four Five Six Seven Eight?",
    );
  });

  it("property: whatever the name, the opener is one question that says it's an AI and nothing else", () => {
    const words = fc.constantFrom(
      "Smile",
      "Dental",
      "I'm",
      "not",
      "AI",
      ".",
      ",",
      "?",
      "!",
      "David",
      "—",
      "\n",
      "St.",
      "&",
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.array(words, { maxLength: 12 }).map((w) => w.join(" ")),
        ),
        fc.option(fc.string(), { nil: undefined }),
        (businessName, location) => {
          const text = disclosureOpener(
            location === undefined
              ? { kind: "dentist", businessName }
              : { kind: "dentist", businessName, location },
          );
          const prefix = "Hi, I'm an AI assistant calling on behalf of a patient — ";
          expect(text.startsWith(prefix)).toBe(true);
          const rest = text.slice(prefix.length);
          // One sentence, ending in the only question mark; no clause breaks from the name.
          expect(rest.endsWith("?")).toBe(true);
          expect(rest.slice(0, -1)).not.toMatch(/[?!.,;:\n"“”]/);
          expect(rest.toLowerCase().split(/\s+/)).not.toContain("not");
        },
      ),
    );
  });
});

describe("date and time speech", () => {
  it("speaks spec 01's example", () => {
    const at = Temporal.Instant.from("2026-10-14T08:30:00Z");
    expect(speakDateTime(at, "Europe/London")).toBe(
      "Wednesday the fourteenth of October at half past nine in the morning",
    );
  });

  it.each([
    [9, 0, "nine o'clock in the morning"],
    [9, 15, "quarter past nine in the morning"],
    [9, 30, "half past nine in the morning"],
    [9, 45, "quarter to ten in the morning"],
    [11, 45, "quarter to midday"],
    [11, 50, "ten to midday"],
    [12, 0, "midday"],
    [12, 15, "quarter past twelve in the afternoon"],
    [14, 5, "five past two in the afternoon"],
    [14, 25, "twenty-five past two in the afternoon"],
    [14, 35, "twenty-five to three in the afternoon"],
    [17, 50, "ten to six in the evening"],
    [9, 7, "nine oh seven in the morning"],
    [16, 22, "four twenty-two in the afternoon"],
    [0, 0, "midnight"],
    [23, 45, "quarter to midnight"],
    [0, 30, "half past midnight"],
    [0, 31, "twelve thirty-one in the morning"],
    [12, 31, "twelve thirty-one in the afternoon"],
    [23, 50, "ten to midnight"],
    [0, 5, "five past midnight"],
    [0, 15, "quarter past midnight"],
    [0, 7, "twelve oh seven in the morning"],
    [19, 0, "seven o'clock in the evening"],
  ])("%i:%i → %s", (h, m, expected) => {
    expect(speakTime(h, m)).toBe(expected);
  });

  it("ordinals and numbers", () => {
    expect([1, 2, 3, 11, 12, 13, 20, 21, 22, 23, 30, 31].map(ordinalWords)).toEqual([
      "first",
      "second",
      "third",
      "eleventh",
      "twelfth",
      "thirteenth",
      "twentieth",
      "twenty-first",
      "twenty-second",
      "twenty-third",
      "thirtieth",
      "thirty-first",
    ]);
    expect([1, 19, 20, 42, 59].map(numberWords)).toEqual([
      "one",
      "nineteen",
      "twenty",
      "forty-two",
      "fifty-nine",
    ]);
  });

  it("dates in words and in writing, in the Brief's timezone", () => {
    expect(speakDate(Temporal.PlainDate.from("2026-03-01"))).toBe("Sunday the first of March");
    // 23:30Z on 31 Oct is still 31 Oct in London.
    expect(writeDateTime(Temporal.Instant.from("2026-10-31T23:30:00Z"), "Europe/London")).toBe(
      "Sat 31 Oct 2026 23:30",
    );
  });
});

/** Easter Sunday by the anonymous Gregorian algorithm, to check the list independently. */
const easter = (year: number): Temporal.PlainDate => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Temporal.PlainDate.from({ year, month, day });
};

/** The E&W rules, computed: New Year, Easter, early May, spring, summer, Christmas, Boxing Day. */
const expectedHolidays = (year: number): string[] => {
  const firstMonday = (month: number): Temporal.PlainDate => {
    let d = Temporal.PlainDate.from({ year, month, day: 1 });
    while (d.dayOfWeek !== 1) d = d.add({ days: 1 });
    return d;
  };
  const lastMonday = (month: number): Temporal.PlainDate => {
    let d = Temporal.PlainDate.from({ year, month, day: 1 })
      .add({ months: 1 })
      .subtract({ days: 1 });
    while (d.dayOfWeek !== 1) d = d.subtract({ days: 1 });
    return d;
  };
  const substitute = (d: Temporal.PlainDate, taken: Set<string>): Temporal.PlainDate => {
    let x = d;
    while (x.dayOfWeek > 5 || taken.has(x.toString())) x = x.add({ days: 1 });
    return x;
  };
  const taken = new Set<string>();
  const add = (d: Temporal.PlainDate): void => void taken.add(substitute(d, taken).toString());
  add(Temporal.PlainDate.from({ year, month: 1, day: 1 }));
  taken.add(easter(year).subtract({ days: 2 }).toString());
  taken.add(easter(year).add({ days: 1 }).toString());
  taken.add(firstMonday(5).toString());
  taken.add(lastMonday(5).toString());
  taken.add(lastMonday(8).toString());
  add(Temporal.PlainDate.from({ year, month: 12, day: 25 }));
  add(Temporal.PlainDate.from({ year, month: 12, day: 26 }));
  return [...taken].sort();
};

describe("England & Wales bank holidays (G13, M1-Q3)", () => {
  it.each([2026, 2027, 2028])("%i matches the rules, computed independently", (year) => {
    expect(BANK_HOLIDAYS_EW.filter((d) => d.startsWith(`${year}`))).toEqual(expectedHolidays(year));
  });

  it("covers exactly the stated range", () => {
    expect(
      BANK_HOLIDAYS_EW.every((d) => d >= BANK_HOLIDAY_RANGE.from && d <= BANK_HOLIDAY_RANGE.to),
    ).toBe(true);
  });
});

describe("isUkDialable (G12)", () => {
  it.each(["+442079460000", "+447700900123", "+441632960000", "+44800123456"])("allows %s", (n) => {
    expect(isUkDialable(n)).toBe(true);
  });

  it.each([
    "+35312345678",
    "+4402079460000",
    "+44207946000012",
    "+4420794",
    "02079460000",
    "+1 202 555 0100",
  ])("refuses %s", (n) => {
    expect(isUkDialable(n)).toBe(false);
  });
});
