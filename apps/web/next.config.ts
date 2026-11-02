import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kilomita/shared", "@kilomita/engine"],
  // Postgres in WASM (memory mode only): loaded from node_modules at run time, never bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
};

export default nextConfig;
