// =============================================================
// Storage service: thong ke dung luong, audit orphan (R2 vs DB),
// cleanup file mo coi / PENDING qua han
// =============================================================

import { db } from "@/lib/db";
import { deleteObjects, listObjectsPage } from "@/lib/r2";
import type { StorageStatsDto, OrphanAuditItemDto } from "@/types";

export async function getStorageStats(): Promise<StorageStatsDto> {
  const [totals, perMangaAgg, largest, pendingCount, mangaCount, chapterCount, pageCount] =
    await Promise.all([
      db.storageObject.aggregate({
        where: { status: "CONFIRMED" },
        _sum: { fileSize: true },
        _count: { _all: true },
      }),
      db.storageObject.groupBy({
        by: ["mangaId"],
        where: { status: "CONFIRMED", mangaId: { not: null } },
        _sum: { fileSize: true },
        _count: { _all: true },
      }),
      db.storageObject.findMany({
        where: { status: "CONFIRMED" },
        orderBy: { fileSize: "desc" },
        take: 10,
        include: {
          manga: { select: { title: true } },
          chapter: { select: { chapterNumber: true } },
        },
      }),
      db.storageObject.count({ where: { status: "PENDING" } }),
      db.manga.count(),
      db.chapter.count(),
      db.page.count(),
    ]);

  const mangaIds = perMangaAgg.map((g) => g.mangaId) as string[];
  const mangas = await db.manga.findMany({
    where: { id: { in: mangaIds } },
    select: { id: true, title: true, _count: { select: { chapters: true } } },
  });
  const mangaMap = new Map(mangas.map((m) => [m.id, m]));

  const perManga = perMangaAgg
    .map((g) => {
      const m = mangaMap.get(g.mangaId as string);
      return m
        ? {
            mangaId: m.id,
            title: m.title,
            fileCount: g._count._all,
            sizeBytes: g._sum.fileSize ?? 0,
            chapterCount: m._count.chapters,
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    totalBytes: totals._sum.fileSize ?? 0,
    totalFiles: totals._count._all,
    quotaBytes: 100 * 1024 * 1024 * 1024, // se duoc override boi route theo env
    mangaCount,
    chapterCount,
    pageCount,
    perManga,
    largestFiles: largest.map((f) => ({
      objectKey: f.objectKey,
      fileName: f.fileName,
      fileSize: f.fileSize,
      mangaTitle: f.manga?.title ?? null,
      chapterNumber: f.chapter?.chapterNumber ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
    pendingObjects: pendingCount,
  };
}

export interface AuditPageResult {
  items: OrphanAuditItemDto[];
  scanned: number;
  truncated: boolean;
  nextToken?: string;
}

const AUDIT_PAGE_SIZE = 1000;

/**
 * Audit 1 trang listing R2: phat hien object tren R2 ma DB khong
 * con tham chieu (orphan). Client goi lap lai den khi truncated=false.
 *
 * Phan loai orphan:
 * - Khong co StorageObject row -> hoan toan mo coi
 * - Row PENDING qua han (mac dinh 24h) -> upload bi gian doan
 * - Row CONFIRMED nhung khong duoc page/cover tham chieu -> finalize that bai
 */
export async function auditStoragePage(opts: {
  continuationToken?: string;
  maxAgeHours?: number;
}): Promise<AuditPageResult> {
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 3600 * 1000;
  const staleCutoff = new Date(Date.now() - maxAgeMs);

  const page = await listObjectsPage({
    continuationToken: opts.continuationToken,
    maxKeys: AUDIT_PAGE_SIZE,
  });
  if (page.keys.length === 0) {
    return { items: [], scanned: 0, truncated: page.truncated, nextToken: page.continuationToken };
  }

  const [pageRefs, coverRefs, storageRows] = await Promise.all([
    db.page.findMany({ where: { objectKey: { in: page.keys } }, select: { objectKey: true } }),
    db.manga.findMany({
      where: { coverImageKey: { in: page.keys } },
      select: { coverImageKey: true },
    }),
    db.storageObject.findMany({
      where: { objectKey: { in: page.keys } },
      select: { objectKey: true, status: true, createdAt: true },
    }),
  ]);

  const liveKeys = new Set<string>([
    ...pageRefs.map((p) => p.objectKey),
    ...coverRefs.map((m) => m.coverImageKey ?? ""),
  ]);
  const rowMap = new Map(storageRows.map((s) => [s.objectKey, s]));

  const orphans: OrphanAuditItemDto[] = [];
  page.keys.forEach((key, i) => {
    if (liveKeys.has(key)) return;
    const row = rowMap.get(key);
    if (!row) {
      orphans.push({ objectKey: key, size: page.sizes[i] });
      return;
    }
    if (row.status === "PENDING" && row.createdAt < staleCutoff) {
      orphans.push({ objectKey: key, size: page.sizes[i] });
      return;
    }
    if (row.status === "CONFIRMED") {
      // confirmed nhung khong duoc tham chieu -> orphan
      orphans.push({ objectKey: key, size: page.sizes[i] });
    }
    // PENDING moi (dang upload) -> khong phai orphan
  });

  return {
    items: orphans,
    scanned: page.keys.length,
    truncated: page.truncated,
    nextToken: page.continuationToken,
  };
}

/** Cleanup PENDING qua han: xoa tren R2 + xoa row */
export async function cleanupPendingObjects(opts: {
  maxAgeHours: number;
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; keys: string[] }> {
  const cutoff = new Date(Date.now() - opts.maxAgeHours * 3600 * 1000);
  const stale = await db.storageObject.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { objectKey: true },
  });
  const keys = stale.map((s) => s.objectKey);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, keys };
  }
  let deleted = 0;
  try {
    const res = await deleteObjects(keys);
    deleted = res.deleted;
  } catch (err) {
    console.error("[storage-service] cleanup R2 delete failed:", err);
  }
  await db.storageObject.deleteMany({ where: { objectKey: { in: keys } } }).catch(() => undefined);
  return { candidates: keys.length, deleted, keys };
}

/** Xoa danh sach object cu the (ket qua audit) — co kiem tra khong con tham chieu */
export async function cleanupOrphanKeys(keys: string[], dryRun: boolean): Promise<{
  candidates: number;
  deleted: number;
  skippedReferenced: string[];
  errors: string[];
}> {
  if (keys.length === 0) return { candidates: 0, deleted: 0, skippedReferenced: [], errors: [] };

  const [pageRefs, coverRefs] = await Promise.all([
    db.page.findMany({ where: { objectKey: { in: keys } }, select: { objectKey: true } }),
    db.manga.findMany({ where: { coverImageKey: { in: keys } }, select: { coverImageKey: true } }),
  ]);
  const referenced = new Set<string>([
    ...pageRefs.map((p) => p.objectKey),
    ...coverRefs.map((m) => m.coverImageKey ?? ""),
  ]);
  const safeKeys = keys.filter((k) => !referenced.has(k));
  const skippedReferenced = keys.filter((k) => referenced.has(k));

  if (dryRun || safeKeys.length === 0) {
    return { candidates: safeKeys.length, deleted: 0, skippedReferenced, errors: [] };
  }

  let deleted = 0;
  let errors: string[] = [];
  try {
    const res = await deleteObjects(safeKeys);
    deleted = res.deleted;
    errors = res.errors;
  } catch (err) {
    console.error("[storage-service] orphan R2 delete failed:", err);
    errors.push(String(err));
  }
  await db.storageObject.deleteMany({ where: { objectKey: { in: safeKeys } } }).catch(() => undefined);

  return { candidates: safeKeys.length, deleted, skippedReferenced, errors };
}
