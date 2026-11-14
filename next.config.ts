import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cho phep dev server chap nhan cross-origin asset requests tu preview panel
  // + localhost/127.0.0.1 cho dev local (Next 16 chan mac dinh -> hydration
  // bi tre vinh viec khi truy cap qua 127.0.0.1: font/HMR payload bi block)
  allowedDevOrigins: ["*.space-z.ai", "*.z.ai", "127.0.0.1", "localhost"],
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
      {
        // Service worker: KHONG duoc cache boi HTTP cache (browser phai luon
        // fetch ban moi nhat); Service-Worker-Allowed cho phep scope "/".
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Mot so host phuc .webmanifest voi text/plain -> Chrome tu choi
        // manifest; khai bao MIME dung o day cho ca Vercel lan self-host.
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
