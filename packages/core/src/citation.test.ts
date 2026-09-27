import { describe, expect, it } from "vitest";

import {
  citationHolds,
  domainOf,
  hostOf,
  isFirstPartySource,
  normalisePhone,
  normaliseText,
  pageNamesBusiness,
  sameEmail,
} from "./citation";

const NBSP = "\u00A0";
const ZWSP = "\u200B";
const ENDASH = "\u2013";
const LQ = "\u201C";
const RQ = "\u201D";
const LSQ = "\u2018";
const RSQ = "\u2019";

describe("normalisePhone", () => {
  it.each([
    "+44 20 7946 0000",
    "020 7946 0000",
    "(020) 7946-0000",
    "+44 (0)20 7946 0000",
    "+44(0)2079460000",
    "0044 20 7946 0000",
    "020.7946.0000",
    "０２０ ７９４６ ００００",
  ])("%s → +442079460000", (text) => {
    expect(normalisePhone(text)).toBe("+442079460000");
  });

  it.each([
    ["07700 900123", "+447700900123"],
    ["+353 1 234 5678", "+35312345678"],
    ["0800 123 456", "+44800123456"],
  ])("%s → %s", (text, e164) => {
    expect(normalisePhone(text)).toBe(e164);
  });

  it.each([
    "",
    "call us",
    "7946 0000",
    "+44 0 20 7946 0000",
    "020 7946 0000 ext 2",
    "+0 123 4567",
    "12-34",
    "020 7946 00000 0",
  ])("%j is not a phone number", (text) => {
    expect(normalisePhone(text)).toBeNull();
  });
});

describe("normaliseText", () => {
  it("collapses every kind of whitespace, drops zero-width characters, unifies dashes and quotes", () => {
    const messy =
      "Call" +
      NBSP +
      "us:\n\t020" +
      ZWSP +
      " 7946" +
      ENDASH +
      "0000 " +
      LQ +
      "bookings" +
      RQ +
      " " +
      LSQ +
      "x" +
      RSQ;
    expect(normaliseText(messy)).toBe("Call us: 020 7946-0000 \"bookings\" 'x'");
  });
});

