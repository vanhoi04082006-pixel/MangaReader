// =============================================================
// Reading progress + history service
// =============================================================

import { db } from "@/lib/db";
import type { ProgressInput } from "@/schemas";
import type { ContinueReadingItemDto, HistoryEntryDto, Paginated } from "@/types";

export async function saveProgress(userId: string, input: ProgressInput) {
  const chapter = await db.chapter.findUnique({
    where: { id: input.chapterId },
    select: { id: true, mangaId: true, pageCount: true },
  });
  if (!chapter || chapter.mangaId !== input.mangaId) return null;

  const pageNumber = Math.min(Math.max(1, input.pageNumber), Math.max(1, chapter.pageCount));

  const [progress] = await db.$transaction([
    db.readingProgress.upsert({
      where: { userId_mangaId: { userId, mangaId: input.mangaId } },
      update: {
        chapterId: input.chapterId,
        pageNumber,
        scrollPosition: input.scrollPosition,
      },
      create: {
        userId,
        mangaId: input.mangaId,
        chapterId: input.chapterId,
        pageNumber,
        scrollPosition: input.scrollPosition,
      },
    }),
    db.readingHistory.upsert({
      where: { userId_chapterId: { userId, chapterId: input.chapterId } },
      update: { pageNumber, readAt: new Date() },
      create: {
        userId,
        mangaId: input.mangaId,
        chapterId: input.chapterId,
        pageNumber,
      },
    }),
  ]);
  return progress;
}

export async function continueReading(userId: string, limit = 10): Promise<ContinueReadingItemDto[]> {
  const rows = await db.readingProgress.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      manga: { select: { id: true, title: true, coverImageKey: true } },
      chapter: { select: { id: true, chapterNumber: true, title: true, pageCount: true } },
    },
  });
  return rows.map((r) => ({
    mangaId: r.manga.id,
    mangaTitle: r.manga.title,
    coverImageKey: r.manga.coverImageKey,
    chapterId: r.chapter.id,
    chapterNumber: r.chapter.chapterNumber,
    chapterTitle: r.chapter.title,
    pageNumber: r.pageNumber,
    pageCount: r.chapter.pageCount,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listHistory(
  userId: string,
  page: number,
  pageSize: number
): Promise<Paginated<HistoryEntryDto>> {
  const where = { userId };
  const [total, rows] = await Promise.all([
    db.readingHistory.count({ where }),
    db.readingHistory.findMany({
      where,
      orderBy: { readAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        manga: { select: { id: true, title: true, coverImageKey: true } },
        chapter: { select: { id: true, chapterNumber: true, title: true, pageCount: true } },
      },
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      mangaId: r.manga.id,
      mangaTitle: r.manga.title,
      coverImageKey: r.manga.coverImageKey,
      chapterId: r.chapter.id,
      chapterNumber: r.chapter.chapterNumber,
      chapterTitle: r.chapter.title,
      pageNumber: r.pageNumber,
      pageCount: r.chapter.pageCount,
      readAt: r.readAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function deleteHistoryForManga(userId: string, mangaId: string) {
  await db.readingHistory.deleteMany({ where: { userId, mangaId } });
}

export async function clearHistory(userId: string) {
  await db.readingHistory.deleteMany({ where: { userId } });
}
