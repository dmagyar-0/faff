/**
 * `resolveChannel` (Q29, spec 07 "Channel resolution", M1 plan §3.7): phone or email, and why.
 * Rules 1–4 in order; the first that applies decides. `user_override` is never produced here:
 * the approval card sets it when the user changes the channel.
 */
import type { ChannelReason } from "./brief";
import type { Observation, ObservationOf } from "./observations";
import { Temporal, type Instant } from "./time";
import { withinWorkingDays, type Holidays } from "./working-days";

/** Observations older than this say nothing about the business's preference now. */
export const PREFERENCE_MAX_AGE_DAYS = 180;
/** A reply within this many working days counts as preferring email (spec 07). */
export const PROMPT_REPLY_WORKING_DAYS = 2;

export type ChannelInputs = {
  /** The user's own `user_businesses.preferred_contact` for this business, if they gave one. */
  readonly userMemory?: { readonly phone?: string; readonly email?: string };
  /** This business's observations, in any order. */
  readonly observations: readonly Observation[];
  /** What contact resolution found (spec 08). */
  readonly knownContacts: { readonly phone?: string; readonly email?: string };
};

export type ChannelChoice = {
  readonly chosen: "phone" | "email";
  readonly reason: Exclude<ChannelReason, "user_override">;
};

const newestFirst = (a: Observation, b: Observation): number =>
  Temporal.Instant.compare(
    Temporal.Instant.from(b.observedAt),
    Temporal.Instant.from(a.observedAt),
  ) || b.id - a.id;

/**
 * Rule 2's question: does the most recent preference-relevant observation, if it is under 180
 * days old, favour email? `prefers_email` does; an `email_reply_latency` does when the reply came
 * within 2 working days, and argues against email when it didn't.
 */
export const observedPrefersEmail = (
  observations: readonly Observation[],
  now: Instant,
  timezone: string,
  holidays: Holidays,
): boolean => {
  const oldest = now.subtract({ hours: 24 * PREFERENCE_MAX_AGE_DAYS });
  const latest = observations
    .filter(
      (o): o is ObservationOf<"prefers_email"> | ObservationOf<"email_reply_latency"> =>
        o.kind === "prefers_email" || o.kind === "email_reply_latency",
    )
    .filter((o) => {
      const at = Temporal.Instant.from(o.observedAt);
      return Temporal.Instant.compare(at, oldest) > 0 && Temporal.Instant.compare(at, now) <= 0;
    })
    .sort(newestFirst)[0];
  if (latest === undefined) return false;
  if (latest.kind === "prefers_email") return true;
  return withinWorkingDays(
    Temporal.Instant.from(latest.value.sentAt),
    Temporal.Instant.from(latest.value.repliedAt),
    PROMPT_REPLY_WORKING_DAYS,
    timezone,
    holidays,
  );
};

/**
 * Spec 07 rules 1–4:
 * 1. The user's own preferred contact for this business decides (`user_memory`): the phone if
 *    they saved one, else their saved email.
 * 2. A recent observation shows the business prefers email, and an email address is known
 *    (`prefers_email_observed`).
 * 3. No phone number is known but an email address is (`no_phone_known`).
 * 4. Phone (`default_phone`).
 */
export const resolveChannel = (
  inputs: ChannelInputs,
  now: Instant,
  timezone: string,
  holidays: Holidays,
): ChannelChoice => {
  const memory = inputs.userMemory;
  if (memory?.phone !== undefined) return { chosen: "phone", reason: "user_memory" };
  if (memory?.email !== undefined) return { chosen: "email", reason: "user_memory" };
  const { phone, email } = inputs.knownContacts;
  if (email !== undefined && observedPrefersEmail(inputs.observations, now, timezone, holidays)) {
    return { chosen: "email", reason: "prefers_email_observed" };
  }
  if (phone === undefined && email !== undefined)
    return { chosen: "email", reason: "no_phone_known" };
  return { chosen: "phone", reason: "default_phone" };
};
