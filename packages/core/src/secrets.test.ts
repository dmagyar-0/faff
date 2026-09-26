import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_SCAN_LENGTH, rejectProfileValues, rejectSecrets, type SecretKind } from "./secrets";

/** Every one of these must be rejected, as the kind given (I-6). */
const POSITIVE: readonly (readonly [string, SecretKind])[] = [
  // Standard test card numbers, in every grouping.
  ["4111111111111111", "card_number"],
  ["4111 1111 1111 1111", "card_number"],
  ["4111-1111-1111-1111", "card_number"],
  ["card 4242 4242 4242 4242 exp 12/28", "card_number"],
  ["5555555555554444", "card_number"],
  ["5105 1051 0510 5100", "card_number"],
  ["2223 0031 2200 3222", "card_number"],
  ["Amex 378282246310005", "card_number"],
  ["3782 822463 10005", "card_number"],
  ["6011 1111 1111 1117", "card_number"],
  ["3530111333300000", "card_number"],
  ["4000 0566 5566 5556", "card_number"],
  ["4222222222222", "card_number"],
  ["６０１１ １１１１ １１１１ １１１７", "card_number"],
  ["my card is 4111111111111111.", "card_number"],
  // With its expiry or security code written straight after it (review, PR 1.6).
  ["4111 1111 1111 1111 12/28", "card_number"],
  ["4111111111111111 12/28 123", "card_number"],
  ["4111 1111 1111 1111 123", "card_number"],
  ["5555 5555 5555 4444 09 27", "card_number"],
  ["ref 12 4111 1111 1111 1111", "card_number"],
  ["4111.1111.1111.1111", "card_number"],
  // Sort code and account number pairs.
  ["sort code 20-00-00 account 12345678", "bank_details"],
  ["Sort code: 200000", "bank_details"],
  ["sort-code 40 47 84", "bank_details"],
  ["20-00-00 12345678", "bank_details"],
  ["12345678 / 20-00-00", "bank_details"],
  ["account number 31926819", "bank_details"],
  ["acc no. 31926819", "bank_details"],
  ["A/C 31926819", "bank_details"],
  ["Account: 31926819", "bank_details"],
  ["sort code ２０-００-００", "bank_details"],
  ["acct 12345678", "bank_details"],
  ["account no 1234 5678", "bank_details"],
  ["IBAN GB29NWBK60161331926819", "bank_details"],
  ["GB29 NWBK 6016 1331 9268 19", "bank_details"],
  ["pay to DE89 3704 0044 0532 0130 00", "bank_details"],
  // A secret's name with its value.
  ["my PIN is 4471", "secret_value"],
  ["PIN: 4471", "secret_value"],
  ["pin number 1234", "secret_value"],
  ["Pin code = 9876", "secret_value"],
  ["passcode 112233", "secret_value"],
  ["CVV 123", "secret_value"],
  ["the cvc is 4412", "secret_value"],
  ["one-time code 482913", "secret_value"],
  ["OTP is 123456", "secret_value"],
  ["verification code: 889 123", "secret_value"],
  ["the password is hunter2", "secret_value"],
  ["password: Tr0ub4dor&3", "secret_value"],
  ['Password = "correct horse"', "secret_value"],
  ["memorable word is sunshine", "secret_value"],
  ["Memorable information: rover", "secret_value"],
  ["mother's maiden name is Smith", "secret_value"],
  ["Mum's maiden name: Jones", "secret_value"],
  ["security answer: fluffy", "secret_value"],
  ["the answer to my security question is Paris", "secret_value"],
  ["PIN is ４４７１", "secret_value"],
  ["password hunter2", "secret_value"],
  ["memorable word sunshine", "secret_value"],
  ["pw: hunter2", "secret_value"],
  ["pwd hunter2", "secret_value"],
  ["my PIN's 4471", "secret_value"],
  ["2FA code 482913", "secret_value"],
  ["login code: 551 902", "secret_value"],
  ["password - hunter2", "secret_value"],
  ["Password:\nhunter2", "secret_value"],
  ["first pet Rex", "secret_value"],
  ["my sort code is 20-00-00", "bank_details"],
  ["sort code is 200000 and account is 12345678", "bank_details"],
  ["account number is 12345678", "bank_details"],
  ["my account number is 1234 5678", "bank_details"],
  ["4111 1111\n1111 1111", "card_number"],
  ["4111–1111–1111–1111", "card_number"],
  ["4111 — 1111 — 1111 — 1111", "card_number"],
  ["password – hunter2", "secret_value"],
  ["memorable word - sunshine", "secret_value"],
  ["security answer - fluffy", "secret_value"],
  ["my first pet was Rex", "secret_value"],
  ["place of birth is Leeds", "secret_value"],
  ["memorable place is Paris", "secret_value"],
  ["passcode is abcd", "secret_value"],
];

