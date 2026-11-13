"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Copy, Database, Globe, HardDrive, Moon, Server, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/store/auth-store";
import { useReaderStore } from "@/store/reader-store";
import { formatBytes } from "@/utils/format";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import type { DashboardDto } from "@/types";

interface HealthInfo {
  status: string;
  provider: string;
  checks: { database: boolean; r2: boolean; r2Bucket: string };
}

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const provider = useAuthStore((s) => s.provider);
  const readerSettings = useReaderStore();
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [dashboard, setDashboard] = useState<DashboardDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [h, d] = await Promise.all([
          api.get<HealthInfo>("/api/health/ready"),
          api.get<DashboardDto>("/api/dashboard"),
        ]);
        if (!cancelled) {
          setHealth(h);
          setDashboard(d);
        }
      } catch {
        // im lang
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Cài đặt</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Tài khoản, giao diện và thông tin hệ thống</p>
      </div>

      {/* Tai khoan */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <User className="h-4.5 w-4.5 text-primary" />
          Tài khoản
        </h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Vai trò</span>
            <span className="font-medium">Quản trị viên (tài khoản duy nhất)</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Nhà cung cấp xác thực</span>
            <span className="font-medium capitalize">
              {provider === "supabase" ? "Supabase Auth" : "Local (JWT)"}
            </span>
          </div>
        </div>
        <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Đổi mật khẩu tại Supabase Dashboard → Authentication → Users (nếu dùng Supabase Auth).
        </p>
      </section>

      {/* Giao dien */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Moon className="h-4.5 w-4.5 text-primary" />
          Giao diện
        </h2>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="theme-toggle">Chế độ tối</Label>
            <p className="text-xs text-muted-foreground">Giao diện mặc định của ứng dụng</p>
          </div>
          <Switch
            id="theme-toggle"
            checked={theme === "dark"}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>
        <Separator className="my-4" />
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>Ẩn thanh công cụ khi đọc</Label>
            <p className="text-xs text-muted-foreground">Tự động ẩn toolbar trong Reader</p>
          </div>
          <Switch
            checked={readerSettings.autoHideToolbar}
            onCheckedChange={(v) => readerSettings.update({ autoHideToolbar: v })}
          />
        </div>
      </section>

      {/* He thong */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Server className="h-4.5 w-4.5 text-primary" />
          Trạng thái hệ thống
        </h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Database className="h-4 w-4" /> Database
            </span>
            <span className={health?.checks.database ? "font-medium text-emerald-500" : "text-muted-foreground"}>
              {health ? (health.checks.database ? "Hoạt động" : "Mất kết nối") : "Đang kiểm tra..."}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="h-4 w-4" /> Cloudflare R2
            </span>
            <span className={health?.checks.r2 ? "font-medium text-emerald-500" : "text-muted-foreground"}>
              {health ? (health.checks.r2 ? `Đã kết nối (${health.checks.r2Bucket})` : "Mất kết nối") : "Đang kiểm tra..."}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Globe className="h-4 w-4" /> Dung lượng đã dùng
            </span>
            <span className="font-medium">
              {dashboard ? formatBytes(dashboard.storageUsedBytes) : "—"}
            </span>
          </div>
        </div>
      </section>

      {/* Thong tin ung dung */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-bold">Về ứng dụng</h2>
        <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Tsundoku</span> — Thư viện truyện tranh cá nhân
          </p>
          <p>Next.js 16 · React 19 · Prisma · Cloudflare R2 · Supabase Auth</p>
          <p className="flex items-center gap-1.5">
            Phiên bản 1.0.0
            <button
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
              onClick={() => {
                void navigator.clipboard.writeText("1.0.0");
                setCopied(true);
                toast.success("Đã copy");
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}
