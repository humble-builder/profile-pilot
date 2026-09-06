import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactCompiler: false,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${process.env.INTERNAL_API_URL ?? "http://localhost:5000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
