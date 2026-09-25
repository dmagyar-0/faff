import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export TypeScript source (M0 plan §2); Next compiles them. List every
  // @faff/* package web reaches, including transitively (agents imports tools).
  transpilePackages: ["@faff/core", "@faff/db", "@faff/agents", "@faff/tools"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
