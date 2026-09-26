/**
 * The approval card (spec 02 "What the user sees on the approval card"). The approval stores the
 * rendered text the user saw, so the card is built by one deterministic function from the parsed
 * Brief: the same Brief always renders to the same bytes.
 */
import type { Brief, ChannelReason } from "../brief";
import {
  APPROVAL_CARD_REMINDER,
  CALLEE_NOUN,
  disclosureOpener,
  openerParts,
  EMAIL_DISCLOSURE,
  writeDateTime,
} from "../locale/en-GB";
import type { ProfileField } from "../primitives";
import { Temporal } from "../time";
import { acceptanceRuleText, listWords, oneLine } from "./acceptance-rule";

export type CardSection = { readonly title: string; readonly lines: readonly string[] };
export type BriefCard = { readonly sections: readonly CardSection[]; readonly text: string };

const VERB: Readonly<Record<Brief["verb"], string>> = {
  book: "Book",
  reschedule: "Reschedule",
  cancel: "Cancel",
};

const KIND: Readonly<Record<Brief["business"]["kind"], string>> = {
  dentist: "dentist",
  gp: "GP surgery",
  optician: "optician",
  physio: "physiotherapist",
  clinic: "clinic",
  vet: "vet",
  hair_and_beauty: "hair and beauty",
  garage: "garage",
  other: "business",
};

const CHANNEL_WHY: Readonly<Record<ChannelReason, string>> = {
  user_memory: "you said this business prefers it",
  prefers_email_observed: "this business has recently preferred email",
  no_phone_known: "Faff has no phone number for this business",
  default_phone: "phone is the default",
  user_override: "you chose it",
};

const FIELD_LABEL: Readonly<Record<Exclude<ProfileField, "existing_patient">, string>> = {
  full_name: "your full name",
  preferred_name: "your preferred name",
  date_of_birth: "your date of birth",
  postcode: "your postcode",
  address_line: "your address",
  contact_phone: "your phone number",
  contact_email: "your email address",
  nhs_number: "your NHS number",
};

/** How the card names a profile field; "existing patient" takes the business's noun. */
export const fieldLabel = (field: ProfileField, kind: Brief["business"]["kind"]): string =>
  field === "existing_patient"
    ? `that you're an existing ${CALLEE_NOUN[kind]}`
    : FIELD_LABEL[field];

/**
 * What Faff will say about the user. By phone, the agent names the user by first name once the
 * business has confirmed who it is (spec 08), and the allowed fields likewise. By email, the user's
 * name goes in every email (spec 07), and the other fields only once the business has replied from
 * that address (D2), unless it has replied before.
 */
const disclosureLines = (brief: Brief): string[] => {
  const name = brief.forPerson.firstName;
  const fields = brief.disclosure.allowedFields.map((f) => fieldLabel(f, brief.business.kind));
  const also = fields.length === 0 ? "" : listWords(fields, "and");
  const what = also === "" ? `your first name (${name})` : `your first name (${name}) and ${also}`;
  const phoneLine = `${what}, and only once they've confirmed who they are.`;
  if (brief.channel.chosen === "phone") return [phoneLine.replace(/^./, (c) => c.toUpperCase())];
  const lines = [
    `Your first name (${name}) and last initial go in every email, with what you're asking for.`,
  ];
  lines.push(
    also === ""
      ? "Nothing else about you."
      : `${also.replace(/^./, (c) => c.toUpperCase())}: only once they've replied from this address, unless they have before.`,
  );
  // A switch to phone needs no email reply: on the call, the phone rule applies (I-7).
  if (brief.business.contact.phone !== undefined) {
    lines.push(`If it switches to phone: ${phoneLine}`);
  }
  return lines;
};

/**
 * The Brief's call opener (I-1, spec 08): the card shows it and the call says it, so both take it
 * from here. The user's first name is never said as part of the business's name.
 */
export const briefOpener = (brief: Brief): string =>
  disclosureOpener({
    kind: brief.business.kind,
    ...openerParts(brief.business.displayName),
    avoid: [brief.forPerson.firstName],
  });

/**
 * How Faff says it's an AI (I-1): the call's fixed opener, or for email the fixed signature, and
 * the opener too when an email task may switch to phone.
 */
const disclosureWords = (brief: Brief): string[] => {
  const opener = briefOpener(brief);
  if (brief.channel.chosen === "phone") return [`Faff opens the call with: “${opener}”`];
  const lines = [`Every email is signed: “${EMAIL_DISCLOSURE}”`];
  if (brief.business.contact.phone !== undefined) {
    lines.push(`If it switches to phone, Faff opens the call with: “${opener}”`);
  }
  return lines;
};

