// =============================================================
// Storage service: thong ke dung luong, audit orphan (R2 vs DB),
// cleanup file mo coi / PENDING qua han, va safe-delete (toan ven
// du lieu DB <-> R2).
//
// NGUYEN TAC TOAN VEN DU LIEU:
// - safeDeleteObjects(): chi go bo metadata khi R2 xac nhan object
//   DA XOA hoac KHONG TON TAI (S3 delete idempotent). Object xoa
//   that bai -> giu row (DELETE_PENDING) de retry — khong bao gio
//   mat tham chieu den object that tren R2.
// =============================================================

import { db } from "@/lib/db";
import { deleteObjects, listObjectsPage } from "@/lib/r2";
import type { StorageStatsDto, OrphanAuditItemDto } from "@/types";

export interface SafeDeleteResult {
  /** Key da duoc xac nhan xoa khoi R2 (an toan go bo metadata). */
  removed: string[];
  /** Key chua xoa duoc — GIU metadata de retry. */
  pending: Array<{ key: string; reason: string }>;
}

/**
 * Xoa object tren R2 va CHI tra ve danh sach key da duoc xac nhan xoa.
 * - Loi mang toan phan -> tat ca key nam trong pending (giu metadata).
 * - Loi theo tung key -> key do nam trong pending.
 * - Key khong ton tai tren R2 van duoc bao "Deleted" (S3 idempotent)
 *   -> coi nhu removed (metadata rac, go bo an toan).
 */
export async function safeDeleteObjects(keys: string[]): Promise<SafeDeleteResult> {
  if (keys.length === 0) return { removed: [], pending: [] };
  let res: Awaited<ReturnType<typeof deleteObjects>>;
  try {
    res = await deleteObjects(keys);
  } catch (err) {
    console.error("[storage-service] R2 delete batch failed:", err);
    return { removed: [], pending: keys.map((key) => ({ key, reason: "r2_batch_error" })) };
  }
  const removed = new Set(res.deletedKeys);
  const errorKeys = new Set(
    res.errors.map((e) => e.split(":")[0]).filter(Boolean)
  );
  const pending: SafeDeleteResult["pending"] = [];
  for (const key of keys) {
    if (removed.has(key)) continue; // da xac nhan xoa
    if (errorKeys.has(key)) {
      pending.push({ key, reason: "r2_delete_error" });
      continue;
    }
    // Khong trong Deleted cung khong co loi rieng -> coi nhu pending (an toan)
    pending.push({ key, reason: "unconfirmed" });
  }
  return { removed: [...removed], pending };
}

/** Go bo metadata cho cac key da xac nhan xoa (idempotent). */
export async function removeMetadataIfDeleted(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const res = await db.storageObject.deleteMany({
    where: { objectKey: { in: keys } },
  });
  return res.count;
}

export async function getStorageStats(): Promise<StorageStatsDto> {
  const [totals, perMangaAgg, largest, pendingCount, deletePendingCount, mangaCount, chapterCount, pageCount] =
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
      db.storageObject.count({ where: { status: "DELETE_PENDING" } }),
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
            sizeBytes: Number(g._sum.fileSize ?? 0),
            chapterCount: m._count.chapters,
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    totalBytes: Number(totals._sum.fileSize ?? 0),
    totalFiles: totals._count._all,
    quotaBytes: 100 * 1024 * 1024 * 1024, // se duoc override boi route theo env
    mangaCount,
    chapterCount,
    pageCount,
    perManga,
    largestFiles: largest.map((f) => ({
      objectKey: f.objectKey,
      fileName: f.fileName,
      fileSize: Number(f.fileSize),
      mangaTitle: f.manga?.title ?? null,
      chapterNumber: f.chapter?.chapterNumber ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
    pendingObjects: pendingCount,
    deletePendingObjects: deletePendingCount,
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
 * - Row DELETE_PENDING khong con tham chieu -> xoa R2 that bai truoc do (retry)
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
    if (row.status === "DELETE_PENDING") {
      // xoa R2 that bai truoc do -> retry qua cleanup
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

/**
 * Cleanup PENDING qua han (upload bi gian doan).
 * TOAN VEN: chi xoa row khi R2 xac nhan object da xoa. Xoa that bai
 * -> row giu nguyen, lan cleanup sau retry.
 */
export async function cleanupPendingObjects(opts: {
  maxAgeHours: number;
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; keys: string[]; retryNeeded: number }> {
  const cutoff = new Date(Date.now() - opts.maxAgeHours * 3600 * 1000);
  const stale = await db.storageObject.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { objectKey: true },
  });
  const keys = stale.map((s) => s.objectKey);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, keys, retryNeeded: 0 };
  }

  const result = await safeDeleteObjects(keys);
  // Chi go bo metadata cho key da xac nhan xoa tren R2
  const removedCount = await removeMetadataIfDeleted(result.removed);

  return {
    candidates: keys.length,
    deleted: removedCount,
    keys: result.removed,
    retryNeeded: result.pending.length,
  };
}

/**
 * Retry cac object DELETE_PENDING (xoa R2 that bai truoc do — do deleteChapter/
 * deleteManga/clearPages de lai). Idempotent: chay nhieu lan an toan.
 */
export async function retryFailedDeletions(opts: {
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; retryNeeded: number; keys: string[] }> {
  const rows = await db.storageObject.findMany({
    where: { status: "DELETE_PENDING" },
    select: { objectKey: true },
  });
  const keys = rows.map((r) => r.objectKey);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, retryNeeded: 0, keys };
  }

  const result = await safeDeleteObjects(keys);
  const removedCount = await removeMetadataIfDeleted(result.removed);

  return {
    candidates: keys.length,
    deleted: removedCount,
    retryNeeded: result.pending.length,
    keys: result.removed,
  };
}

/** Xoa danh sach object cu the (ket qua audit) — co kiem tra khong con tham chieu */
export async function cleanupOrphanKeys(keys: string[], dryRun: boolean): Promise<{
  candidates: number;
  deleted: number;
  skippedReferenced: string[];
  retryNeeded: number;
  errors: string[];
}> {
  if (keys.length === 0) return { candidates: 0, deleted: 0, skippedReferenced: [], retryNeeded: 0, errors: [] };

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
    return { candidates: safeKeys.length, deleted: 0, skippedReferenced, retryNeeded: 0, errors: [] };
  }

  const result = await safeDeleteObjects(safeKeys);
  const removedCount = await removeMetadataIfDeleted(result.removed);

  return {
    candidates: safeKeys.length,
    deleted: removedCount,
    skippedReferenced,
    retryNeeded: result.pending.length,
    errors: result.pending.map((p) => `${p.key}: ${p.reason}`),
  };
}