/** Every one of these must pass: ordinary notes that only look like numbers or mention secrets. */
const FALSE_POSITIVES: readonly string[] = [
  // UK phone numbers.
  "020 7946 0000",
  "+44 20 7946 0000",
  "+44 (0)20 7946 0000",
  "(020) 7946-0000",
  "07700 900123",
  "0800 123 4567",
  "call 020 7946 0000 or 020 7946 0001",
  "+442079460000",
  // Dates in every common format.
  "14-10-26",
  "14/10/2026",
  "2026-10-14",
  "14.10.26",
  "141026",
  "Tuesday 14 October 2026",
  "14th Oct",
  "appointment 14-10-26 at 09:30, ref 88213441",
  "between 01-10-26 and 31-10-26",
  // Times.
  "09:30",
  "9.30am",
  "14:30-15:00",
  "any time 10:00 – 12:00",
  // Postcodes.
  "SW4 7AA",
  "EC1A 1BB",
  "W5 5AA",
  // Booking references.
  "ref 4417",
  "SD-20931",
  "booking ref 88213441",
  "REF: 2026-10-14-0930",
  "order 1234567890123",
  // NHS-style 10-digit numbers.
  "943 476 5919",
  "9434765919",
  // Mentions without a value.
  "don't give them my PIN",
  "they may ask for a PIN — say you don't have it",
  "if they ask for a password, say Faff doesn't have one",
  "the password is not something Faff has",
  "password is required on their portal",
  "the PIN is on the letter they sent",
  "they want my mother's maiden name; I'll call them myself",
  "Faff can't answer security questions",
  "the security code on the door is broken",
  "password is changed",
  "my password was reset last week",
  "they said my password is too weak",
  "verification code of 6 digits",
  "the password doesn't work on their site",
  "use the password reset link",
  "they have a password manager",
  "the password field is case sensitive",
  "IBAN GB00NWBK60161331926819 is invalid",
  "GB29 is a region code",
  "patient account 88213441",
  "password recovery",
  "password page",
  "password portal",
  "password issue",
  "password hints",
  "password sorted",
  "pw mentioned",
  "password: see letter",
  "password is fine",
  "password was sent by text",
  "the password was forgotten",
  "password: none",
  "Password: n/a",
  "07197 459272 020 8340 3193",
  "NHS 943 476 5919 dob 12 03 1985",
  "slots 27 05 1300 21 05 0900",
  "27.01.2026 15.48 2676",
  "call ".repeat(3) + "020 7946 0000",
  // Ordinary notes.
  "ask for the hygienist too; patient since 2019",
  "prefers mornings, not Mondays",
  "the account is under my married name",
  "call between 9 and 12",
];

describe("rejectSecrets: positive corpus", () => {
  it.each(POSITIVE)("rejects %j as %s", (text, kind) => {
    const result = rejectSecrets(text);
    expect(result).toMatchObject({ ok: false, reason: kind });
    if (!result.ok) {
      const [start, end] = result.detail?.span ?? [0, 0];
      expect(end).toBeGreaterThan(start);
    }
  });
});

