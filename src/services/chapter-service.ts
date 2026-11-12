// =============================================================
// Chapter service: CRUD, pages finalize (upload), reader payload,
// xoa chapter/page dong bo DB + R2
// =============================================================

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { deleteObjects, presignGet } from "@/lib/r2";
import { getChapterOrder } from "@/services/manga-service";
import type { ChapterCreateInput, ChapterUpdateInput, PagesFinalizeInput } from "@/schemas";
import type { ChapterDto, ReaderPayloadDto, PageDto, Paginated } from "@/types";
import { naturalCompare } from "@/utils/natural-sort";

async function chapterSizeMap(chapterIds: string[]): Promise<Map<string, number>> {
  if (chapterIds.length === 0) return new Map();
  const agg = await db.storageObject.groupBy({
    by: ["chapterId"],
    where: { chapterId: { in: chapterIds }, status: "CONFIRMED" },
    _sum: { fileSize: true },
  });
  return new Map(agg.map((a) => [a.chapterId as string, a._sum.fileSize ?? 0]));
}

export async function listChapters(
  mangaId: string,
  sort: "asc" | "desc",
  page: number,
  pageSize: number
): Promise<Paginated<ChapterDto>> {
  const [total, chapters] = await Promise.all([
    db.chapter.count({ where: { mangaId } }),
    db.chapter.findMany({
      where: { mangaId },
      orderBy: { createdAt: sort === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const sizeMap = await chapterSizeMap(chapters.map((c) => c.id));

  const items: ChapterDto[] = chapters.map((c) => ({
    id: c.id,
    mangaId: c.mangaId,
    chapterNumber: c.chapterNumber,
    title: c.title,
    volume: c.volume,
    pageCount: c.pageCount,
    sizeBytes: sizeMap.get(c.id) ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  // Sap xep lai theo so chuong thu tu tu nhien
  items.sort((a, b) => {
    const cmp = naturalCompare(a.chapterNumber, b.chapterNumber);
    return sort === "asc" ? cmp : -cmp;
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createChapter(mangaId: string, input: ChapterCreateInput) {
  const manga = await db.manga.findUnique({ where: { id: mangaId }, select: { id: true } });
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");
  const duplicate = await db.chapter.findFirst({
    where: { mangaId, chapterNumber: input.chapterNumber },
    select: { id: true },
  });
  if (duplicate) {
    throw new ApiError(`Chương "${input.chapterNumber}" đã tồn tại trong truyện này.`, 409, "chapter_exists");
  }
  return db.chapter.create({
    data: {
      mangaId,
      chapterNumber: input.chapterNumber,
      title: input.title ?? null,
      volume: input.volume ?? null,
    },
  });
}

export async function updateChapter(chapterId: string, input: ChapterUpdateInput) {
  const chapter = await db.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");
  if (
    input.chapterNumber !== undefined &&
    input.chapterNumber !== chapter.chapterNumber
  ) {
    const duplicate = await db.chapter.findFirst({
      where: { mangaId: chapter.mangaId, chapterNumber: input.chapterNumber, id: { not: chapterId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(`Chương "${input.chapterNumber}" đã tồn tại trong truyện này.`, 409, "chapter_exists");
    }
  }
  return db.chapter.update({
    where: { id: chapterId },
    data: {
      ...(input.chapterNumber !== undefined ? { chapterNumber: input.chapterNumber } : {}),
      ...(input.title !== undefined ? { title: input.title ?? null } : {}),
      ...(input.volume !== undefined ? { volume: input.volume ?? null } : {}),
    },
  });
}

export async function deleteChapter(chapterId: string) {
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    include: { pages: { select: { objectKey: true } } },
  });
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");

  const keys = chapter.pages.map((p) => p.objectKey);

  // 1) Xoa DB (cascade pages/progress/history)
  await db.chapter.delete({ where: { id: chapterId } });

  // 2) Xoa objects tren R2 (best-effort)
  try {
    if (keys.length > 0) await deleteObjects(keys);
  } catch (err) {
    console.error("[chapter-service] R2 delete failed:", err);
  }

  // 3) Xoa metadata
  await db.storageObject.deleteMany({ where: { objectKey: { in: keys } } }).catch(() => undefined);

  return { deleted: true, objectsRemoved: keys.length };
}

export async function listPages(chapterId: string): Promise<PageDto[]> {
  const pages = await db.page.findMany({
    where: { chapterId },
    orderBy: { pageNumber: "asc" },
  });
  return pages.map((p) => ({
    id: p.id,
    pageNumber: p.pageNumber,
    objectKey: p.objectKey,
    fileName: p.fileName,
    mimeType: p.mimeType,
    fileSize: p.fileSize,
    width: p.width,
    height: p.height,
  }));
}

/**
 * Finalize upload: ghi nhan pages vao DB (upsert theo so trang),
 * confirm StorageObject, cap nhat pageCount. Xu ly retry an toan:
 * neu upload lai trang da co -> object cu thanh orphan -> cleanup.
 */
export async function finalizePages(input: PagesFinalizeInput) {
  const chapter = await db.chapter.findUnique({
    where: { id: input.chapterId },
    select: { id: true, mangaId: true },
  });
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");

  const pageNumbers = input.pages.map((p) => p.pageNumber);
  const uniqueNumbers = new Set(pageNumbers);
  if (uniqueNumbers.size !== pageNumbers.length) {
    throw new ApiError("Có số trang bị trùng lặp trong dữ liệu gửi lên.", 400, "duplicate_page");
  }

  // Trang da ton tai (cho phat hien retry doi object key)
  const existing = await db.page.findMany({
    where: { chapterId: chapter.id, pageNumber: { in: pageNumbers } },
    select: { pageNumber: true, objectKey: true },
  });
  const existingMap = new Map(existing.map((e) => [e.pageNumber, e.objectKey]));

  const replacedOldKeys: string[] = [];
  for (const p of input.pages) {
    const oldKey = existingMap.get(p.pageNumber);
    if (oldKey && oldKey !== p.objectKey) replacedOldKeys.push(oldKey);
  }

  await db.$transaction(async (tx) => {
    for (const p of input.pages) {
      await tx.page.upsert({
        where: { chapterId_pageNumber: { chapterId: chapter.id, pageNumber: p.pageNumber } },
        update: {
          objectKey: p.objectKey,
          fileName: p.fileName,
          mimeType: p.mimeType,
          fileSize: p.fileSize,
          width: p.width ?? null,
          height: p.height ?? null,
        },
        create: {
          chapterId: chapter.id,
          pageNumber: p.pageNumber,
          objectKey: p.objectKey,
          fileName: p.fileName,
          mimeType: p.mimeType,
          fileSize: p.fileSize,
          width: p.width ?? null,
          height: p.height ?? null,
        },
      });
    }

    // Confirm storage objects
    for (const p of input.pages) {
      await tx.storageObject.upsert({
        where: { objectKey: p.objectKey },
        update: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          chapterId: chapter.id,
          mangaId: chapter.mangaId,
          fileName: p.fileName,
          fileSize: p.fileSize,
          mimeType: p.mimeType,
        },
        create: {
          objectKey: p.objectKey,
          kind: "PAGE",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          chapterId: chapter.id,
          mangaId: chapter.mangaId,
          fileName: p.fileName,
          fileSize: p.fileSize,
          mimeType: p.mimeType,
        },
      });
    }

    const total = await tx.page.count({ where: { chapterId: chapter.id } });
    await tx.chapter.update({ where: { id: chapter.id }, data: { pageCount: total } });
  });

  // Cleanup object bi thay the (ngoai transaction — best effort)
  if (replacedOldKeys.length > 0) {
    try {
      await deleteObjects(replacedOldKeys);
      await db.storageObject.deleteMany({ where: { objectKey: { in: replacedOldKeys } } });
    } catch (err) {
      console.error("[chapter-service] replaced key cleanup failed:", err);
    }
  }

  const pageCount = await db.page.count({ where: { chapterId: chapter.id } });
  return { chapterId: chapter.id, pageCount };
}

/** Xoa 1 trang: R2 object + row + cap nhat pageCount */
export async function deletePage(pageId: string) {
  const page = await db.page.findUnique({ where: { id: pageId }, include: { chapter: true } });
  if (!page) throw new ApiError("Không tìm thấy trang.", 404, "not_found");

  await db.page.delete({ where: { id: pageId } });
  const pageCount = await db.page.count({ where: { chapterId: page.chapterId } });
  await db.chapter.update({ where: { id: page.chapterId }, data: { pageCount } });

  try {
    await deleteObjects([page.objectKey]);
  } catch (err) {
    console.error("[chapter-service] page R2 delete failed:", err);
  }
  await db.storageObject.deleteMany({ where: { objectKey: page.objectKey } }).catch(() => undefined);

  return { deleted: true, pageCount };
}

/** Xoa toan bo trang cua chuong (che do "thay the toan bo") */
export async function clearPages(chapterId: string) {
  const pages = await db.page.findMany({
    where: { chapterId },
    select: { objectKey: true },
  });
  const keys = pages.map((p) => p.objectKey);

  await db.page.deleteMany({ where: { chapterId } });
  await db.chapter.update({ where: { id: chapterId }, data: { pageCount: 0 } });

  try {
    if (keys.length > 0) await deleteObjects(keys);
  } catch (err) {
    console.error("[chapter-service] clear pages R2 delete failed:", err);
  }
  await db.storageObject.deleteMany({ where: { objectKey: { in: keys } } }).catch(() => undefined);

  return { cleared: keys.length };
}

/** Payload cho Reader: pages + presigned URLs + prev/next + progress */
export async function getReaderPayload(
  mangaId: string,
  chapterId: string,
  userId: string
): Promise<ReaderPayloadDto | null> {
  const [manga, chapter] = await Promise.all([
    db.manga.findUnique({ where: { id: mangaId }, select: { id: true, title: true } }),
    db.chapter.findUnique({ where: { id: chapterId } }),
  ]);
  if (!manga || !chapter || chapter.mangaId !== mangaId) return null;

  const [pages, order, progress] = await Promise.all([
    db.page.findMany({
      where: { chapterId },
      orderBy: { pageNumber: "asc" },
    }),
    getChapterOrder(mangaId),
    db.readingProgress.findUnique({
      where: { userId_mangaId: { userId, mangaId } },
      select: { pageNumber: true, scrollPosition: true, chapterId: true },
    }),
  ]);

  const urls = await Promise.all(pages.map((p) => presignGet(p.objectKey)));

  const idx = order.findIndex((c) => c.id === chapterId);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  return {
    manga: { id: manga.id, title: manga.title },
    chapter: {
      id: chapter.id,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      volume: chapter.volume,
      pageCount: chapter.pageCount,
    },
    pages: pages.map((p, i) => ({
      pageNumber: p.pageNumber,
      url: urls[i],
      width: p.width,
      height: p.height,
      fileSize: p.fileSize,
      mimeType: p.mimeType,
    })),
    prevChapter: prev ? { id: prev.id, chapterNumber: prev.chapterNumber } : null,
    nextChapter: next ? { id: next.id, chapterNumber: next.chapterNumber } : null,
    progress:
      progress && progress.chapterId === chapterId
        ? { pageNumber: progress.pageNumber, scrollPosition: progress.scrollPosition }
        : null,
  };
}
