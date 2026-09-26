import { describe, expect, it } from "vitest";
import { z } from "zod";

import { OBSERVATION_KINDS, Observation, observationValues } from "./observations";

type JsonSchema = {
  type?: string;
  format?: string;
  pattern?: string;
  enum?: unknown[];
  const?: unknown;
  maxLength?: number;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

/** Every string leaf, with its path, in a JSON Schema. */
const stringLeaves = (schema: JsonSchema, path: string): [string, JsonSchema][] => {
  const out: [string, JsonSchema][] = [];
  if (schema.type === "string") out.push([path, schema]);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    out.push(...stringLeaves(child, `${path}.${key}`));
  }
  if (schema.items) out.push(...stringLeaves(schema.items, `${path}[]`));
  for (const [i, child] of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].entries()) {
    out.push(...stringLeaves(child, `${path}|${i}`));
  }
  return out;
};

/** A bound that rules out prose: a format, an enum or const, or a pattern with a short cap. */
const rulesOutProse = (s: JsonSchema): boolean =>
  s.format !== undefined ||
  s.enum !== undefined ||
  s.const !== undefined ||
  (s.pattern !== undefined && s.maxLength !== undefined && s.maxLength <= 40) ||
  (s.pattern !== undefined && /^\^[^ ]*\$$/.test(s.pattern) && !s.pattern.includes(" "));

describe("observation value schemas (D10: no free text)", () => {
  it("has one value schema per kind", () => {
    expect(Object.keys(observationValues).sort()).toEqual([...OBSERVATION_KINDS].sort());
  });

  // A private registry keeps the shared ids (E164, DateTime…) inline instead of $ref'd.
  const inline = (schema: z.ZodType): JsonSchema =>
    z.toJSONSchema(schema, { metadata: z.registry() }) as JsonSchema;

  it.each(OBSERVATION_KINDS)("%s has no string field that could hold prose", (kind) => {
    for (const [path, leaf] of stringLeaves(inline(observationValues[kind]), kind)) {
      expect(rulesOutProse(leaf), `${path} would accept free text`).toBe(true);
    }
  });

  it("the walk sees the strings behind shared schemas", () => {
    expect(stringLeaves(inline(observationValues.phone_number), "x")).toHaveLength(1);
    expect(stringLeaves(inline(observationValues.reached_ok), "x").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(stringLeaves(inline(observationValues.email_reply_latency), "x")).toHaveLength(2);
  });

  it("the walk does catch an unbounded string", () => {
    const leaves = stringLeaves(z.toJSONSchema(z.object({ note: z.string() })) as JsonSchema, "x");
    expect(leaves.map(([, s]) => rulesOutProse(s))).toEqual([false]);
    const bounded = z.toJSONSchema(z.object({ note: z.string().max(500) })) as JsonSchema;
    expect(stringLeaves(bounded, "x").map(([, s]) => rulesOutProse(s))).toEqual([false]);
  });

  it("rejects a spoken IVR step that is a sentence", () => {
    const ivr = observationValues.ivr_path;
    expect(ivr.safeParse({ steps: [{ dtmf: "2" }, { say: "bookings" }] }).success).toBe(true);
    expect(ivr.safeParse({ steps: [{ say: "my name is david and my dob is" }] }).success).toBe(
      false,
    );
    expect(ivr.safeParse({ steps: [{ say: "Bookings" }] }).success).toBe(false);
  });
});

describe("Observation", () => {
  const base = {
    id: 1,
    businessId: "7a1e4c2b-3d5f-4a6b-8c9d-0e1f2a3b4c21",
    observedAt: "2026-09-20T10:00:00Z",
    sourceKind: "call",
    sourceRef: "call_123",
  };

  it("parses a typed row", () => {
    const row = { ...base, kind: "reached_ok", value: { channel: "phone", e164: "+442079460000" } };
    expect(Observation.parse(row)).toEqual(row);
  });

  it("rejects a value of the wrong shape for its kind", () => {
    const row = { ...base, kind: "hold_minutes", value: { e164: "+442079460000" } };
    expect(Observation.safeParse(row).success).toBe(false);
  });

  it("requires evidenceQuote for web_extract, and only for it", () => {
    const web = {
      ...base,
      sourceKind: "web_extract",
      sourceRef: "https://smile.example",
      kind: "phone_number",
      value: { e164: "+442079460000" },
    };
    expect(Observation.safeParse(web).success).toBe(false);
    expect(Observation.safeParse({ ...web, evidenceQuote: "Call 020 7946 0000" }).success).toBe(
      true,
    );
    const call = {
      ...base,
      kind: "refused_ai",
      value: {},
      evidenceQuote: "we don't talk to robots",
    };
    expect(Observation.safeParse(call).success).toBe(false);
  });
});