describe("rejectSecrets: false-positive corpus", () => {
  it.each(FALSE_POSITIVES)("allows %j", (text) => {
    expect(rejectSecrets(text)).toMatchObject({ ok: true });
  });
});

describe("rejectSecrets", () => {
  it("returns the NFKC-normalised text, and spans point into it", () => {
    expect(rejectSecrets("ＡＢＣ 123")).toEqual({ ok: true, value: "ABC 123" });
    const text = "notes: card ４１１１ １１１１ １１１１ １１１１ thanks";
    const result = rejectSecrets(text);
    if (result.ok) throw new Error("expected a match");
    const [start, end] = result.detail?.span ?? [0, 0];
    expect(text.normalize("NFKC").slice(start, end)).toBe("4111 1111 1111 1111");
  });

  it("does not flag a card-length number that fails Luhn, or one outside the card ranges", () => {
    expect(rejectSecrets("4111111111111112").ok).toBe(true);
    expect(rejectSecrets("1111111111111117").ok).toBe(true);
  });

  it("catches a card grouped by double spaces or tabs", () => {
    expect(rejectSecrets("4111  1111  1111  1111").ok).toBe(false);
    expect(rejectSecrets("4111\t1111\t1111\t1111").ok).toBe(false);
  });

  it("refuses text too long to scan, rather than scanning it", () => {
    const long = "a".repeat(MAX_SCAN_LENGTH + 1);
    expect(rejectSecrets(long)).toMatchObject({ ok: false, reason: "too_long" });
    expect(rejectProfileValues(long, {})).toMatchObject({ ok: false, reason: "too_long" });
    expect(rejectSecrets("a".repeat(MAX_SCAN_LENGTH)).ok).toBe(true);
  });

  it("a full name that is just the Brief's first name isn't matched", () => {
    expect(rejectProfileValues("David prefers mornings", { full_name: "David" }, "David").ok).toBe(
      true,
    );
    expect(rejectProfileValues("David prefers mornings", { full_name: "David" }).ok).toBe(false);
  });

  it("stays fast on long runs of digits and spaces (no blow-up)", () => {
    for (const text of [
      "12-34-56 ".repeat(20_000),
      "1 ".repeat(50_000),
      `password${" ".repeat(100_000)}x`,
    ]) {
      const started = Date.now();
      rejectSecrets(text);
      rejectProfileValues(text, { contact_phone: "+447700900123", nhs_number: "9434765919" });
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });

  const luhnDigit = (body: number[]): number => {
    const sum = body
      .slice()
      .reverse()
      .reduce((acc, d, i) => {
        const x = i % 2 === 0 ? d * 2 : d;
        return acc + (x > 9 ? x - 9 : x);
      }, 0);
    return (10 - (sum % 10)) % 10;
  };
  const cardDigits = fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 14, maxLength: 14 })
    .map((body) => {
      const digits = [4, ...body];
      return [...digits, luhnDigit(digits)].join("");
    });

  it("property: a Luhn-valid 16-digit number starting 4 is caught, whatever separates its blocks", () => {
    fc.assert(
      fc.property(
        cardDigits,
        fc.array(fc.constantFrom("", " ", "-", "  ", ".", "\t"), { minLength: 3, maxLength: 3 }),
        (card, seps) => {
          const blocks = card.match(/\d{4}/g) ?? [];
          const text = blocks.map((b, i) => `${b}${seps[i] ?? ""}`).join("");
          expect(rejectSecrets(`pay with ${text} please`)).toMatchObject({
            ok: false,
            reason: "card_number",
          });
        },
      ),
    );
  });

  it("property: a card grouped as printed is caught with other digits written around it", () => {
    fc.assert(
      fc.property(
        cardDigits,
        fc.constantFrom(" ", "-"),
        fc.array(fc.stringMatching(/^\d{1,4}$/), { maxLength: 2 }),
        fc.array(fc.stringMatching(/^\d{1,4}$/), { maxLength: 2 }),
        (card, sep, before, after) => {
          const grouped = (card.match(/\d{4}/g) ?? []).join(sep);
          // Digit groups before and after it, as an expiry or a reference would be written.
          const text = [...before, grouped, ...after].join(" ");
          expect(rejectSecrets(`pay with ${text} please`)).toMatchObject({
            ok: false,
            reason: "card_number",
          });
        },
      ),
    );
  });

  it("property: never throws", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(typeof rejectSecrets(text).ok).toBe("boolean");
      }),
    );
  });
});

