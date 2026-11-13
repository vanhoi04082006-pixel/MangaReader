"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: "primary" | "emerald" | "amber" | "violet";
  className?: string;
}

const accentStyles: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-500",
  amber: "bg-amber-500/10 text-amber-500",
  violet: "bg-violet-500/10 text-violet-500",
};

export function StatCard({ icon: Icon, label, value, sub, accent = "primary", className }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("rounded-xl border bg-card p-4 sm:p-5", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
          <p className="mt-1.5 truncate font-mono text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
            {value}
          </p>
          {sub ? <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">{sub}</p> : null}
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10", accentStyles[accent])}>
          <Icon className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
        </div>
      </div>
    </motion.div>
  );
}

interface QuotaBarProps {
  usedBytes: number;
  quotaBytes: number;
}

export function QuotaBar({ usedBytes, quotaBytes }: QuotaBarProps) {
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0;
  const percent = Math.min(1, ratio);
  const danger = percent >= 0.95;
  const warning = percent >= 0.8 && !danger;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">Dung lượng đã dùng</span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {(percent * 100).toFixed(1).replace(".", ",")}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(percent * 100, 1.5)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={cn(
            "h-full rounded-full",
            danger ? "bg-destructive" : warning ? "bg-amber-500" : "bg-primary"
          )}
        />
      </div>
      {(warning || danger) && (
        <p className={cn("text-xs", danger ? "text-destructive" : "text-amber-500")}>
          {danger
            ? "Sắp đạt giới hạn 100GB — hãy cân nhắc dọn dẹp file không dùng."
            : "Đã dùng hơn 80% hạn mức 100GB."}
        </p>
      )}
    </div>
  );
}
