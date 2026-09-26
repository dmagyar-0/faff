/**
 * The structured outcome of a call or an email exchange (spec 03), from `end_call` or email
 * completion, plus the system `dropped` kind (M1-Q6): a call that ended without `end_call`
 * because the callee hung up, the provider failed or the watchdog cut it. `dropped` is treated as
 * `no_contact` for redials but recorded as itself so it's visible.
 *
 * `validateOutcome` (the checks against the Brief and the reveal log) arrives with the task
 * machine (M1 PR 1.4).
 */
import { z } from "zod";

import {
  AppointmentRef,
  BookingReference,
  IsoDateTime,
  PractitionerName,
  ProfileField,
  Slot,
} from "./primitives";

/** The appointment as the business confirmed it. `startsAt` must carry an offset. */
export const ConfirmedAppointment = z.strictObject({
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.optional(),
  practitioner: PractitionerName.optional(),
  reference: BookingReference.optional(),
});
export type ConfirmedAppointment = z.infer<typeof ConfirmedAppointment>;

const disclosedFields = z.array(ProfileField).max(9);

export const NO_CONTACT_DETAILS = ["no_answer", "busy", "voicemail", "closed"] as const;
export type NoContactDetail = (typeof NO_CONTACT_DETAILS)[number];

export const DROPPED_BY = ["callee", "provider", "watchdog"] as const;
export type DroppedBy = (typeof DROPPED_BY)[number];

export const Outcome = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("booked"),
    appointment: ConfirmedAppointment,
    disclosedFields,
  }),
  z.strictObject({
    kind: z.literal("rescheduled"),
    from: AppointmentRef,
    to: ConfirmedAppointment,
    disclosedFields,
  }),
  z.strictObject({
    kind: z.literal("cancelled"),
    appointment: AppointmentRef,
    reference: BookingReference.optional(),
    disclosedFields,
  }),
  z.strictObject({
    kind: z.literal("outside_rule_offers"),
    offers: z.array(Slot).min(1).max(50),
  }),
  z.strictObject({
    kind: z.literal("no_availability"),
    nextAvailableHint: z.string().min(1).max(200).optional(),
  }),
  z.strictObject({ kind: z.literal("wrong_business") }),
  z.strictObject({ kind: z.literal("refused_ai") }),
  z.strictObject({
    kind: z.literal("needs_user"),
    /** e.g. "they insist on speaking to the patient". */
    reason: z.string().min(1).max(500),
  }),
  z.strictObject({ kind: z.literal("no_contact"), detail: z.enum(NO_CONTACT_DETAILS) }),
  z.strictObject({ kind: z.literal("dropped"), by: z.enum(DROPPED_BY) }),
]);
export type Outcome = z.infer<typeof Outcome>;
export type OutcomeKind = Outcome["kind"];
export const OUTCOME_KINDS = Outcome.options.map(
  (o) => o.shape.kind.value,
) as readonly OutcomeKind[];
