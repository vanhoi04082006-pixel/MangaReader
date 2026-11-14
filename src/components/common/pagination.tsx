"use client";

import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  /** Trang hiện tại (bắt đầu từ 1) */
  page: number;
  /** Tổng số trang */
  totalPages: number;
  /** Callback đổi trang — component tự clamp vào khoảng [1, totalPages] */
  onChange: (page: number) => void;
  className?: string;
}

/**
 * Phân trang chuẩn TSUNDOKU: « Trước [ô nhập] /N Sau »
 * - Ô nhập cho phép nhảy tới trang bất kỳ (Enter để chuyển, Escape hoàn tác).
 * - Nút « / » nhảy nhanh đầu/cuối (hiện khi tổng số trang > 5).
 * - Kích thước chạm tối thiểu 36-44px, ô nhập chống tự zoom trên iOS.
 */
export function Pagination({ page, totalPages, onChange, className }: PaginationProps) {
  const [draft, setDraft] = useState(String(page));

  // Đồng bộ khi đổi trang từ ngoài (nút Trước/Sau, back/forward)
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1) {
      setDraft(String(page));
      return;
    }
    const clamped = Math.min(n, totalPages);
    setDraft(String(clamped));
    if (clamped !== page) onChange(clamped);
  };

  return (
    <nav
      className={cn("flex items-center justify-center gap-1.5 pt-4", className)}
      aria-label="Phân trang"
    >
      {totalPages > 5 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          disabled={page <= 1}
          onClick={() => onChange(1)}
          aria-label="Về trang đầu"
          title="Về trang đầu"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        className="h-9 min-w-16 gap-0.5 px-3"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Trước
      </Button>

      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(String(page));
              e.currentTarget.blur();
            }
          }}
          onBlur={commit}
          aria-label={`Trang hiện tại, tổng ${totalPages} trang`}
          title="Nhập số trang rồi Enter để chuyển"
          className="no-zoom-input h-9 w-12 rounded-md border border-input bg-background px-1 text-center font-mono text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <span className="font-mono text-sm tabular-nums text-muted-foreground">/ {totalPages}</span>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-9 min-w-16 gap-0.5 px-3"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Sau
      </Button>

      {totalPages > 5 && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          disabled={page >= totalPages}
          onClick={() => onChange(totalPages)}
          aria-label="Tới trang cuối"
          title="Tới trang cuối"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      )}
    </nav>
  );
}
