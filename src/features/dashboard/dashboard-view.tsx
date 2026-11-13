"use client";

import { BookOpen, Clock, FileImage, HardDrive, LibraryBig, Plus, Upload, Link as LinkIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, QuotaBar } from "@/components/common/stat-card";
import { EmptyState, ErrorState } from "@/components/common/states";
import { CoverImage } from "@/components/manga/cover-image";
import { MangaGrid } from "@/components/manga/manga-card";
import { useDashboard } from "@/hooks/queries";
import { navigate } from "@/lib/client/hash-router";
import { useAuthStore } from "@/store/auth-store";
import { formatBytes, formatNumber, formatRelativeTime } from "@/utils/format";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Chào buổi sáng";
  if (h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function ContinueReading() {
  const { data } = useDashboard();
  if (!data || data.continueReading.length === 0) return null;

  return (
    <section aria-label="Tiếp tục đọc">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Clock className="h-5 w-5 text-primary" />
          Tiếp tục đọc
        </h2>
      </div>
      <div className="scrollbar-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-3 sm:gap-4">
        {data.continueReading.map((item, i) => (
          <motion.button
            key={item.mangaId}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ y: -3 }}
            className="group flex w-44 shrink-0 flex-col gap-2.5 rounded-xl border bg-card p-3 text-left transition-shadow hover:shadow-lg sm:w-56"
            onClick={() => navigate(`/reader/${item.mangaId}/${item.chapterId}`)}
          >
            <div className="relative h-24 w-full overflow-hidden rounded-lg bg-muted sm:h-28">
              <CoverImage
                src={item.coverUrl}
                alt={`Bìa ${item.mangaTitle}`}
                lqip={item.coverLqip}
                color={item.coverColor}
                eager={i < 4}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute inset-x-2 bottom-2">
                <p className="line-clamp-2 text-xs font-semibold text-white">{item.mangaTitle}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Chương {item.chapterNumber}
                {item.chapterTitle ? ` — ${item.chapterTitle}` : ""}
              </p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-primary">
                  Trang {item.pageNumber}/{item.pageCount}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(item.updatedAt)}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (item.pageNumber / Math.max(1, item.pageCount)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

export function DashboardView() {
  const { data, isLoading, error, refetch } = useDashboard();
  const user = useAuthStore((s) => s.user);
  const name = user?.email?.split("@")[0] ?? "";

  if (error) {
    return (
      <ErrorState
        message="Không tải được dữ liệu tổng quan. Kiểm tra kết nối rồi thử lại."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-glow">
            {greeting()}
            {name ? <span className="text-primary"> {name}</span> : <span className="text-primary">!</span>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Tổng quan thư viện truyện của bạn</p>
        </div>
        <div className="flex items-center gap-3">
          <img
            src="/mascots/back.png"
            alt=""
            aria-hidden
            className="hidden h-16 w-auto select-none lg:block"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/library")}>
              <LibraryBig className="h-4 w-4" />
              Thư viện
            </Button>
            <Button size="sm" className="gap-2 glow-primary" onClick={() => navigate("/upload")}>
              <Plus className="h-4 w-4" />
              Thêm truyện
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              icon={BookOpen}
              label="Truyện"
              value={formatNumber(data.mangaCount)}
              sub={`${formatNumber(data.favoriteCount)} yêu thích · ${formatNumber(data.genreCount)} thể loại`}
            />
            <StatCard
              icon={LibraryBig}
              label="Chương"
              value={formatNumber(data.chapterCount)}
              accent="violet"
            />
            <StatCard
              icon={FileImage}
              label="Trang truyện"
              value={formatNumber(data.pageCount)}
              accent="emerald"
            />
            <StatCard
              icon={HardDrive}
              label="Dung lượng R2"
              value={formatBytes(data.storageUsedBytes)}
              sub={`Hạn mức ${formatBytes(data.storageQuotaBytes, { decimals: 0 })}`}
              accent="amber"
            />
          </div>

          {/* Lớp bọc là link sang trang Lưu trữ (mobile không có sidebar
              nên cần lối vào từ dashboard) */}
          <a href="#/storage" className="block rounded-xl border bg-card p-5 transition-colors hover:border-primary/40">
            <QuotaBar usedBytes={data.storageUsedBytes} quotaBytes={data.storageQuotaBytes} />
          </a>

          <ContinueReading />

          <section aria-label="Truyện mới thêm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <BookOpen className="h-5 w-5 text-primary" />
                Truyện mới thêm
              </h2>
              {data.recentlyAdded.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => navigate("/library?sort=createdAt&order=desc")}
                >
                  Xem tất cả <LinkIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {data.recentlyAdded.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="Thư viện đang trống"
                description="Thêm nhiều truyện cùng lúc chỉ bằng một thư mục — mỗi thư mục con là một bộ truyện."
                action={
                  <Button className="gap-2" onClick={() => navigate("/upload")}>
                    <Plus className="h-4 w-4" />
                    Thêm truyện đầu tiên
                  </Button>
                }
              />
            ) : (
              <MangaGrid mangas={data.recentlyAdded} />
            )}
          </section>

          <section aria-label="Upload gần đây">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold tracking-tight">
              <Upload className="h-5 w-5 text-primary" />
              Hoạt động upload gần đây
            </h2>
            {data.recentUploads.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Chưa có hoạt động upload nào.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {data.recentUploads.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileImage className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.mangaTitle ?? "—"} · Chương {u.chapterNumber ?? "—"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.fileName}</p>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatBytes(u.fileSize)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {formatRelativeTime(u.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
