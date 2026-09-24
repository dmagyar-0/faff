// Stub. The real module lands in its milestone (docs/design/milestones/).
import { packageName as corePackage } from "@faff/core";

export const packageName = "@faff/db";

/** The workspace packages this one may import, per the dependency matrix in CLAUDE.md. */
export const dependsOn: readonly string[] = [corePackage];

/** Generated from the migrations by `pnpm db:types`; CI fails if it drifts. Never edit by hand. */
export type { Database, Json } from "./types.gen";
