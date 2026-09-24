import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them (M0 plan §2).
  transpilePackages: ["@faff/core", "@faff/db", "@faff/agents"],
  // `tsc -b` needs the referenced packages' declarations built first; next build reads them as
  // source instead. The CI typecheck job still runs `tsc -b` over tsconfig.json.
  typescript: { tsconfigPath: "tsconfig.next.json" },
};

export default nextConfig;
