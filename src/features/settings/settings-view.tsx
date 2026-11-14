"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Check, Copy, Database, Globe, HardDrive, Moon, Search, Server, Tag, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/store/auth-store";
import { useReaderStore } from "@/store/reader-store";
import { useGenres, toastMutationError } from "@/hooks/queries";
import { formatBytes, formatNumber } from "@/utils/format";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/client/api";
import type { DashboardDto, GenreDto } from "@/types";

interface HealthInfo {
  status: string;
  provider: string;
  checks: { database: boolean; r2: boolean; r2Bucket: string };
}

function GenreManagement() {
  const { data, isLoading } = useGenres();
  const genres = data?.genres ?? [];
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<GenreDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return genres;
    return genres.filter((g) => g.name.toLowerCase().includes(q));
  }, [genres, filter]);

  const unusedCount = useMemo(() => genres.filter((g) => g.mangaCount === 0).length, [genres]);

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/genres/${pendingDelete.id}`);
      toast.success(`Đã xóa thể loại "${pendingDelete.name}".`);
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["genres"] });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "genre_in_use") {
        toast.error(err.message);
        await queryClient.invalidateQueries({ queryKey: ["genres"] });
      } else {
        toastMutationError(err, "Xóa thể loại thất bại.");
      }
      throw err;
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5" aria-label="Quản lý thể loại">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold">
            <Tag className="h-4.5 w-4.5 text-primary" />
            Thể loại
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatNumber(genres.length)} thể loại · {formatNumber(unusedCount)} chưa được dùng (xóa được)
          </p>
        </div>
        <img
          src="/mascots/tag.png"
          alt=""
          aria-hidden
          className="mascot-float pointer-events-none hidden h-16 w-16 select-none rounded-xl drop-shadow-[0_8px_24px_color-mix(in_oklch,var(--primary)_35%,transparent)] sm:block"
        />
        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Tìm thể loại..."
            className="pl-8"
            aria-label="Tìm thể loại"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="scrollbar-thin mt-4 max-h-72 divide-y overflow-y-auto rounded-lg border bg-background/50">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Không có thể loại khớp.</li>
          )}
          {filtered.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-sm">{g.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                {g.mangaCount > 0 ? (
                  <Badge variant="secondary" className="tabular-nums">{formatNumber(g.mangaCount)} truyện</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Chưa dùng</Badge>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={g.mangaCount > 0 ? `Không thể xóa (đang được ${g.mangaCount} truyện dùng)` : `Xóa thể loại ${g.name}`}
                  title={g.mangaCount > 0 ? `Không thể xóa — đang được ${g.mangaCount} truyện sử dụng` : "Xóa thể loại này"}
                  disabled={g.mangaCount > 0 || deleting}
                  onClick={() => setPendingDelete(g)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Chỉ xóa được thể loại <em>chưa có truyện sử dụng</em> — thể loại đang dùng sẽ bị chặn kèm cảnh báo.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={`Xóa thể loại "${pendingDelete?.name ?? ""}"?`
        }
        description={`Thể loại này chưa được truyện nào sử dụng nên xóa an toàn. Danh mục mặc định sẽ không tự tạo lại (chỉ seed lần đầu).`}
        confirmLabel="Xóa thể loại"
        destructive
        onConfirm={doDelete}
      />
    </section>
  );
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
      </section>

      {/* Quan ly the loai */}
      <GenreManagement />

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
