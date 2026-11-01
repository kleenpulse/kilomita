import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kilomita/shared", "@kilomita/engine"],
  poweredByHeader: false,
};

export default nextConfig;
