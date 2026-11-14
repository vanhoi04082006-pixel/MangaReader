// =============================================================
// Dashboard service: tong hop so lieu thuc te tu DB (Supabase REST)
// =============================================================

import { supabase } from "@/lib/supabase";
import { getEnv } from "@/lib/env";
import { continueReading } from "@/services/progress-service";
import { getMangaSummaries } from "@/services/manga-service";
import { getStorageUsageCached } from "@/services/storage-service";
import type { DashboardDto, RecentUploadItemDto } from "@/types";

export async function getDashboard(userId: string): Promise<DashboardDto> {
  const env = getEnv();

  // FIX: dung luong phai la SUM(file_size) cua TOAN BO row CONFIRMED.
  // Cu: 1 query khong phan trang → PostgREST chi tra 1000 row dau →
  // dung luong bi thieu (312MB thay vi ~2.6GB). Nay: helper phan trang
  // + cache 60s (dashboard/sidebar goi lien tuc).
  const [usage, mangaCount, chapterCount, pageCount, favoriteCount, genreCount] =
    await Promise.all([
      getStorageUsageCached(),
      supabase.from("mangas").select("*", { count: "exact", head: true }),
      supabase.from("chapters").select("*", { count: "exact", head: true }),
      supabase.from("pages").select("*", { count: "exact", head: true }),
      supabase.from("favorites").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("genres").select("*", { count: "exact", head: true }),
    ]);

  const storageUsedBytes = usage.confirmedBytes;

  const [continueList, recentMangasRes, recentUploadsRaw] = await Promise.all([
    continueReading(userId, 8),
    supabase.from("mangas").select("id").order("created_at", { ascending: false }).limit(10),
    supabase
      .from("storage_objects")
      .select("*, manga:mangas(title), chapter:chapters(chapter_number)")
      .eq("status", "CONFIRMED")
      .eq("kind", "PAGE")
      .order("confirmed_at", { ascending: false })
      .limit(10),
  ]);

  const recentlyAdded = await getMangaSummaries((recentMangasRes.data ?? []).map((m: any) => m.id), userId);

  const recentUploads: RecentUploadItemDto[] = (recentUploadsRaw.data ?? []).map((u: any) => ({
    id: u.id,
    fileName: u.file_name,
    kind: u.kind,
    fileSize: Number(u.file_size),
    createdAt: (u.confirmed_at ?? u.created_at),
    mangaTitle: u.manga?.title ?? null,
    chapterNumber: u.chapter?.chapter_number ?? null,
  }));

  return {
    mangaCount: mangaCount.count ?? 0,
    chapterCount: chapterCount.count ?? 0,
    pageCount: pageCount.count ?? 0,
    storageUsedBytes,
    storageQuotaBytes: env.storageQuotaBytes,
    favoriteCount: favoriteCount.count ?? 0,
    genreCount: genreCount.count ?? 0,
    continueReading: continueList,
    recentlyAdded,
    recentUploads,
  };
}