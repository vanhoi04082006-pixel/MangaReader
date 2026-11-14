"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageImage } from "@/features/reader/page-image";
import type { ReaderPayloadDto } from "@/types";
import { cn } from "@/lib/utils";

interface PagedReaderProps {
  payload: ReaderPayloadDto;
  fit: "width" | "height" | "original";
  direction: "ltr" | "rtl";
  preloadCount: number;
  current: number; // 1-based
  onChangePage: (page: number) => void;
  onSourceError: () => void;
  onRequestNextChapter: () => void;
  /** Bam vung giua (mobile/PC) de hien/an thanh cong cu. */
  onToggleToolbar?: () => void;
}

/** Nguong vuot (px) — duoi muc nay coi la tap, khong phai swipe. */
const SWIPE_THRESHOLD_PX = 48;

export function PagedReader({
  payload,
  fit,
  direction,
  preloadCount,
  current,
  onChangePage,
  onSourceError,
  onRequestNextChapter,
  onToggleToolbar,
}: PagedReaderProps) {
  const pageCount = payload.pages.length;
  const page = payload.pages[current - 1];
  const isLast = current >= pageCount;
  const atEnd = isLast;
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // Preload cac trang phia truoc
  useEffect(() => {
    for (let i = current; i < Math.min(pageCount, current + preloadCount); i++) {
      const img = new Image();
      img.src = payload.pages[i].url;
    }
  }, [current, pageCount, preloadCount, payload.pages]);

  const navPrev = useMemo(
    () => (direction === "ltr" ? () => onChangePage(Math.max(1, current - 1)) : () => onChangePage(Math.min(pageCount, current + 1))),
    [direction, current, pageCount, onChangePage]
  );
  const navNext = useMemo(
    () => (direction === "ltr" ? () => onChangePage(Math.min(pageCount, current + 1)) : () => onChangePage(Math.max(1, current - 1))),
    [direction, current, pageCount, onChangePage]
  );

  // Vung bam: 32% trai/phai de doi trang, GIUA hien/an thanh cong cu
  const onZoneClick = (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const leftZone = rect.width * 0.32;
    const rightZone = rect.width * 0.68;
    if (x < leftZone) {
      if (direction === "ltr") navPrev();
      else navNext();
    } else if (x > rightZone) {
      if (direction === "ltr") navNext();
      else navPrev();
    } else {
      // Vung giua: hien/an thanh cong cu (tuong tu nút quyển sách)
      onToggleToolbar?.();
    }
  };

  // Swipe ngang doi trang (mobile): vuot sang trai/phai >= 48px
  // va gan nhu ngang (|dx| > 1.5*|dy|) thi coi la vuot — tap nho
  // khong kich hoat (se roi vao onZoneClick nhu binh thuong).
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return; // tap — bo qua
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // cuon doc — bo qua
    const swipeRight = dx > 0;
    // ltr: vuot sang trai = trang truoc; rtl nguoc lai
    if (direction === "ltr") {
      if (swipeRight) navPrev();
      else navNext();
    } else {
      if (swipeRight) navNext();
      else navPrev();
    }
  };

  if (atEnd && payload.nextChapter) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
        <img
          src="/mascots/celebrating.png"
          alt=""
          aria-hidden
          className="pointer-events-none h-24 w-auto select-none drop-shadow-[0_10px_28px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
        />
        <div>
          <p className="text-lg font-bold">Hết chương {payload.chapter.chapterNumber}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Trang {current}/{pageCount}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onChangePage(Math.max(1, current - 1))} className="gap-2">
            <ChevronLeft className="h-4 w-4" />
            Trang trước
          </Button>
          <Button className="gap-2" onClick={onRequestNextChapter}>
            Chương tiếp theo ({payload.nextChapter.chapterNumber})
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "reader-scroll-contain relative h-full w-full overflow-auto",
        fit === "height" ? "flex items-center justify-center" : "flex justify-center"
      )}
      onClick={onZoneClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="presentation"
    >
      {page && (
        <PageImage
          key={page.pageNumber}
          src={page.url}
          alt={`Trang ${page.pageNumber}`}
          fit={fit}
          eager
          onSourceError={onSourceError}
          className={fit === "height" ? "h-full py-0" : "py-0"}
        />
      )}

      {/* Mui ten dieu huong (desktop) */}
      <button
        className="group absolute inset-y-0 left-0 hidden w-20 items-center justify-start pl-3 md:flex"
        onClick={(e) => {
          e.stopPropagation();
          if (direction === "ltr") navPrev();
          else navNext();
        }}
        aria-label={direction === "ltr" ? "Trang trước" : "Trang sau"}
      >
        <span className="rounded-full bg-background/60 p-2 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <ChevronLeft className="h-5 w-5" />
        </span>
      </button>
      <button
        className="group absolute inset-y-0 right-0 hidden w-20 items-center justify-end pr-3 md:flex"
        onClick={(e) => {
          e.stopPropagation();
          if (direction === "ltr") navNext();
          else navPrev();
        }}
        aria-label={direction === "ltr" ? "Trang sau" : "Trang trước"}
      >
        <span className="rounded-full bg-background/60 p-2 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <ChevronRight className="h-5 w-5" />
        </span>
      </button>
    </div>
  );
}
