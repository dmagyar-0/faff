export const packageName = "@faff/core";

/** The workspace packages this one may import, per the dependency matrix in CLAUDE.md. */
export const dependsOn: readonly string[] = [];

export * from "./result";
export * from "./primitives";
export * from "./contact";
export * from "./acceptance-rule";
export * from "./brief";
export * from "./outcome";
export * from "./observations";
export * from "./canonical";
export * from "./citation";
export * from "./channel";
export * from "./contact-switch";
export * from "./identity-match";
export * from "./profile-derive";
export * from "./working-days";
export { normalisePractitioner, samePractitioner } from "./practitioner";
