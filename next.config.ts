import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "pg", "@prisma/adapter-pg"],
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "rankeyeq.com" }],
        destination: "https://www.rankeyeq.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
