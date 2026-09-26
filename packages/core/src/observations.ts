/**
 * The general knowledge tier (spec 04, I-5, Q19): one zod value schema per observation `kind`.
 *
 * **No value schema has a free-text field** (D10). Every string is an id, an E.164 number, an
 * email address, a datetime, an enum or a short bounded token, so a transcript can't be passed
 * through into the shared tier. `observations.test.ts` walks every schema to prove it.
 */
import { z } from "zod";

import { E164, Email, IsoDateTime, Uuid, WallTime, Weekday } from "./primitives";

export const OBSERVATION_KINDS = [
  "phone_number",
  "email_address",
  "prefers_email",
  "ivr_path",
  "opening_hours",
  "number_wrong",
  "reached_ok",
  "hold_minutes",
  "refused_ai",
  "accepted_ai",
  "booking_lead_time",
  "email_reply_latency",
] as const;
export const ObservationKind = z.enum(OBSERVATION_KINDS);
export type ObservationKind = z.infer<typeof ObservationKind>;

export const SOURCE_KINDS = ["call", "email", "web_extract", "user_report"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** One IVR step: a keypad entry, or a short spoken menu choice ("bookings"). */
export const IvrStep = z.union([
  z.strictObject({
    dtmf: z
      .string()
      .max(10)
      .regex(/^[0-9*#]{1,10}$/),
  }),
  z.strictObject({
    say: z
      .string()
      .regex(/^[a-z]+(?: [a-z]+){0,3}$/)
      .max(40),
  }),
]);
export type IvrStep = z.infer<typeof IvrStep>;

export const OpeningPeriod = z.strictObject({ day: Weekday, from: WallTime, to: WallTime });
export type OpeningPeriod = z.infer<typeof OpeningPeriod>;

/** The contact a call or email reached. */
export const ReachedContact = z.discriminatedUnion("channel", [
  z.strictObject({ channel: z.literal("phone"), e164: E164 }),
  z.strictObject({ channel: z.literal("email"), email: Email }),
]);

export const observationValues = {
  phone_number: z.strictObject({ e164: E164 }),
  email_address: z.strictObject({ email: Email }),
  prefers_email: z.strictObject({}),
  ivr_path: z.strictObject({ steps: z.array(IvrStep).min(1).max(10) }),
  opening_hours: z.strictObject({
    /** An empty list says nothing about the hours; it doesn't mean "always closed". */
    weekly: z.array(OpeningPeriod).max(21),
    source: z.enum(["ivr", "website", "callee"]),
  }),
  number_wrong: z.strictObject({ e164: E164 }),
  reached_ok: ReachedContact,
  hold_minutes: z.strictObject({ minutes: z.number().min(0).max(600) }),
  refused_ai: z.strictObject({}),
  accepted_ai: z.strictObject({}),
  /** How far out the first offer was, in days. */
  booking_lead_time: z.strictObject({ days: z.int().min(0).max(730) }),
  /** When Faff emailed and when the business replied; `channel.ts` counts the working days. */
  email_reply_latency: z.strictObject({ sentAt: IsoDateTime, repliedAt: IsoDateTime }),
} as const satisfies Record<ObservationKind, z.ZodType>;

export type ObservationValue<K extends ObservationKind> = z.infer<(typeof observationValues)[K]>;

const meta = {
  /** Monotonic `bigint identity`. */
  id: z.int().min(0),
  businessId: Uuid,
  observedAt: IsoDateTime,
  sourceKind: z.enum(SOURCE_KINDS),
  /** call id, email message id or URL. */
  sourceRef: z.string().min(1).max(2048),
  /** Required for `web_extract` (I-11). */
  evidenceQuote: z.string().min(1).max(1000).optional(),
  taskId: Uuid.optional(),
};

const row = <K extends ObservationKind>(kind: K) =>
  z.strictObject({ ...meta, kind: z.literal(kind), value: observationValues[kind] });

export const Observation = z
  .discriminatedUnion("kind", [
    row("phone_number"),
    row("email_address"),
    row("prefers_email"),
    row("ivr_path"),
    row("opening_hours"),
    row("number_wrong"),
    row("reached_ok"),
    row("hold_minutes"),
    row("refused_ai"),
    row("accepted_ai"),
    row("booking_lead_time"),
    row("email_reply_latency"),
  ])
  .refine((o) => (o.sourceKind === "web_extract") === (o.evidenceQuote !== undefined), {
    message: "evidenceQuote is required for web_extract observations, and only for them",
    path: ["evidenceQuote"],
  });
export type Observation = z.infer<typeof Observation>;
export type ObservationOf<K extends ObservationKind> = Extract<Observation, { kind: K }>;
