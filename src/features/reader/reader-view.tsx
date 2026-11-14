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
  const { data: chaptersData } = useChapters(mangaId, "asc", 1, 200);
  const saveProgress = useSaveProgress();
  const { refresh } = useRefreshReader();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollingRef = useRef(false);
  // Người dùng chủ động thu gọn toolbar → chỉ mở lại khi bấm nút hình quyển sách.
  const collapsedRef = useRef(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const lastSavedRef = useRef<{ page: number; fraction: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryPage = parseInt(route.query.get("page") ?? "", 10);
  const initialPage =
    Number.isFinite(queryPage) && queryPage > 0 ? queryPage : (payload?.progress?.pageNumber ?? 1);

  // ---------- Toolbar auto-hide ----------
  const armHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (collapsedRef.current) return;
    if (settings.autoHideToolbar && !settingsOpen && !chapterListOpen) {
      hideTimerRef.current = setTimeout(() => setToolbarVisible(false), 2600);
    }
  }, [settings.autoHideToolbar, settingsOpen, chapterListOpen]);

  const showToolbar = useCallback(() => {
    collapsedRef.current = false;
    setToolbarVisible(true);
    armHideTimer();
  }, [armHideTimer]);

  /** Thu gọn toolbar thành nút hình quyển sách (bấm nút đó để mở lại). */
  const collapseToolbar = useCallback(() => {
    collapsedRef.current = true;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    isScrollingRef.current = false;
    setToolbarVisible(false);
  }, []);

  useEffect(() => {
    armHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [armHideTimer]);

  useEffect(() => {
    const onMove = () => {
      if (collapsedRef.current) return;
      if (isScrollingRef.current) return;
      showToolbar();
    };
    const onDown = () => {
      if (collapsedRef.current) return;
      showToolbar();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [showToolbar]);

  // An toolbar khi doc/cuon (wheel/touchmove/scroll) — chi hien lai khi
  // dung lai (o yen 1 cho) ~1.4s. Dung wheel/touchmove vi scroll event
  // khong fire tin cay trong mot so truong hop (container fixed/fullscreen).
  const onReadingActivity = useCallback(() => {
    if (collapsedRef.current) return;
    if (!settings.autoHideToolbar || settingsOpen || chapterListOpen) return;
    isScrollingRef.current = true;
    setToolbarVisible(false);
    if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    scrollHideTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      setToolbarVisible(true);
      armHideTimer();
    }, 1400);
  }, [settings.autoHideToolbar, settingsOpen, chapterListOpen, armHideTimer]);

  useEffect(() => {
    const container = document.querySelector(".h-full.w-full.overflow-y-auto");
    const targets: EventTarget[] = [window];
    if (container) targets.push(container);
    const events = ["scroll", "wheel", "touchmove"];
    targets.forEach((t) => events.forEach((ev) => t.addEventListener(ev, onReadingActivity, { passive: true })));
    return () => {
      targets.forEach((t) => events.forEach((ev) => t.removeEventListener(ev, onReadingActivity)));
      if (scrollHideTimerRef.current) clearTimeout(scrollHideTimerRef.current);
    };
  }, [onReadingActivity, payload]);

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
          const container = document.querySelector(".scrollbar-thin.overflow-y-auto");
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

  const goPrevChapter = useCallback(() => {
    if (payload?.prevChapter) goToChapter(payload.prevChapter.id);
  }, [payload, goToChapter]);

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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
            <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-1 rounded-xl border bg-background/85 p-1.5 shadow-lg backdrop-blur-md">
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={exitReader} aria-label="Thoát">
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
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={goPrevChapter}
                  disabled={!payload.prevChapter}
                  aria-label="Chương trước"
                  title="Chương trước"
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
                    className="h-7 w-12 rounded-md border border-input bg-background/60 px-1 text-center font-mono text-xs font-semibold tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    / {pageCount}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={goNextChapter}
                  disabled={!payload.nextChapter}
                  aria-label="Chương sau"
                  title="Chương sau"
                >
                  <ChevronRight className="h-4.5 w-4.5" />
                </Button>

                <div className="mx-0.5 h-5 w-px bg-border sm:mx-1" />

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
                  className="hidden h-9 w-9 sm:inline-flex"
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

      {/* Nút hình quyển sách: mở lại toolbar khi đã thu gọn */}
      <AnimatePresence>
        {!isToolbarVisible && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 z-10 rounded-full border bg-background/80 p-2.5 text-muted-foreground shadow-lg backdrop-blur-md transition-colors hover:text-foreground"
            onClick={showToolbar}
            aria-label="Mở thanh công cụ"
            title="Mở thanh công cụ"
          >
            <BookOpen className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      <ReaderSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
