"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

interface CoverImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  /** Placeholder mờ base64 (JPEG ~16px) — hiện tức thời trong lúc chờ ảnh thật */
  lqip?: string | null;
  /** Màu chủ đạo của bìa (hex) — nền placeholder khi không có lqip */
  color?: string | null;
  /** Ưu tiên tải ngay — dùng cho các ảnh hiện diện trên màn hình đầu tiên */
  eager?: boolean;
}

/**
 * Anh bia voi placeholder tuc thoi (LQIP mo / mau chu dao) + fade-in.
 * - Co lqip: hien anh mo ~16px (data URI, 0 request) ngay lap tuc,
 *   anh that fade-in đè lên khi tai xong.
 * - Chi co color: nen mau chu dao thay shimmer.
 * - Khong co gi: giu shimmer gradient nhu cu.
 * Dung <img> thuan vi URL la presigned R2 (dynamic, khong qua next/image).
 */
export function CoverImage({ src, alt, className, lqip, color, eager }: CoverImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [prevSrc, setPrevSrc] = useState(src);
  const lqipUrl = lqip ? `data:image/jpeg;base64,${lqip}` : null;

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
          src="/placeholder-cover.svg"
          alt=""
          className={cn("h-full w-full object-cover", status === "error" && "opacity-60")}
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
      {/* Lớp placeholder — hiện tức thời, nằm dưới ảnh thật */}
      {lqipUrl ? (
        <img
          src={lqipUrl}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
        />
      ) : color ? (
        <div aria-hidden className="absolute inset-0" style={{ backgroundColor: color }} />
      ) : status === "loading" ? (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted/30" />
      ) : null}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
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