/** "P7D" → "7 days", "PT90M" → "90 minutes", "P1DT12H" → "1 day 12 hours". */
export const durationWords = (duration: string): string => {
  const d = Temporal.Duration.from(duration);
  const parts: [number, string][] = [
    [d.days, "day"],
    [d.hours, "hour"],
    [d.minutes, "minute"],
    [d.seconds, "second"],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`);
  return words.length === 0 ? "0 minutes" : words.join(" ");
};

const contactLines = (brief: Brief): string[] => {
  const c = brief.business.contact;
  const value = brief.channel.chosen === "phone" ? c.phone : c.email;
  const where =
    c.source === "user_memory"
      ? "from your saved details"
      : c.source === "observations"
        ? "from Faff's records of earlier calls and emails"
        : `found on ${c.evidence.url}, which says: “${oneLine(c.evidence.quote)}”`;
  // The Brief refinement guarantees the chosen channel has its value.
  const lines = [`${value}, ${where}.`];
  if (brief.channel.chosen === "email" && c.phone !== undefined) {
    lines.push(`If it switches to phone, Faff calls ${c.phone}.`);
  }
  if (c.phone !== undefined) {
    lines.push(
      brief.business.contactPolicy.autoSwitchOnWrongNumber
        ? "If this number turns out to be wrong, Faff may switch to one other number it can verify from the business's own site, the NHS directory or your saved details."
        : "If this number turns out to be wrong, Faff will ask you before trying another.",
    );
  }
  return lines;
};

const serviceLines = (brief: Brief): string[] => {
  const s = brief.service;
  const description = oneLine(s.description);
  const lines = [description.charAt(0).toUpperCase() + description.slice(1) + "."];
  if (s.durationMinutes !== undefined) lines.push(`About ${s.durationMinutes} minutes.`);
  if (typeof s.practitioner === "string") lines.push(`Asks for ${oneLine(s.practitioner)}.`);
  if (s.practitioner === null) lines.push("Any practitioner.");
  if (s.isExistingCustomer === true)
    lines.push(`You're an existing ${CALLEE_NOUN[brief.business.kind]}.`);
  if (s.isExistingCustomer === false)
    lines.push(`You're a new ${CALLEE_NOUN[brief.business.kind]}.`);
  return lines;
};

/** The card, section by section, and as the plain text stored with the approval. */
export const briefCard = (brief: Brief): BriefCard => {
  const tz = brief.timezone;
  const sections: CardSection[] = [];

  sections.push({
    title: "What",
    lines: [
      `${VERB[brief.verb]} at ${brief.business.displayName} (${KIND[brief.business.kind]}), for ${brief.forPerson.firstName}.`,
      ...disclosureWords(brief),
    ],
  });

  const channelLines = [
    `By ${brief.channel.chosen}, because ${CHANNEL_WHY[brief.channel.reason]}.`,
  ];
  if (brief.channel.chosen === "email") {
    const days = brief.channel.emailFallbackToPhoneAfter.workingDays;
    const within = `within ${days} working day${days === 1 ? "" : "s"}`;
    // Spec 07: with no phone number to fall back to, the task escalates instead.
    channelLines.push(
      brief.business.contact.phone === undefined
        ? `If there's no reply Faff can act on ${within}, it asks you what to do: it has no phone number for them.`
        : `If there's no reply Faff can act on ${within}, it switches to phone.`,
    );
  }
  sections.push({ title: "How", lines: channelLines });
  sections.push({ title: "Contact", lines: contactLines(brief) });
  sections.push({ title: "Service", lines: serviceLines(brief) });

  if (brief.verb !== "book") {
    const a = brief.existingAppointment;
    const ref = a.reference === undefined ? "" : ` (ref ${oneLine(a.reference)})`;
    sections.push({
      title: "Existing appointment",
      lines: [`${writeDateTime(Temporal.Instant.from(a.startsAt), tz)}${ref}.`],
    });
  }

  if (brief.verb === "cancel") {
    sections.push({
      title: "Cancellation",
      lines: [
        brief.cancel.mode === "paired"
          ? "Only once your new booking has succeeded. You'll confirm this cancellation separately."
          : "You'll be asked to confirm this cancellation once more before Faff contacts them.",
      ],
    });
  } else {
    const lines = [acceptanceRuleText(brief.acceptance, tz)];
    if (brief.verb === "reschedule") {
      lines.push(
        "Faff asks them to cancel your current appointment only once a new one is confirmed.",
      );
    }
    sections.push({ title: "Acceptable times", lines });
  }

  sections.push({ title: "What Faff may tell them", lines: disclosureLines(brief) });

  const l = brief.limits;
  sections.push({
    title: "Limits",
    lines: [
      `Up to ${l.maxDialAttempts} call${l.maxDialAttempts === 1 ? "" : "s"} and ${l.maxCallMinutes} minutes on the phone in all, within ${durationWords(l.maxLifetime)}. Then Faff stops and asks you.`,
    ],
  });

  if (brief.notesForAgent !== undefined && brief.notesForAgent !== "") {
    // One line, so a note can't look like more of the card.
    const note = oneLine(brief.notesForAgent);
    sections.push({ title: "Notes for the agent (context only)", lines: [note] });
  }

  sections.push({ title: "Remember", lines: [APPROVAL_CARD_REMINDER] });

  const text = sections.map((s) => `${s.title}\n${s.lines.join("\n")}`).join("\n\n");
  return { sections, text };
};
