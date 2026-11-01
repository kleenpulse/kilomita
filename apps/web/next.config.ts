import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mita/shared", "@mita/engine"],
  poweredByHeader: false,
};

export default nextConfig;
