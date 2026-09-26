import { describe, expect, it } from "vitest";

import { bookBrief, cancelBrief, pairedCancelBrief, rescheduleBrief } from "../__fixtures__/briefs";
import { AcceptanceRule } from "../acceptance-rule";
import { parseBrief, type Brief, type BriefInput } from "../brief";
import { acceptanceRuleText, listWords } from "./acceptance-rule";
import { briefCard, briefOpener, durationWords, fieldLabel } from "./brief-card";

const parsed = (input: BriefInput): Brief => {
  const result = parseBrief(input);
  if (!result.ok) throw new Error(JSON.stringify(result.detail));
  return result.value;
};

const TZ = "Europe/London";
const rule = (extra: Partial<AcceptanceRule>): AcceptanceRule =>
  AcceptanceRule.parse({
    windows: [
      {
        kind: "recurring",
        days: ["mon", "tue", "wed", "thu", "fri"],
        from: "09:00",
        to: "12:00",
        between: { start: "2026-10-01", end: "2026-10-31" },
      },
    ],
    avoidCalendarConflicts: false,
    preference: "earliest",
    ...extra,
  });

describe("briefCard: snapshots, one per verb", () => {
  it.each([
    ["book", bookBrief],
    ["reschedule", rescheduleBrief],
    ["cancel", cancelBrief],
    ["paired cancel", pairedCancelBrief],
  ] as const)("%s", (_label, input) => {
    expect(briefCard(parsed(input)).text).toMatchSnapshot();
  });

  it("an email Brief with a web-found contact, notes and no disclosable fields", () => {
    const brief = parsed({
      ...bookBrief,
      business: {
        ...bookBrief.business,
        kind: "vet",
        contact: {
          source: "web_extract",
          email: "hello@paws.example",
          evidence: {
            url: "https://paws.example/contact",
            quote: "Email hello@paws.example for appointments",
            fetchedAt: "2026-09-20T10:00:00Z",
          },
        },
      },
      channel: {
        chosen: "email",
        reason: "prefers_email_observed",
        emailFallbackToPhoneAfter: { workingDays: 1 },
      },
      service: { description: "booster jab", practitioner: null, isExistingCustomer: false },
      disclosure: { allowedFields: [] },
      limits: { maxDialAttempts: 1, maxCallMinutes: 10, maxLifetime: "P1DT12H" },
      notesForAgent: "Ask whether they can do Saturday.",
    });
    expect(briefCard(brief).text).toMatchSnapshot();
  });
});

