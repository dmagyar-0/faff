/**
 * Types the spec uses but never defines (M1 plan §3.1): `E164`, `Duration`, `Weekday`, `Slot`,
 * `AppointmentRef`, plus the datetime, date and wall-clock formats every schema shares.
 */
import { z } from "zod";

/** A UUID, as every id in the Brief is. */
export const Uuid = z.uuid().meta({ id: "Uuid" });

/**
 * An E.164 number: `+`, a country code that doesn't start with 0, at most 15 digits in all.
 * Generic on purpose: the v1 UK-only rule (G12) is a `placeCall` guard, not a schema rule.
 */
export const E164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "An E.164 number: + then 7 to 15 digits")
  .meta({ id: "E164", description: "E.164 phone number, e.g. +442079460000" });
export type E164 = z.infer<typeof E164>;

export const Email = z.email().max(254).meta({ id: "Email" });

/**
 * An RFC 3339 datetime **with an offset** (`Z` or `±hh:mm`). Seconds are required, as RFC 3339
 * requires them. A local datetime without an offset is rejected: it names no instant.
 */
export const IsoDateTime = z.iso.datetime({ offset: true }).meta({
  id: "DateTime",
  description: "RFC 3339 datetime with seconds and an offset (Z or ±hh:mm)",
});

/** A calendar date, `YYYY-MM-DD`, in the Brief's timezone. */
export const LocalDate = z.iso.date().meta({ id: "LocalDate" });

/** A wall-clock time, `HH:MM`, 24-hour, in the Brief's timezone. */
export const WallTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "A 24-hour time, HH:MM")
  .meta({ id: "WallTime", description: "Wall-clock time HH:MM (24-hour) in the Brief's timezone" });

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const Weekday = z.enum(WEEKDAYS).meta({ id: "Weekday" });
export type Weekday = z.infer<typeof Weekday>;

/**
 * An ISO 8601 duration made of days, hours, minutes and seconds (`P7D`, `PT90M`, `P1DT12H`).
 * Years, months and weeks are left out: they have no fixed length, so a limit written with them
 * would mean different things on different days.
 */
export const Duration = z
  .string()
  .regex(
    /^P(?=\d|T\d)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/,
    "An ISO 8601 duration in days, hours, minutes and seconds, e.g. P7D",
  )
  .meta({
    id: "Duration",
    description: "ISO 8601 duration using D, H, M and S only, e.g. P7D or PT90M",
  });
export type Duration = z.infer<typeof Duration>;

/** A practitioner's name as spoken or written ("Dr Patel"). */
export const PractitionerName = z.string().min(1).max(100);

/** A time the business offered or booked. With no `end`, the service's duration applies. */
export const Slot = z
  .strictObject({
    start: IsoDateTime,
    end: IsoDateTime.optional(),
    practitioner: PractitionerName.optional(),
  })
  .meta({ id: "Slot" });
export type Slot = z.infer<typeof Slot>;

/** A booking reference as the business gave it ("4417", "SD-20931"). */
export const BookingReference = z.string().min(1).max(64);

/** An existing appointment Faff knows about (an `appointments` row). */
export const AppointmentRef = z
  .strictObject({
    appointmentId: Uuid,
    startsAt: IsoDateTime,
    reference: BookingReference.optional(),
  })
  .meta({ id: "AppointmentRef" });
export type AppointmentRef = z.infer<typeof AppointmentRef>;

/** The closed enum of profile fields (spec 05, Q21). Adding one needs a decision record. */
export const PROFILE_FIELDS = [
  "full_name",
  "preferred_name",
  "date_of_birth",
  "postcode",
  "address_line",
  "contact_phone",
  "contact_email",
  "existing_patient",
  "nhs_number",
] as const;
export const ProfileField = z.enum(PROFILE_FIELDS).meta({ id: "ProfileField" });
export type ProfileField = z.infer<typeof ProfileField>;
