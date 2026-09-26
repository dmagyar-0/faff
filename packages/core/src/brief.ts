/**
 * `faff.brief/v1` (spec 02): the source of truth for the Brief. Exported as JSON Schema to
 * `docs/spec/schemas/brief.v1.json`; CI fails if the committed file drifts from `toJsonSchema()`.
 *
 * The top level is a discriminated union on `verb`, so the verb-dependent rules (`acceptance`
 * for book and reschedule, `existingAppointment` for reschedule and cancel, `cancel` for cancel)
 * are `oneOf` branches that an external producer can validate against the JSON Schema alone.
 * The rules JSON Schema can't express are refinements, listed in `BRIEF_REFINEMENTS` and in the
 * schema's description.
 */
import { z } from "zod";

import { AcceptanceRule } from "./acceptance-rule";
import { ResolvedContact } from "./contact";
import { AppointmentRef, Duration, PractitionerName, ProfileField, Uuid } from "./primitives";
import { samePractitioner } from "./practitioner";
import { err, ok, type Result } from "./result";

export const BRIEF_SCHEMA_V1 = "faff.brief/v1";

/**
 * What kind of business this is. It picks the opener's noun (patient, customer, client: G19,
 * M1-Q7), so the user sees on the approval card what the agent will call them.
 */
export const BUSINESS_KINDS = [
  "dentist",
  "gp",
  "optician",
  "physio",
  "clinic",
  "vet",
  "hair_and_beauty",
  "garage",
  "other",
] as const;
export const BusinessKind = z.enum(BUSINESS_KINDS);
export type BusinessKind = z.infer<typeof BusinessKind>;

export const CHANNEL_REASONS = [
  "user_memory",
  "prefers_email_observed",
  "no_phone_known",
  "default_phone",
  "user_override",
] as const;
export type ChannelReason = (typeof CHANNEL_REASONS)[number];

export const DEFAULT_LIMITS = {
  maxDialAttempts: 3,
  maxCallMinutes: 30,
  maxLifetime: "P7D",
} as const;
export const DEFAULT_EMAIL_FALLBACK_WORKING_DAYS = 2;

export const Limits = z
  .strictObject({
    maxDialAttempts: z.int().min(1).max(20).default(DEFAULT_LIMITS.maxDialAttempts),
    /** Talk plus hold, across every call on the task. */
    maxCallMinutes: z.int().min(1).max(600).default(DEFAULT_LIMITS.maxCallMinutes),
    /** Wall clock from dispatch. */
    maxLifetime: Duration.default(DEFAULT_LIMITS.maxLifetime),
  })
  .meta({ id: "Limits" });
export type Limits = z.infer<typeof Limits>;

const Business = z
  .strictObject({
    businessId: Uuid,
    displayName: z.string().min(1).max(200),
    kind: BusinessKind,
    address: z.string().min(1).max(500).optional(),
    contact: ResolvedContact,
    contactPolicy: z
      .strictObject({
        /** Q39: may Faff switch to one other code-vouched number after a wrong number? */
        autoSwitchOnWrongNumber: z.boolean().default(true),
      })
      .prefault({}),
  })
  .meta({ id: "Business" });

const Channel = z
  .strictObject({
    chosen: z.enum(["phone", "email"]),
    reason: z.enum(CHANNEL_REASONS),
    /**
     * Spec 07: switch an email task to phone when no reply that can be acted on arrives within
     * this many working days (weekends and England & Wales bank holidays excluded: G13, M1-Q3).
     */
    emailFallbackToPhoneAfter: z
      .strictObject({ workingDays: z.int().min(1).max(20) })
      .default({ workingDays: DEFAULT_EMAIL_FALLBACK_WORKING_DAYS }),
  })
  .meta({ id: "Channel" });

const Service = z
  .strictObject({
    description: z.string().min(1).max(500),
    durationMinutes: z
      .int()
      .min(1)
      .max(8 * 60)
      .optional(),
    /** Who the agent asks for. `null` means anyone. `acceptance.practitioner` decides (G18). */
    practitioner: PractitionerName.nullable().optional(),
    /** Pinned from per-user memory. */
    isExistingCustomer: z.boolean().optional(),
  })
  .meta({ id: "Service" });

const common = {
  schema: z.literal(BRIEF_SCHEMA_V1),
  briefId: Uuid,
  revision: z.int().min(1),
  userId: Uuid,
  locale: z.enum(["en-GB"]),
  timezone: z.enum(["Europe/London"]),
  business: Business,
  /** The person the task is for, pinned at draft time for the identity step (G22, M1-Q7). */
  forPerson: z.strictObject({ firstName: z.string().min(1).max(50) }),
  channel: Channel,
  service: Service,
  disclosure: z.strictObject({
    /** Pinned per Brief (Q21). */
    allowedFields: z.array(ProfileField).max(9),
  }),
  limits: Limits.prefault({}),
  /** Context only; never grants authority. Scanned for secrets on write (I-6). */
  notesForAgent: z.string().max(2000).optional(),
};

const BookBrief = z.strictObject({
  ...common,
  verb: z.literal("book"),
  acceptance: AcceptanceRule,
});

const RescheduleBrief = z.strictObject({
  ...common,
  verb: z.literal("reschedule"),
  existingAppointment: AppointmentRef,
  acceptance: AcceptanceRule,
});

