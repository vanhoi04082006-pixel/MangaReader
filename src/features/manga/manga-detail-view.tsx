"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Heart,
  ImageUp,
  Layers,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Pagination } from "@/components/common/pagination";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CoverImage } from "@/components/manga/cover-image";
import { STATUS_LABELS } from "@/components/manga/manga-card";
import { MangaFormDialog } from "@/features/manga/manga-form-dialog";
import { ChapterFormDialog } from "@/features/manga/chapter-form-dialog";
import { ChapterPagesDialog } from "@/features/manga/chapter-pages-dialog";
import {
  useManga,
  useChapters,
  useDeleteManga,
  useDeleteChapter,
  useToggleFavorite,
  toastMutationError,
} from "@/hooks/queries";
import { navigate } from "@/lib/client/hash-router";
import type { ChapterDto } from "@/types";
import { formatBytes, formatDate, formatRelativeTime } from "@/utils/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function MangaDetailView({ mangaId }: { mangaId: string }) {
  const { data: manga, isLoading, isError, error, refetch } = useManga(mangaId);
  const [chapterSort, setChapterSort] = useState<"asc" | "desc">("desc");
  const [chapterPage, setChapterPage] = useState(1);
  const { data: chaptersData, isLoading: chaptersLoading } = useChapters(
    mangaId,
    chapterSort,
    chapterPage,
    50
  );

  const [editOpen, setEditOpen] = useState(false);
  const [chapterFormOpen, setChapterFormOpen] = useState(false);
  const [editingChapter, setEditingChapter] = useState<ChapterDto | null>(null);
  const [pagesDialogChapter, setPagesDialogChapter] = useState<string | null>(null);
  const [confirmDeleteManga, setConfirmDeleteManga] = useState(false);
  const [deletingChapter, setDeletingChapter] = useState<ChapterDto | null>(null);

  const toggleFavorite = useToggleFavorite();
  const deleteManga = useDeleteManga();
  const deleteChapter = useDeleteChapter();

  // Chương đầu tiên THẬT SỰ (số nhỏ nhất natural order) — dùng cho
  // "Đọc từ đầu". Query riêng sort asc, pageSize 1 nên luôn đúng chương 1
  // kể cả khi danh sách đang hiển thị desc hay ở trang bất kỳ (>50 chương).
  const { data: firstChapterData } = useChapters(mangaId, "asc", 1, 1);
  const firstChapter = firstChapterData?.items[0] ?? null;

  if (isError) {
    return (
      <ErrorState
        title="Không tải được truyện"
        message={(error as Error)?.message ?? "Truyện có thể đã bị xóa."}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading || !manga) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-6 md:flex-row">
          <Skeleton className="mx-auto h-72 w-48 rounded-xl md:mx-0 md:h-96 md:w-64" />
          <div className="flex-1 space-y-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20" />
              ))}
            </div>
            <Skeleton className="h-24 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const continueChapter = manga.progress?.chapterId;

  return (
    <div className="space-y-8">
      {/* Khu vuc dau: bia + thong tin */}
      <div className="relative">
        {/* Background blur tu bia */}
        {manga.coverUrl && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-80 overflow-hidden rounded-b-3xl opacity-25 blur-2xl saturate-150"
          >
            <img src={manga.coverUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
          </div>
        )}

        <div className="relative flex flex-col gap-6 md:flex-row">
          <div className="mx-auto w-44 shrink-0 sm:w-52 md:mx-0 md:w-64">
            <div className="relative aspect-[2/3] overflow-hidden rounded-xl border shadow-2xl">
              <CoverImage src={manga.coverUrl} alt={`Bìa ${manga.title}`} />
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
                {manga.title}
              </h1>
              {manga.alternativeTitles && (
                <p className="mt-1 text-sm text-muted-foreground">{manga.alternativeTitles}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {manga.author && (
                <span>
                  Tác giả: <span className="font-medium text-foreground">{manga.author}</span>
                </span>
              )}
              {manga.artist && (
                <span>
                  Họa sĩ: <span className="font-medium text-foreground">{manga.artist}</span>
                </span>
              )}
              {manga.publicationYear && <span>Năm {manga.publicationYear}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/20">
                {STATUS_LABELS[manga.status]}
              </Badge>
              {manga.genres.map((g) => (
                <Badge key={g} variant="secondary" className="font-normal">
                  {g}
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                {manga.chapterCount} chương
              </span>
              <span className="flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                {manga.pageCount.toLocaleString("vi-VN")} trang
              </span>
              <span>{formatBytes(manga.sizeBytes)}</span>
              <span>Cập nhật {formatRelativeTime(manga.updatedAt)}</span>
            </div>

            {/* Nut hanh dong */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {manga.chapterCount > 0 ? (
                <Button
                  className="gap-2 font-semibold"
                  onClick={() =>
                    continueChapter
                      ? navigate(`/reader/${manga.id}/${continueChapter}`)
                      : firstChapter
                        ? navigate(`/reader/${manga.id}/${firstChapter.id}`)
                        : undefined
                  }
                >
                  <Play className="h-4 w-4" />
                  {continueChapter ? "Đọc tiếp" : "Đọc từ đầu"}
                </Button>
              ) : (
                <Button className="gap-2 font-semibold" onClick={() => navigate(`/upload?manga=${manga.id}`)}>
                  <Upload className="h-4 w-4" />
                  Upload chương
                </Button>
              )}

              {firstChapter && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => navigate(`/reader/${manga.id}/${firstChapter.id}`)}
                >
                  Đọc từ đầu
                </Button>
              )}

              <Button
                variant={manga.isFavorite ? "default" : "outline"}
                className={cn("gap-2", manga.isFavorite && "font-semibold")}
                onClick={() => toggleFavorite.mutate(manga.id)}
                aria-pressed={manga.isFavorite}
                aria-label="Yêu thích"
              >
                <Heart className={cn("h-4 w-4", manga.isFavorite && "fill-current")} />
                <span className="hidden sm:inline">
                  {manga.isFavorite ? "Đã yêu thích" : "Yêu thích"}
                </span>
              </Button>

              <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)} aria-label="Sửa thông tin truyện">
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Sửa</span>
              </Button>

              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteManga(true)}
                aria-label="Xóa truyện"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Xóa</span>
              </Button>
            </div>

            {manga.progress && (
              <div className="rounded-lg border bg-card/60 px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Đang đọc chương{" "}
                    <span className="font-semibold text-foreground">{manga.progress.chapterNumber}</span>
                  </span>
                  <span className="font-mono text-primary">
                    {manga.progress.pageNumber}/{manga.progress.pageCount}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, (manga.progress.pageNumber / Math.max(1, manga.progress.pageCount)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {formatRelativeTime(manga.progress.updatedAt)}
                </p>
              </div>
            )}

            {manga.description && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {manga.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Danh sach chuong */}
      <section aria-label="Danh sách chương">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold tracking-tight">
            Chương{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({chaptersData?.total ?? 0})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setChapterSort((s) => (s === "asc" ? "desc" : "asc"))}
              aria-label={chapterSort === "asc" ? "Đang xếp tăng dần" : "Đang xếp giảm dần"}
            >
              {chapterSort === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="hidden sm:inline">{chapterSort === "asc" ? "Tăng dần" : "Giảm dần"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(`/upload?manga=${manga.id}`)}
            >
              <ImageUp className="h-4 w-4" />
              <span className="hidden sm:inline">Upload trang</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setChapterFormOpen(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Thêm chương</span>
            </Button>
          </div>
        </div>

        {chaptersLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : chaptersData && chaptersData.items.length > 0 ? (
          <>
            <ul className="divide-y rounded-xl border bg-card">
              {chaptersData.items.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 px-3 py-3 transition-colors hover:bg-accent/40 sm:gap-3 sm:px-4">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => c.pageCount > 0 && navigate(`/reader/${manga.id}/${c.id}`)}
                    disabled={c.pageCount === 0}
                  >
                    <span className="w-12 shrink-0 text-left font-mono text-sm font-bold tabular-nums text-primary sm:w-14">
                      {c.chapterNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title ?? `Chương ${c.chapterNumber}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.pageCount > 0 ? (
                          <>
                            {c.pageCount} trang · {formatBytes(c.sizeBytes)} · {formatDate(c.createdAt)}
                          </>
                        ) : (
                          <span className="text-amber-500">Chưa có trang — cần upload ảnh</span>
                        )}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => setPagesDialogChapter(c.id)}
                      aria-label="Quản lý trang"
                      title="Quản lý trang"
                    >
                      <Layers className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          aria-label="Thao tác"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/upload?manga=${manga.id}&chapter=${c.id}`)}>
                          <Upload className="h-4 w-4" />
                          Upload thêm / thay trang
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingChapter(c);
                            setChapterFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                          Sửa chương
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingChapter(c)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Xóa chương
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>

            {chaptersData.totalPages > 1 && (
              <Pagination
                page={chapterPage}
                totalPages={chaptersData.totalPages}
                onChange={setChapterPage}
              />
            )}
          </>
        ) : (
          <EmptyState
            mascot="book"
            title="Chưa có chương nào"
            description="Dùng tính năng nhập từ thư mục để thêm toàn bộ chương cùng lúc."
            action={
              <Button className="gap-2" onClick={() => setChapterFormOpen(true)}>
                <Plus className="h-4 w-4" />
                Thêm chương đầu tiên
              </Button>
            }
          />
        )}
      </section>

      {/* Dialogs */}
      <MangaFormDialog open={editOpen} onOpenChange={setEditOpen} editing={manga} />
      <ChapterFormDialog
        open={chapterFormOpen}
        onOpenChange={setChapterFormOpen}
        mangaId={mangaId}
        editing={editingChapter}
      />
      <ChapterPagesDialog
        open={pagesDialogChapter !== null}
        onOpenChange={(open) => !open && setPagesDialogChapter(null)}
        mangaId={mangaId}
        chapterId={pagesDialogChapter}
      />

      <ConfirmDialog
        open={confirmDeleteManga}
        onOpenChange={setConfirmDeleteManga}
        title={`Xóa truyện "${manga.title}"?`}
        description={`Toàn bộ ${manga.chapterCount} chương, ${manga.pageCount.toLocaleString("vi-VN")} trang và ${formatBytes(manga.sizeBytes)} ảnh trên Cloudflare R2 sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`}
        confirmLabel="Xóa vĩnh viễn"
        destructive
        onConfirm={async () => {
          try {
            await deleteManga.mutateAsync(manga.id);
            toast.success("Đã xóa truyện và toàn bộ dữ liệu liên quan.");
            navigate("/library");
          } catch (err) {
            toastMutationError(err, "Xóa truyện thất bại.");
          }
        }}
      />

      <ConfirmDialog
        open={deletingChapter !== null}
        onOpenChange={(open) => !open && setDeletingChapter(null)}
        title={`Xóa chương ${deletingChapter?.chapterNumber}?`}
        description={`${deletingChapter?.pageCount ?? 0} trang ảnh trên R2 sẽ bị xóa vĩnh viễn cùng dữ liệu chương.`}
        confirmLabel="Xóa chương"
        destructive
        onConfirm={async () => {
          if (!deletingChapter) return;
          try {
            await deleteChapter.mutateAsync({ id: deletingChapter.id, mangaId });
            toast.success("Đã xóa chương.");
          } catch (err) {
            toastMutationError(err, "Xóa chương thất bại.");
          } finally {
            setDeletingChapter(null);
          }
        }}
      />
    </div>
  );
}
