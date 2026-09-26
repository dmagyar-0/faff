import { describe, expect, it } from "vitest";

import { OUTCOME_KINDS, Outcome } from "./outcome";

const appointmentRef = {
  appointmentId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c31",
  startsAt: "2026-10-14T09:30:00+01:00",
};

describe("Outcome", () => {
  it("has spec 03's kinds plus the system dropped kind (M1-Q6)", () => {
    expect([...OUTCOME_KINDS].sort()).toEqual(
      [
        "booked",
        "rescheduled",
        "cancelled",
        "outside_rule_offers",
        "no_availability",
        "wrong_business",
        "refused_ai",
        "needs_user",
        "no_contact",
        "dropped",
      ].sort(),
    );
  });

  it.each([
    { kind: "booked", appointment: { startsAt: "2026-10-14T09:30:00+01:00" }, disclosedFields: [] },
    {
      kind: "rescheduled",
      from: appointmentRef,
      to: { startsAt: "2026-10-15T09:30:00+01:00", practitioner: "Dr Patel", reference: "4418" },
      disclosedFields: ["full_name", "date_of_birth"],
    },
    {
      kind: "cancelled",
      appointment: appointmentRef,
      reference: "X1",
      disclosedFields: ["full_name"],
    },
    { kind: "outside_rule_offers", offers: [{ start: "2026-10-20T15:00:00+01:00" }] },
    { kind: "no_availability" },
    { kind: "no_availability", nextAvailableHint: "they said try in December" },
    { kind: "wrong_business" },
    { kind: "refused_ai" },
    { kind: "needs_user", reason: "they insist on speaking to the patient" },
    { kind: "no_contact", detail: "closed" },
    { kind: "dropped", by: "watchdog" },
  ])("accepts $kind", (outcome) => {
    expect(Outcome.safeParse(outcome).success).toBe(true);
  });

  it.each([
    [
      "booked without an offset",
      { kind: "booked", appointment: { startsAt: "2026-10-14T09:30:00" }, disclosedFields: [] },
    ],
    [
      "booked without disclosedFields",
      { kind: "booked", appointment: { startsAt: "2026-10-14T09:30:00Z" } },
    ],
    [
      "an unknown profile field",
      {
        kind: "booked",
        appointment: { startsAt: "2026-10-14T09:30:00Z" },
        disclosedFields: ["pin"],
      },
    ],
    ["no offers", { kind: "outside_rule_offers", offers: [] }],
    ["hung_up, which is dropped now", { kind: "no_contact", detail: "hung_up" }],
    ["an unknown dropper", { kind: "dropped", by: "user" }],
    ["an unknown kind", { kind: "maybe" }],
    ["extra keys", { kind: "refused_ai", why: "robots" }],
  ])("rejects %s", (_label, outcome) => {
    expect(Outcome.safeParse(outcome).success).toBe(false);
  });
});
