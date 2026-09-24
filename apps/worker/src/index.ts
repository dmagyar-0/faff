// Stub. The real module lands in its milestone (docs/design/milestones/).
import { packageName as corePackage } from "@faff/core";
import { packageName as dbPackage } from "@faff/db";
import { packageName as toolsPackage } from "@faff/tools";
import { packageName as agentsPackage } from "@faff/agents";
import { packageName as telephonyPackage } from "@faff/telephony";
import { packageName as emailPackage } from "@faff/email";
import { packageName as simPackage } from "@faff/sim";

export const packageName = "@faff/worker";

/** The workspace packages this one may import, per the dependency matrix in CLAUDE.md. */
export const dependsOn: readonly string[] = [
  corePackage,
  dbPackage,
  toolsPackage,
  agentsPackage,
  telephonyPackage,
  emailPackage,
  simPackage,
];
