"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export function LoadingScreen({ label = "Đang tải..." }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4">
      <motion.img
        src="/mascots/dizzy.png"
        alt=""
        aria-hidden
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="h-24 w-auto select-none drop-shadow-[0_10px_28px_color-mix(in_oklch,var(--primary)_35%,transparent)]"
      />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {label}
        <motion.span
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          className="font-bold text-primary"
        >
          ···
        </motion.span>
      </p>
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className ?? ""}`} />;
}
