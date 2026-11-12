"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReaderMode = "vertical" | "paged";
export type ReaderFit = "width" | "height" | "original";
export type ReaderDirection = "ltr" | "rtl";
export type ReaderBackground = "dark" | "black" | "light";

interface ReaderSettingsState {
  mode: ReaderMode;
  fit: ReaderFit;
  direction: ReaderDirection;
  background: ReaderBackground;
  pageGap: number; // px
  autoHideToolbar: boolean;
  preloadCount: number; // so trang preload phia truoc
  update: (patch: Partial<Omit<ReaderSettingsState, "update">>) => void;
}

export const useReaderStore = create<ReaderSettingsState>()(
  persist(
    (set) => ({
      mode: "vertical",
      fit: "width",
      direction: "ltr",
      background: "dark",
      pageGap: 8,
      autoHideToolbar: true,
      preloadCount: 3,
      update: (patch) => set(patch),
    }),
    { name: "tsundoku-reader-settings" }
  )
);
