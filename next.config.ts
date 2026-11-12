import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cho phep dev server chap nhan cross-origin asset requests tu preview panel
  allowedDevOrigins: ["*.space-z.ai", "*.z.ai"],
  reactStrictMode: false,
  // Baseline security headers cho TAT CA deploy path (Vercel + self-host).
  // frame-ancestors: chan clickjacking cua admin SPA (cac handler destructive
  // chi chong cross-origin, khong chan same-origin tu iframe ben ngoai).
  // Cho phep 'self' + origin cua preview panel (z.ai) de preview khong bi vo.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://*.space-z.ai https://*.z.ai",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
