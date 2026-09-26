// Bundles the worker into one ESM file for the image (M0 plan §2: no per-package build; the
// only artefacts are the web build and this bundle). Workspace packages are TypeScript source,
// so esbuild compiles them along the way.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  // pg loads its optional native binding lazily; we don't use it.
  external: ["pg-native"],
  // Bundled CommonJS dependencies call require() for Node built-ins, which ESM lacks.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