describe("citationHolds (I-11)", () => {
  const page =
    "<p>Smile Dental, Clapham</p>" +
    NBSP +
    "Bookings:" +
    NBSP +
    "020 7946" +
    NBSP +
    "0000.\nEmail info@SmileDental.example for anything else.";

  it("holds when the quote is on the page and the value is in the quote", () => {
    expect(citationHolds({ phone: "+442079460000" }, "Bookings: 020 7946 0000", page)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      citationHolds(
        { email: "info@smiledental.example" },
        "Email info@SmileDental.example for",
        page,
      ).ok,
    ).toBe(true);
  });

  it("fails when the quote isn't on the page", () => {
    expect(citationHolds({ phone: "+442079460000" }, "Call 020 7946 0000", page)).toEqual({
      ok: false,
      reason: "quote_not_on_page",
    });
  });

  it("fails when the value isn't in the quote", () => {
    expect(citationHolds({ phone: "+442079460001" }, "Bookings: 020 7946 0000", page)).toEqual({
      ok: false,
      reason: "value_not_in_quote",
    });
    expect(citationHolds({ phone: "+442079460000" }, "Smile Dental, Clapham", page)).toEqual({
      ok: false,
      reason: "value_not_in_quote",
    });
    // The local part is exact: a different case is a different mailbox.
    expect(
      citationHolds({ email: "Info@smiledental.example" }, "Email info@SmileDental.example", page)
        .ok,
    ).toBe(false);
  });

  it("skips phone-like runs that aren't numbers, and still finds the real one", () => {
    const text = "Ref 12-34 5678 9012 3456 7890 or 020 7946 0000";
    expect(citationHolds({ phone: "+442079460000" }, "or 020 7946 0000", text).ok).toBe(true);
    expect(
      citationHolds({ phone: "+442079460000" }, "Ref 12-34 5678 9012 3456 7890", text).ok,
    ).toBe(false);
  });

  it("a quote that cuts a longer value in half can't vouch for the half", () => {
    const emailPage = "Email bookings@smiledental.co.uk or notinfo@smiledental.example";
    expect(
      citationHolds(
        { email: "bookings@smiledental.co" },
        "Email bookings@smiledental.co",
        emailPage,
      ),
    ).toEqual({ ok: false, reason: "value_not_in_quote" });
    expect(
      citationHolds({ email: "info@smiledental.example" }, "info@smiledental.example", emailPage)
        .ok,
    ).toBe(false);
    const phonePage = "Ref 020 7946 00001234 for orders";
    expect(citationHolds({ phone: "+442079460000" }, "Ref 020 7946 0000", phonePage)).toEqual({
      ok: false,
      reason: "value_not_in_quote",
    });
  });

  it("a span that drops the start of the number can't vouch for what's left (review, PR 1.5)", () => {
    const cases: [string, string][] = [
      ["+2079460000", "Call +44 20 7946 0000"],
      ["+79460000", "Tel 020 7946 0000"],
      ["+442079460000", "+1 442 079 460 000"],
      ["+442079460000", "Ref 442079460000"],
    ];
    for (const [phone, page] of cases) {
      expect(citationHolds({ phone }, page, page), `${phone} in ${page}`).toEqual({
        ok: false,
        reason: "value_not_in_quote",
      });
    }
  });

  it("an extension written as its own group doesn't stop the number counting", () => {
    const page = "Tel 020 7946 0000 1234";
    expect(citationHolds({ phone: "+442079460000" }, page, page).ok).toBe(true);
  });

  it("an email must sit inside the quote, not just somewhere on the page", () => {
    const page = "Email bookings@smile.example or info@smile.example";
    expect(
      citationHolds({ email: "info@smile.example" }, "Email bookings@smile.example", page),
    ).toEqual({
      ok: false,
      reason: "value_not_in_quote",
    });
  });

  it("an email may end a sentence, but not be the start of a longer address", () => {
    const page = "Email bookings@smile.example. Or x@smile.example-2.org";
    expect(
      citationHolds({ email: "bookings@smile.example" }, "Email bookings@smile.example.", page).ok,
    ).toBe(true);
    expect(citationHolds({ email: "x@smile.example" }, "Or x@smile.example-2.org", page).ok).toBe(
      false,
    );
  });

  it("finds the number when other digits sit beside it in the same run", () => {
    const page = "Mon-Fri 9-5 020 7946 0000 / 020 7946 1111";
    expect(citationHolds({ phone: "+442079460000" }, "9-5 020 7946 0000", page).ok).toBe(true);
    expect(citationHolds({ phone: "+442079461111" }, "0000 / 020 7946 1111", page).ok).toBe(true);
    // The value must sit inside the quote, not just somewhere on the page.
    expect(citationHolds({ phone: "+442079461111" }, "Mon-Fri 9-5", page).ok).toBe(false);
    // Every spelling of the same number: +44, 0044 and +44 (0).
    expect(
      citationHolds({ phone: "+442079460000" }, "0044 20 7946 0000", "Tel 0044 20 7946 0000").ok,
    ).toBe(true);
    expect(
      citationHolds({ phone: "+442079460000" }, "+44 (0)20 7946 0000", "+44 (0)20 7946 0000").ok,
    ).toBe(true);
    expect(
      citationHolds({ phone: "+35312345678" }, "+353 1 234 5678", "Dublin +353 1 234 5678").ok,
    ).toBe(true);
  });

  it("an empty quote proves nothing", () => {
    expect(citationHolds({ phone: "+442079460000" }, "  ", page)).toEqual({
      ok: false,
      reason: "empty_quote",
    });
  });

  it("an obfuscated address fails, on purpose", () => {
    const obfuscated = "Email info [at] smiledental.example";
    expect(citationHolds({ email: "info@smiledental.example" }, obfuscated, obfuscated).ok).toBe(
      false,
    );
  });

  it("sameEmail", () => {
    expect(sameEmail("a@B.example", "a@b.EXAMPLE")).toBe(true);
    expect(sameEmail("A@b.example", "a@b.example")).toBe(false);
    expect(sameEmail("nodomain", "nodomain")).toBe(false);
  });
});

