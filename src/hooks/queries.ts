"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/client/api";
import type {
  AuthUser,
  ChapterDto,
  DashboardDto,
  GenreDto,
  HistoryEntryDto,
  MangaDetailDto,
  MangaSummaryDto,
  PageDto,
  Paginated,
  ReaderPayloadDto,
  StorageStatsDto,
} from "@/types";
import type {
  MangaCreateInput,
  MangaUpdateInput,
  ChapterCreateInput,
  ChapterUpdateInput,
  ProgressInput,
  MangaStatus,
} from "@/schemas";

// ---------------- Query keys ----------------

export const qk = {
  dashboard: ["dashboard"] as const,
  mangas: (filters: string) => ["mangas", filters] as const,
  manga: (id: string) => ["manga", id] as const,
  chapters: (mangaId: string, sort: string, page: number, pageSize: number) =>
    ["chapters", mangaId, sort, page, pageSize] as const,
  chapter: (id: string) => ["chapter", id] as const,
  reader: (id: string) => ["reader", id] as const,
  genres: ["genres"] as const,
  history: (page: number) => ["history", page] as const,
  storageStats: ["storage-stats"] as const,
};

// ---------------- Queries ----------------

export function useDashboard() {
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardDto>("/api/dashboard"),
  });
}

export interface MangaFilters {
  search?: string;
  genre?: string;
  status?: MangaStatus | "";
  sort?: "title" | "createdAt" | "updatedAt" | "lastRead";
  order?: "asc" | "desc";
  favorites?: boolean;
  page?: number;
  pageSize?: number;
}

export function mangaFiltersToQuery(filters: MangaFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.genre) params.set("genre", filters.genre);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.favorites) params.set("favorites", "true");
  params.set("page", String(filters.page ?? 1));
  params.set("pageSize", String(filters.pageSize ?? 24));
  return params.toString();
}

export function useMangas(filters: MangaFilters) {
  const qs = mangaFiltersToQuery(filters);
  return useQuery({
    queryKey: qk.mangas(qs),
    queryFn: () => api.get<Paginated<MangaSummaryDto>>(`/api/mangas?${qs}`),
    placeholderData: (prev) => prev,
  });
}

export function useManga(id: string | null) {
  return useQuery({
    queryKey: qk.manga(id ?? "none"),
    queryFn: () => api.get<MangaDetailDto>(`/api/mangas/${id}`),
    enabled: Boolean(id),
  });
}

export function useChapters(mangaId: string | null, sort: "asc" | "desc" = "desc", page = 1, pageSize = 100) {
  return useQuery({
    queryKey: qk.chapters(mangaId ?? "none", sort, page, pageSize),
    queryFn: () =>
      api.get<Paginated<ChapterDto>>(`/api/mangas/${mangaId}/chapters?sort=${sort}&page=${page}&pageSize=${pageSize}`),
    enabled: Boolean(mangaId),
    placeholderData: (prev) => prev,
  });
}

export interface ChapterDetail {
  chapter: ChapterDto;
  pages: Array<PageDto & { url: string }>;
}

export function useChapter(id: string | null) {
  return useQuery({
    queryKey: qk.chapter(id ?? "none"),
    queryFn: () => api.get<ChapterDetail>(`/api/chapters/${id}`),
    enabled: Boolean(id),
  });
}

export function useReaderPayload(chapterId: string | null) {
  return useQuery({
    queryKey: qk.reader(chapterId ?? "none"),
    queryFn: () => api.get<ReaderPayloadDto>(`/api/chapters/${chapterId}/reader`),
    enabled: Boolean(chapterId),
    staleTime: 10 * 60 * 1000, // presigned URL song 1h — cache 10p la an toan
    retry: 1,
  });
}

export function useGenres() {
  return useQuery({
    queryKey: qk.genres,
    queryFn: () => api.get<{ genres: GenreDto[] }>("/api/genres"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useHistory(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: qk.history(page),
    queryFn: () => api.get<Paginated<HistoryEntryDto>>(`/api/history?page=${page}&pageSize=${pageSize}`),
    placeholderData: (prev) => prev,
  });
}

export function useStorageStats(options?: Partial<UseQueryOptions<StorageStatsDto>>) {
  return useQuery({
    queryKey: qk.storageStats,
    queryFn: () => api.get<StorageStatsDto>("/api/storage/stats"),
    ...options,
  });
}

// ---------------- Mutations ----------------

function useInvalidators() {
  const qc = useQueryClient();
  return {
    invalidateMangas: () => qc.invalidateQueries({ queryKey: ["mangas"] }),
    invalidateManga: (id: string) => qc.invalidateQueries({ queryKey: ["manga", id] }),
    invalidateChapters: (mangaId: string) => qc.invalidateQueries({ queryKey: ["chapters", mangaId] }),
    invalidateChapter: (id: string) => qc.invalidateQueries({ queryKey: ["chapter", id] }),
    invalidateDashboard: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
    invalidateHistory: () => qc.invalidateQueries({ queryKey: ["history"] }),
    invalidateStorage: () => qc.invalidateQueries({ queryKey: ["storage-stats"] }),
    invalidateReader: (id: string) => qc.invalidateQueries({ queryKey: ["reader", id] }),
  };
}

export function useCreateManga() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (input: MangaCreateInput) => api.post<{ id: string }>("/api/mangas", input),
    onSuccess: () => {
      inv.invalidateMangas();
      inv.invalidateDashboard();
    },
  });
}

