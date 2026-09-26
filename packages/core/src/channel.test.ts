import { describe, expect, it } from "vitest";

import { obs } from "./__fixtures__/observations";
import { observedPrefersEmail, resolveChannel } from "./channel";
import { Temporal } from "./time";

const TZ = "Europe/London";
const NOW = Temporal.Instant.from("2026-10-15T12:00:00Z");
const both = { phone: "+442079460000", email: "hello@smile.example" };
const resolve = (inputs: Parameters<typeof resolveChannel>[0]) =>
  resolveChannel(inputs, NOW, TZ, []);

describe("resolveChannel: spec 07 rules 1–4, in order", () => {
  it("1. the user's own preferred contact decides", () => {
    expect(
      resolve({ userMemory: { phone: "+447700900123" }, observations: [], knownContacts: both }),
    ).toEqual({
      chosen: "phone",
      reason: "user_memory",
    });
    expect(
      resolve({ userMemory: { email: "me@smile.example" }, observations: [], knownContacts: both }),
    ).toEqual({
      chosen: "email",
      reason: "user_memory",
    });
    // Rule 1 beats an observed email preference.
    const prefers = [obs(1, "prefers_email", {}, "2026-10-01T10:00:00Z")];
    expect(
      resolve({
        userMemory: { phone: "+447700900123", email: "x@y.example" },
        observations: prefers,
        knownContacts: both,
      }).reason,
    ).toBe("user_memory");
  });

  it("2. a recent observation that favours email, with an email known", () => {
    const prefers = [obs(1, "prefers_email", {}, "2026-10-01T10:00:00Z")];
    expect(resolve({ observations: prefers, knownContacts: both })).toEqual({
      chosen: "email",
      reason: "prefers_email_observed",
    });
    // No email known: rule 2 can't apply.
    expect(resolve({ observations: prefers, knownContacts: { phone: both.phone } }).reason).toBe(
      "default_phone",
    );
    // An empty user memory doesn't count as a preference.
    expect(resolve({ userMemory: {}, observations: prefers, knownContacts: both }).reason).toBe(
      "prefers_email_observed",
    );
  });

  it("3. no phone known but an email is", () => {
    expect(resolve({ observations: [], knownContacts: { email: both.email } })).toEqual({
      chosen: "email",
      reason: "no_phone_known",
    });
  });

  it("4. otherwise phone", () => {
    expect(resolve({ observations: [], knownContacts: both })).toEqual({
      chosen: "phone",
      reason: "default_phone",
    });
    expect(resolve({ observations: [], knownContacts: {} }).reason).toBe("default_phone");
  });
});

describe("observedPrefersEmail", () => {
  const latency = (id: number, sentAt: string, repliedAt: string, observedAt = repliedAt) =>
    obs(id, "email_reply_latency", { sentAt, repliedAt }, observedAt);

  it("a reply within 2 working days favours email; a slower one argues against", () => {
    // Fri 16:00 → Tue 15:59: within 2 working days.
    expect(
      observedPrefersEmail(
        [latency(1, "2026-10-09T15:00:00Z", "2026-10-13T14:59:00Z")],
        NOW,
        TZ,
        [],
      ),
    ).toBe(true);
    // Fri 16:00 → Tue 16:01: just over.
    expect(
      observedPrefersEmail(
        [latency(1, "2026-10-09T15:00:00Z", "2026-10-13T15:01:00Z")],
        NOW,
        TZ,
        [],
      ),
    ).toBe(false);
  });

  it("the most recent preference-relevant observation decides", () => {
    const slowThenPrefers = [
      latency(1, "2026-09-01T09:00:00Z", "2026-09-10T09:00:00Z"),
      obs(2, "prefers_email", {}, "2026-09-20T09:00:00Z"),
    ];
    expect(observedPrefersEmail(slowThenPrefers, NOW, TZ, [])).toBe(true);
    const prefersThenSlow = [
      obs(1, "prefers_email", {}, "2026-09-01T09:00:00Z"),
      latency(2, "2026-09-10T09:00:00Z", "2026-09-20T09:00:00Z"),
    ];
    expect(observedPrefersEmail(prefersThenSlow, NOW, TZ, [])).toBe(false);
    // Same observedAt: the higher id is the later row.
    const tie = [
      latency(2, "2026-09-01T09:00:00Z", "2026-09-20T09:00:00Z", "2026-09-20T09:00:00Z"),
      obs(1, "prefers_email", {}, "2026-09-20T09:00:00Z"),
    ];
    expect(observedPrefersEmail(tie, NOW, TZ, [])).toBe(false);
    // Unrelated kinds don't count.
    expect(
      observedPrefersEmail([obs(1, "refused_ai", {}, "2026-10-01T09:00:00Z")], NOW, TZ, []),
    ).toBe(false);
  });

  it("ignores observations 180 days old or more, and ones dated after now", () => {
    expect(
      observedPrefersEmail([obs(1, "prefers_email", {}, "2026-04-18T12:00:01Z")], NOW, TZ, []),
    ).toBe(true);
    expect(
      observedPrefersEmail([obs(1, "prefers_email", {}, "2026-04-18T12:00:00Z")], NOW, TZ, []),
    ).toBe(false);
    expect(
      observedPrefersEmail([obs(1, "prefers_email", {}, "2026-10-16T12:00:00Z")], NOW, TZ, []),
    ).toBe(false);
  });
});
