/**
 * The `AcceptanceRule` schema (spec 06, Q24). The evaluator that applies it is `acceptance.ts`
 * (M1 PR 1.2); this module only says what a well-formed rule is.
 */
import { z } from "zod";

import { IsoDateTime, LocalDate, PractitionerName, WallTime, Weekday } from "./primitives";
import { compareIso } from "./time";

export const AbsoluteWindow = z
  .strictObject({
    kind: z.literal("absolute"),
    start: IsoDateTime,
    end: IsoDateTime,
  })
  .superRefine((w, ctx) => {
    const order = compareIso(w.start, w.end);
    // Unreadable datetimes already carry a format issue; the order isn't defined for them.
    if (order !== undefined && order >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "An absolute window must end after it starts",
        path: ["end"],
      });
    }
  });

/**
 * A weekly window: `from`–`to` wall-clock on each of `days`, in the Brief's timezone, on dates
 * from `between.start` to `between.end` **inclusive** (G17). `from > to` means the window
 * crosses midnight and belongs to the day it starts on.
 */
export const RecurringWindow = z
  .strictObject({
    kind: z.literal("recurring"),
    days: z.array(Weekday).min(1).max(7),
    from: WallTime,
    to: WallTime,
    between: z.strictObject({ start: LocalDate, end: LocalDate }),
  })
  .refine((w) => new Set(w.days).size === w.days.length, {
    message: "Each weekday may appear once",
    path: ["days"],
  })
  .refine((w) => w.from !== w.to, {
    message: "A recurring window can't start and end at the same time",
    path: ["to"],
  })
  .refine((w) => w.between.start <= w.between.end, {
    message: "between.end can't be before between.start",
    path: ["between", "end"],
  });

export const Window = z
  .discriminatedUnion("kind", [AbsoluteWindow, RecurringWindow])
  .meta({ id: "Window" });
export type Window = z.infer<typeof Window>;
export type AbsoluteWindow = z.infer<typeof AbsoluteWindow>;
export type RecurringWindow = z.infer<typeof RecurringWindow>;

export const Preference = z.union([
  z.literal("earliest"),
  z.literal("latest"),
  z.strictObject({ closestTo: IsoDateTime }),
]);
export type Preference = z.infer<typeof Preference>;

export const DEFAULT_BUFFER_MINUTES = 30;

export const AcceptanceRule = z
  .strictObject({
    /** At least one. The allowed times are their union. */
    windows: z.array(Window).min(1).max(50),
    /** Needs calendar free/busy (Q12). False when no calendar is connected. */
    avoidCalendarConflicts: z.boolean(),
    /** Travel or buffer time around each busy block, in minutes. */
    bufferMinutes: z
      .int()
      .min(0)
      .max(24 * 60)
      .default(DEFAULT_BUFFER_MINUTES),
    preference: Preference,
    practitioner: z
      .strictObject({
        mustBe: PractitionerName.optional(),
        avoid: z.array(PractitionerName).max(20).optional(),
      })
      .optional(),
    /** Don't accept a slot that starts sooner than this many hours from now. */
    minNoticeHours: z
      .number()
      .min(0)
      .max(24 * 365)
      .optional(),
  })
  .meta({ id: "AcceptanceRule" });
export type AcceptanceRule = z.infer<typeof AcceptanceRule>;
