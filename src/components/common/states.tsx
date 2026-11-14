"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Các mascot TSUNDOKU có sẵn trong /public/mascots */
export type MascotKey =
  | "sitting"
  | "happy"
  | "happy-hug"
  | "angry"
  | "grumpy"
  | "dizzy"
  | "crying"
  | "back"
  | "curious"
  | "sleeping"
  | "shy"
  | "shocked"
  | "paw"
  | "book"
  | "badge"
  | "starstruck"
  | "celebrating"
  | "waving"
  | "cozy";

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Mascot hiển thị thay cho icon — chuẩn không khí TSUNDOKU */
  mascot?: MascotKey;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, mascot, title, description, action, compact }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center ${
        compact ? "px-6 py-10" : "px-6 py-16 sm:py-20"
      }`}
    >
      {mascot ? (
        <motion.img
          src={`/mascots/${mascot}.png`}
          alt=""
          aria-hidden
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1, y: [0, -6, 0] }}
          transition={{
            opacity: { duration: 0.35 },
            scale: { duration: 0.35 },
            y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
          }}
          className={`pointer-events-none select-none drop-shadow-[0_10px_28px_color-mix(in_oklch,var(--primary)_35%,transparent)] ${
            compact ? "h-20" : "h-28 sm:h-32"
          } w-auto`}
        />
      ) : Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </motion.div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Mascot đi kèm trạng thái lỗi (mặc định: mèo khóc) */
  mascot?: MascotKey;
}

export function ErrorState({ title = "Đã xảy ra lỗi", message, onRetry, mascot = "crying" }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <img
        src={`/mascots/${mascot}.png`}
        alt=""
        aria-hidden
        className="pointer-events-none h-24 w-auto select-none"
      />
      <div className="space-y-1">
        <h3 className="flex items-center justify-center gap-1.5 text-base font-semibold">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          {title}
        </h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2 gap-2">
          <RotateCcw className="h-4 w-4" />
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}
