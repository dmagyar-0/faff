import { describe, expect, it } from "vitest";

import {
  bookBrief,
  cancelBrief,
  IDS,
  pairedCancelBrief,
  rescheduleBrief,
  without,
} from "./__fixtures__/briefs";
import { BRIEF_REFINEMENTS, BriefV1, parseBrief, toJsonSchema, type Brief } from "./brief";

const parsed = (input: unknown): Brief => {
  const result = parseBrief(input);
  if (!result.ok) throw new Error(JSON.stringify(result.detail));
  return result.value;
};

const issuePaths = (input: unknown): string[] => {
  const result = parseBrief(input);
  if (result.ok) return [];
  return (result.detail ?? []).map((i) => i.path);
};

describe("parseBrief", () => {
  it.each([
    ["book", bookBrief],
    ["reschedule", rescheduleBrief],
    ["cancel (standalone)", cancelBrief],
    ["cancel (paired)", pairedCancelBrief],
  ])("accepts a %s Brief", (_label, brief) => {
    expect(parseBrief(brief).ok).toBe(true);
  });

  it("applies the defaults", () => {
    const brief = parsed(bookBrief);
    expect(brief.limits).toEqual({ maxDialAttempts: 3, maxCallMinutes: 30, maxLifetime: "P7D" });
    expect(brief.business.contactPolicy).toEqual({ autoSwitchOnWrongNumber: true });
    expect(brief.channel.emailFallbackToPhoneAfter).toEqual({ workingDays: 2 });
    if (brief.verb !== "book") throw new Error("unreachable");
    expect(brief.acceptance.bufferMinutes).toBe(30);
  });

  it("keeps values the producer set over the defaults", () => {
    const brief = parsed({
      ...bookBrief,
      limits: { maxDialAttempts: 5 },
      business: { ...bookBrief.business, contactPolicy: { autoSwitchOnWrongNumber: false } },
    });
    expect(brief.limits.maxDialAttempts).toBe(5);
    expect(brief.limits.maxCallMinutes).toBe(30);
    expect(brief.business.contactPolicy.autoSwitchOnWrongNumber).toBe(false);
  });

  it("is idempotent: parsing a parsed Brief changes nothing", () => {
    for (const input of [bookBrief, rescheduleBrief, cancelBrief, pairedCancelBrief]) {
      const once = parsed(input);
      expect(parsed(once)).toEqual(once);
    }
  });

  it.each([
    ["no schema", { ...bookBrief, schema: undefined }],
    ["a future schema", { ...bookBrief, schema: "faff.brief/v2" }],
    ["null", null],
    ["a string", "faff.brief/v1"],
  ])("rejects %s as unknown_schema", (_label, input) => {
    const result = parseBrief(input);
    expect(result).toMatchObject({ ok: false, reason: "unknown_schema" });
  });

  describe("verb-dependent fields (the oneOf branches)", () => {
    const bookWithoutAcceptance = without(bookBrief, "acceptance");
    const rescheduleWithoutAppointment = without(rescheduleBrief, "existingAppointment");
    const cancelWithoutCancel = without(cancelBrief, "cancel");

    it.each([
      ["book without acceptance", bookWithoutAcceptance],
      [
        "book with an existing appointment",
        { ...bookBrief, existingAppointment: rescheduleBrief.existingAppointment },
      ],
      ["reschedule without existingAppointment", rescheduleWithoutAppointment],
      ["reschedule with a cancel block", { ...rescheduleBrief, cancel: { mode: "standalone" } }],
      ["cancel without cancel", cancelWithoutCancel],
      ["cancel with an acceptance rule", { ...cancelBrief, acceptance: bookBrief.acceptance }],
      ["paired cancel without pairedWithBriefId", { ...cancelBrief, cancel: { mode: "paired" } }],
      [
        "standalone cancel with pairedWithBriefId",
        { ...cancelBrief, cancel: { mode: "standalone", pairedWithBriefId: IDS.pairedBrief } },
      ],
      ["an unknown verb", { ...bookBrief, verb: "chase" }],
    ])("rejects %s", (_label, input) => {
      expect(parseBrief(input)).toMatchObject({ ok: false, reason: "invalid_brief" });
    });
  });

  describe("formats", () => {
    it.each([
      ["a datetime without an offset", "2026-10-14T09:30:00"],
      ["a datetime without seconds", "2026-10-14T09:30+01:00"],
      ["a date only", "2026-10-14"],
    ])("rejects %s", (_label, startsAt) => {
      const input = {
        ...rescheduleBrief,
        existingAppointment: { ...rescheduleBrief.existingAppointment, startsAt },
      };
      expect(issuePaths(input)).toContain("existingAppointment.startsAt");
    });

    it("accepts Z and numeric offsets", () => {
      for (const startsAt of ["2026-10-14T08:30:00Z", "2026-10-14T09:30:00.250+01:00"]) {
        const input = {
          ...rescheduleBrief,
          existingAppointment: { ...rescheduleBrief.existingAppointment, startsAt },
        };
        expect(parseBrief(input).ok).toBe(true);
      }
    });

    it.each(["020 7946 0000", "+0207946000", "+44", "442079460000", "+4420794600001234"])(
      "rejects the phone number %s",
      (phone) => {
        const input = {
          ...bookBrief,
          business: { ...bookBrief.business, contact: { source: "user_memory", phone } },
        };
        expect(issuePaths(input)).toContain("business.contact.phone");
      },
    );

    it.each(["P7D", "PT90M", "P1DT12H", "PT1H", "P30D", "PT3600S"])(
      "accepts the lifetime %s",
      (d) => {
        expect(parseBrief({ ...bookBrief, limits: { maxLifetime: d } }).ok).toBe(true);
      },
    );

    it.each([
      "P",
      "PT",
      "P1W",
      "P1M",
      "P1Y",
      "7D",
      "P1DT",
      "p7d",
      "P0D",
      "PT30S",
      "PT59M59S",
      "P31D",
      "P30DT1S",
    ])("rejects the lifetime %s", (d) => {
      expect(issuePaths({ ...bookBrief, limits: { maxLifetime: d } })).toContain(
        "limits.maxLifetime",
      );
    });

    it("rejects unknown keys anywhere (strict objects)", () => {
      expect(parseBrief({ ...bookBrief, extra: 1 }).ok).toBe(false);
      expect(
        parseBrief({ ...bookBrief, service: { ...bookBrief.service, colour: "red" } }).ok,
      ).toBe(false);
    });

    it("rejects a non-UUID id", () => {
      expect(issuePaths({ ...bookBrief, briefId: "brief-1" })).toContain("briefId");
    });

    it("rejects a locale or timezone v1 doesn't support", () => {
      expect(issuePaths({ ...bookBrief, locale: "hu-HU" })).toContain("locale");
      expect(issuePaths({ ...bookBrief, timezone: "Europe/Budapest" })).toContain("timezone");
    });
  });

  describe("contact", () => {
    const evidence = {
      url: "https://smiledental.example/contact",
      quote: "Call us on 020 7946 0000",
      fetchedAt: "2026-09-20T10:00:00Z",
    };

    it("requires evidence for a web_extract contact", () => {
      const contact = { source: "web_extract", phone: "+442079460000" };
      expect(issuePaths({ ...bookBrief, business: { ...bookBrief.business, contact } })).toContain(
        "business.contact.evidence",
      );
      expect(
        parseBrief({
          ...bookBrief,
          business: { ...bookBrief.business, contact: { ...contact, evidence } },
        }).ok,
      ).toBe(true);
    });

    it("rejects evidence on a contact that isn't web_extract", () => {
      const contact = { source: "observations", phone: "+442079460000", evidence };
      expect(parseBrief({ ...bookBrief, business: { ...bookBrief.business, contact } }).ok).toBe(
        false,
      );
    });

    it("rejects an evidence URL that isn't http(s)", () => {
      const contact = {
        source: "web_extract",
        phone: "+442079460000",
        evidence: { ...evidence, url: "ftp://smiledental.example/contact" },
      };
      expect(parseBrief({ ...bookBrief, business: { ...bookBrief.business, contact } }).ok).toBe(
        false,
      );
    });

    it("needs a phone number or an email address", () => {
      const input = {
        ...bookBrief,
        business: { ...bookBrief.business, contact: { source: "user_memory" } },
      };
      expect(issuePaths(input)).toContain("business.contact");
    });
  });

  describe("refinements", () => {
    it("the phone channel needs a phone number", () => {
      const input = {
        ...bookBrief,
        business: {
          ...bookBrief.business,
          contact: { source: "user_memory", email: "hello@smile.example" },
        },
      };
      expect(issuePaths(input)).toContain("channel.chosen");
    });

    it("the email channel needs an email address", () => {
      const input = { ...bookBrief, channel: { chosen: "email", reason: "user_override" } };
      expect(issuePaths(input)).toContain("channel.chosen");
      const withEmail = {
        ...input,
        business: {
          ...bookBrief.business,
          contact: { source: "user_memory", email: "hello@smile.example" },
        },
      };
      expect(parseBrief(withEmail).ok).toBe(true);
    });

    it("rejects service.practitioner disagreeing with acceptance.practitioner.mustBe (G18)", () => {
      const input = {
        ...bookBrief,
        service: { ...bookBrief.service, practitioner: "Dr Jones" },
        acceptance: { ...bookBrief.acceptance, practitioner: { mustBe: "Dr Patel" } },
      };
      expect(issuePaths(input)).toContain("service.practitioner");
    });

    it("accepts the same practitioner written differently", () => {
      const input = {
        ...bookBrief,
        service: { ...bookBrief.service, practitioner: "dr. patel" },
        acceptance: { ...bookBrief.acceptance, practitioner: { mustBe: "Dr Patel" } },
      };
      expect(parseBrief(input).ok).toBe(true);
    });

    it("accepts service.practitioner = null (anyone) with a mustBe", () => {
      const input = {
        ...bookBrief,
        service: { ...bookBrief.service, practitioner: null },
        acceptance: { ...bookBrief.acceptance, practitioner: { mustBe: "Dr Patel" } },
      };
      expect(parseBrief(input).ok).toBe(true);
    });

    it("rejects a cancel paired with itself", () => {
      const input = { ...cancelBrief, cancel: { mode: "paired", pairedWithBriefId: IDS.brief } };
      expect(issuePaths(input)).toContain("cancel.pairedWithBriefId");
    });

    it("rejects a profile field listed twice", () => {
      const input = { ...bookBrief, disclosure: { allowedFields: ["postcode", "postcode"] } };
      expect(issuePaths(input)).toContain("disclosure.allowedFields");
    });

    it("rejects a lone surrogate, which has no canonical form", () => {
      expect(parseBrief({ ...bookBrief, notesForAgent: "bad \ud800 string" }).ok).toBe(false);
      expect(parseBrief({ ...bookBrief, notesForAgent: "fine 😀 string" }).ok).toBe(true);
    });

    it("carries the new v1 fields from M1-Q7", () => {
      const brief = parsed(bookBrief);
      expect(brief.business.kind).toBe("dentist");
      expect(brief.forPerson.firstName).toBe("David");
      expect(
        parseBrief({ ...bookBrief, business: { ...bookBrief.business, kind: "bank" } }).ok,
      ).toBe(false);
      const noPerson = without(bookBrief, "forPerson");
      expect(parseBrief(noPerson).ok).toBe(false);
    });
  });

  it("reports every issue with a dotted path", () => {
    const result = parseBrief({ ...bookBrief, revision: 0, briefId: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_brief");
    expect([...new Set(result.detail?.map((i) => i.path))].sort()).toEqual(["briefId", "revision"]);
  });
});

describe("toJsonSchema", () => {
  const schema = toJsonSchema();

  it("is draft 2020-12 with an id and a title", () => {
    expect(schema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://faff.app/schemas/brief.v1.json",
      title: "faff.brief/v1",
    });
  });

  it("has one oneOf branch per verb, each strict", () => {
    const branches = schema["oneOf"] as {
      properties: { verb: { const: string } };
      additionalProperties: boolean;
      required: string[];
    }[];
    expect(branches.map((b) => b.properties.verb.const)).toEqual(["book", "reschedule", "cancel"]);
    for (const b of branches) expect(b.additionalProperties).toBe(false);
    const [book, reschedule, cancel] = branches;
    expect(book?.required).toContain("acceptance");
    expect(book?.required).not.toContain("existingAppointment");
    expect(reschedule?.required).toEqual(
      expect.arrayContaining(["acceptance", "existingAppointment"]),
    );
    expect(cancel?.required).toEqual(expect.arrayContaining(["cancel", "existingAppointment"]));
    expect(cancel?.required).not.toContain("acceptance");
  });

  it("describes input: defaulted fields are optional", () => {
    const book = (schema["oneOf"] as { required: string[] }[])[0];
    expect(book?.required).not.toContain("limits");
  });

  it("lists every refinement in its description", () => {
    for (const rule of BRIEF_REFINEMENTS) expect(schema["description"]).toContain(rule);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(toJsonSchema())).toBe(JSON.stringify(schema));
  });

  it("is what BriefV1 exports", () => {
    expect(BriefV1.meta()?.title).toBe("faff.brief/v1");
  });
});
