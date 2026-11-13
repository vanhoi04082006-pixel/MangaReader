"use client";

import { motion } from "framer-motion";
import { Heart, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CoverImage } from "@/components/manga/cover-image";
import { navigate } from "@/lib/client/hash-router";
import type { MangaSummaryDto } from "@/types";
import type { MangaStatus } from "@/schemas";
import { cn } from "@/lib/utils";

export const STATUS_LABELS: Record<MangaStatus, string> = {
  ONGOING: "Đang ra",
  COMPLETED: "Hoàn thành",
  HIATUS: "Tạm dừng",
  DROPPED: "Ngừng làm",
};

const STATUS_STYLES: Record<MangaStatus, string> = {
  ONGOING: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
  COMPLETED: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  HIATUS: "bg-amber-500/15 text-amber-500 border-amber-500/20",
  DROPPED: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

export function MangaCard({ manga, index = 0 }: { manga: MangaSummaryDto; index?: number }) {
  const progressPercent =
    manga.progress && manga.progress.pageCount > 0
      ? Math.min(100, (manga.progress.pageNumber / manga.progress.pageCount) * 100)
      : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.035, 0.4), ease: "easeOut" }}
      className="group cursor-pointer"
      onClick={() => navigate(`/manga/${manga.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/manga/${manga.id}`);
      }}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border bg-muted shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-primary/5 group-hover:ring-1 group-hover:ring-primary/30">
        <CoverImage src={manga.coverUrl} alt={`Bìa truyện ${manga.title}`} />

        {/* Overlay gradient khi hover (chỉ desktop) */}
        <div className="absolute inset-0 hidden bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 md:block" />

        {/* The yeu thich */}
        {manga.isFavorite && (
          <div className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5 fill-primary text-primary" />
          </div>
        )}

        {/* Badge trang thai */}
        <div className="absolute left-2 top-2">
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-md",
              STATUS_STYLES[manga.status]
            )}
          >
            {STATUS_LABELS[manga.status]}
          </span>
        </div>

        {/* Số chương — luôn hiện ở mobile (không có hover), translate khi hover ở desktop */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 opacity-100 md:translate-y-2 md:opacity-0 md:transition-all md:duration-300 md:group-hover:translate-y-0 md:group-hover:opacity-100">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/90">
            <Layers className="h-3.5 w-3.5" />
            {manga.chapterCount} chương
            <span className="opacity-60">·</span>
            {manga.pageCount.toLocaleString("vi-VN")} trang
          </div>
        </div>

        {/* Progress bar doc */}
        {progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPercent}%` }}
              title={`Đã đọc đến trang ${manga.progress?.pageNumber}/${manga.progress?.pageCount} chương ${manga.progress?.chapterNumber}`}
            />
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
          {manga.title}
        </h3>
        <p className="truncate text-xs text-muted-foreground">
          {manga.author ?? "Chưa rõ tác giả"}
        </p>
      </div>
    </motion.div>
  );
}

export function MangaGrid({ mangas }: { mangas: MangaSummaryDto[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 min-[420px]:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {mangas.map((m, i) => (
        <MangaCard key={m.id} manga={m} index={i} />
      ))}
    </div>
  );
}

export function MangaListRow({ manga, index = 0 }: { manga: MangaSummaryDto; index?: number }) {
  const progressPercent =
    manga.progress && manga.progress.pageCount > 0
      ? Math.min(100, (manga.progress.pageNumber / manga.progress.pageCount) * 100)
      : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
      onClick={() => navigate(`/manga/${manga.id}`)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-accent/40 sm:gap-4"
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/manga/${manga.id}`);
      }}
    >
      <div className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
        <CoverImage src={manga.coverUrl} alt={`Bìa ${manga.title}`} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold group-hover:text-primary">{manga.title}</h3>
          {manga.isFavorite && <Heart className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{manga.author ?? "Chưa rõ tác giả"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:gap-3">
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {STATUS_LABELS[manga.status]}
          </Badge>
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {manga.chapterCount} chương
          </span>
        </div>
      </div>

      <div className="hidden w-32 shrink-0 sm:block">
        {progressPercent > 0 ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="text-right text-[10px] text-muted-foreground">
              Ch. {manga.progress?.chapterNumber}
            </p>
          </div>
        ) : (
          <p className="text-right text-[11px] text-muted-foreground">Chưa đọc</p>
        )}
      </div>
    </motion.div>
  );
}
