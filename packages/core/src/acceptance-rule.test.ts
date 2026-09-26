import { describe, expect, it } from "vitest";

import { AcceptanceRule, Window } from "./acceptance-rule";

const recurring = {
  kind: "recurring",
  days: ["mon", "wed"],
  from: "09:00",
  to: "12:00",
  between: { start: "2026-10-01", end: "2026-10-31" },
} as const;

describe("Window", () => {
  it("accepts an absolute window that ends after it starts, across offsets", () => {
    // 09:00+01:00 is 08:00Z, so this ends an hour after it starts.
    const w = { kind: "absolute", start: "2026-10-05T09:00:00+01:00", end: "2026-10-05T09:00:00Z" };
    expect(Window.safeParse(w).success).toBe(true);
  });

  it.each([
    ["ends before it starts", "2026-10-05T12:00:00+01:00", "2026-10-05T09:00:00+01:00"],
    ["is empty", "2026-10-05T09:00:00+01:00", "2026-10-05T09:00:00+01:00"],
    ["is empty across offsets", "2026-10-05T09:00:00+01:00", "2026-10-05T08:00:00Z"],
  ])("rejects an absolute window that %s", (_label, start, end) => {
    expect(Window.safeParse({ kind: "absolute", start, end }).success).toBe(false);
  });

  it("accepts a recurring window, including one that crosses midnight", () => {
    expect(Window.safeParse(recurring).success).toBe(true);
    expect(Window.safeParse({ ...recurring, from: "22:00", to: "02:00" }).success).toBe(true);
  });

  it("accepts a one-day between range (inclusive dates)", () => {
    const w = { ...recurring, between: { start: "2026-10-05", end: "2026-10-05" } };
    expect(Window.safeParse(w).success).toBe(true);
  });

  it.each([
    ["a repeated weekday", { days: ["mon", "mon"] }],
    ["no weekdays", { days: [] }],
    ["from = to", { from: "09:00", to: "09:00" }],
    ["between backwards", { between: { start: "2026-10-31", end: "2026-10-01" } }],
    ["24:00", { to: "24:00" }],
    ["a time without a leading zero", { from: "9:00" }],
    [
      "a datetime as a between date",
      { between: { start: "2026-10-01T00:00:00Z", end: "2026-10-31" } },
    ],
    ["a capitalised weekday", { days: ["Mon"] }],
  ])("rejects a recurring window with %s", (_label, change) => {
    expect(Window.safeParse({ ...recurring, ...change }).success).toBe(false);
  });
});

describe("AcceptanceRule", () => {
  const rule = { windows: [recurring], avoidCalendarConflicts: false, preference: "earliest" };

  it("defaults bufferMinutes to 30", () => {
    expect(AcceptanceRule.parse(rule).bufferMinutes).toBe(30);
  });

  it("accepts every preference form", () => {
    for (const preference of ["earliest", "latest", { closestTo: "2026-10-14T10:00:00+01:00" }]) {
      expect(AcceptanceRule.safeParse({ ...rule, preference }).success).toBe(true);
    }
    expect(AcceptanceRule.safeParse({ ...rule, preference: "soonest" }).success).toBe(false);
  });

  it("needs at least one window", () => {
    expect(AcceptanceRule.safeParse({ ...rule, windows: [] }).success).toBe(false);
  });

  it("rejects negative notice and fractional buffers", () => {
    expect(AcceptanceRule.safeParse({ ...rule, minNoticeHours: -1 }).success).toBe(false);
    expect(AcceptanceRule.safeParse({ ...rule, bufferMinutes: 7.5 }).success).toBe(false);
  });
});
