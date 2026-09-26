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
export * from "./secrets";
export * from "./locale/en-GB";
export * from "./render/acceptance-rule";
export * from "./render/brief-card";
export { normalisePractitioner, samePractitioner } from "./practitioner";
