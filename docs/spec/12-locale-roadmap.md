# 12 — Locale Roadmap (Q3, Q18)

v1 ships **`en-GB` only**. Nothing Hungarian gets built now. The only commitment is *locale discipline*, so that a second locale is additive work rather than a rewrite.

## Discipline in v1

- Every Brief carries `locale` and `timezone`. Nothing assumes Europe/London implicitly.
- Phone numbers are always E.164. Formatting for display and speech is per locale.
- Every user-facing or callee-facing string comes from a per-locale catalogue: the disclosure opener template, the voicemail greeting, the email signature, the capability statement. The **fixed disclosure templates are per locale and each is reviewed as a legal artefact**, not just translated.
- Business-type nouns (patient, customer, client) are per locale.
- Date parsing and speech (for example "the fourteenth" vs "14-én") live behind a locale interface in `core`.
- Profile fields are locale-aware: `postcode` vs `irányítószám`, and the NHS number is a GB-only field. Hungary's TAJ number would be its own field with the same separate opt-in treatment.
- `businesses.country` and `locale` are set. Observations are per business, so they don't mix across countries.

## Hungary (named later market)

Notes for whoever picks this up:

- **The EU AI Act Art. 50 applies directly.** Disclosure is already universal (I-1), so the rule itself doesn't change. The opener must be legally reviewed in Hungarian.
- GDPR rather than UK GDPR. Hungarian rules on recording one-party calls need checking before assuming parity with RIPA.
- The practical booking landscape (private clinics, and online booking systems that may make phone calls unnecessary) should be researched before assuming the UK wedge carries over.
- It needs a Hungarian caller ID and its own telecoms-regulator rules. The Ofcom invariant (I-4) generalises to "follow the destination regulator's CLI and abandonment rules".
