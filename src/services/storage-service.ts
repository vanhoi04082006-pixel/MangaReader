// =============================================================
// Storage service: thong ke dung luong, audit orphan (R2 vs DB),
// cleanup file mo coi / PENDING qua han, va safe-delete (toan ven
// du lieu DB <-> R2). Supabase REST (HTTP).
// =============================================================

import { supabase } from "@/lib/supabase";
import { deleteObjects, listObjectsPage } from "@/lib/r2";
import type { StorageStatsDto, OrphanAuditItemDto } from "@/types";

export interface SafeDeleteResult {
  removed: string[];
  pending: Array<{ key: string; reason: string }>;
}

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
    if (removed.has(key)) continue;
    if (errorKeys.has(key)) {
      pending.push({ key, reason: "r2_delete_error" });
      continue;
    }
    pending.push({ key, reason: "unconfirmed" });
  }
  return { removed: [...removed], pending };
}

export async function removeMetadataIfDeleted(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const { count } = await supabase
    .from("storage_objects")
    .delete({ count: "exact" })
    .in("object_key", keys);
  return count ?? 0;
}

export async function getStorageStats(): Promise<StorageStatsDto> {
  const [confirmedRes, pendingCount, deletePendingCount, mangaCount, chapterCount, pageCount] =
    await Promise.all([
      supabase.from("storage_objects").select("file_size, manga_id").eq("status", "CONFIRMED"),
      supabase.from("storage_objects").select("*", { count: "exact", head: true }).eq("status", "PENDING"),
      supabase.from("storage_objects").select("*", { count: "exact", head: true }).eq("status", "DELETE_PENDING"),
      supabase.from("mangas").select("*", { count: "exact", head: true }),
      supabase.from("chapters").select("*", { count: "exact", head: true }),
      supabase.from("pages").select("*", { count: "exact", head: true }),
    ]);

  const confirmed = confirmedRes.data ?? [];
  const totalBytes = confirmed.reduce((sum: number, r: any) => sum + Number(r.file_size ?? 0), 0);
  const totalFiles = confirmed.length;

  // Per-manga aggregation
  const perMangaMap = new Map<string, { fileCount: number; sizeBytes: number }>();
  for (const r of confirmed) {
    if (!r.manga_id) continue;
    const agg = perMangaMap.get(r.manga_id) ?? { fileCount: 0, sizeBytes: 0 };
    agg.fileCount++;
    agg.sizeBytes += Number(r.file_size ?? 0);
    perMangaMap.set(r.manga_id, agg);
  }

  const mangaIds = [...perMangaMap.keys()];
  const { data: mangas } = mangaIds.length > 0
    ? await supabase.from("mangas").select("id, title").in("id", mangaIds)
    : { data: [] };

  const mangaMap = new Map((mangas ?? []).map((m: any) => [m.id, m]));
  const { data: chapterCounts } = mangaIds.length > 0
    ? await supabase.from("chapters").select("manga_id").in("manga_id", mangaIds)
    : { data: [] };

  const chapterCountMap = new Map<string, number>();
  for (const c of chapterCounts ?? []) {
    chapterCountMap.set(c.manga_id, (chapterCountMap.get(c.manga_id) ?? 0) + 1);
  }

  const perManga = [...perMangaMap.entries()]
    .map(([mangaId, agg]) => {
      const m = mangaMap.get(mangaId);
      if (!m) return null;
      return {
        mangaId: m.id,
        title: m.title,
        fileCount: agg.fileCount,
        sizeBytes: agg.sizeBytes,
        chapterCount: chapterCountMap.get(mangaId) ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  // Largest files
  const { data: largest } = await supabase
    .from("storage_objects")
    .select("object_key, file_name, file_size, manga_id, chapter_id, created_at, manga:mangas(title), chapter:chapters(chapter_number)")
    .eq("status", "CONFIRMED")
    .order("file_size", { ascending: false })
    .limit(10);

  const largestFiles = (largest ?? []).map((f: any) => ({
    objectKey: f.object_key,
    fileName: f.file_name,
    fileSize: Number(f.file_size),
    mangaTitle: f.manga?.title ?? null,
    chapterNumber: f.chapter?.chapter_number ?? null,
    createdAt: f.created_at,
  }));

  return {
    totalBytes,
    totalFiles,
    quotaBytes: 100 * 1024 * 1024 * 1024,
    mangaCount: mangaCount.count ?? 0,
    chapterCount: chapterCount.count ?? 0,
    pageCount: pageCount.count ?? 0,
    perManga,
    largestFiles,
    pendingObjects: pendingCount.count ?? 0,
    deletePendingObjects: deletePendingCount.count ?? 0,
  };
}

export interface AuditPageResult {
  items: OrphanAuditItemDto[];
  scanned: number;
  truncated: boolean;
  nextToken?: string;
}

const AUDIT_PAGE_SIZE = 1000;

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

  const [pageRefsRes, coverRefsRes, storageRowsRes] = await Promise.all([
    supabase.from("pages").select("object_key").in("object_key", page.keys),
    supabase.from("mangas").select("cover_image_key").in("cover_image_key", page.keys),
    supabase.from("storage_objects").select("object_key, status, created_at").in("object_key", page.keys),
  ]);

  const pageRefs = pageRefsRes.data ?? [];
  const coverRefs = coverRefsRes.data ?? [];
  const storageRows = storageRowsRes.data ?? [];

  const liveKeys = new Set<string>([
    ...pageRefs.map((p: any) => p.object_key),
    ...coverRefs.map((m: any) => m.cover_image_key ?? ""),
  ]);
  const rowMap = new Map(storageRows.map((s: any) => [s.object_key, s]));

  const orphans: OrphanAuditItemDto[] = [];
  page.keys.forEach((key, i) => {
    if (liveKeys.has(key)) return;
    const row = rowMap.get(key);
    if (!row) {
      orphans.push({ objectKey: key, size: page.sizes[i] });
      return;
    }
    if (row.status === "PENDING" && new Date(row.created_at) < staleCutoff) {
      orphans.push({ objectKey: key, size: page.sizes[i] });
      return;
    }
    if (row.status === "CONFIRMED" || row.status === "DELETE_PENDING") {
      orphans.push({ objectKey: key, size: page.sizes[i] });
    }
  });

  return {
    items: orphans,
    scanned: page.keys.length,
    truncated: page.truncated,
    nextToken: page.continuationToken,
  };
}

export async function cleanupPendingObjects(opts: {
  maxAgeHours: number;
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; keys: string[]; retryNeeded: number }> {
  const cutoff = new Date(Date.now() - opts.maxAgeHours * 3600 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("storage_objects")
    .select("object_key")
    .eq("status", "PENDING")
    .lt("created_at", cutoff);

  const keys = (stale ?? []).map((s: any) => s.object_key);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, keys, retryNeeded: 0 };
  }

  const result = await safeDeleteObjects(keys);
  const removedCount = await removeMetadataIfDeleted(result.removed);

  return {
    candidates: keys.length,
    deleted: removedCount,
    keys: result.removed,
    retryNeeded: result.pending.length,
  };
}

export async function retryFailedDeletions(opts: {
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; retryNeeded: number; keys: string[] }> {
  const { data: rows } = await supabase
    .from("storage_objects")
    .select("object_key")
    .eq("status", "DELETE_PENDING");

  const keys = (rows ?? []).map((r: any) => r.object_key);
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

export async function cleanupOrphanKeys(keys: string[], dryRun: boolean): Promise<{
  candidates: number;
  deleted: number;
  skippedReferenced: string[];
  retryNeeded: number;
  errors: string[];
}> {
  if (keys.length === 0) return { candidates: 0, deleted: 0, skippedReferenced: [], retryNeeded: 0, errors: [] };

  const [pageRefsRes, coverRefsRes] = await Promise.all([
    supabase.from("pages").select("object_key").in("object_key", keys),
    supabase.from("mangas").select("cover_image_key").in("cover_image_key", keys),
  ]);
  const pageRefs = pageRefsRes.data ?? [];
  const coverRefs = coverRefsRes.data ?? [];

  const referenced = new Set<string>([
    ...pageRefs.map((p: any) => p.object_key),
    ...coverRefs.map((m: any) => m.cover_image_key ?? ""),
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