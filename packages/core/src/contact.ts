/**
 * `ResolvedContact` (spec 08): the number or address Faff may use, where it came from, and the
 * evidence for it. The source is the discriminator, so "evidence iff `web_extract`" is part of
 * the JSON Schema rather than a hidden refinement.
 */
import { z } from "zod";

import { E164, Email, IsoDateTime } from "./primitives";

export const CONTACT_SOURCES = ["user_memory", "observations", "web_extract"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** The page a web-found contact was cited from, and the exact text quoted (I-11, Q31). */
export const Evidence = z
  .strictObject({
    url: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      // Repeated as a pattern so the exported JSON Schema carries the http(s) rule too.
      .regex(/^https?:\/\//i),
    quote: z.string().min(1).max(1000),
    fetchedAt: IsoDateTime,
  })
  .meta({ id: "Evidence" });
export type Evidence = z.infer<typeof Evidence>;

const values = {
  phone: E164.optional(),
  email: Email.optional(),
  lastReachedOkAt: IsoDateTime.optional(),
};

const hasPhoneOrEmail = (c: { phone?: string | undefined; email?: string | undefined }): boolean =>
  c.phone !== undefined || c.email !== undefined;
const phoneOrEmail = { message: "A contact needs a phone number or an email address" };

export const ResolvedContact = z
  .discriminatedUnion("source", [
    z.strictObject({ source: z.literal("user_memory"), ...values }),
    z.strictObject({ source: z.literal("observations"), ...values }),
    z.strictObject({ source: z.literal("web_extract"), ...values, evidence: Evidence }),
  ])
  .refine(hasPhoneOrEmail, phoneOrEmail)
  .meta({ id: "ResolvedContact" });
export type ResolvedContact = z.infer<typeof ResolvedContact>;
