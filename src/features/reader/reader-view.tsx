"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Maximize,
  Minimize,
  Settings2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LoadingScreen } from "@/components/common/loading";
import { ErrorState } from "@/components/common/states";
import { VerticalReader } from "@/features/reader/vertical-reader";
import { PagedReader } from "@/features/reader/paged-reader";
import { ReaderSettingsSheet } from "@/features/reader/reader-settings-sheet";
import { useReaderPayload, useSaveProgress, useChapters, useRefreshReader } from "@/hooks/queries";
import { useReaderStore } from "@/store/reader-store";
import { goBack, navigate, useHashRoute } from "@/lib/client/hash-router";
import { naturalCompare } from "@/utils/natural-sort";
import { cn } from "@/lib/utils";

interface ReaderViewProps {
  mangaId: string;
  chapterId: string;
}

const BG_CLASSES = {
  dark: "reader-bg-dark",
  black: "reader-bg-black",
  light: "reader-bg-light",
} as const;

export function ReaderView({ mangaId, chapterId }: ReaderViewProps) {
  const route = useHashRoute();
  const settings = useReaderStore();
  const { data: payload, isLoading, isError, error, refetch } = useReaderPayload(chapterId);
  // Danh sach chuong phan trang (200 chuong/trang — truyen dai hon khong bi cat)
  const [chapterPage, setChapterPage] = useState(1);
  const { data: chaptersData } = useChapters(mangaId, "asc", chapterPage, 200);
  const saveProgress = useSaveProgress();
  const { refresh } = useRefreshReader();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");

  const pageInputRef = useRef<HTMLInputElement>(null);
  const lastSavedRef = useRef<{ page: number; fraction: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryPage = parseInt(route.query.get("page") ?? "", 10);
  const initialPage =
    Number.isFinite(queryPage) && queryPage > 0 ? queryPage : (payload?.progress?.pageNumber ?? 1);

  // ---------- Toolbar: hien/an bang tay (khong tu dong an/hien) ----------
  const showToolbar = useCallback(() => setToolbarVisible(true), []);
  const collapseToolbar = useCallback(() => setToolbarVisible(false), []);
  const toggleToolbar = useCallback(() => setToolbarVisible((v) => !v), []);

  // Khi mo panel thi luon hien toolbar
  const isToolbarVisible = toolbarVisible || settingsOpen || chapterListOpen;

  // ---------- Fullscreen ----------
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // tu choi boi trinh duyet — bo qua
    }
  };

  // ---------- Page state — reset khi doi chuong (derived state pattern) ----------
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
  if (payload && loadedChapterId !== payload.chapter.id) {
    setLoadedChapterId(payload.chapter.id);
    const start =
      Number.isFinite(queryPage) && queryPage > 0 ? queryPage : payload.progress?.pageNumber ?? 1;
    setCurrentPage(Math.min(Math.max(1, start), Math.max(1, payload.pages.length)));
    setFinished(false);
  }

  // ---------- Save progress (throttle 3.5s) ----------
  // LUU Y: giu callback ON DINH de timer khong bi clear lam (bug da fix):
  // dung ref cho doSave + mutate (react-query mutate la stable reference)
  const saveMutate = saveProgress.mutate;
  const doSaveRef = useRef<((page: number, fraction: number) => void) | null>(null);

  const doSave = useCallback(
    (page: number, fraction: number) => {
      if (!payload) return;
      lastSavedRef.current = { page, fraction };
      saveMutate({
        mangaId,
        chapterId,
        pageNumber: page,
        scrollPosition: fraction,
      });
    },
    [payload, mangaId, chapterId, saveMutate]
  );
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  const onPageChange = useCallback(
    (page: number, fraction: number) => {
      setCurrentPage(page);
      const last = lastSavedRef.current;
      if (last && last.page === page && Math.abs(last.fraction - fraction) < 0.01) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        doSaveRef.current?.(page, fraction);
      }, 3500);
    },
    []
  );

  // Luu ngay khi roi reader / an tab / chuyen chuong
  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        const last = lastSavedRef.current;
        if (last) doSaveRef.current?.(last.page, last.fraction);
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // ---------- Navigation ----------
  const goToChapter = useCallback(
    (nextChapterId: string) => {
      // replace: tránh chồng history entry khi đổi chương trong reader —
      // để nút Thoát (history.back) quay về trang chi tiết truyện
      navigate(`/reader/${mangaId}/${nextChapterId}`, { replace: true });
    },
    [mangaId]
  );

  /** Doi trang o che do paged (cap nhat state + tien do) */
  const goToPage = useCallback(
    (page: number) => {
      if (!payload) return;
      const clamped = Math.min(Math.max(1, page), Math.max(1, payload.pages.length));
      onPageChange(clamped, (clamped - 1) / Math.max(1, payload.pages.length));
    },
    [payload, onPageChange]
  );

  /** Nhảy tới trang ở cả 2 chế độ đọc (paged + cuộn dọc). */
  const jumpToPage = useCallback(
    (page: number) => {
      if (!payload) return;
      const total = Math.max(1, payload.pages.length);
      const target = Math.min(Math.max(1, Math.round(page)), total);
      if (settings.mode === "paged") {
        setCurrentPage(target);
        onPageChange(target, (target - 1) / total);
      } else {
        const el = document.querySelector(`[data-page-anchor="${target}"]`);
        if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
        else {
          // Fallback on dinh danh (khong phu thuoc class CSS — chong viec
          // doi class lam hong selector)
          const container =
            document.querySelector("[data-reader-scroll]") ??
            document.querySelector(".scrollbar-thin.overflow-y-auto");
          if (container) {
            const ratio = (target - 1) / total;
            (container as HTMLElement).scrollTop =
              ratio * ((container as HTMLElement).scrollHeight - (container as HTMLElement).clientHeight);
          }
        }
      }
      setPageDraft(String(target));
    },
    [payload, settings.mode, onPageChange]
  );

  // Đồng bộ ô nhập trang với trang hiện tại (trừ khi người dùng đang gõ).
  useEffect(() => {
    if (document.activeElement === pageInputRef.current) return;
    setPageDraft(String(Math.min(currentPage, Math.max(1, payload?.pages.length ?? 1))));
  }, [currentPage, payload?.pages.length]);

  const commitPageInput = useCallback(() => {
    const n = Number.parseInt(pageDraft, 10);
    if (!Number.isFinite(n)) {
      setPageDraft(String(currentPage));
      return;
    }
    jumpToPage(n);
  }, [pageDraft, currentPage, jumpToPage]);

  const goNextChapter = useCallback(() => {
    if (payload?.nextChapter) goToChapter(payload.nextChapter.id);
  }, [payload, goToChapter]);

  const exitReader = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    goBack();
  }, []);

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Chan phim khi focus dang o phan tu tuong tac:
      // - INPUT/TEXTAREA/SELECT/CONTENTEDITABLE: dang go noi dung
      // - BUTTON: Space se bam nut (tranh double-action: bam nut + doi trang)
      // - [role=slider] (Radix Slider): ArrowLeft/Right dieu khien slider
      //   (tranh nhay 2 trang cung luc — bug da fix)
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (
        el && (
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.tagName === "BUTTON" ||
          el.isContentEditable ||
          el.closest('[role="slider"]')
        )
      ) {
        return;
      }
      switch (e.key) {
        case "Escape":
          if (settingsOpen) setSettingsOpen(false);
          else exitReader();
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "ArrowLeft":
          if (settings.mode === "paged" && payload) {
            e.preventDefault();
            const delta = settings.direction === "ltr" ? -1 : 1;
            goToPage(currentPage + delta);
          }
          break;
        case "ArrowRight":
          if (settings.mode === "paged" && payload) {
            e.preventDefault();
            const delta = settings.direction === "ltr" ? 1 : -1;
            goToPage(currentPage + delta);
          }
          break;
        case " ":
          if (settings.mode === "paged" && payload) {
            e.preventDefault();
            const delta = settings.direction === "ltr" ? 1 : -1;
            goToPage(currentPage + delta);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.mode, settings.direction, settingsOpen, payload, exitReader, goToPage, currentPage]);

  // Chan scroll body
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const onSourceError = useCallback(() => {
    refresh(chapterId);
  }, [refresh, chapterId]);

  const sortedChapters = useMemo(
    () =>
      [...(chaptersData?.items ?? [])].sort((a, b) => naturalCompare(a.chapterNumber, b.chapterNumber)),
    [chaptersData]
  );

  // ---------- Render ----------

  if (isLoading) {
    return (
      <div className={cn("fixed inset-0 z-50", BG_CLASSES[settings.background])}>
        <LoadingScreen label="Đang chuẩn bị chương..." />
      </div>
    );
  }

  if (isError || !payload) {
    return (
      <div className={cn("fixed inset-0 z-50 p-6", BG_CLASSES[settings.background])}>
        <div className="mx-auto max-w-lg pt-24">
          <ErrorState
            title="Không mở được chương"
            message={(error as Error)?.message ?? "Chương có thể đã bị xóa hoặc phiên đăng nhập hết hạn."}
            onRetry={() => void refetch()}
          />
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={exitReader} className="gap-2">
              <X className="h-4 w-4" />
              Thoát
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const pageCount = payload.pages.length;
  if (pageCount === 0) {
    return (
      <div className={cn("fixed inset-0 z-50 p-6", BG_CLASSES[settings.background])}>
        <div className="mx-auto max-w-lg pt-24 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-4 text-lg font-bold">Chương chưa có trang</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Hãy upload ảnh cho chương {payload.chapter.chapterNumber} trước khi đọc.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button className="gap-2" onClick={() => navigate(`/upload?manga=${mangaId}&chapter=${chapterId}`)}>
              Upload trang
            </Button>
            <Button variant="outline" onClick={exitReader} className="gap-2">
              <X className="h-4 w-4" />
              Thoát
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col", BG_CLASSES[settings.background])}>
      {/* Vung doc */}
      <div className="relative flex-1 overflow-hidden">
        {settings.mode === "vertical" ? (
          <VerticalReader
            payload={payload}
            gap={settings.pageGap}
            initialPage={initialPage}
            onCurrentPageChange={onPageChange}
            onSourceError={onSourceError}
            onFinished={() => setFinished(true)}
            onNextChapter={goNextChapter}
            finished={finished}
          />
        ) : (
          <PagedReader
            payload={payload}
            fit={settings.fit}
            direction={settings.direction}
            preloadCount={settings.preloadCount}
            current={currentPage}
            onChangePage={(p) => onPageChange(p, (p - 1) / Math.max(1, pageCount))}
            onSourceError={onSourceError}
            onRequestNextChapter={goNextChapter}
            onToggleToolbar={toggleToolbar}
          />
        )}
      </div>

      {/* Toolbar */}
      <AnimatePresence>
        {toolbarVisible && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-3"
          >
            <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-1 rounded-xl border bg-background/85 p-1.5 shadow-lg backdrop-blur-md">
              {/* Hàng 1: Thoát + tiêu đề/chương + điều hướng trang + thu gọn */}
              <div className="flex w-full items-center gap-1">
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 sm:h-9 sm:w-9" onClick={exitReader} aria-label="Thoát">
                <X className="h-4.5 w-4.5" />
              </Button>

              <Popover open={chapterListOpen} onOpenChange={setChapterListOpen}>
                <PopoverTrigger asChild>
                  <button className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition-colors hover:bg-accent sm:gap-2 sm:px-3">
                    <span className="max-w-24 truncate text-muted-foreground sm:max-w-32">{payload.manga.title}</span>
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                      Ch. {payload.chapter.chapterNumber}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0">
                  <ScrollArea className="h-80">
                    <div className="p-1.5">
                      {sortedChapters.map((c) => (
                        <button
                          key={c.id}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                            c.id === chapterId && "bg-primary/10 font-semibold text-primary"
                          )}
                          onClick={() => {
                            setChapterListOpen(false);
                            if (c.id !== chapterId) goToChapter(c.id);
                          }}
                        >
                          <span className="w-12 shrink-0 font-mono text-xs">{c.chapterNumber}</span>
                          <span className="truncate">{c.title ?? ""}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.pageCount} tr.</span>
                        </button>
                      ))}
                      {(chaptersData?.total ?? 0) > 0 && sortedChapters.length === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Trang này không có chương.</p>
                      )}
                    </div>
                  </ScrollArea>
                  {(chaptersData?.totalPages ?? 1) > 1 && (
                    <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Trang chương trước"
                        disabled={chapterPage <= 1}
                        onClick={() => setChapterPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {chapterPage}/{chaptersData?.totalPages ?? 1} · {chaptersData?.total ?? 0} chương
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Trang chương sau"
                        disabled={chapterPage >= (chaptersData?.totalPages ?? 1)}
                        onClick={() => setChapterPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-9 sm:w-9"
                  onClick={() => jumpToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  aria-label="Trang trước"
                  title="Trang trước"
                >
                  <ChevronLeft className="h-4.5 w-4.5" />
                </Button>

                <div className="flex items-center gap-1">
                  <input
                    ref={pageInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pageDraft}
                    onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={commitPageInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        setPageDraft(String(currentPage));
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label={`Trang hiện tại, tổng ${pageCount} trang`}
                    title="Nhập số trang rồi Enter để chuyển"
                    className="no-zoom-input h-9 w-12 rounded-md border border-input bg-background/60 px-1 text-center font-mono text-xs font-semibold tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-8"
                  />
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    / {pageCount}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-9 sm:w-9"
                  onClick={() => jumpToPage(currentPage + 1)}
                  disabled={currentPage >= (payload.pages.length || 1)}
                  aria-label="Trang sau"
                  title="Trang sau"
                >
                  <ChevronRight className="h-4.5 w-4.5" />
                </Button>

              </div>

              {/* Nút sách thu gọn — mobile: bấm vào mới thu gọn thành nút sách */}
              <Button
                variant="ghost"
                size="icon"
                className="ml-0.5 h-10 w-10 shrink-0 sm:hidden"
                onClick={collapseToolbar}
                aria-label="Thu gọn thanh công cụ"
                title="Thu gọn thanh công cụ"
              >
                <BookOpen className="h-4.5 w-4.5" />
              </Button>

              {/* Nhóm icon — desktop: cùng hàng với tiêu đề */}
              <div className="hidden items-center gap-0.5 sm:flex">
                <div className="mx-1 h-5 w-px bg-border" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => settings.update({ mode: settings.mode === "vertical" ? "paged" : "vertical" })}
                  aria-label={settings.mode === "vertical" ? "Chuyển sang từng trang" : "Chuyển sang cuộn dọc"}
                  title={settings.mode === "vertical" ? "Đọc từng trang" : "Cuộn dọc"}
                >
                  <Columns3 className="h-4.5 w-4.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Cài đặt đọc"
                  title="Cài đặt đọc"
                >
                  <Settings2 className="h-4.5 w-4.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void toggleFullscreen()}
                  aria-label="Toàn màn hình"
                  title="Toàn màn hình (F)"
                >
                  {isFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={collapseToolbar}
                  aria-label="Thu gọn thanh công cụ"
                  title="Thu gọn thanh công cụ"
                >
                  <BookOpen className="h-4.5 w-4.5" />
                </Button>
              </div>
              </div>

              {/* Hàng 2 (chỉ mobile): đổi chế độ đọc + cài đặt — target chạm lớn */}
              <div className="flex w-full items-center justify-center gap-10 sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => settings.update({ mode: settings.mode === "vertical" ? "paged" : "vertical" })}
                  aria-label={settings.mode === "vertical" ? "Chuyển sang từng trang" : "Chuyển sang cuộn dọc"}
                  title={settings.mode === "vertical" ? "Đọc từng trang" : "Cuộn dọc"}
                >
                  <Columns3 className="h-4.5 w-4.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Cài đặt đọc"
                  title="Cài đặt đọc"
                >
                  <Settings2 className="h-4.5 w-4.5" />
                </Button>
              </div>

              {/* Thanh keo nhanh trang */}
              <div className="flex w-full items-center gap-3 px-2 pb-1 pt-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">1</span>
                <Slider
                  value={[Math.min(currentPage, pageCount)]}
                  min={1}
                  max={pageCount}
                  step={1}
                  onValueChange={([v]) => jumpToPage(v)}
                  className="flex-1"
                />
                <span className="font-mono text-[10px] text-muted-foreground">{pageCount}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nút hình quyển sách nổi: bấm vào mới sổ thanh công cụ ra.
          Không bấm thì thanh giữ ẩn mãi — không tự hiện lại khi chạm/cuộn. */}
      <AnimatePresence>
        {!isToolbarVisible && (
          <motion.button
            initial={{ opacity: 0, scale: 0.6, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 12 }}
            whileTap={{ scale: 0.88 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className="glow-primary absolute bottom-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full border border-primary/35 bg-background/85 text-primary shadow-lg backdrop-blur-md transition-colors hover:text-foreground"
            onClick={showToolbar}
            aria-label="Mở thanh công cụ"
            title="Mở thanh công cụ"
          >
            <BookOpen className="h-5.5 w-5.5" />
          </motion.button>
        )}
      </AnimatePresence>

      <ReaderSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
