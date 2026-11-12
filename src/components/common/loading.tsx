"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export function LoadingScreen({ label = "Đang tải..." }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10"
      >
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </motion.div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className ?? ""}`} />;
}
