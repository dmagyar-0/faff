/**
 * The workspace dependency matrix (spec 01 "Repo layout", M0 plan §3). This file is the source
 * of truth: loosening an edge means editing MATRIX in a PR, where review can see it.
 *
 * pnpm's strict node_modules is the first layer (an undeclared package doesn't resolve); these
 * rules are the second (a declared-but-forbidden edge, or a relative import across packages,
 * still fails).
 */

/** Workspace directory → the workspace directories it may import. `null` = unrestricted. */
const MATRIX = {
  "packages/core": [],
  "packages/db": ["packages/core"],
  "packages/tools": ["packages/core", "packages/db"],
  // Never packages/db: agents reach data only through tools (spec 01, D3, I-7).
  "packages/agents": ["packages/core", "packages/tools"],
  "packages/telephony": ["packages/core", "packages/sim"],
  "packages/email": ["packages/core"],
  "packages/sim": ["packages/core"],
  evals: null,
  "apps/web": ["packages/core", "packages/db", "packages/agents"],
  "apps/worker": [
    "packages/core",
    "packages/db",
    "packages/tools",
    "packages/agents",
    "packages/telephony",
    "packages/email",
    "packages/sim",
  ],
};

/** The only third-party packages packages/core may use at runtime (M1 plan §2). */
const CORE_RUNTIME_ALLOWLIST = ["zod", "temporal-polyfill", "@noble/hashes", "canonicalize"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const WORKSPACE = "^(packages/[^/]+|apps/[^/]+|evals)/";

const matrixRules = Object.entries(MATRIX)
  .filter(([, allowed]) => allowed !== null)
  .map(([from, allowed]) => ({
    name: `matrix:${from}`,
    severity: "error",
    comment: `${from} may import only: ${allowed.length ? allowed.join(", ") : "no workspace package"}.`,
    from: { path: `^${esc(from)}/` },
    to: {
      path: WORKSPACE,
      pathNot: `^(${[from, ...allowed].map(esc).join("|")})/`,
    },
  }));

module.exports = {
  forbidden: [
    ...matrixRules,
    {
      name: "core-runtime-allowlist",
      severity: "error",
      comment: `packages/core may use only ${CORE_RUNTIME_ALLOWLIST.join(", ")} at runtime (tests excepted).`,
      from: { path: "^packages/core/src/", pathNot: "\\.test\\.ts$" },
      to: {
        dependencyTypesNot: ["local"],
        pathNot: `node_modules/(${CORE_RUNTIME_ALLOWLIST.map(esc).join("|")})/`,
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "An import that doesn't resolve. For @faff/* this usually means the package isn't in " +
        "package.json, which is how pnpm enforces the matrix.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Anchored to workspace dirs: an unanchored `dist/` would also hide node_modules/*/dist/*.
    exclude: { path: `${WORKSPACE}(\\.tsbuild|coverage|dist|\\.next)/` },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
  },
};
