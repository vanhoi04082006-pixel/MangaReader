"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageImage } from "@/features/reader/page-image";
import type { ReaderPayloadDto } from "@/types";
import { cn } from "@/lib/utils";

interface VerticalReaderProps {
  payload: ReaderPayloadDto;
  gap: number;
  initialPage: number;
  onCurrentPageChange: (page: number, scrollFraction: number) => void;
  onSourceError: () => void;
  onFinished: () => void;
  onNextChapter?: () => void;
  finished: boolean;
}

function findIndexAt(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Tinh offset cuon cua tung trang (prefix sum + gap) */
function computeOffsets(heights: number[], gap: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const h of heights) {
    out.push(acc);
    acc += h + gap;
  }
  return out;
}

const DEFAULT_ASPECT = 0.69; // ty le w/h trung binh cua trang truyen
const READING_COLUMN_MAX = 768; // max-w-3xl — chieu rong cot doc

export function VerticalReader({
  payload,
  gap,
  initialPage,
  onCurrentPageChange,
  onSourceError,
  onFinished,
  onNextChapter,
  finished,
}: VerticalReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const restoreRef = useRef<string | null>(null);
  const restoredRef = useRef(false);

  // Do kich thuoc container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setMetrics({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setMetrics({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Tinh chieu cao moi trang (aspect ratio biet truoc tu DB).
  // LUU Y: dung chieu rong COT DOC (max-w-3xl), khong phai scroll container
  const contentWidth = Math.min(metrics.width || 800, READING_COLUMN_MAX);
  const heights = useMemo(() => {
    return payload.pages.map((p) => {
      const aspect = p.width && p.height ? p.width / p.height : DEFAULT_ASPECT;
      return contentWidth / aspect;
    });
  }, [payload.pages, contentWidth]);

  const offsets = useMemo(() => computeOffsets(heights, gap), [heights, gap]);

  const totalHeight =
    heights.length > 0 ? offsets[offsets.length - 1] + heights[heights.length - 1] : 0;
  // Chua them khong gian cho panel "het chuong" o cuoi
  const containerHeight = totalHeight + 260;

  // Phan cua so: chi render cac trang gan viewport
  const firstVisible = findIndexAt(offsets, scrollTop);
  const lastVisible = findIndexAt(offsets, scrollTop + (metrics.height || 900));
  const renderStart = Math.max(0, firstVisible - 2);
  const renderEnd = Math.min(payload.pages.length - 1, lastVisible + 3);

  // Trang hien tai: vi tri 40% viewport
  const currentPage = Math.min(
    payload.pages.length,
    findIndexAt(offsets, scrollTop + (metrics.height || 900) * 0.4) + 1
  );

  // Prefetch cac trang PHIA TRUOC (ngoai cua so render) — cuon nhanh
  // khong bi cho anh (viewport chi render +-3 trang quanh vi tri hien tai)
  useEffect(() => {
    const from = renderEnd + 1;
    const to = Math.min(payload.pages.length, from + 4);
    for (let i = from; i < to; i++) {
      const img = new Image();
      img.src = payload.pages[i].url;
    }
  }, [renderEnd, payload.pages]);

  // Scroll handler (rAF throttle)
  const tickingRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        tickingRef.current = false;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Phat hien trang hien tai + tien do
  // LUU Y: khong report truoc khi restore xong (chong ghi de progress sai)
  const lastReportedRef = useRef(-1);
  useEffect(() => {
    if (!restoredRef.current) return;
    if (currentPage !== lastReportedRef.current) {
      lastReportedRef.current = currentPage;
      const fraction = totalHeight > 0 ? Math.min(1, scrollTop / totalHeight) : 0;
      onCurrentPageChange(currentPage, fraction);
    }
  }, [currentPage, scrollTop, totalHeight, onCurrentPageChange]);

  // Kiem tra da cuon den cuoi (hien thi panel ket thuc)
  useEffect(() => {
    if (!finished && totalHeight > 0 && scrollTop + (metrics.height || 900) >= totalHeight - 40) {
      onFinished();
    }
  }, [scrollTop, totalHeight, metrics.height, finished, onFinished]);

  // Khoi phuc vi tri doc khi payload san sang (1 lan / chapter)
  useEffect(() => {
    if (restoreRef.current === payload.chapter.id) return;
    if (metrics.width === 0 || offsets.length === 0) return;
    restoreRef.current = payload.chapter.id;
    const el = containerRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(payload.pages.length - 1, initialPage - 1));
    el.scrollTop = offsets[idx];
    // danh dau da restore — cho phep report trang hien tai
    restoredRef.current = true;
    lastReportedRef.current = -1;
    const fraction = totalHeight > 0 ? Math.min(1, el.scrollTop / totalHeight) : 0;
    onCurrentPageChange(idx + 1, fraction);
  }, [payload.chapter.id, payload.pages.length, metrics.width, offsets, initialPage, totalHeight, onCurrentPageChange]);

  return (
    <div
      ref={containerRef}
      className={cn("h-full w-full overflow-y-auto scrollbar-thin")}
      aria-label="Vùng đọc truyện cuộn dọc"
    >
      <div
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: containerHeight }}
      >
        {payload.pages.slice(renderStart, renderEnd + 1).map((page, i) => {
          const index = renderStart + i;
          const isNearViewport = Math.abs(index - firstVisible) <= 1;
          return (
            <div
              key={page.pageNumber}
              data-page-anchor={page.pageNumber}
              className="absolute left-0 right-0"
              style={{
                top: offsets[index],
                height: heights[index],
                paddingBottom: gap,
              }}
            >
              <PageImage
                src={page.url}
                alt={`Trang ${page.pageNumber}`}
                fit="width"
                eager={isNearViewport}
                lqip={page.lqip}
                onSourceError={onSourceError}
              />
              {isNearViewport && (
                <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground backdrop-blur-sm">
                  {page.pageNumber}/{payload.pages.length}
                </span>
              )}
            </div>
          );
        })}

        {/* Panel ket thuc chuong */}
        <div
          className="absolute inset-x-0 flex flex-col items-center gap-3 px-4 pb-16 pt-8 text-center"
          style={{ top: totalHeight }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <BookOpenCheck className="h-6 w-6 text-primary" />
          </div>
          <p className="font-semibold">Hết chương {payload.chapter.chapterNumber}</p>
          {payload.nextChapter ? (
            <Button className="gap-2" onClick={onNextChapter}>
              Chương tiếp theo ({payload.nextChapter.chapterNumber})
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Đây là chương mới nhất.</p>
          )}
        </div>
      </div>
    </div>
  );
}
