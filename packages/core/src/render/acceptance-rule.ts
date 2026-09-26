/**
 * The acceptance rule in plain English (M1 plan §3.14). The same text goes on the approval card
 * (spec 02, part of "the rendered text the user saw") and into the phone prompt as "the
 * acceptance rule in words" (spec 01), so it comes from one deterministic function.
 */
import type { AcceptanceRule, Window } from "../acceptance-rule";
import { writeDate, writeDateTime } from "../locale/en-GB";
import type { Weekday } from "../primitives";
import { Temporal } from "../time";

const DAY_SHORT: Readonly<Record<Weekday, string>> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "a", "a or b", "a, b or c" */
export const listWords = (items: readonly string[], conjunction: "and" | "or"): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;

const daysText = (days: readonly Weekday[]): string => {
  const set = new Set(days);
  if (set.size === 7) return "any day";
  if (set.size === 5 && ORDER.slice(0, 5).every((d) => set.has(d))) return "weekdays";
  if (set.size === 2 && set.has("sat") && set.has("sun")) return "weekends";
  return listWords(
    ORDER.filter((d) => set.has(d)).map((d) => DAY_SHORT[d]),
    "or",
  );
};

const windowText = (window: Window, timezone: string): string => {
  if (window.kind === "recurring") {
    const overnight = window.from > window.to ? " (overnight)" : "";
    const from = writeDate(Temporal.PlainDate.from(window.between.start));
    const to = writeDate(Temporal.PlainDate.from(window.between.end));
    const range = from === to ? `on ${from}` : `from ${from} to ${to}`;
    return `${daysText(window.days)} ${window.from}–${window.to}${overnight}, ${range}`;
  }
  const start = Temporal.Instant.from(window.start);
  const end = Temporal.Instant.from(window.end);
  const sameDay = start
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .equals(end.toZonedDateTimeISO(timezone).toPlainDate());
  if (sameDay) {
    const endTime = writeDateTime(end, timezone).slice(-5);
    return `${writeDateTime(start, timezone)}–${endTime}`;
  }
  return `${writeDateTime(start, timezone)} to ${writeDateTime(end, timezone)}`;
};

/**
 * Text from outside the card's own words (a web page's quote, the user's notes, a practitioner's
 * name) on one line, so it can't look like more of the card.
 */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * e.g. "Accepts weekdays 09:00–12:00, from Thu 1 Oct 2026 to Sat 31 Oct 2026. Takes the earliest it's offered.
 * Avoids clashes with your calendar, with 30 minutes either side. Needs at least 24 hours'
 * notice. Only with Dr Patel."
 */
export const acceptanceRuleText = (rule: AcceptanceRule, timezone: string): string => {
  const windows = rule.windows.map((w) => windowText(w, timezone));
  const sentences = [`Accepts ${windows.join("; or ")}.`];
  const pref = rule.preference;
  sentences.push(
    pref === "earliest"
      ? "Takes the earliest it's offered."
      : pref === "latest"
        ? "Takes the latest it's offered."
        : `Takes the one offered closest to ${writeDateTime(Temporal.Instant.from(pref.closestTo), timezone)}.`,
  );
  sentences.push(
    rule.avoidCalendarConflicts
      ? rule.bufferMinutes === 0
        ? "Avoids clashes with your calendar."
        : `Avoids clashes with your calendar, with ${rule.bufferMinutes} minutes either side.`
      : "Doesn't check your calendar.",
  );
  if (rule.minNoticeHours !== undefined && rule.minNoticeHours > 0) {
    const h = rule.minNoticeHours;
    sentences.push(`Needs at least ${h === 1 ? "1 hour's" : `${h} hours'`} notice.`);
  }
  const { mustBe, avoid = [] } = rule.practitioner ?? {};
  if (mustBe !== undefined) sentences.push(`Only with ${oneLine(mustBe)}.`);
  if (avoid.length > 0) sentences.push(`Not with ${listWords(avoid.map(oneLine), "or")}.`);
  return sentences.join(" ");
};
