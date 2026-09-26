/** Build observation rows for tests: `obs(id, kind, value, observedAt)`. */
import type { Observation } from "../observations";

export const BUSINESS_ID = "7a1e4c2b-3d5f-4a6b-8c9d-0e1f2a3b4c21";

export const obs = <K extends Observation["kind"]>(
  id: number,
  kind: K,
  value: Extract<Observation, { kind: K }>["value"],
  observedAt: string,
  extra: Partial<
    Pick<Observation, "sourceKind" | "sourceRef" | "evidenceQuote" | "businessId">
  > = {},
): Observation =>
  ({
    id,
    businessId: BUSINESS_ID,
    kind,
    value,
    observedAt,
    sourceKind: "call",
    sourceRef: `call_${id}`,
    ...extra,
  }) as Observation;