describe("pageNamesBusiness (Q39 condition 4)", () => {
  const page =
    "Welcome to Smile Dental in Clapham. 12 High Street, London SW4 7AA. Tel 020 7946 0000";

  it("needs the display name and the postcode or address", () => {
    expect(
      pageNamesBusiness(page, { displayName: "Smile Dental, Clapham", postcode: "sw47aa" }).ok,
    ).toBe(true);
    expect(
      pageNamesBusiness(page, { displayName: "Smile Dental", address: "12 High Street" }).ok,
    ).toBe(true);
  });

  it("fails without the name", () => {
    expect(pageNamesBusiness(page, { displayName: "Bright Smile", postcode: "SW4 7AA" })).toEqual({
      ok: false,
      reason: "name_not_on_page",
    });
    expect(pageNamesBusiness(page, { displayName: ", ", postcode: "SW4 7AA" }).ok).toBe(false);
  });

  it("needs the name as one phrase and the postcode as whole words", () => {
    const scattered = "Dental news: smile! Bright Smile Clinic, Clapham SW4 7AA";
    expect(
      pageNamesBusiness(scattered, { displayName: "Smile Dental, Clapham", postcode: "SW4 7AA" }),
    ).toEqual({
      ok: false,
      reason: "name_not_on_page",
    });
    const animals = "Smile Dental: we see 16 animals a day";
    expect(pageNamesBusiness(animals, { displayName: "Smile Dental", postcode: "E1 6AN" }).ok).toBe(
      false,
    );
    expect(
      pageNamesBusiness("Smile Dental, E16AN", { displayName: "Smile Dental", postcode: "E1 6AN" })
        .ok,
    ).toBe(true);
  });

  it("fails without a matching location", () => {
    expect(pageNamesBusiness(page, { displayName: "Smile Dental", postcode: "SW9 1AA" })).toEqual({
      ok: false,
      reason: "location_not_on_page",
    });
    expect(pageNamesBusiness(page, { displayName: "Smile Dental" })).toEqual({
      ok: false,
      reason: "location_not_on_page",
    });
    expect(
      pageNamesBusiness(page, { displayName: "Smile Dental", address: "1 High Street" }).ok,
    ).toBe(false);
  });
});

describe("isFirstPartySource (Q39 condition 2)", () => {
  const nhs = ["www.nhs.uk"];

  it.each([
    ["https://smiledental.example/contact", "smiledental.example"],
    ["https://www.smiledental.example/contact", "https://smiledental.example"],
    ["https://bookings.smiledental.example", "www.smiledental.example"],
    ["https://www.nhs.uk/services/dentist/smile-dental/X1", undefined],
    ["http://WWW.NHS.UK./x", undefined],
  ])("%s is first-party (site %s)", (url, site) => {
    expect(isFirstPartySource(url, site, nhs)).toBe(true);
  });

  it.each([
    ["https://yell.example/smile-dental", "smiledental.example"],
    ["https://smiledental.example.evil.example/", "smiledental.example"],
    ["https://notsmiledental.example/", "smiledental.example"],
    ["https://nhs.uk.evil.example/", undefined],
    ["https://othersurgery.nhs.uk/contact", undefined],
    ["https://nhs.uk/services/x", undefined],
    ["https://facebook.com/smiledental/about", "facebook.com/smiledental"],
    ["https://nhs.uk@evil.example/", undefined],
    ["https://evil.example\\@smiledental.example/", "smiledental.example"],
    ["https://evil.example\\@www.nhs.uk/x", undefined],
    ["https://evil.example\\.smiledental.example/", "smiledental.example"],
    ["https://smiledental.example /x", "smiledental.example"],
    ["ftp://smiledental.example/", "smiledental.example"],
    ["not a url", "smiledental.example"],
  ])("%s is not (site %s)", (url, site) => {
    expect(isFirstPartySource(url, site, nhs)).toBe(false);
  });

  it("hostOf and domainOf", () => {
    expect(hostOf("https://Example.COM:8443/a?b#c")).toBe("example.com");
    expect(hostOf("https://user:pw@example.com/")).toBeUndefined();
    expect(hostOf("https://")).toBeUndefined();
    expect(domainOf("www.Smile.example")).toBe("smile.example");
    expect(domainOf("www.Smile.example/")).toBe("smile.example");
    expect(domainOf("facebook.com/smiledental")).toBeUndefined();
    expect(domainOf("https://www.smile.example")).toBe("smile.example");
  });
});
