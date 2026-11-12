import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cho phep dev server chap nhan cross-origin asset requests tu preview panel
  allowedDevOrigins: ["*.space-z.ai", "*.z.ai"],
  reactStrictMode: false,
};

export default nextConfig;