describe("rejectProfileValues (G21)", () => {
  const values = {
    full_name: "David Example",
    preferred_name: "David",
    date_of_birth: "1985-03-04",
    postcode: "W4 7AA",
    contact_phone: "+447700900123",
    contact_email: "d.ex@mail.example",
    nhs_number: "943 476 5919",
    address_line: "12 High Street",
    existing_patient: "yes",
  } as const;

  it.each([
    ["DOB 04/03/1985", "date_of_birth"],
    ["born 4 March 1985", "date_of_birth"],
    ["born 4th of March 1985", "date_of_birth"],
    ["dob 1985-03-04", "date_of_birth"],
    ["dob 4.3.85", "date_of_birth"],
    ["March 4, 1985", "date_of_birth"],
    ["postcode w47aa", "postcode"],
    ["lives at W4  7AA", "postcode"],
    ["address 12 High St", "address_line"],
    ["mobile 07700 900123", "contact_phone"],
    ["mobile +44 7700 900 123", "contact_phone"],
    ["email D.Ex@Mail.Example", "contact_email"],
    ["NHS 9434765919", "nhs_number"],
    ["this is for David Example.", "full_name"],
    ["dob 04031985", "date_of_birth"],
    ["dob 040385", "date_of_birth"],
    ["1985.3.4", "date_of_birth"],
    ["mobile 7700 900123", "contact_phone"],
    ["call 07700 900123 12:00", "contact_phone"],
  ])("rejects %j (%s)", (text, field) => {
    expect(rejectProfileValues(text, values)).toEqual({
      ok: false,
      reason: "profile_value",
      detail: { field },
    });
  });

  it.each([
    "prefers mornings",
    "born in March",
    "call 020 7946 0000",
    "David prefers the hygienist",
    "Davidexample is not the name",
    "yes please",
    "appointment on 04/03/2026",
    "ref 1207700900123",
    "their postcode is SW4 7AA",
    "new w4 7aab",
    "David prefers mornings",
  ])("allows %j", (text) => {
    expect(rejectProfileValues(text, values)).toEqual({ ok: true, value: true });
  });

  it("spells dates of birth with every ordinal suffix", () => {
    for (const [dob, text] of [
      ["1990-11-12", "born 12th November 1990"],
      ["1990-11-11", "born 11th Nov 1990"],
      ["1990-11-22", "born 22nd of November 1990"],
      ["1990-11-23", "November 23rd 1990"],
      ["1990-11-21", "21st/11/90"],
    ] as const) {
      expect(rejectProfileValues(text, { date_of_birth: dob }).ok, `${dob} in ${text}`).toBe(false);
    }
    // A month that doesn't exist still matches as written numerically.
    expect(rejectProfileValues("born 01/13/1990", { date_of_birth: "1990-13-01" }).ok).toBe(false);
  });

  it("ignores very short values and non-ISO dates are matched as written", () => {
    expect(rejectProfileValues("ab cd", { preferred_name: "ab" }).ok).toBe(true);
    expect(rejectProfileValues("born 4 March", { date_of_birth: "4 March" }).ok).toBe(false);
    expect(rejectProfileValues("anything", {}).ok).toBe(true);
    expect(rejectProfileValues("tel 07700 900123", { contact_phone: "123" }).ok).toBe(true);
  });
});