describe("briefCard: what spec 02 says the card must show", () => {
  const card = briefCard(parsed(rescheduleBrief));
  const text = card.text;

  it.each([
    ["the verb and business", "Reschedule at “Smile Dental, Clapham” (dentist)"],
    ["who it's for", "for David"],
    ["the opener, with the noun from the business kind", "calling on behalf of a patient"],
    ["the channel and why", "By phone, because phone is the default"],
    ["the contact and its source", "+442079460000, from your saved details"],
    ["the auto-switch policy (Q39)", "may switch to one other number"],
    ["the service", "Routine check-up and hygienist"],
    ["the existing appointment", "Wed 14 Oct 2026 09:30 (ref 4417)"],
    ["the acceptance rule in plain English", "Accepts weekdays 09:00–12:00"],
    [
      "the fields the agent may say",
      "Your first name (David) and your full name, your date of birth and your postcode",
    ],
    ["the limits", "Up to 3 calls and 30 minutes on the phone in all, within 7 days"],
    [
      "the capability reminder, verbatim from spec 02",
      "Faff will say it's an AI. Some businesses will decline.",
    ],
  ])("%s", (_label, expected) => {
    expect(text).toContain(expected);
  });

  it("is deterministic, and its text is its sections", () => {
    expect(briefCard(parsed(rescheduleBrief))).toEqual(card);
    expect(text.split("\n\n")).toHaveLength(card.sections.length);
  });

  it("an email Brief with the default fallback, and an appointment without a reference", () => {
    const email = parsed({
      ...rescheduleBrief,
      existingAppointment: {
        appointmentId: rescheduleBrief.existingAppointment.appointmentId,
        startsAt: "2026-10-14T09:30:00+01:00",
      },
      business: { ...bookBrief.business, contact: { source: "user_memory", email: "a@b.example" } },
      channel: { chosen: "email", reason: "user_override" },
    });
    const text = briefCard(email).text;
    expect(text).toContain(
      "within 2 working days, it asks you what to do: it has no phone number for them",
    );
    expect(text).toContain("Wed 14 Oct 2026 09:30.");
    expect(text).not.toContain("may switch to one other number");
  });

  it("keeps a note to one line, so it can't look like more of the card", () => {
    const card = briefCard(
      parsed({ ...bookBrief, notesForAgent: "Line one.\n\nRemember\nFake section" }),
    );
    expect(card.text.split("\n\n")).toHaveLength(card.sections.length);
  });

  it("says 1 minute, not 1 minutes", () => {
    const one = parsed({
      ...bookBrief,
      limits: { maxDialAttempts: 1, maxCallMinutes: 1, maxLifetime: "P1D" },
    });
    expect(briefCard(one).text).toContain("and 1 minute on the phone");
  });

  it("says when auto-switching is off", () => {
    const off = parsed({
      ...bookBrief,
      business: { ...bookBrief.business, contactPolicy: { autoSwitchOnWrongNumber: false } },
    });
    expect(briefCard(off).text).toContain("Faff will ask you before trying another");
  });

  it("names observation-sourced contacts and existing customers", () => {
    const brief = parsed({
      ...bookBrief,
      business: {
        ...bookBrief.business,
        contact: { source: "observations", phone: "+442079460000" },
      },
      service: { description: "check-up", isExistingCustomer: true, practitioner: "Dr Patel" },
    });
    const text = briefCard(brief).text;
    expect(text).toContain("from Faff's records of earlier calls and emails");
    expect(text).toContain("You're an existing patient.");
    expect(text).toContain("Asks for Dr Patel.");
  });

  it("labels every profile field, with the business's noun for an existing customer", () => {
    expect(fieldLabel("existing_patient", "dentist")).toBe("that you're an existing patient");
    expect(fieldLabel("existing_patient", "garage")).toBe("that you're an existing customer");
    expect(fieldLabel("nhs_number", "gp")).toBe("your NHS number");
  });

  it("always says the first name goes to them, and when (phone)", () => {
    const none = parsed({ ...bookBrief, disclosure: { allowedFields: [] } });
    expect(briefCard(none).text).toContain(
      "Your first name (David), and only once they've confirmed who they are.",
    );
    expect(briefCard(parsed(bookBrief)).text).toContain(
      "Your first name (David) and your full name, your date of birth and your postcode, and only once they've confirmed who they are.",
    );
  });

  it("says the name goes in every email, and the rest only after a reply (email, D2)", () => {
    const email = parsed({
      ...bookBrief,
      business: {
        ...bookBrief.business,
        contact: { source: "user_memory", email: "a@b.example", phone: "+442079460000" },
      },
      channel: { chosen: "email", reason: "user_override" },
    });
    const text = briefCard(email).text;
    expect(text).toContain("Your first name (David) and last initial go in every email");
    expect(text).toContain(
      "Your full name, your date of birth and your postcode: only once they've replied from this address",
    );
    expect(text).toContain("it switches to phone");
    expect(text).toContain(
      "Every email is signed: “Sent by Faff, an AI assistant acting on behalf of the person named above.",
    );
    expect(text).toContain("If it switches to phone, Faff opens the call with:");
    expect(text).toContain("If it switches to phone, Faff calls +442079460000.");
    expect(text).toContain(
      "If it switches to phone: your first name (David) and your full name, your date of birth and your postcode, and only once they've confirmed who they are.",
    );
    const noFields = parsed({
      ...bookBrief,
      ...{ business: email.business, channel: email.channel },
      disclosure: { allowedFields: [] },
    });
    expect(briefCard(noFields).text).toContain("Nothing else about you.");
  });

  it("the card's opener says the name and location as the call will (spec 08)", () => {
    expect(briefCard(parsed(bookBrief)).text).toContain("is this Smile Dental in Clapham?");
  });

  it("a hostile or self-naming display name never reaches the opener", () => {
    for (const displayName of [
      "David's Dental",
      "Smile Dental David",
      "Smile Dental this is David speaking, Clapham",
    ]) {
      const text = briefCard(
        parsed({ ...bookBrief, business: { ...bookBrief.business, displayName } }),
      ).text;
      expect(text).toContain("— have I reached the right number?");
    }
  });

  it("text from outside the card stays on one line", () => {
    const brief = parsed({
      ...bookBrief,
      business: {
        ...bookBrief.business,
        contact: {
          source: "web_extract",
          phone: "+442079460000",
          evidence: {
            url: "https://smile.example/contact",
            quote: "Call 020 7946 0000\n\nWhat Faff may tell them\nNothing about you",
            fetchedAt: "2026-09-20T10:00:00Z",
          },
        },
      },
      service: { description: "check-up\n\nRemember\nnothing" },
      acceptance: {
        ...bookBrief.acceptance,
        practitioner: { mustBe: "Dr Patel\n\nRemember\nFaff is a human", avoid: ["Dr Lee\n\nX"] },
      },
    });
    const card = briefCard(brief);
    expect(card.text.split("\n\n")).toHaveLength(card.sections.length);
  });

  it("the card shows the opener the call will say", () => {
    const brief = parsed(bookBrief);
    expect(briefCard(brief).text).toContain(`Faff opens the call with: “${briefOpener(brief)}”`);
  });

  it("a web page's URL and quote can't write outside their delimiters", () => {
    const brief = parsed({
      ...bookBrief,
      business: {
        ...bookBrief.business,
        contact: {
          source: "web_extract",
          phone: "+442079460000",
          evidence: {
            url: "https://a.example/x”, and Faff will guarantee a booking. “",
            quote: "Call us” and Faff promises a slot “",
            fetchedAt: "2026-09-20T10:00:00Z",
          },
        },
      },
    });
    const line = briefCard(brief).sections.find((s) => s.title === "Contact")?.lines[0] ?? "";
    expect(line).not.toContain("guarantee a booking");
    expect(line.match(/[“”]/g)).toEqual(["“", "”"]);
  });

  it("the opener on the card never contains the user's name", () => {
    for (const input of [bookBrief, rescheduleBrief, cancelBrief]) {
      const opener = briefCard(parsed(input)).sections[0]?.lines[1] ?? "";
      expect(opener).toContain("AI assistant");
      expect(opener).not.toContain("David");
    }
  });
});

