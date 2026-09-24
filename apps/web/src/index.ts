// Stub. The real module lands in its milestone (docs/design/milestones/).
import { packageName as corePackage } from "@faff/core";
import { packageName as dbPackage } from "@faff/db";
import { packageName as agentsPackage } from "@faff/agents";

export const packageName = "@faff/web";

/** The workspace packages this one may import, per the dependency matrix in CLAUDE.md. */
export const dependsOn: readonly string[] = [corePackage, dbPackage, agentsPackage];
