// =============================================================
// Chapter service: CRUD, pages finalize (upload), reader payload,
// xoa chapter/page dong bo DB + R2 (idempotent, recoverable)
//
// TOAN VEN DU LIEU (DB <-> R2):
// - finalizePages: verify object TON TAI tren R2 (HeadObject) + dung
//   kich thuoc/mime + thuoc dung manga/chapter TRUOC khi confirm.
// - deleteChapter/deletePage/clearPages: mark DELETE_PENDING -> xoa DB
//   -> xoa R2 (safe) -> chi go metadata khi R2 xac nhan xoa. That bai
//   -> row DELETE_PENDING, cleanup retry sau (khong mat tham chieu).
// =============================================================

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { deleteObjects, presignGet, headObject } from "@/lib/r2";
import { getChapterOrder } from "@/services/manga-service";
import { safeDeleteObjects, removeMetadataIfDeleted } from "@/services/storage-service";
import { MAX_FILE_SIZE } from "@/schemas";
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
  return new Map(agg.map((a) => [a.chapterId as string, Number(a._sum.fileSize ?? 0)]));
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

/**
 * Xoa chapter + pages + objects tren R2 (idempotent, recoverable):
 * 1) Mark StorageObject -> DELETE_PENDING (luu vet truoc khi xoa DB)
 * 2) Xoa DB (cascade pages/progress/history; storageObject FK set null)
 * 3) Xoa tren R2 (safe delete)
 * 4) Chi go metadata khi R2 xac nhan xoa — that bai -> DELETE_PENDING retry
 */
export async function deleteChapter(chapterId: string) {
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    include: { pages: { select: { objectKey: true } } },
  });
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");

  const keys = chapter.pages.map((p) => p.objectKey);

  // 1) Mark DELETE_PENDING (bao gom ca storage object lien quan khac cua chapter)
  if (keys.length > 0) {
    await db.storageObject.updateMany({
      where: { objectKey: { in: keys }, status: { in: ["PENDING", "CONFIRMED"] } },
      data: { status: "DELETE_PENDING" },
    });
  }

  // 2) Xoa DB (cascade)
  await db.chapter.delete({ where: { id: chapterId } });

  // 3) Xoa objects tren R2 + 4) chi go metadata khi xac nhan xoa
  let removedCount = 0;
  let retryNeeded = 0;
  if (keys.length > 0) {
    const result = await safeDeleteObjects(keys);
    removedCount = await removeMetadataIfDeleted(result.removed);
    retryNeeded = result.pending.length;
    if (retryNeeded > 0) {
      console.warn(`[chapter-service] ${retryNeeded} object xoa R2 that bai — giu DELETE_PENDING de retry.`);
    }
  }

  return { deleted: true, objectsRemoved: removedCount, objectsPendingRetry: retryNeeded };
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
    fileSize: Number(p.fileSize),
    width: p.width,
    height: p.height,
  }));
}

/** HeadObject 1 key (cho phep 404 = null). Gop loi de bao cao 1 lan. */
async function verifyObjectsInR2(
  pages: Array<{ objectKey: string; fileSize: number; mimeType: string }>,
  expectedPrefix: string
): Promise<string[]> {
  const problems: string[] = [];
  const CONCURRENCY = 8;
  const queue = [...pages];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      const head = await headObject(p.objectKey);
      if (!head) {
        problems.push(`${p.objectKey}: không tồn tại trên R2 (upload chưa hoàn tất?)`);
        continue;
      }
      if (head.contentLength !== p.fileSize) {
        problems.push(
          `${p.objectKey}: kích thước trên R2 (${head.contentLength}B) khác khai báo (${p.fileSize}B)`
        );
        continue;
      }
      if (head.contentLength > MAX_FILE_SIZE) {
        problems.push(`${p.objectKey}: vượt giới hạn ${MAX_FILE_SIZE} byte`);
        continue;
      }
      // Mime phai khop (chuan hoa image/jpg -> image/jpeg)
      const normalize = (m?: string | null) => (m === "image/jpg" ? "image/jpeg" : m ?? "");
      if (normalize(head.contentType) !== normalize(p.mimeType)) {
        problems.push(
          `${p.objectKey}: Content-Type trên R2 (${head.contentType ?? "?"}) khác khai báo (${p.mimeType})`
        );
      }
      if (!p.objectKey.startsWith(expectedPrefix)) {
        problems.push(`${p.objectKey}: không thuộc namespace ${expectedPrefix}`);
      }
    }
  });
  await Promise.all(workers);
  return problems;
}

