/**
 * `deriveBusinessProfile` (I-5, spec 04 "Derived cache", M1 plan §3.8): the disposable summary of
 * a business's observations. Deterministic: the same observations, in any order, give the same
 * profile. It never reads the cache back and nothing corrects it in place; when it expires it is
 * thrown away and derived again.
 */
import type { E164 } from "./primitives";
import type { IvrStep, Observation, ObservationOf, OpeningPeriod } from "./observations";
import { Temporal, type Instant } from "./time";

/** A contact counts only if it was reached within this many days (spec 08, resolution step 2). */
export const CONTACT_MAX_AGE_DAYS = 180;
/** Typical hold is the median of this many most recent hold times. */
export const HOLD_SAMPLE = 10;

export type DerivedProfile = {
  /** The most recently reached number with no newer `number_wrong`, reached under 180 days ago. */
  readonly bestPhone?: { readonly e164: E164; readonly lastReachedOkAt: string };
  /** The most recently reached email address, under 180 days ago. */
  readonly bestEmail?: { readonly email: string; readonly lastReachedOkAt: string };
  /** When the business was last seen to prefer email, if it was. */
  readonly prefersEmailObservedAt?: string;
  /** The most recent IVR route to bookings. */
  readonly ivrHint?: readonly IvrStep[];
  /** The most recently observed weekly opening hours. */
  readonly openingHours?: readonly OpeningPeriod[];
  /** Median of the last 10 hold times, in minutes. */
  readonly typicalHoldMinutes?: number;
  /** Whether the business last accepted or refused an AI caller. */
  readonly aiReception?: "accepted" | "refused";
};

export type DerivationResult = {
  readonly derived: DerivedProfile;
  /** The highest observation id considered; `undefined` if none was. */
  readonly derivedFromMaxId: number | undefined;
};

const at = (o: Observation): Instant => Temporal.Instant.from(o.observedAt);

/** Oldest first; `id` (monotonic) breaks ties, so input order never matters. */
const chronological = (a: Observation, b: Observation): number =>
  Temporal.Instant.compare(at(a), at(b)) || a.id - b.id;

const latestOf = <K extends Observation["kind"]>(
  sorted: readonly Observation[],
  kind: K,
): ObservationOf<K> | undefined => sorted.findLast((o): o is ObservationOf<K> => o.kind === kind);

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * The derived profile of one business. Observations dated after `now` are ignored: a row can't
 * describe a moment that hasn't happened.
 */
export const deriveBusinessProfile = (
  observations: readonly Observation[],
  now: Instant,
): DerivationResult => {
  const sorted = observations
    .filter((o) => Temporal.Instant.compare(at(o), now) <= 0)
    .sort(chronological);
  const fresh = now.subtract({ hours: 24 * CONTACT_MAX_AGE_DAYS });
  const isFresh = (o: Observation): boolean => Temporal.Instant.compare(at(o), fresh) > 0;

  const wrongAt = new Map<string, Observation>();
  for (const o of sorted) if (o.kind === "number_wrong") wrongAt.set(o.value.e164, o);

  const reached = sorted.filter((o): o is ObservationOf<"reached_ok"> => o.kind === "reached_ok");
  const phone = reached.findLast((o) => {
    if (o.value.channel !== "phone" || !isFresh(o)) return false;
    const wrong = wrongAt.get(o.value.e164);
    return wrong === undefined || chronological(wrong, o) < 0;
  });
  const email = reached.findLast((o) => o.value.channel === "email" && isFresh(o));
  const prefers = latestOf(sorted, "prefers_email");
  const ivr = latestOf(sorted, "ivr_path");
  const hours = latestOf(sorted, "opening_hours");
  const holds = sorted.filter((o): o is ObservationOf<"hold_minutes"> => o.kind === "hold_minutes");
  const ai = sorted.findLast((o) => o.kind === "accepted_ai" || o.kind === "refused_ai");

  const derived: DerivedProfile = {
    ...(phone?.value.channel === "phone"
      ? { bestPhone: { e164: phone.value.e164, lastReachedOkAt: phone.observedAt } }
      : {}),
    ...(email?.value.channel === "email"
      ? { bestEmail: { email: email.value.email, lastReachedOkAt: email.observedAt } }
      : {}),
    ...(prefers === undefined ? {} : { prefersEmailObservedAt: prefers.observedAt }),
    ...(ivr === undefined ? {} : { ivrHint: ivr.value.steps }),
    ...(hours === undefined ? {} : { openingHours: hours.value.weekly }),
    ...(holds.length === 0
      ? {}
      : { typicalHoldMinutes: median(holds.slice(-HOLD_SAMPLE).map((o) => o.value.minutes)) }),
    ...(ai === undefined
      ? {}
      : { aiReception: ai.kind === "accepted_ai" ? "accepted" : "refused" }),
  };
  const maxId = sorted.reduce<number | undefined>(
    (m, o) => (m === undefined || o.id > m ? o.id : m),
    undefined,
  );
  return { derived, derivedFromMaxId: maxId };
};
