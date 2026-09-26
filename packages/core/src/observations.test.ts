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
  patternProperties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
};

/** Every string leaf, with its path, in a JSON Schema. An `allOf` on a string is merged in. */
const stringLeaves = (schema: JsonSchema, path: string): [string, JsonSchema][] => {
  if (schema.type === "string") {
    const merged = (schema.allOf ?? []).reduce<JsonSchema>((acc, s) => ({ ...acc, ...s }), schema);
    return [[path, merged]];
  }
  const children: [string, JsonSchema][] = [
    ...Object.entries(schema.properties ?? {}),
    ...Object.entries(schema.patternProperties ?? {}),
    ...(typeof schema.additionalProperties === "object"
      ? [["*", schema.additionalProperties] as [string, JsonSchema]]
      : []),
    ...(schema.items ? [["[]", schema.items] as [string, JsonSchema]] : []),
    ...(schema.prefixItems ?? []).map((s, i) => [`[${i}]`, s] as [string, JsonSchema]),
    ...[...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])].map(
      (s, i) => [`|${i}`, s] as [string, JsonSchema],
    ),
  ];
  return children.flatMap(([key, child]) => stringLeaves(child, `${path}.${key}`));
};

/**
 * A bound that rules out prose: a format, an enum or const, or a pattern with a short length cap.
 * A pattern alone isn't enough: `^.*$` is a pattern.
 */
const rulesOutProse = (s: JsonSchema): boolean =>
  s.format !== undefined ||
  s.enum !== undefined ||
  s.const !== undefined ||
  (s.pattern !== undefined && s.maxLength !== undefined && s.maxLength <= 40);

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

  it("the walk catches strings that could hold prose, wherever they are", () => {
    const caught = (schema: z.ZodType): boolean[] =>
      stringLeaves(inline(schema), "x").map(([, leaf]) => rulesOutProse(leaf));
    expect(caught(z.object({ note: z.string() }))).toEqual([false]);
    expect(caught(z.object({ note: z.string().max(500) }))).toEqual([false]);
    expect(caught(z.object({ note: z.string().regex(/^.*$/) }))).toEqual([false]);
    expect(
      caught(
        z.object({
          note: z
            .string()
            .regex(/^[\w\s]+$/)
            .max(500),
        }),
      ),
    ).toEqual([false]);
    expect(caught(z.record(z.string(), z.string()))).toEqual([false]);
    expect(caught(z.tuple([z.string()]))).toEqual([false]);
    expect(
      caught(z.object({ ok: z.enum(["a"]), code: z.string().max(10).regex(/^\d+$/) })),
    ).toEqual([true, true]);
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
