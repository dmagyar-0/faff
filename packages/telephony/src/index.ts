// Stub. The real module lands in its milestone (docs/design/milestones/).
import { packageName as corePackage } from "@faff/core";
import { packageName as simPackage } from "@faff/sim";

export const packageName = "@faff/telephony";

/** The workspace packages this one may import, per the dependency matrix in CLAUDE.md. */
export const dependsOn: readonly string[] = [corePackage, simPackage];