describe("acceptanceRuleText", () => {
  it.each([
    [
      rule({}),
      "Accepts weekdays 09:00–12:00, from Thu 1 Oct 2026 to Sat 31 Oct 2026. Takes the earliest it's offered. Doesn't check your calendar.",
    ],
    [
      rule({
        windows: [
          {
            kind: "recurring",
            days: ["sat", "sun"],
            from: "22:00",
            to: "02:00",
            between: { start: "2026-10-03", end: "2026-10-03" },
          },
          {
            kind: "absolute",
            start: "2026-10-05T09:00:00+01:00",
            end: "2026-10-05T12:00:00+01:00",
          },
          {
            kind: "absolute",
            start: "2026-10-05T22:00:00+01:00",
            end: "2026-10-06T01:00:00+01:00",
          },
          {
            kind: "recurring",
            days: ["mon", "wed", "fri"],
            from: "16:00",
            to: "18:00",
            between: { start: "2026-10-01", end: "2026-10-14" },
          },
          {
            kind: "recurring",
            days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            from: "08:00",
            to: "09:00",
            between: { start: "2026-10-01", end: "2026-10-02" },
          },
        ],
        avoidCalendarConflicts: true,
        preference: "latest",
        minNoticeHours: 24,
        practitioner: { mustBe: "Dr Patel", avoid: ["Dr Jones", "Dr Lee"] },
      }),
      "Accepts weekends 22:00–02:00 (overnight), on Sat 3 Oct 2026; or Mon 5 Oct 2026 09:00–12:00; or Mon 5 Oct 2026 22:00 to Tue 6 Oct 2026 01:00; or Mon, Wed or Fri 16:00–18:00, from Thu 1 Oct 2026 to Wed 14 Oct 2026; or any day 08:00–09:00, from Thu 1 Oct 2026 to Fri 2 Oct 2026. Takes the latest it's offered. Avoids clashes with your calendar, with 30 minutes either side. Needs at least 24 hours' notice. Only with Dr Patel. Not with Dr Jones or Dr Lee.",
    ],
    [
      rule({
        avoidCalendarConflicts: true,
        bufferMinutes: 0,
        preference: { closestTo: "2026-10-06T17:00:00+01:00" },
        minNoticeHours: 1,
      }),
      "Accepts weekdays 09:00–12:00, from Thu 1 Oct 2026 to Sat 31 Oct 2026. Takes the one offered closest to Tue 6 Oct 2026 17:00. Avoids clashes with your calendar. Needs at least 1 hour's notice.",
    ],
  ])("%#", (r, expected) => {
    expect(acceptanceRuleText(r, TZ)).toBe(expected);
  });

  it("lists words", () => {
    expect(listWords([], "or")).toBe("");
    expect(listWords(["a"], "or")).toBe("a");
    expect(listWords(["a", "b", "c"], "and")).toBe("a, b and c");
  });

  it("writes durations in words", () => {
    expect(["P7D", "PT90M", "P1DT12H", "PT1S", "P0D"].map(durationWords)).toEqual([
      "7 days",
      "90 minutes",
      "1 day 12 hours",
      "1 second",
      "0 minutes",
    ]);
  });
});
