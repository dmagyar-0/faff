import { describe, expect, it } from "vitest";

import { bookBrief } from "./__fixtures__/briefs";
import { BUSINESS_ID, obs } from "./__fixtures__/observations";
import { parseBrief, type Brief, type BriefInput } from "./brief";
import type { ResolvedContact } from "./contact";
import { type ContactSwitchInput, mayAutoSwitchContact } from "./contact-switch";

const parsed = (input: BriefInput): Brief => {
  const result = parseBrief(input);
  if (!result.ok) throw new Error(JSON.stringify(result.detail));
  return result.value;
};

const OLD = "+442079460000";
const NEW = "+442079461111";
const PAGE =
  "Smile Dental, Clapham. 12 High Street, London SW4 7AA. Appointments: 020 7946 1111. Open Mon–Fri.";
const webContact: ResolvedContact = {
  source: "web_extract",
  phone: NEW,
  evidence: {
    url: "https://www.smiledental.example/contact",
    quote: "Appointments: 020 7946 1111",
    fetchedAt: "2026-10-10T10:00:00Z",
  },
};

const input = (overrides: Partial<ContactSwitchInput> = {}): ContactSwitchInput => ({
  brief: parsed(bookBrief),
  autoSwitchesSoFar: 0,
  newContact: webContact,
  failedPhone: OLD,
  observations: [obs(1, "number_wrong", { e164: OLD }, "2026-10-10T09:00:00Z")],
  business: {
    businessId: BUSINESS_ID,
    displayName: "Smile Dental, Clapham",
    postcode: "SW4 7AA",
    website: "https://smiledental.example",
  },
  evidencePageText: PAGE,
  trustedDirectories: ["nhs.uk"],
  dialAllowed: true,
  ...overrides,
});

describe("mayAutoSwitchContact (Q39): all six conditions hold", () => {
  it("a number cited on the business's own site", () => {
    expect(mayAutoSwitchContact(input())).toEqual({ ok: true, value: NEW });
  });

  it("a number from the user's own memory needs no page", () => {
    const contact: ResolvedContact = { source: "user_memory", phone: NEW };
    expect(
      mayAutoSwitchContact(input({ newContact: contact, evidencePageText: undefined })),
    ).toEqual({
      ok: true,
      value: NEW,
    });
  });

  it("a number cited on the NHS directory", () => {
    const contact: ResolvedContact = {
      ...webContact,
      evidence: {
        ...webContact.evidence,
        url: "https://www.nhs.uk/services/dentist/smile-dental/X1",
      },
    };
    const business = {
      businessId: BUSINESS_ID,
      displayName: "Smile Dental, Clapham",
      postcode: "SW4 7AA",
    };
    expect(mayAutoSwitchContact(input({ newContact: contact, business })).ok).toBe(true);
  });
});

describe("mayAutoSwitchContact: each failure has its own reason, checked in spec 08's order", () => {
  it.each<[string, Partial<ContactSwitchInput>, string]>([
    [
      "1. the Brief doesn't allow switching",
      {
        brief: parsed({
          ...bookBrief,
          business: { ...bookBrief.business, contactPolicy: { autoSwitchOnWrongNumber: false } },
        }),
      },
      "auto_switch_disabled",
    ],
    [
      "the new contact has no number",
      { newContact: { source: "user_memory", email: "a@b.example" } },
      "no_new_number",
    ],
    ["the new number is the one that failed", { failedPhone: NEW }, "same_number"],
    [
      "2. it came from observations, not the user or a first-party page",
      { newContact: { source: "observations", phone: NEW } },
      "source_not_trusted",
    ],
    [
      "2. a third-party directory",
      {
        newContact: {
          ...webContact,
          evidence: { ...webContact.evidence, url: "https://yell.example/smile" },
        },
      },
      "source_not_trusted",
    ],
    [
      "2. the business has no website on record, and the page isn't a trusted directory",
      {
        business: {
          businessId: BUSINESS_ID,
          displayName: "Smile Dental, Clapham",
          postcode: "SW4 7AA",
        },
      },
      "source_not_trusted",
    ],
    [
      "2. the evidence page couldn't be re-fetched",
      { evidencePageText: undefined },
      "citation_failed",
    ],
    [
      "2. the quote is no longer on the page",
      { evidencePageText: "Smile Dental, Clapham SW4 7AA" },
      "citation_failed",
    ],
    [
      "3. the number is already known to be wrong for this business",
      { observations: [obs(1, "number_wrong", { e164: NEW }, "2026-09-01T09:00:00Z")] },
      "known_wrong_number",
    ],
    [
      "4. the page doesn't name the business",
      { evidencePageText: `Bright Smile, SW4 7AA. ${PAGE.slice(PAGE.indexOf("Appointments"))}` },
      "page_does_not_name_business",
    ],
    [
      "4. the page names the business but not its postcode or address",
      {
        business: {
          businessId: BUSINESS_ID,
          displayName: "Smile Dental, Clapham",
          postcode: "SW9 1AA",
          address: "1 Other Road",
          website: "smiledental.example",
        },
      },
      "page_does_not_name_business",
    ],
    ["5. the task has switched before", { autoSwitchesSoFar: 1 }, "already_switched"],
    ["6. limits don't allow another dial", { dialAllowed: false }, "limits_exhausted"],
  ])("%s", (_label, overrides, reason) => {
    expect(mayAutoSwitchContact(input(overrides))).toEqual({ ok: false, reason });
  });

  it("an address on the page stands in for a postcode", () => {
    const business = {
      businessId: BUSINESS_ID,
      displayName: "Smile Dental, Clapham",
      address: "12 High Street",
      website: "smiledental.example",
    };
    expect(mayAutoSwitchContact(input({ business })).ok).toBe(true);
  });

  it("a number_wrong for a different business doesn't count", () => {
    const other = obs(1, "number_wrong", { e164: NEW }, "2026-09-01T09:00:00Z", {
      businessId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mayAutoSwitchContact(input({ observations: [other] })).ok).toBe(true);
  });

  it("reports the first failing condition when several fail", () => {
    const result = mayAutoSwitchContact(
      input({
        autoSwitchesSoFar: 3,
        dialAllowed: false,
        newContact: { source: "observations", phone: NEW },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "source_not_trusted" });
  });
});
