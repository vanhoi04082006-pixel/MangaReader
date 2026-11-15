"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goBack, navigate } from "@/lib/client/hash-router";
import { cn } from "@/lib/utils";

/**
 * Nút "Quay lại" dạng pill có nhãn rõ ràng cho các màn hình chi tiết/cài đặt.
 * Về màn hình trước nếu có lịch sử trong app, ngược lại về `fallback`.
 */
export function BackButton({
  fallback = "/library",
  className,
}: {
  fallback?: string;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "group h-9 gap-1.5 rounded-full bg-background/60 pl-2.5 pr-3.5 text-sm font-medium shadow-sm backdrop-blur-sm transition-all hover:border-primary/45 hover:bg-accent active:scale-[0.97]",
        className
      )}
      onClick={() => {
        // Lịch sử trong app (hash push) → quay lại; vào thẳng URL → về fallback
        if (window.history.length > 1) goBack();
        else navigate(fallback);
      }}
      aria-label="Quay lại"
      title="Quay lại"
    >
      <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
      Quay lại
    </Button>
  );
}
