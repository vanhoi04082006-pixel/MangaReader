"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { LoadingScreen } from "@/components/common/loading";
import { LoginView } from "@/features/auth/login-view";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { LibraryView } from "@/features/library/library-view";
import { FavoritesView } from "@/features/favorites/favorites-view";
import { HistoryView } from "@/features/history/history-view";
import { StorageView } from "@/features/storage/storage-view";
import { SettingsView } from "@/features/settings/settings-view";
import { MangaDetailView } from "@/features/manga/manga-detail-view";
import { UploadView } from "@/features/upload/upload-view";
import { ReaderView } from "@/features/reader/reader-view";
import { useHashRoute, navigate } from "@/lib/client/hash-router";
import { useAuthStore } from "@/store/auth-store";

function ViewSwitch({ segments }: { segments: string[] }) {
  const [first, second] = segments;

  switch (first) {
    case undefined:
    case "":
      return <DashboardView />;
    case "library":
      return <LibraryView />;
    case "favorites":
      return <FavoritesView />;
    case "history":
      return <HistoryView />;
    case "storage":
      return <StorageView />;
    case "settings":
      return <SettingsView />;
    case "upload":
      return <UploadView />;
    case "manga":
      return second ? <MangaDetailView mangaId={second} /> : <DashboardView />;
    case "dashboard":
      return <DashboardView />;
    default:
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <p className="text-lg font-semibold">Không tìm thấy trang</p>
          <button
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => navigate("/")}
          >
            Về Tổng quan
          </button>
        </div>
      );
  }
}

export function MangaApp() {
  const status = useAuthStore((s) => s.status);
  const route = useHashRoute();
  const isReader = route.segments[0] === "reader";

  // Scroll ve dau khi doi route (tru reader — reader tu quan ly scroll)
  useEffect(() => {
    if (!isReader) window.scrollTo({ top: 0 });
  }, [route.path, isReader]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <img src="/logo.svg" alt="Tsundoku" className="h-16 w-16 rounded-2xl" />
          <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full w-1/3 rounded-full bg-primary"
              animate={{ x: ["-100%", "300%"] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
            />
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginView />;
  }

  // Reader: fullscreen, khong shell
  if (isReader) {
    const mangaId = route.segments[1];
    const chapterId = route.segments[2];
    if (mangaId && chapterId) {
      return <ReaderView mangaId={mangaId} chapterId={chapterId} />;
    }
  }

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={route.segments[0] ?? "dashboard"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <ViewSwitch segments={route.segments} />
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}
