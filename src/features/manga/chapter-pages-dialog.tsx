"use client";

import { useState } from "react";
import { ImageUp, Loader2, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/common/states";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useChapter, useDeletePage, useSetCoverFromPage, toastMutationError } from "@/hooks/queries";
import { navigate } from "@/lib/client/hash-router";
import { formatBytes } from "@/utils/format";
import { toast } from "sonner";

interface ChapterPagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mangaId: string;
  chapterId: string | null;
}

export function ChapterPagesDialog({ open, onOpenChange, mangaId, chapterId }: ChapterPagesDialogProps) {
  const { data, isLoading, refetch } = useChapter(chapterId);
  const deletePage = useDeletePage();
  const setCover = useSetCoverFromPage();
  const [deletingPage, setDeletingPage] = useState<string | null>(null);
  const [confirmSetCover, setConfirmSetCover] = useState<string | null>(null);

  const chapter = data?.chapter;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Quản lý trang — Chương {chapter?.chapterNumber ?? "..."}
            {chapter?.title ? `: ${chapter.title}` : ""}
          </DialogTitle>
          <DialogDescription>
            {data ? `${data.pages.length} trang · ${formatBytes(data.pages.reduce((s, p) => s + p.fileSize, 0))}` : "Đang tải..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data && data.pages.length === 0 ? (
          <EmptyState
            icon={ImageUp}
            title="Chưa có trang nào"
            description="Upload ảnh ZIP hoặc thư mục để thêm trang cho chương này."
            action={
              <Button
                className="gap-2"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/upload?manga=${mangaId}&chapter=${chapterId}`);
                }}
              >
                <ImageUp className="h-4 w-4" />
                Upload ngay
              </Button>
            }
            compact
          />
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Di chuột lên trang để xem thao tác — xóa trang hay đặt làm ảnh bìa truyện.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/upload?manga=${mangaId}&chapter=${chapterId}`);
                }}
              >
                <ImageUp className="h-4 w-4" />
                Tải thêm trang
              </Button>
            </div>
            <ScrollArea className="max-h-[55vh] pr-3">
              <div className="grid grid-cols-3 gap-3 py-2 sm:grid-cols-4 md:grid-cols-6">
                {data.pages.map((page) => (
                  <div key={page.id} className="group relative">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted">
                      <img
                        src={page.url}
                        alt={`Trang ${page.pageNumber}`}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white backdrop-blur-sm">
                        {page.pageNumber}
                      </span>
                      {deletingPage === page.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 className="h-5 w-5 animate-spin text-white" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          className="rounded bg-white/15 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                          title="Đặt làm ảnh bìa truyện"
                          aria-label="Đặt làm ảnh bìa"
                          onClick={() => setConfirmSetCover(page.id)}
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded bg-white/15 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-destructive"
                          title="Xóa trang này"
                          aria-label="Xóa trang"
                          onClick={() => setDeletingPage(page.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">
                      {formatBytes(page.fileSize)}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : null}

        <ConfirmDialog
          open={deletingPage !== null}
          onOpenChange={(open) => !open && setDeletingPage(null)}
          title="Xóa trang này?"
          description="Ảnh sẽ bị xóa vĩnh viễn khỏi Cloudflare R2. Thứ tự các trang còn lại được giữ nguyên."
          confirmLabel="Xóa trang"
          destructive
          onConfirm={async () => {
            if (!deletingPage || !chapterId) return;
            try {
              await deletePage.mutateAsync({ chapterId, pageId: deletingPage });
              toast.success("Đã xóa trang.");
              await refetch();
            } catch (err) {
              toastMutationError(err, "Xóa trang thất bại.");
            } finally {
              setDeletingPage(null);
            }
          }}
        />

        <ConfirmDialog
          open={confirmSetCover !== null}
          onOpenChange={(open) => !open && setConfirmSetCover(null)}
          title="Đặt trang này làm ảnh bìa?"
          description="Một bản copy của ảnh sẽ được tạo làm ảnh bìa cho truyện."
          confirmLabel="Đặt làm bìa"
          onConfirm={async () => {
            if (!confirmSetCover) return;
            try {
              await setCover.mutateAsync({ mangaId, pageId: confirmSetCover });
              toast.success("Đã đặt ảnh bìa mới cho truyện.");
            } catch (err) {
              toastMutationError(err, "Đặt ảnh bìa thất bại.");
            } finally {
              setConfirmSetCover(null);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
