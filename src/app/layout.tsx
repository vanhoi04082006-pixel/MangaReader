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
  // Giải quyết URL tuyệt đối cho og:image (override bằng env khi deploy)
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Tsundoku — Thư viện truyện cá nhân",
    template: "%s · Tsundoku",
  },
  description:
    "Tsundoku — Personal Manga Reader. Thư viện truyện tranh cá nhân: nhập truyện hàng loạt từ thư mục, quản lý và đọc truyện mọi lúc mọi nơi.",
  applicationName: "Tsundoku",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // iOS: cho phep "Add to Home Screen" mo duoi dang standalone (khong
    // Safari chrome); black-translucent => noi dung tron man hinh sau
    // status bar (phoi hop viewport-fit=cover + safe-area padding).
    capable: true,
    title: "Tsundoku",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Tsundoku — Personal Manga Reader",
    description:
      "Thư viện truyện tranh cá nhân — nhập truyện hàng loạt từ thư mục, quản lý và đọc truyện mọi lúc mọi nơi.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Tsundoku — Personal Manga Reader" }],
    type: "website",
    siteName: "Tsundoku",
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
    { media: "(prefers-color-scheme: dark)", color: "#150c22" },
    { media: "(prefers-color-scheme: light)", color: "#f7f3fc" },
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