const CancelBrief = z.strictObject({
  ...common,
  verb: z.literal("cancel"),
  existingAppointment: AppointmentRef,
  cancel: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("standalone") }),
    /** Dispatches only once the paired booking Brief is completed (spec 06). */
    z.strictObject({ mode: z.literal("paired"), pairedWithBriefId: Uuid }),
  ]),
});

/**
 * The rules the JSON Schema can't carry. Each is checked by `BriefV1` and listed in the exported
 * schema's description, so an external producer knows about them.
 */
export const BRIEF_REFINEMENTS = [
  'channel.chosen = "phone" needs business.contact.phone; "email" needs business.contact.email.',
  "business.contact needs a phone number or an email address.",
  "An absolute window must end after it starts, compared as instants.",
  "A recurring window lists each weekday once, has from ≠ to, and between.start ≤ between.end.",
  "When service.practitioner and acceptance.practitioner.mustBe are both set they must name the same person (case, titles and punctuation ignored).",
  "cancel.pairedWithBriefId must differ from briefId.",
  "disclosure.allowedFields lists each field once.",
  "Every string is well-formed Unicode (no lone surrogates), so the Brief has a canonical form.",
] as const;

type BriefShape =
  z.infer<typeof BookBrief> | z.infer<typeof RescheduleBrief> | z.infer<typeof CancelBrief>;

const LONE_SURROGATE = /\p{Cs}/u;

const hasLoneSurrogate = (value: unknown): boolean => {
  if (typeof value === "string") return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (typeof value === "object" && value !== null)
    return Object.values(value).some(hasLoneSurrogate);
  return false;
};

const checkCrossFields = (b: BriefShape, ctx: z.RefinementCtx): void => {
  if (hasLoneSurrogate(b)) {
    ctx.addIssue({ code: "custom", message: "A string contains a lone surrogate", path: [] });
  }
  const contact = b.business.contact;
  if (b.channel.chosen === "phone" && contact.phone === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "The phone channel needs business.contact.phone",
      path: ["channel", "chosen"],
    });
  }
  if (b.channel.chosen === "email" && contact.email === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "The email channel needs business.contact.email",
      path: ["channel", "chosen"],
    });
  }
  const mustBe = b.verb === "cancel" ? undefined : b.acceptance.practitioner?.mustBe;
  const asked = b.service.practitioner;
  if (mustBe !== undefined && typeof asked === "string" && !samePractitioner(mustBe, asked)) {
    ctx.addIssue({
      code: "custom",
      message: "service.practitioner and acceptance.practitioner.mustBe disagree (G18)",
      path: ["service", "practitioner"],
    });
  }
  if (
    b.verb === "cancel" &&
    b.cancel.mode === "paired" &&
    b.cancel.pairedWithBriefId === b.briefId
  ) {
    ctx.addIssue({
      code: "custom",
      message: "A cancel can't be paired with itself",
      path: ["cancel", "pairedWithBriefId"],
    });
  }
  if (new Set(b.disclosure.allowedFields).size !== b.disclosure.allowedFields.length) {
    ctx.addIssue({
      code: "custom",
      message: "Each profile field may appear once",
      path: ["disclosure", "allowedFields"],
    });
  }
};

export const BriefV1 = z
  .discriminatedUnion("verb", [BookBrief, RescheduleBrief, CancelBrief])
  .superRefine(checkCrossFields)
  .meta({
    $id: "https://faff.app/schemas/brief.v1.json",
    title: "faff.brief/v1",
    description:
      "The Faff Task Brief (docs/spec/02-task-brief.md). Every datetime is RFC 3339 with an " +
      "offset. Rules this schema can't express, which the reference validator (packages/core " +
      "BriefV1) also enforces: " +
      BRIEF_REFINEMENTS.join(" "),
  });

/** A parsed Brief: defaults applied, refinements checked. */
export type Brief = z.output<typeof BriefV1>;
/** What a producer may send: defaulted fields may be omitted. */
export type BriefInput = z.input<typeof BriefV1>;
export type BookBrief = Extract<Brief, { verb: "book" }>;
export type RescheduleBrief = Extract<Brief, { verb: "reschedule" }>;
export type CancelBrief = Extract<Brief, { verb: "cancel" }>;
export type Verb = Brief["verb"];

export const PARSE_BRIEF_REASONS = ["unknown_schema", "invalid_brief"] as const;
export type ParseBriefReason = (typeof PARSE_BRIEF_REASONS)[number];

export type BriefIssue = { readonly path: string; readonly message: string };

const issuesOf = (error: z.ZodError): BriefIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));

/**
 * Parse anything claiming to be a Brief. Switches on `schema`, so a v2 (and its migration from
 * v1) can be added here without touching callers.
 */
export const parseBrief = (
  input: unknown,
): Result<Brief, ParseBriefReason, readonly BriefIssue[]> => {
  const schema =
    typeof input === "object" && input !== null && "schema" in input ? input.schema : undefined;
  switch (schema) {
    case BRIEF_SCHEMA_V1: {
      const parsed = BriefV1.safeParse(input);
      return parsed.success ? ok(parsed.data) : err("invalid_brief", issuesOf(parsed.error));
    }
    default:
      return err("unknown_schema", [
        { path: "schema", message: `Unknown schema: ${String(schema)}` },
      ]);
  }
};

/**
 * The JSON Schema for `faff.brief/v1`, describing what a producer may send (`io: "input"`:
 * defaulted fields are optional). `pnpm schema:write` writes it to `docs/spec/schemas/`.
 */
export const toJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(BriefV1, {
    io: "input",
    target: "draft-2020-12",
    unrepresentable: "throw",
  });
