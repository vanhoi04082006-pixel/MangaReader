// =============================================================
// Zod schemas — validate moi input vao API
// =============================================================

import { z } from "zod";

export const MANGA_STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"] as const;
export type MangaStatus = (typeof MANGA_STATUSES)[number];

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB / anh (gioi han tuyet doi)

/**
 * Gioi han upload qua proxy server (fallback). Tren Vercel, body request
 * toi serverless function bi gioi han ~4.5MB — file lon hon PHAI upload
 * truc tiep browser -> R2 bang presigned PUT (can CORS cho bucket).
 */
export const MAX_PROXY_FILE_SIZE = 4 * 1024 * 1024; // 4MB (de du phong cho Vercel 4.5MB)

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Vui lòng nhập email").email("Email không hợp lệ"),
  password: z.string().min(1, "Vui lòng nhập mật khẩu").max(200),
});

export const mangaCreateSchema = z.object({
  title: z.string().trim().min(1, "Tên truyện không được để trống").max(300),
  alternativeTitles: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(8000).optional().nullable(),
  author: z.string().trim().max(200).optional().nullable(),
  artist: z.string().trim().max(200).optional().nullable(),
  status: z.enum(MANGA_STATUSES).default("ONGOING"),
  publicationYear: z
    .number()
    .int()
    .min(1900, "Năm xuất bản không hợp lệ")
    .max(2100, "Năm xuất bản không hợp lệ")
    .optional()
    .nullable(),
  genres: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  /** "Nguồn" từ info.txt — dung de check trung (migration 0002, optional) */
  sourceUrl: z.string().trim().max(500).optional().nullable(),
});

export const mangaUpdateSchema = mangaCreateSchema.partial();

export const chapterCreateSchema = z.object({
  chapterNumber: z
    .string()
    .trim()
    .min(1, "Số chương không được để trống")
    .max(50, "Số chương quá dài"),
  title: z.string().trim().max(300).optional().nullable(),
  volume: z.string().trim().max(50).optional().nullable(),
});

export const chapterUpdateSchema = chapterCreateSchema.partial();

export const presignSchema = z.object({
  kind: z.enum(["PAGE", "COVER"]),
  mangaId: z.uuid("ID truyện không hợp lệ"),
  chapterId: z.uuid("ID chương không hợp lệ").optional().nullable(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(IMAGE_MIME_TYPES, { message: "Định dạng ảnh không được hỗ trợ (chấp nhận JPEG/PNG/WebP/AVIF/GIF)" }),
  fileSize: z
    .number()
    .int()
    .positive("Kích thước file không hợp lệ")
    .max(MAX_FILE_SIZE, "Mỗi ảnh tối đa 100MB"),
  pageNumber: z.number().int().min(1).max(100000).optional().nullable(),
});

export const pageMetaSchema = z.object({
  objectKey: z.string().min(1).max(500),
  pageNumber: z.number().int().min(1).max(100000),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  width: z.number().int().positive().max(100000).optional().nullable(),
  height: z.number().int().positive().max(100000).optional().nullable(),
  /** Placeholder mo base64 JPEG ~16px — sinh client-side (canvas), hien trang khi dang tai (migration 0003) */
  lqip: z.string().max(4000).optional().nullable(),
});

export const pagesFinalizeSchema = z.object({
  chapterId: z.uuid("ID chương không hợp lệ").optional(), // route param cung cap
  pages: z.array(pageMetaSchema).min(1, "Không có trang nào để lưu").max(3000),
});

export const uploadsAbortSchema = z.object({
  objectKeys: z.array(z.string().min(1).max(500)).min(1).max(3000),
});

export const coverFinalizeSchema = z.object({
  mangaId: z.uuid(),
  objectKey: z.string().min(1).max(500),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  /** Placeholder mo base64 JPEG ~16px + mau chu dao (hex) — sinh client-side (migration 0003) */
  coverLqip: z.string().max(4000).optional().nullable(),
  coverColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
});

export const setCoverFromPageSchema = z.object({
  pageId: z.uuid("ID trang không hợp lệ"),
});

export const progressSchema = z.object({
  mangaId: z.uuid(),
  chapterId: z.uuid(),
  pageNumber: z.number().int().min(1).max(100000),
  scrollPosition: z.number().min(0).max(1).default(0),
});

export const genreCreateSchema = z.object({
  name: z.string().trim().min(1, "Tên thể loại không được để trống").max(60),
});

export const mangaListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  genre: z.string().trim().max(60).optional(),
  status: z.enum(MANGA_STATUSES).optional(),
  sort: z.enum(["title", "createdAt", "updatedAt", "lastRead"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  favorites: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export const mangaDuplicateCheckQuerySchema = z.object({
  title: z.string().trim().min(1, "Thiếu tên truyện").max(300),
  sourceUrl: z.string().trim().max(500).optional(),
});

export const chapterListQuerySchema = z.object({
  sort: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const storageAuditQuerySchema = z.object({
  continuationToken: z.string().max(1000).optional(),
});

export const cleanupSchema = z.object({
  maxAgeHours: z.coerce.number().int().min(1).max(720).default(24),
  dryRun: z.boolean().default(true),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MangaCreateInput = z.infer<typeof mangaCreateSchema>;
export type MangaUpdateInput = z.infer<typeof mangaUpdateSchema>;
export type ChapterCreateInput = z.infer<typeof chapterCreateSchema>;
export type ChapterUpdateInput = z.infer<typeof chapterUpdateSchema>;
export type PresignInput = z.infer<typeof presignSchema>;
export type PagesFinalizeInput = z.infer<typeof pagesFinalizeSchema>;
export type ProgressInput = z.infer<typeof progressSchema>;
