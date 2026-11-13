"use client";

import { useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, History as HistoryIcon, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/common/states";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CoverImage } from "@/components/manga/cover-image";
import { useHistory, useDeleteHistory, toastMutationError } from "@/hooks/queries";
import { navigate, queryInt, updateRouteQuery, useHashRoute } from "@/lib/client/hash-router";
import { formatRelativeTime } from "@/utils/format";
import { toast } from "sonner";

export function HistoryView() {
  const route = useHashRoute();
  const page = queryInt(route.query, "page", 1);
  const { data, isLoading, isError, error, refetch } = useHistory(page);
  const deleteHistory = useDeleteHistory();
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmManga, setConfirmManga] = useState<string | null>(null);

  const setPage = (p: number) =>
    navigate(`/history${updateRouteQuery(route.query, { page: String(p) })}`, { replace: true });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Lịch sử đọc</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.total.toLocaleString("vi-VN")} chương đã đọc` : "Đang tải..."}
          </p>
        </div>
        {data && data.items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-destructive hover:text-destructive"
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 className="h-4 w-4" />
            Xóa tất cả
          </Button>
        )}
      </div>

      {isError ? (
        <ErrorState
          message={(error as Error)?.message ?? "Không tải được lịch sử."}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Chưa có lịch sử đọc"
          description="Mở bất kỳ chương nào để bắt đầu — vị trí đọc sẽ được tự động lưu."
          action={
            <Button className="gap-2" onClick={() => navigate("/library")}>
              <BookOpen className="h-4 w-4" />
              Đến thư viện
            </Button>
          }
        />
      ) : data ? (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {data.items.map((h) => (
              <li key={h.id} className="group flex items-center gap-3 p-3 sm:gap-4">
                <button
                  className="h-16 w-11 shrink-0 overflow-hidden rounded-md border bg-muted"
                  onClick={() => navigate(`/manga/${h.mangaId}`)}
                  aria-label={`Xem ${h.mangaTitle}`}
                >
                  <CoverImage src={h.coverUrl} alt={`Bìa ${h.mangaTitle}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    className="block max-w-full truncate text-left text-sm font-semibold hover:text-primary"
                    onClick={() => navigate(`/manga/${h.mangaId}`)}
                  >
                    {h.mangaTitle}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    Chương {h.chapterNumber}
                    {h.chapterTitle ? ` — ${h.chapterTitle}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Đến trang {h.pageNumber}/{h.pageCount} · {formatRelativeTime(h.readAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 sm:px-3"
                    onClick={() => navigate(`/reader/${h.mangaId}/${h.chapterId}?page=${h.pageNumber}`)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Đọc tiếp</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmManga(h.mangaId)}
                    aria-label="Xóa lịch sử truyện này"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 font-mono text-sm tabular-nums text-muted-foreground">
                {page} / {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmClearAll}
        onOpenChange={setConfirmClearAll}
        title="Xóa toàn bộ lịch sử đọc?"
        description="Tiến độ đọc hiện tại của các truyện (tiếp tục đọc) sẽ được giữ lại, chỉ xóa danh sách lịch sử."
        confirmLabel="Xóa tất cả"
        destructive
        onConfirm={async () => {
          try {
            await deleteHistory.mutateAsync(null);
            toast.success("Đã xóa toàn bộ lịch sử đọc.");
          } catch (err) {
            toastMutationError(err, "Xóa lịch sử thất bại.");
          }
        }}
      />

      <ConfirmDialog
        open={confirmManga !== null}
        onOpenChange={(open) => !open && setConfirmManga(null)}
        title="Xóa lịch sử của truyện này?"
        description="Các chương đã đọc của truyện này sẽ bị xóa khỏi lịch sử."
        confirmLabel="Xóa"
        destructive
        onConfirm={async () => {
          if (!confirmManga) return;
          try {
            await deleteHistory.mutateAsync(confirmManga);
            toast.success("Đã xóa lịch sử của truyện.");
          } catch (err) {
            toastMutationError(err, "Xóa lịch sử thất bại.");
          } finally {
            setConfirmManga(null);
          }
        }}
      />
    </div>
  );
}
