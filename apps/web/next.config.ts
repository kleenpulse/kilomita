import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@kilomita/shared", "@kilomita/engine"],
  // Postgres in WASM (memory mode only): loaded from node_modules at run time, never bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  headers: () => Promise.resolve(securityHeaders({ dev: process.env.NODE_ENV === "development" })),
};

export default nextConfig;
