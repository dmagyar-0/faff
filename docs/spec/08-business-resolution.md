# 08 — Business Resolution and Callee Identity

How Faff turns "my dentist in Clapham" into a number it's allowed to dial, and how it makes sure the right business answered before it says anything personal.

## Resolution order

`resolveContact(userId, businessQuery)`:

1. **Per-user tier:** a `user_businesses.preferred_contact` supplied by the user. It is trusted, and used as it is.
2. **General tier:** the `business_profile_cache`, derived from recent observations. It is used if the chosen phone number or email has a `reached_ok` observation newer than any `number_wrong` one, and less than 180 days old.
3. **Web lookup (Q28):** web search, then LLM extraction, then **deterministic citation check** (Q31, I-11).

The result is a `ResolvedContact`:

```ts
type ResolvedContact = {
  phone?: E164;
  email?: string;
  source: "user_memory" | "observations" | "web_extract";
  evidence?: { url: string; quote: string; fetchedAt: string };   // required for web_extract
  lastReachedOkAt?: string;
};
```

## Web lookup (Q28, Q31)

1. **Search:** a web search for the business name plus location, restricted to the top N results. The business's own site and the NHS service directory (for GPs and dentists) rank first.
2. **Extract:** an LLM reads the fetched pages and returns candidates, each shaped `{ phone|email, url, quote }`, where `quote` must be copied exactly from the page.
3. **Verify, deterministically, with no LLM:** `verifyCitation(candidate)` re-fetches `url`, normalises whitespace and phone formatting (`+44 20…` ≡ `020…`), and checks that the candidate value appears **inside** `quote` and that `quote` appears on the page. A candidate that fails either check is discarded. Candidates that pass are written as `web_extract` observations with `evidence_quote`.
4. **Choose:** prefer the business's own domain over directories, and a bookings or appointments line over a general number.

**No separate user confirmation (Q31).** The chosen contact and its evidence are shown on the Brief card, so approval is informed. Nothing blocks on it. The risk this accepts, an out-of-date but correctly cited number, is covered by the identity check below.

## Callee identity check (Q35)

**[derived D1]** Every call follows a fixed opening protocol **once a human is reached** (after any IVR):

1. **Disclosure plus identity question, in the fixed template (I-1):**
   > "Hi, I'm an AI assistant calling on behalf of a patient — is this Smile Dental in Clapham?"

   (The noun comes from the Brief's `business.kind` (G19): *patient* for dentists, GPs, opticians, physios and clinics; *client* for vets and hair and beauty; *customer* otherwise. The template is `disclosureOpener` in `packages/core/src/locale/en-GB.ts`, tested byte for byte against a fixture. The Brief's `business.displayName` is split at its last comma into name and location ("Smile Dental, Clapham"), and `briefOpener` in `packages/core/src/render/brief-card.ts` builds the opener for both the approval card and the call. A name is said only if it is at most 6 words of letters A–Z (with accents, and the few Latin letters with none, such as Ł, ø and ß; no small capitals or IPA letters), digits and `& ' -`, with no word that could make a clause (a pronoun, a verb such as "is" or "speaking", a greeting, "AI") and not the user's first name, checked with accents folded and piece by piece across `- & '` ("I-am-not-an-AI", "Ím"), and with an apostrophe only as a possessive ("Jo's") or after one letter before a capital ("O'Brien"), since any other could be a contraction ("l'm"); otherwise the question is the fixed fallback "have I reached the right number?".)
2. The agent calls `confirm_business_identity(heard_name, heard_location)`.
   - **Match:** `identity_confirmed = true`. The agent then names the user by first name ("I'm calling for David…") and continues.
   - **Mismatch / unclear after one clarification:** the agent apologises and ends the call ("Sorry, wrong number — have a good day"). A `number_wrong` observation is logged, and the cached profile for that business is invalidated. Resolution re-runs, excluding that number. This counts as an attempt. Whether Faff dials the new number without asking is decided by the deterministic check in [After a wrong number](#after-a-wrong-number) (Q39).
3. Until the identity is confirmed, `reveal_profile_field` refuses every field, **including `full_name`**.

**Why the user's name comes after the check rather than in the first sentence:** Q4 says "on behalf of [named user]". Naming them to a stranger who answered an out-of-date number is still a disclosure. The disclosure that matters for I-1 is *that it's an AI*, and that stays the first thing said. This ordering is derived rather than interviewed, so it is flagged for review.

**IVR:** disclosure is aimed at humans. When the agent navigates an IVR it says nothing to it beyond menu choices. If an IVR asks for identifying details (such as a DOB by keypad), the agent does not enter them. It waits for a human or ends the call (`needs_user`).

## After a wrong number

**(Q39)** `mayAutoSwitchContact(task, brief, newContact, observations) → ok | reason` is a pure function in `core`. Faff dials the new contact without a new approval only if every condition holds:

1. `brief.business.contactPolicy.autoSwitchOnWrongNumber` is true.
2. The source is `user_memory`, **or** `web_extract` whose evidence URL is on the business's own domain or the NHS service directory (not a third-party directory).
3. The value has no `number_wrong` observation for this business.
4. The evidence page names the business's display name and matches its postcode or address.
5. The task hasn't switched contact automatically before (at most one switch per task).
6. `limits` still allow a dial (I-8).

On success the worker records a `contact_switched` task event with the new `ResolvedContact` and its evidence, and dials that contact from then on. The Brief revision is never edited. The report shows the switch. On any failure the task escalates with `wrong_business_unresolved` and a suggested action to approve the new number. The identity check above still runs on the new call, so disclosure stays protected (I-7).

## What gets written back

Each call appends typed observations: `reached_ok` (number and when), `ivr_path` (the menu sequence that reached bookings), `hold_minutes`, `opening_hours` (if the IVR said so), `accepted_ai` / `refused_ai`, `booking_lead_time` (how far out the first offer was). None of these contains user data (D10).
