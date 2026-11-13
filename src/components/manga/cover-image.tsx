"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

interface CoverImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
}

/**
 * Anh bia voi 3 trang thai: loading (shimmer), loi (fallback), thanh cong.
 * Dung <img> thuan vi URL la presigned R2 (dynamic, khong qua next/image).
 */
export function CoverImage({ src, alt, className }: CoverImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [prevSrc, setPrevSrc] = useState(src);

  // Reset trạng thái khi đổi nguồn ảnh (presigned URL thay đổi) — derived state pattern
  if (prevSrc !== src) {
    setPrevSrc(src);
    setStatus("loading");
  }

  if (!src || status === "error") {
    return (
      <div
        className={cn("relative h-full w-full overflow-hidden bg-muted", className)}
        role="img"
        aria-label={alt}
      >
        <img
          src="/placeholder-cover.png"
          alt=""
          className={cn(
            "h-full w-full object-cover",
            status === "error" && "opacity-40 grayscale"
          )}
          loading="lazy"
        />
        {status === "error" && (
          <span className="absolute inset-x-0 bottom-2 text-center text-[10px] font-medium text-white/80">
            Không tải được ảnh
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      {status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted/30" />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          status === "loading" ? "opacity-0" : "opacity-100",
          className
        )}
      />
    </>
  );
}
