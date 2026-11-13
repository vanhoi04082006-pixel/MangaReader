// =============================================================
// Dashboard service: tong hop so lieu thuc te tu DB
// =============================================================

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { continueReading } from "@/services/progress-service";
import { getMangaSummaries } from "@/services/manga-service";
import type { DashboardDto, RecentUploadItemDto } from "@/types";

export async function getDashboard(userId: string): Promise<DashboardDto> {
  const env = getEnv();

  const [mangaCount, chapterCount, pageCount, storageAgg, favoriteCount, genreCount] =
    await Promise.all([
      db.manga.count(),
      db.chapter.count(),
      db.page.count(),
      db.storageObject.aggregate({
        where: { status: "CONFIRMED" },
        _sum: { fileSize: true },
      }),
      db.favorite.count({ where: { userId } }),
      db.genre.count(),
    ]);

  const [continueList, recentMangas, recentUploadsRaw] = await Promise.all([
    continueReading(userId, 8),
    db.manga.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true },
    }),
    db.storageObject.findMany({
      where: { status: "CONFIRMED", kind: "PAGE" },
      orderBy: { confirmedAt: "desc" },
      take: 10,
      include: {
        manga: { select: { title: true } },
        chapter: { select: { chapterNumber: true } },
      },
    }),
  ]);

  const recentlyAdded = await getMangaSummaries(recentMangas.map((m) => m.id), userId);

  const recentUploads: RecentUploadItemDto[] = recentUploadsRaw.map((u) => ({
    id: u.id,
    fileName: u.fileName,
    kind: u.kind,
    fileSize: Number(u.fileSize),
    createdAt: (u.confirmedAt ?? u.createdAt).toISOString(),
    mangaTitle: u.manga?.title ?? null,
    chapterNumber: u.chapter?.chapterNumber ?? null,
  }));

  return {
    mangaCount,
    chapterCount,
    pageCount,
    storageUsedBytes: Number(storageAgg._sum.fileSize ?? 0),
    storageQuotaBytes: env.storageQuotaBytes,
    favoriteCount,
    genreCount,
    continueReading: continueList,
    recentlyAdded,
    recentUploads,
  };
}
