"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Plus, Search, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navigate, useHashRoute } from "@/lib/client/hash-router";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";

export function Header() {
  const { theme, setTheme } = useTheme();
  const route = useHashRoute();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const routeSearch = route.query.get("search") ?? "";
  const [search, setSearch] = useState(routeSearch);
  const [prevRouteSearch, setPrevRouteSearch] = useState(routeSearch);

  // Dong bo khi query thay doi tu router (back/forward) — derived state pattern
  if (prevRouteSearch !== routeSearch) {
    setPrevRouteSearch(routeSearch);
    setSearch(routeSearch);
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("search", value.trim());
      const qs = params.toString();
      navigate(`/library${qs ? `?${qs}` : ""}`, { replace: true });
    }, 400);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (document.activeElement?.tagName === "INPUT") return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-3 sm:px-4 md:gap-3 md:px-8">
        {/* Logo — hiện trên mobile (sidebar ẩn, thay cho nút menu:
            điều hướng chính đã có thanh tab dưới cùng) */}
        <a href="#/" className="flex items-center gap-2 md:hidden" aria-label="Về trang chủ">
          <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
        </a>

        <div className="relative min-w-0 flex-1 sm:max-w-sm md:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
                navigate(`/library${qs}`, { replace: true });
              }
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Tìm truyện, tác giả..."
            className="h-9 border-transparent bg-muted/60 pl-9 pr-8 focus-visible:bg-background"
            aria-label="Tìm kiếm truyện"
          />
          {search ? (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Xóa tìm kiếm"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground lg:block">
              /
            </kbd>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Nút thêm truyện: ẩn trên mobile (đã có tab "Thêm truyện" dưới cùng) */}
          <Button
            size="sm"
            className={cn("hidden gap-2 sm:inline-flex", "font-semibold")}
            onClick={() => navigate("/upload")}
          >
            <Plus className="h-4 w-4" />
            Thêm truyện
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Chuyển đổi giao diện sáng/tối"
          >
            <Sun className="h-4.5 w-4.5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4.5 w-4.5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold uppercase text-primary transition-transform hover:scale-105"
                aria-label="Menu tài khoản"
              >
                {user?.email?.charAt(0) ?? "?"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-semibold">{user?.email}</p>
                <p className="text-xs text-muted-foreground">Quản trị viên</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                Cài đặt
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  void logout();
                  navigate("/");
                }}
              >
                Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
