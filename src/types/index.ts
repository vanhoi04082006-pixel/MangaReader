// =============================================================
// Shared domain types (API DTOs) — dung chung client/server
// =============================================================

import type { MangaStatus } from "@/schemas";

export interface AuthUser {
  id: string;
  email: string;
  provider: "supabase" | "local";
}

export interface GenreDto {
  id: string;
  name: string;
  mangaCount: number;
}

export interface MangaProgressInfo {
  chapterId: string;
  chapterNumber: string;
  pageNumber: number;
  pageCount: number;
  updatedAt: string;
}

export interface MangaSummaryDto {
  id: string;
  title: string;
  author: string | null;
  status: MangaStatus;
  coverImageKey: string | null;
  /** presigned GET — sinh boi attachCoverUrls() tai route; optional tai tang service */
  coverUrl?: string | null;
  genres: string[];
  chapterCount: number;
  pageCount: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  progress: MangaProgressInfo | null;
}

export interface MangaDetailDto extends MangaSummaryDto {
  alternativeTitles: string | null;
  description: string | null;
  artist: string | null;
  publicationYear: number | null;
  /** "Nguồn" (info.txt) — null nếu DB chưa chạy migration 0002 */
  sourceUrl: string | null;
  sizeBytes: number;
}

/** Kết quả check trùng truyện (GET /api/mangas/check-duplicate) */
export interface DuplicateMatchDto {
  id: string;
  title: string;
  alternativeTitles: string | null;
  sourceUrl: string | null;
  /** Khớp theo tiêu chí nào */
  by: "title" | "altTitle" | "sourceUrl";
}

export interface ChapterDto {
  id: string;
  mangaId: string;
  chapterNumber: string;
  title: string | null;
  volume: string | null;
  pageCount: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface PageDto {
  id: string;
  pageNumber: number;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
}

export interface ReaderPageDto {
  pageNumber: number;
  url: string; // presigned GET — co thoi han, KHONG luu vao DB
  width: number | null;
  height: number | null;
  fileSize: number;
  mimeType: string;
}

export interface ReaderPayloadDto {
  manga: { id: string; title: string };
  chapter: { id: string; chapterNumber: string; title: string | null; volume: string | null; pageCount: number };
  pages: ReaderPageDto[];
  prevChapter: { id: string; chapterNumber: string } | null;
  nextChapter: { id: string; chapterNumber: string } | null;
  progress: { pageNumber: number; scrollPosition: number } | null;
}

export interface ContinueReadingItemDto {
  mangaId: string;
  mangaTitle: string;
  coverImageKey: string | null;
  coverUrl?: string | null;
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string | null;
  pageNumber: number;
  pageCount: number;
  updatedAt: string;
}

export interface RecentUploadItemDto {
  id: string;
  fileName: string | null;
  kind: string;
  fileSize: number;
  createdAt: string;
  mangaTitle: string | null;
  chapterNumber: string | null;
}

export interface DashboardDto {
  mangaCount: number;
  chapterCount: number;
  pageCount: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  favoriteCount: number;
  genreCount: number;
  continueReading: ContinueReadingItemDto[];
  recentlyAdded: MangaSummaryDto[];
  recentUploads: RecentUploadItemDto[];
}

export interface HistoryEntryDto {
  id: string;
  mangaId: string;
  mangaTitle: string;
  coverImageKey: string | null;
  coverUrl?: string | null;
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string | null;
  pageNumber: number;
  pageCount: number;
  readAt: string;
}

export interface MangaStorageUsageDto {
  mangaId: string;
  title: string;
  fileCount: number;
  sizeBytes: number;
  chapterCount: number;
}

export interface StorageStatsDto {
  totalBytes: number;
  totalFiles: number;
  quotaBytes: number;
  mangaCount: number;
  chapterCount: number;
  pageCount: number;
  perManga: MangaStorageUsageDto[];
  largestFiles: Array<{
    objectKey: string;
    fileName: string | null;
    fileSize: number;
    mangaTitle: string | null;
    chapterNumber: string | null;
    createdAt: string;
  }>;
  pendingObjects: number;
  /** Object dan dau DELETE_PENDING (xoa R2 that bai — cho retry). */
  deletePendingObjects: number;
  /** Breakdown dung luong cho UI: bytes cac object PENDING (chua finalize). */
  pendingBytes: number;
  /** Breakdown dung luong cho UI: bytes cac object DELETE_PENDING. */
  deletePendingBytes: number;
}

export interface OrphanAuditItemDto {
  objectKey: string;
  size: number;
}

export interface PresignResponseDto {
  objectKey: string;
  uploadUrl: string;
  storageObjectId: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CoverUrlCacheEntry {
  key: string;
  url: string;
  expiresAt: number;
}
