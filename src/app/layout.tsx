import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "MangaReader — Thư viện truyện cá nhân",
    template: "%s · MangaReader",
  },
  description:
    "Thư viện truyện tranh cá nhân với Cloudflare R2 — upload, quản lý và đọc truyện mọi lúc mọi nơi.",
  applicationName: "MangaReader",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // iOS: cho phep "Add to Home Screen" mo duoi dang standalone (khong
    // Safari chrome); black-translucent => noi dung tron man hinh sau
    // status bar (phoi hop viewport-fit=cover + safe-area padding).
    capable: true,
    title: "MangaReader",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover bat buoc cho standalone iOS full-bleed; cac phan
  // tu sticky/fixed duoc dan padding safe-area (env(safe-area-inset-*))
  // de khong bi noi dung chim vao notch/home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#18120f" },
    { media: "(prefers-color-scheme: light)", color: "#faf8f6" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