/**
 * Finalize upload: verify toan ven (DB metadata + R2 HeadObject) roi
 * moi ghi nhan pages vao DB (upsert theo so trang), confirm
 * StorageObject, cap nhat pageCount.
 *
 * Retry an toan: neu upload lai trang da co -> object cu thanh orphan -> cleanup.
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

  const expectedPrefix = `mangas/${chapter.mangaId}/chapters/${chapter.id}/`;

  // ---- B1: Verify metadata dang ky trong DB ----
  const storageRows = await db.storageObject.findMany({
    where: { objectKey: { in: input.pages.map((p) => p.objectKey) } },
    select: { objectKey: true, kind: true, status: true, mangaId: true, chapterId: true, fileSize: true, mimeType: true },
  });
  const rowMap = new Map(storageRows.map((r) => [r.objectKey, r]));
  const problems: string[] = [];
  for (const p of input.pages) {
    const row = rowMap.get(p.objectKey);
    if (!row) {
      problems.push(`${p.objectKey}: chưa được đăng ký qua /api/uploads/presign`);
      continue;
    }
    if (row.kind !== "PAGE") {
      problems.push(`${p.objectKey}: không phải object PAGE`);
      continue;
    }
    if (row.mangaId !== chapter.mangaId || row.chapterId !== chapter.id) {
      problems.push(`${p.objectKey}: object không thuộc chương/truyện này`);
      continue;
    }
    if (row.status === "DELETE_PENDING") {
      problems.push(`${p.objectKey}: object đang chờ xóa`);
      continue;
    }
    if (Number(row.fileSize) !== p.fileSize) {
      problems.push(`${p.objectKey}: kích thước đăng ký (${Number(row.fileSize)}B) khác gửi lên (${p.fileSize}B)`);
    }
    if (row.mimeType && row.mimeType !== p.mimeType) {
      problems.push(`${p.objectKey}: mime đăng ký (${row.mimeType}) khác gửi lên (${p.mimeType})`);
    }
    if (!p.objectKey.startsWith(expectedPrefix)) {
      problems.push(`${p.objectKey}: không thuộc namespace ${expectedPrefix}`);
    }
  }
  if (problems.length > 0) {
    throw new ApiError(
      `Dữ liệu finalize không hợp lệ: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? " ..." : ""}`,
      400,
      "finalize_invalid"
    );
  }

  // ---- B2: Verify object TON TAI tren R2 (HeadObject) ----
  const r2Problems = await verifyObjectsInR2(
    input.pages.map((p) => ({ objectKey: p.objectKey, fileSize: p.fileSize, mimeType: p.mimeType })),
    expectedPrefix
  );
  if (r2Problems.length > 0) {
    throw new ApiError(
      `Không xác minh được object trên R2: ${r2Problems.slice(0, 5).join("; ")}${r2Problems.length > 5 ? " ..." : ""}`,
      400,
      "r2_verify_failed"
    );
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

  // ---- B3: Ghi nhan DB (transaction) ----
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

    // Confirm storage objects (da verify qua HeadObject o B2)
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

  // ---- B4: Cleanup object bi thay the (ngoai transaction — safe) ----
  if (replacedOldKeys.length > 0) {
    await db.storageObject.updateMany({
      where: { objectKey: { in: replacedOldKeys }, status: { in: ["PENDING", "CONFIRMED"] } },
      data: { status: "DELETE_PENDING" },
    }).catch(() => undefined);
    const result = await safeDeleteObjects(replacedOldKeys);
    await removeMetadataIfDeleted(result.removed).catch(() => undefined);
    if (result.pending.length > 0) {
      console.warn(`[chapter-service] ${result.pending.length} object thay the xoa that bai — DELETE_PENDING retry.`);
    }
  }

  const pageCount = await db.page.count({ where: { chapterId: chapter.id } });
  return { chapterId: chapter.id, pageCount };
}

/** Xoa 1 trang: R2 object + row + cap nhat pageCount (safe delete) */
export async function deletePage(pageId: string) {
  const page = await db.page.findUnique({ where: { id: pageId }, include: { chapter: true } });
  if (!page) throw new ApiError("Không tìm thấy trang.", 404, "not_found");

  // 1) Mark DELETE_PENDING truoc khi xoa DB
  await db.storageObject.updateMany({
    where: { objectKey: page.objectKey, status: { in: ["PENDING", "CONFIRMED"] } },
    data: { status: "DELETE_PENDING" },
  });

  // 2) Xoa DB
  await db.page.delete({ where: { id: pageId } });
  const pageCount = await db.page.count({ where: { chapterId: page.chapterId } });
  await db.chapter.update({ where: { id: page.chapterId }, data: { pageCount } });

  // 3) Xoa R2 + 4) chi go metadata khi xac nhan xoa
  const result = await safeDeleteObjects([page.objectKey]);
  const removedCount = await removeMetadataIfDeleted(result.removed).catch(() => 0);

  return { deleted: true, pageCount, objectsRemoved: removedCount, objectsPendingRetry: result.pending.length };
}

/** Xoa toan bo trang cua chuong (che do "thay the toan bo") — safe delete */
export async function clearPages(chapterId: string) {
  const pages = await db.page.findMany({
    where: { chapterId },
    select: { objectKey: true },
  });
  const keys = pages.map((p) => p.objectKey);

  // 1) Mark DELETE_PENDING
  if (keys.length > 0) {
    await db.storageObject.updateMany({
      where: { objectKey: { in: keys }, status: { in: ["PENDING", "CONFIRMED"] } },
      data: { status: "DELETE_PENDING" },
    });
  }

  // 2) Xoa DB
  await db.page.deleteMany({ where: { chapterId } });
  await db.chapter.update({ where: { id: chapterId }, data: { pageCount: 0 } });

  // 3) Xoa R2 + 4) chi go metadata khi xac nhan xoa
  let removedCount = 0;
  let retryNeeded = 0;
  if (keys.length > 0) {
    const result = await safeDeleteObjects(keys);
    removedCount = await removeMetadataIfDeleted(result.removed);
    retryNeeded = result.pending.length;
    if (retryNeeded > 0) {
      console.warn(`[chapter-service] clearPages: ${retryNeeded} object xoa that bai — DELETE_PENDING retry.`);
    }
  }

  return { cleared: removedCount, objectsPendingRetry: retryNeeded };
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
      fileSize: Number(p.fileSize),
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
