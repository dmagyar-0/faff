import type { NextConfig } from "next";

// `pnpm build` runs `tsc -b` first: Next's type check follows apps/web's project references and
// needs the referenced packages' declarations in .tsbuild/, which a clean clone doesn't have.
const config: NextConfig = {
  // Workspace packages export TypeScript source (M0 plan §2); Next compiles them. List every
  // @faff/* package web reaches, including transitively (agents imports tools).
  transpilePackages: ["@faff/core", "@faff/db", "@faff/agents", "@faff/tools"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