export function useUpdateManga() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MangaUpdateInput }) =>
      api.patch(`/api/mangas/${id}`, input),
    onSuccess: (_data, vars) => {
      inv.invalidateManga(vars.id);
      inv.invalidateMangas();
      inv.invalidateDashboard();
    },
  });
}

export function useDeleteManga() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean }>(`/api/mangas/${id}`),
    onSuccess: () => {
      inv.invalidateMangas();
      inv.invalidateDashboard();
      inv.invalidateStorage();
    },
  });
}

export function useToggleFavorite() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (mangaId: string) =>
      api.post<{ favorited: boolean }>(`/api/mangas/${mangaId}/favorite`),
    onSuccess: (_data, mangaId) => {
      inv.invalidateManga(mangaId);
      inv.invalidateMangas();
      inv.invalidateDashboard();
    },
  });
}

export function useCreateChapter() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ mangaId, input }: { mangaId: string; input: ChapterCreateInput }) =>
      api.post<{ id: string }>(`/api/mangas/${mangaId}/chapters`, input),
    onSuccess: (_data, vars) => {
      inv.invalidateChapters(vars.mangaId);
      inv.invalidateManga(vars.mangaId);
      inv.invalidateDashboard();
    },
  });
}

export function useUpdateChapter() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, input, mangaId }: { id: string; input: ChapterUpdateInput; mangaId: string }) =>
      api.patch(`/api/chapters/${id}`, input),
    onSuccess: (_data, vars) => {
      inv.invalidateChapters(vars.mangaId);
      inv.invalidateChapter(vars.id);
      inv.invalidateManga(vars.mangaId);
      inv.invalidateDashboard();
    },
  });
}

export function useDeleteChapter() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ id, mangaId }: { id: string; mangaId: string }) =>
      api.del<{ deleted: boolean }>(`/api/chapters/${id}`),
    onSuccess: (_data, vars) => {
      inv.invalidateChapters(vars.mangaId);
      inv.invalidateManga(vars.mangaId);
      inv.invalidateDashboard();
      inv.invalidateStorage();
    },
  });
}

export function useDeletePage() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ chapterId, pageId }: { chapterId: string; pageId: string }) =>
      api.del<{ pageCount: number }>(`/api/chapters/${chapterId}/pages/${pageId}`),
    onSuccess: (_data, vars) => {
      inv.invalidateChapter(vars.chapterId);
      inv.invalidateStorage();
    },
  });
}

export function useClearPages() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (chapterId: string) =>
      api.del<{ cleared: number }>(`/api/chapters/${chapterId}/pages`),
    onSuccess: (_data, chapterId) => {
      inv.invalidateChapter(chapterId);
      inv.invalidateStorage();
    },
  });
}

export function useSaveProgress() {
  return useMutation({
    mutationFn: (input: ProgressInput) => api.put<{ saved: boolean }>("/api/progress", input),
    // im lặng — progress luu ngam
  });
}

export function useSetCoverFromPage() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: ({ mangaId, pageId }: { mangaId: string; pageId: string }) =>
      api.post<{ coverImageKey: string }>(`/api/mangas/${mangaId}/cover/from-page`, { pageId }),
    onSuccess: (_data, vars) => {
      inv.invalidateManga(vars.mangaId);
      inv.invalidateMangas();
      inv.invalidateStorage();
    },
  });
}

export function useDeleteHistory() {
  const inv = useInvalidators();
  return useMutation({
    mutationFn: (mangaId: string | null) =>
      mangaId
        ? api.del(`/api/history?mangaId=${mangaId}`)
        : api.del("/api/history"),
    onSuccess: () => {
      inv.invalidateHistory();
      inv.invalidateDashboard();
    },
  });
}

export function useRefreshReader() {
  const qc = useQueryClient();
  return {
    refresh: (chapterId: string) =>
      qc.invalidateQueries({ queryKey: qk.reader(chapterId) }),
  };
}

/** Bao loi thong nhat cho mutations (goi trong onError cua component) */
export function toastMutationError(err: unknown, fallback = "Thao tác thất bại.") {
  if (err instanceof ApiClientError) toast.error(err.message);
  else toast.error(fallback);
}

export type { AuthUser };
