"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  HardDrive,
  Heart,
  History,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { useHashRoute, navigate } from "@/lib/client/hash-router";
import { useAuthStore } from "@/store/auth-store";
import { api } from "@/lib/client/api";
import type { DashboardDto } from "@/types";
import { formatBytes } from "@/utils/format";
import { cn } from "@/lib/utils";

// Mục nav chính — dùng cho sidebar (desktop) + bottom nav (mobile).
// shortLabel: rút gọn cho bottom nav trên màn hẹp (tránh chữ bị wrap 2 dòng)
const NAV_ITEMS = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard, match: (seg: string) => seg === "" },
  { href: "/library", label: "Thư viện", icon: LibraryBig, match: (seg: string) => seg === "library" },
  { href: "/favorites", label: "Yêu thích", icon: Heart, match: (seg: string) => seg === "favorites" },
  { href: "/history", label: "Lịch sử", icon: History, match: (seg: string) => seg === "history" },
  { href: "/upload", label: "Thêm truyện", shortLabel: "Thêm", icon: Plus, match: (seg: string) => seg === "upload" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const route = useHashRoute();
  const activeSeg = route.segments[0] ?? "";

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Điều hướng chính">
      {NAV_ITEMS.map((item) => {
        const active = item.match(activeSeg);
        return (
          // <a> thuan (KHONG phai next/link): anchor href="#/..." la dieu
          // huong mac dinh cua browser -> fire "hashchange" ngay lap tuc.
          // Next <Link> chi goi history.pushState va khong fire event nao,
          // lam UI khong chuyen tab (phai F5).
          <a
            key={item.href}
            href={`#${item.href}`}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId="sidebar-active-pill"
                className="absolute inset-0 rounded-lg bg-sidebar-accent"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <item.icon className={cn("relative z-10 h-4.5 w-4.5", active && "text-primary")} />
            <span className="relative z-10">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function StorageMini() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardDto>("/api/dashboard"),
    staleTime: 60_000,
  });
  if (!data) return null;
  const percent = data.storageQuotaBytes > 0 ? data.storageUsedBytes / data.storageQuotaBytes : 0;
  return (
    <a
      href="#/storage"
      className="mx-3 mb-2 block rounded-lg border border-sidebar-border bg-background/40 p-3 transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Dung lượng R2</span>
        <span className="font-mono font-semibold tabular-nums">
          {formatBytes(data.storageUsedBytes)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent >= 0.95 ? "bg-destructive" : percent >= 0.8 ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${Math.max(percent * 100, 1.5)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        trên {formatBytes(data.storageQuotaBytes, { decimals: 0 })}
      </p>
    </a>
  );
}

function UserCard({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold uppercase text-primary">
          {user?.email?.charAt(0) ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.email}</p>
          <p className="text-xs text-muted-foreground">Quản trị viên</p>
        </div>
        <button
          onClick={() => {
            onNavigate?.();
            void logout();
            navigate("/");
          }}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Đăng xuất"
          aria-label="Đăng xuất"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SidebarContent() {
  const activeSeg = useHashRoute().segments[0] ?? "";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img
          src="/mascots/badge.png"
          alt="Tsundoku — Personal Manga Reader"
          className="h-9 w-9 rounded-xl shadow-[0_0_18px_-4px_color-mix(in_oklch,var(--primary)_60%,transparent)]"
        />
        <div>
          <p className="text-base font-extrabold leading-tight tracking-tight">
            Tsundoku
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[oklch(0.71_0.25_345)] align-middle shadow-[0_0_8px_oklch(0.71_0.25_345)]" />
          </p>
          <p className="text-[11px] text-muted-foreground">Personal Manga Reader</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <NavList />
        <div className="mt-6">
          <p className="px-6 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Hệ thống
          </p>
          <nav className="flex flex-col gap-1 px-3">
            <a
              href="#/storage"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                activeSeg === "storage" && "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              <HardDrive className="h-4.5 w-4.5" />
              Lưu trữ
            </a>
            <a
              href="#/settings"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                activeSeg === "settings" && "bg-sidebar-accent text-sidebar-accent-foreground"
              )}
            >
              <Settings className="h-4.5 w-4.5" />
              Cài đặt
            </a>
          </nav>
        </div>
        <div className="mt-6">
          <StorageMini />
        </div>
      </div>
      <UserCard />
    </div>
  );
}

/** Thanh tab dưới cùng cho điện thoại (thay cho drawer menu) */
function BottomNav() {
  const route = useHashRoute();
  const activeSeg = route.segments[0] ?? "";

  return (
    <nav
      aria-label="Điều hướng di động"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const active = item.match(activeSeg);
          return (
            <a
              key={item.href}
              href={`#${item.href}`}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className="press-feedback relative flex min-w-14 flex-1 flex-col items-center gap-0.5 px-1 pb-1.5 pt-2.5 text-[11px] font-medium transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="bottomnav-active"
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <item.icon
                className={cn(
                  "h-5 w-5 transition-transform",
                  active ? "scale-110 text-primary" : "text-muted-foreground"
                )}
              />
              <span className={cn(active ? "text-primary" : "text-muted-foreground")}>
                {item.shortLabel ?? item.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-aurora">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
        <SidebarContent />
      </aside>

      <div className="flex min-h-screen flex-col md:pl-60">
        <Header />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 sm:px-4 md:px-8 md:pb-10 md:pt-6">
          {children}
        </main>
      </div>

      {/* Thanh tab dưới cùng cho điện thoại */}
      <BottomNav />
    </div>
  );
}
