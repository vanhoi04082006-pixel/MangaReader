"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageImageProps {
  src: string;
  alt: string;
  fit: "width" | "height" | "original";
  eager?: boolean;
  /** Placeholder mờ base64 (JPEG ~16px) — hiện trang tức thời trong lúc chờ ảnh thật */
  lqip?: string | null;
  /** Goi khi anh loi — component se de nguon moi tu query refetch */
  onSourceError?: () => void;
  className?: string;
}

const FIT_CLASSES: Record<string, string> = {
  width: "w-full h-auto max-w-none",
  height: "max-h-full w-auto max-w-none object-contain",
  original: "max-w-none",
};

export function PageImage({ src, alt, fit, eager, lqip, onSourceError, className }: PageImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [prevSrc, setPrevSrc] = useState(src);
  const lqipUrl = lqip ? `data:image/jpeg;base64,${lqip}` : null;

  // Reset khi doi nguon (trang moi / URL presigned moi) — pattern derived state
  if (prevSrc !== src) {
    setPrevSrc(src);
    setStatus("loading");
    setAttempt(0);
  }

  const onError = () => {
    // Thu lay nguon moi 1 lan (URL het han) — refetch query
    if (attempt < 1 && onSourceError) {
      setAttempt((a) => a + 1);
      onSourceError();
      return;
    }
    setStatus("error");
  };

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex min-h-64 w-full flex-col items-center justify-center gap-3 bg-muted/50 text-muted-foreground",
          className
        )}
        role="img"
        aria-label={alt}
      >
        <AlertTriangle className="h-8 w-8 text-destructive/70" />
        <p className="text-sm">Không tải được trang này (URL có thể đã hết hạn).</p>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            setAttempt(0);
            setStatus("loading");
            onSourceError?.();
          }}
        >
          <RotateCcw className="h-4 w-4" />
          Lấy URL mới
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("relative flex w-full items-center justify-center", className)}>
      {/* Placeholder mờ hiện tức thời (data URI — 0 request) trong lúc chờ trang thật */}
      {status === "loading" &&
        (lqipUrl ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <img
              src={lqipUrl}
              alt=""
              draggable={false}
              className="h-full w-full scale-105 object-cover blur-lg"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          </div>
        ))}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        fetchPriority={eager ? "high" : "auto"}
        onLoad={() => setStatus("loaded")}
        onError={onError}
        className={cn(
          FIT_CLASSES[fit],
          "select-none transition-opacity duration-200",
          status === "loading" ? "opacity-0" : "opacity-100"
        )}
      />
    </div>
  );
}
