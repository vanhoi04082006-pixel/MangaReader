"use client";

import { create } from "zustand";
import { api } from "@/lib/client/api";
import type { AuthUser } from "@/types";

interface AuthState {
  user: AuthUser | null;
  provider: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  forceUnauthenticated: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  provider: null,
  status: "loading",

  login: async (email, password) => {
    const res = await api.post<{ user: AuthUser; provider: string }>("/api/auth/login", {
      email,
      password,
    });
    set({ user: res.user, provider: res.provider, status: "authenticated" });
  },

  logout: async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // best effort
    }
    set({ user: null, provider: null, status: "unauthenticated" });
  },

  bootstrap: async () => {
    try {
      const res = await api.get<{ user: AuthUser; provider: string }>("/api/auth/me");
      set({ user: res.user, provider: res.provider, status: "authenticated" });
    } catch {
      set({ user: null, provider: null, status: "unauthenticated" });
    }
  },

  forceUnauthenticated: () => {
    set({ user: null, provider: null, status: "unauthenticated" });
  },
}));
