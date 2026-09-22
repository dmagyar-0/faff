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

   (The noun varies by business type: patient, customer, client.)
2. The agent calls `confirm_business_identity(heard_name, heard_location)`.
   - **Match:** `identity_confirmed = true`. The agent then names the user ("I'm calling for David Example…") and continues.
   - **Mismatch / unclear after one clarification:** the agent apologises and ends the call ("Sorry, wrong number — have a good day"). A `number_wrong` observation is logged, and the cached profile for that business is invalidated. Resolution re-runs, excluding that number. This counts as an attempt.
3. Until the identity is confirmed, `reveal_profile_field` refuses every field, **including `full_name`**.

**Why the user's name comes after the check rather than in the first sentence:** Q4 says "on behalf of [named user]". Naming them to a stranger who answered an out-of-date number is still a disclosure. The disclosure that matters for I-1 is *that it's an AI*, and that stays the first thing said. This ordering is derived rather than interviewed, so it is flagged for review.

**IVR:** disclosure is aimed at humans. When the agent navigates an IVR it says nothing to it beyond menu choices. If an IVR asks for identifying details (such as a DOB by keypad), the agent does not enter them. It waits for a human or ends the call (`needs_user`).

## What gets written back

Each call appends typed observations: `reached_ok` (number and when), `ivr_path` (the menu sequence that reached bookings), `hold_minutes`, `opening_hours` (if the IVR said so), `accepted_ai` / `refused_ai`, `booking_lead_time` (how far out the first offer was). None of these contains user data (D10).
