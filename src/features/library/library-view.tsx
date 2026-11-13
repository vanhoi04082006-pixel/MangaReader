"use client";

import { useState } from "react";
import {
  BookOpen,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/common/states";
import { MangaGrid, MangaListRow } from "@/components/manga/manga-card";
import {
  useMangas,
  useGenres,
  type MangaFilters,
} from "@/hooks/queries";
import { navigate, updateRouteQuery, useHashRoute, queryInt } from "@/lib/client/hash-router";
import type { MangaStatus } from "@/schemas";
import { cn } from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "createdAt", label: "Ngày thêm" },
  { value: "updatedAt", label: "Ngày cập nhật" },
  { value: "title", label: "Tên truyện" },
  { value: "lastRead", label: "Lần đọc gần nhất" },
];

const STATUS_OPTIONS: Array<{ value: MangaStatus | "all"; label: string }> = [
  { value: "all", label: "Mọi trạng thái" },
  { value: "ONGOING", label: "Đang ra" },
  { value: "COMPLETED", label: "Hoàn thành" },
  { value: "HIATUS", label: "Tạm dừng" },
  { value: "DROPPED", label: "Ngừng làm" },
];

export function LibraryView({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const route = useHashRoute();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [genreFilterOpen, setGenreFilterOpen] = useState(false);

  const routeSearch = route.query.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(routeSearch);
  const [prevRouteSearch, setPrevRouteSearch] = useState(routeSearch);

  // Dong bo input khi query doi (back/forward) — derived state pattern
  if (prevRouteSearch !== routeSearch) {
    setPrevRouteSearch(routeSearch);
    setSearchInput(routeSearch);
  }

  const search = routeSearch;
  const genre = route.query.get("genre") ?? "";
  const status = (route.query.get("status") ?? "") as MangaStatus | "";
  const sort = (route.query.get("sort") ?? "createdAt") as MangaFilters["sort"];
  const order = (route.query.get("order") ?? "desc") as "asc" | "desc";
  const page = queryInt(route.query, "page", 1);

  const setQuery = (patch: Record<string, string | null>) => {
    const base = favoritesOnly ? "/favorites" : "/library";
    navigate(`${base}${updateRouteQuery(route.query, patch)}`, { replace: true });
  };

  const filters: MangaFilters = {
    search: search || undefined,
    genre: genre || undefined,
    status: status || undefined,
    sort,
    order,
    favorites: favoritesOnly,
    page,
    pageSize: 24,
  };

  const { data, isLoading, isError, error, refetch } = useMangas(filters);
  const { data: genresData } = useGenres();
  const activeFilterCount = (search ? 1 : 0) + (genre ? 1 : 0) + (status ? 1 : 0);

  const onSearchSubmit = (value: string) => {
    setQuery({ search: value.trim() || null, page: null });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {favoritesOnly ? "Truyện yêu thích" : "Thư viện"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data ? `${data.total.toLocaleString("vi-VN")} truyện` : "Đang tải..."}
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => navigate("/upload")}>
          <Plus className="h-4 w-4" />
          Thêm truyện
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-0 flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit(searchInput);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, tác giả..."
            className="h-9 pl-9 pr-8"
            aria-label="Tìm truyện"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                onSearchSubmit("");
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Xóa"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </form>

        <Popover open={genreFilterOpen} onOpenChange={setGenreFilterOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 gap-2",
                genre && "border-primary/50 text-primary",
                !favoritesOnly && "sm:min-w-32"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="max-w-20 truncate sm:max-w-none">{genre || "Thể loại"}</span>
              {activeFilterCount > 0 && !genre && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="scrollbar-thin max-h-80 overflow-y-auto p-2">
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent",
                  !genre && "font-medium text-primary"
                )}
                onClick={() => setQuery({ genre: null, page: null })}
              >
                Tất cả thể loại
              </button>
              {(genresData?.genres ?? []).map((g) => (
                <button
                  key={g.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent",
                    genre === g.name && "font-medium text-primary"
                  )}
                  onClick={() => setQuery({ genre: g.name === genre ? null : g.name, page: null })}
                >
                  <Checkbox checked={genre === g.name} className="pointer-events-none" />
                  <span className="flex-1 truncate text-left">{g.name}</span>
                  <span className="text-xs text-muted-foreground">{g.mangaCount}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Select
          value={status || "all"}
          onValueChange={(v) => setQuery({ status: v === "all" ? null : v, page: null })}
        >
          <SelectTrigger className="h-9 w-[125px] sm:w-[150px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={`${sort}:${order}`}
          onValueChange={(v) => {
            const [s, o] = v.split(":");
            setQuery({ sort: s, order: o, page: null });
          }}
        >
          <SelectTrigger className="h-9 w-[140px] sm:w-[190px]">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={`${opt.value}:desc`} value={`${opt.value}:desc`}>
                {opt.label} ↓
              </SelectItem>
            ))}
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={`${opt.value}:asc`} value={`${opt.value}:asc`}>
                {opt.label} ↑
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex overflow-hidden rounded-lg border">
          <button
            className={cn(
              "flex h-9 w-9 items-center justify-center transition-colors",
              view === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setView("grid")}
            aria-label="Xem dạng lưới"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            className={cn(
              "flex h-9 w-9 items-center justify-center transition-colors",
              view === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setView("list")}
            aria-label="Xem dạng danh sách"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Noi dung */}
      {isError ? (
        <ErrorState
          message={(error as Error)?.message ?? "Không tải được thư viện."}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        view === "grid" ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 min-[420px]:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-2.5">
                <Skeleton className="aspect-[2/3] rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        )
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={
            activeFilterCount > 0
              ? "Không có truyện khớp bộ lọc"
              : favoritesOnly
                ? "Chưa có truyện yêu thích"
                : "Thư viện đang trống"
          }
          description={
            activeFilterCount > 0
              ? "Thử bỏ bớt điều kiện lọc hoặc tìm với từ khóa khác."
              : favoritesOnly
                ? "Nhấn vào trái tim ở trang chi tiết truyện để thêm vào yêu thích."
                : "Thêm nhiều truyện cùng lúc bằng cách chọn thư mục chứa các bộ truyện."
          }
          action={
            activeFilterCount > 0 ? (
              <Button variant="outline" onClick={() => navigate(favoritesOnly ? "/favorites" : "/library")}>
                Xóa bộ lọc
              </Button>
            ) : !favoritesOnly ? (
              <Button className="gap-2" onClick={() => navigate("/upload")}>
                <Plus className="h-4 w-4" />
                Thêm truyện
              </Button>
            ) : undefined
          }
        />
      ) : data ? (
        <>
          {view === "grid" ? (
            <MangaGrid mangas={data.items} />
          ) : (
            <div className="space-y-3">
              {data.items.map((m, i) => (
                <MangaListRow key={m.id} manga={m} index={i} />
              ))}
            </div>
          )}

          {/* Phan trang */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setQuery({ page: String(page - 1) })}
              >
                Trước
              </Button>
              <span className="px-2 font-mono text-sm tabular-nums text-muted-foreground">
                {page} / {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setQuery({ page: String(page + 1) })}
              >
                Sau
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
