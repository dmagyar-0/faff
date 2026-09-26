/**
 * Sample Briefs for tests, one per verb. Inputs, not parsed Briefs: defaulted fields are left
 * out, as a producer would. Tests that need a variant spread one of these and override fields.
 */
import type { BriefInput } from "../brief";

export const IDS = {
  brief: "0b6f3a52-6c1e-4f59-9a55-2f0d5d1c7a01",
  pairedBrief: "0b6f3a52-6c1e-4f59-9a55-2f0d5d1c7a02",
  user: "5d2c8e0e-1a6b-4b1f-8f7e-9c3b2a1d0e11",
  business: "7a1e4c2b-3d5f-4a6b-8c9d-0e1f2a3b4c21",
  appointment: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c31",
} as const;

export const bookBrief = {
  schema: "faff.brief/v1",
  briefId: IDS.brief,
  revision: 1,
  userId: IDS.user,
  locale: "en-GB",
  timezone: "Europe/London",
  verb: "book",
  business: {
    businessId: IDS.business,
    displayName: "Smile Dental, Clapham",
    kind: "dentist",
    contact: { source: "user_memory", phone: "+442079460000" },
  },
  forPerson: { firstName: "David" },
  channel: { chosen: "phone", reason: "default_phone" },
  service: { description: "routine check-up and hygienist", durationMinutes: 40 },
  acceptance: {
    windows: [
      {
        kind: "recurring",
        days: ["mon", "tue", "wed", "thu", "fri"],
        from: "09:00",
        to: "12:00",
        between: { start: "2026-10-01", end: "2026-10-31" },
      },
    ],
    avoidCalendarConflicts: true,
    preference: "earliest",
  },
  disclosure: { allowedFields: ["full_name", "date_of_birth", "postcode"] },
} as const satisfies BriefInput;

export const rescheduleBrief = {
  ...bookBrief,
  verb: "reschedule",
  existingAppointment: {
    appointmentId: IDS.appointment,
    startsAt: "2026-10-14T09:30:00+01:00",
    reference: "4417",
  },
} as const satisfies BriefInput;

/** A copy of `obj` without `keys`. */
export const without = <T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> => {
  const drop = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k))) as Omit<T, K>;
};

export const cancelBrief = {
  ...without(bookBrief, "acceptance"),
  verb: "cancel",
  existingAppointment: rescheduleBrief.existingAppointment,
  cancel: { mode: "standalone" },
} as const satisfies BriefInput;

export const pairedCancelBrief = {
  ...cancelBrief,
  cancel: { mode: "paired", pairedWithBriefId: IDS.pairedBrief },
} as const satisfies BriefInput;
