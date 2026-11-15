"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goBack, navigate } from "@/lib/client/hash-router";

/**
 * Nút quay lại dùng chung cho các màn hình chi tiết/cài đặt.
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
      variant="ghost"
      size="icon"
      className={
        className ?? "h-10 w-10 shrink-0 rounded-full sm:h-9 sm:w-9"
      }
      onClick={() => {
        // Lịch sử trong app (hash push) → quay lại; vào thẳng URL → về fallback
        if (window.history.length > 1) goBack();
        else navigate(fallback);
      }}
      aria-label="Quay lại"
      title="Quay lại"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  );
}
