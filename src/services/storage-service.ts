// =============================================================
// Storage service: thong ke dung luong, audit orphan (R2 vs DB),
// cleanup file mo coi / PENDING qua han, va safe-delete (toan ven
// du lieu DB <-> R2). Supabase REST (HTTP).
//
// QUI TAM (fix 2026-11):
// 1. PostgREST co gioi han do dai URL (~8KB). Object key dai
//    ~108 ky tu => `.in("object_key", 1000 keys)` tao URL ~100KB
//    => request BI TU CHOI hoac loi, `data` tra ve null. Code cu
//    bo qua `error` nen moi key bi coi la "mo coi" (false positive
//    10.755 file).=> Moi lookup `.in` PHAI chunk theo ngan sach
//    URL (mặc định 6000 ky tu ~ 55 key/request) va loi PHAI duoc
//    nang len (throw), khong bao gio coi "tra rong" la "khong co
//    tham chieu".
// 2. PostgREST dong thoi gioi han so row tra ve moi request
//    (default 1000). Moi tinh tong SUM dung luong phai phan trang
//    `.range()` — cu chi lay duoc 1000/10.755 row dau.
// =============================================================

import { supabase } from "@/lib/supabase";
import { deleteObjects, listObjectsPage } from "@/lib/r2";
import { getEnv } from "@/lib/env";
import {
  URL_BUDGET_CHARS,
  chunkKeysForUrl,
  unwrap,
  chunkedSelectIn,
  chunkedDelete,
  fetchAllRows,
} from "@/lib/postgrest-chunk";
import {
  classifyOrphans as classifyOrphansPure,
  computeStorageUsage as computeStorageUsagePure,
  type StorageUsage,
  type StorageRowLite,
  type OrphanRowInfo,
} from "@/lib/storage-audit";
import type { StorageStatsDto, OrphanAuditItemDto } from "@/types";

// Re-export cho test + caller cu (ky hop voi tests/unit.test.ts)
export { URL_BUDGET_CHARS, chunkKeysForUrl };
export { classifyOrphans, computeStorageUsage } from "@/lib/storage-audit";
export type { StorageUsage, StorageRowLite, OrphanRowInfo } from "@/lib/storage-audit";

// Alias ben trong (dung classifyOrphansPure/computeStorageUsagePure)
const classifyOrphans = classifyOrphansPure;
const computeStorageUsage = computeStorageUsagePure;

// ---------------------------------------------------------------
// Phan trang (PostgREST tra toi da 1000 row/request) — xem lib/postgrest-chunk.ts
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Safe delete (R2 xac nhan moi go metadata)
// ---------------------------------------------------------------

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

/** Xoa metadata theo DANH SACH key da duoc R2 xac nhan — chunk theo ngan sach URL. */
export async function removeMetadataIfDeleted(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  return chunkedDelete(
    (chunk) =>
      supabase
        .from("storage_objects")
        .delete({ count: "exact" })
        .in("object_key", chunk),
    keys,
    "xóa metadata storage_objects"
  );
}

// ---------------------------------------------------------------
// Thong ke dung luong (phan trang — SUM toan bo, khong bi cat 1000 row)
// Cac ham pure (computeStorageUsage...) nam o lib/storage-audit.ts
// ---------------------------------------------------------------

/** Fetch toan bo row storage_objects (file_size, status, manga_id, created_at) — phan trang. */
export async function fetchStorageRowsLite(): Promise<StorageRowLite[]> {
  return fetchAllRows<StorageRowLite>(
    (from, to) =>
      supabase
        .from("storage_objects")
        .select("file_size, status, manga_id, created_at")
        .order("object_key", { ascending: true })
        .range(from, to),
    "đọc storage_objects"
  );
}

// Cache dung luong dung chung (dashboard, sidebar, quota gate presign).
// TTL ngan: audit/cleanup/doc lieu khac chiu 60s do lech — con cac
// thao tac ghi (finalize/delete/cleanup) se chu dong invalidate.
const USAGE_CACHE_TTL_MS = 60_000;
let usageCache: { at: number; value: StorageUsage } | null = null;

export async function getStorageUsageCached(freshWindowMs = 24 * 3600 * 1000): Promise<StorageUsage> {
  if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS) {
    return usageCache.value;
  }
  const rows = await fetchStorageRowsLite();
  const value = computeStorageUsage(rows, Date.now() - freshWindowMs);
  usageCache = { at: Date.now(), value };
  return value;
}

export function invalidateStorageUsageCache(): void {
  usageCache = null;
}

/**
 * So lieu quota cho presign (single va batch): CONFIRMED + PENDING tuoi
 * (< 24h) + bytes sap them. Dung cache 60s — re chu khong scan DB
 * moi request presign (cu scan toan bo bang cho MOI lan cap 1 URL).
 */
export async function getQuotaUsageBytes(addBytes = 0): Promise<{ usedBytes: number; quotaBytes: number }> {
  const env = getEnv();
  const usage = await getStorageUsageCached(24 * 3600 * 1000);
  return {
    usedBytes: usage.confirmedBytes + usage.freshPendingBytes + addBytes,
    quotaBytes: env.storageQuotaBytes,
  };
}

/** Doc header count cho mot bang (exact). */
async function headCount(table: string, ctx: string, ...filters: Array<(b: any) => any>): Promise<number> {
  let builder = supabase.from(table).select("*", { count: "exact", head: true });
  for (const f of filters) builder = f(builder);
  const res = await builder;
  unwrap(res as { data: unknown[] | null; error: { message: string; code?: string } | null }, ctx);
  return res.count ?? 0;
}

export async function getStorageStats(): Promise<StorageStatsDto> {
  // Mot pass phan trang lay het row (dung cho breakdown + per-manga)
  const rows = await fetchStorageRowsLite();
  const usage = computeStorageUsage(rows, Date.now() - 24 * 3600 * 1000);

  const [mangaCount, chapterCount, pageCount] = await Promise.all([
    headCount("mangas", "đếm mangas"),
    headCount("chapters", "đếm chapters"),
    headCount("pages", "đếm pages"),
  ]);

  // Per-manga aggregation (chi CONFIRMED)
  const perMangaMap = new Map<string, { fileCount: number; sizeBytes: number }>();
  for (const r of rows) {
    if (r.status !== "CONFIRMED" || !r.manga_id) continue;
    const agg = perMangaMap.get(r.manga_id) ?? { fileCount: 0, sizeBytes: 0 };
    agg.fileCount += 1;
    agg.sizeBytes += Number(r.file_size ?? 0) || 0;
    perMangaMap.set(r.manga_id, agg);
  }

  const mangaIds = [...perMangaMap.keys()];
  const mangas = mangaIds.length > 0
    ? await chunkedSelectIn<{ id: string; title: string }>("mangas", "id", mangaIds, "id, title", "đọc mangas theo id")
    : [];
  const chapterRows = await fetchAllRows<{ manga_id: string }>(
    (from, to) =>
      supabase
        .from("chapters")
        .select("manga_id")
        .order("id", { ascending: true })
        .range(from, to),
    "đọc chapters (manga_id)"
  );

  const mangaMap = new Map((mangas ?? []).map((m) => [m.id, m]));
  const chapterCountMap = new Map<string, number>();
  for (const c of chapterRows ?? []) {
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

  // Largest files — query rieng (order + limit, khong can phan trang)
  const largestRes = await supabase
    .from("storage_objects")
    .select("object_key, file_name, file_size, manga_id, chapter_id, created_at, manga:mangas(title), chapter:chapters(chapter_number)")
    .eq("status", "CONFIRMED")
    .order("file_size", { ascending: false })
    .limit(10);
  const largest = unwrap<any[]>(largestRes as { data: any[] | null; error: { message: string; code?: string } | null }, "đọc largest files");

  const largestFiles = (largest ?? []).map((f) => ({
    objectKey: f.object_key,
    fileName: f.file_name,
    fileSize: Number(f.file_size),
    mangaTitle: f.manga?.title ?? null,
    chapterNumber: f.chapter?.chapter_number ?? null,
    createdAt: f.created_at,
  }));

  invalidateStorageUsageCache();
  usageCache = { at: Date.now(), value: usage };

  return {
    // Tong dung luong dang dung = SUM(file_size) WHERE status='CONFIRMED' — duoc (phan trang, khong bi cat)
    totalBytes: usage.confirmedBytes,
    totalFiles: usage.confirmedFiles,
    quotaBytes: 100 * 1024 * 1024 * 1024, // route ghi de bang env STORAGE_QUOTA_GB
    mangaCount,
    chapterCount,
    pageCount,
    perManga,
    largestFiles,
    pendingObjects: usage.pendingFiles,
    deletePendingObjects: usage.deletePendingFiles,
    // Breakdown cho UI
    pendingBytes: usage.pendingBytes,
    deletePendingBytes: usage.deletePendingBytes,
  };
}

// ---------------------------------------------------------------
// Audit orphan (R2 vs DB) — chunked lookup, loi duoc nang len
// ---------------------------------------------------------------

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
  const staleCutoffMs = Date.now() - maxAgeMs;

  const page = await listObjectsPage({
    continuationToken: opts.continuationToken,
    maxKeys: AUDIT_PAGE_SIZE,
  });
  if (page.keys.length === 0) {
    return { items: [], scanned: 0, truncated: page.truncated, nextToken: page.continuationToken };
  }

  // Chunk lookup theo ngan sach URL (~55 key/request) — song song.
  // Loi o bat ky chunk nao cung dc nang len (500) de UI bao loi,
  // chu KHONG nhu cu: loi => data null => coi la orphan.
  const [pageRefs, coverRefs, storageRows] = await Promise.all([
    chunkedSelectIn<{ object_key: string }>("pages", "object_key", page.keys, "object_key", "audit: đối chiếu pages"),
    chunkedSelectIn<{ cover_image_key: string | null }>("mangas", "cover_image_key", page.keys, "cover_image_key", "audit: đối chiếu covers"),
    chunkedSelectIn<{ object_key: string; status: string; created_at: string | null }>(
      "storage_objects", "object_key", page.keys, "object_key, status, created_at", "audit: đối chiếu storage_objects"
    ),
  ]);

  const pageKeys = new Set((pageRefs ?? []).map((p) => p.object_key));
  const coverKeys = new Set(
    (coverRefs ?? []).map((m) => m.cover_image_key ?? "").filter(Boolean)
  );
  const rowsMap = new Map<string, OrphanRowInfo>();
  for (const s of storageRows ?? []) {
    rowsMap.set(s.object_key, {
      status: s.status,
      createdAtMs: s.created_at ? new Date(s.created_at).getTime() : 0,
    });
  }

  const orphans = classifyOrphans(page.keys, page.sizes, { pageKeys, coverKeys, rows: rowsMap }, staleCutoffMs);

  return {
    items: orphans,
    scanned: page.keys.length,
    truncated: page.truncated,
    nextToken: page.continuationToken,
  };
}

// ---------------------------------------------------------------
// Cleanup — 3 mode, tat ca deu an toan (re-check + chunk + R2 confirm)
// ---------------------------------------------------------------

export async function cleanupPendingObjects(opts: {
  maxAgeHours: number;
  dryRun: boolean;
}): Promise<{ candidates: number; deleted: number; keys: string[]; retryNeeded: number }> {
  const cutoff = new Date(Date.now() - opts.maxAgeHours * 3600 * 1000).toISOString();
  const stale = await fetchAllRows<{ object_key: string }>(
    (from, to) =>
      supabase
        .from("storage_objects")
        .select("object_key")
        .eq("status", "PENDING")
        .lt("created_at", cutoff)
        .order("object_key", { ascending: true })
        .range(from, to),
    "đọc PENDING quá hạn"
  );

  const keys = (stale ?? []).map((s) => s.object_key);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, keys, retryNeeded: 0 };
  }

  const result = await safeDeleteObjects(keys);
  const removedCount = await removeMetadataIfDeleted(result.removed);
  invalidateStorageUsageCache();

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
  const rows = await fetchAllRows<{ object_key: string }>(
    (from, to) =>
      supabase
        .from("storage_objects")
        .select("object_key")
        .eq("status", "DELETE_PENDING")
        .order("object_key", { ascending: true })
        .range(from, to),
    "đọc DELETE_PENDING"
  );

  const keys = (rows ?? []).map((r) => r.object_key);
  if (opts.dryRun || keys.length === 0) {
    return { candidates: keys.length, deleted: 0, retryNeeded: 0, keys };
  }

  const result = await safeDeleteObjects(keys);
  const removedCount = await removeMetadataIfDeleted(result.removed);
  invalidateStorageUsageCache();

  return {
    candidates: keys.length,
    deleted: removedCount,
    retryNeeded: result.pending.length,
    keys: result.removed,
  };
}

export interface CleanupOrphanResult {
  candidates: number;
  deleted: number;
  skippedReferenced: string[];
  /** PENDING con tuoi (upload dang dien ra) — bo qua de khong xoa nhầm. */
  skippedActivePending: string[];
  retryNeeded: number;
  errors: string[];
}

/**
 * Mode "keys": xoa DANH SACH key do audit xac nhan la orphan.
 * Layer bao ve (chay LAI luc xoa, khong tin ket qua audit 100%):
 * 1. key van duoc pages/mangas tham chieu => skip (skippedReferenced)
 * 2. key co row PENDING con tuoi (< maxAgeHours) => skip (skippedActivePending)
 * 3. chi khi R2 xac nhan xoa moi go metadata.
 */
export async function cleanupOrphanKeys(keys: string[], dryRun: boolean, maxAgeHours = 24): Promise<CleanupOrphanResult> {
  if (keys.length === 0) {
    return { candidates: 0, deleted: 0, skippedReferenced: [], skippedActivePending: [], retryNeeded: 0, errors: [] };
  }

  const [pageRefs, coverRefs, storageRows] = await Promise.all([
    chunkedSelectIn<{ object_key: string }>("pages", "object_key", keys, "object_key", "cleanup keys: đối chiếu pages"),
    chunkedSelectIn<{ cover_image_key: string | null }>("mangas", "cover_image_key", keys, "cover_image_key", "cleanup keys: đối chiếu covers"),
    chunkedSelectIn<{ object_key: string; status: string; created_at: string | null }>(
      "storage_objects", "object_key", keys, "object_key, status, created_at", "cleanup keys: đối chiếu storage_objects"
    ),
  ]);

  const referenced = new Set<string>([
    ...(pageRefs ?? []).map((p) => p.object_key),
    ...(coverRefs ?? []).map((m) => m.cover_image_key ?? "").filter(Boolean),
  ]);
  const freshPending = new Set<string>();
  for (const s of storageRows ?? []) {
    if (s.status !== "PENDING" || !s.created_at) continue;
    const ageMs = Date.now() - new Date(s.created_at).getTime();
    if (ageMs < maxAgeHours * 3600 * 1000) freshPending.add(s.object_key);
  }

  const safeKeys = keys.filter((k) => !referenced.has(k) && !freshPending.has(k));
  const skippedReferenced = keys.filter((k) => referenced.has(k));
  const skippedActivePending = keys.filter((k) => freshPending.has(k));

  if (dryRun || safeKeys.length === 0) {
    return {
      candidates: safeKeys.length,
      deleted: 0,
      skippedReferenced,
      skippedActivePending,
      retryNeeded: 0,
      errors: [],
    };
  }

  const result = await safeDeleteObjects(safeKeys);
  const removedCount = await removeMetadataIfDeleted(result.removed);
  invalidateStorageUsageCache();

  return {
    candidates: safeKeys.length,
    deleted: removedCount,
    skippedReferenced,
    skippedActivePending,
    retryNeeded: result.pending.length,
    errors: result.pending.map((p) => `${p.key}: ${p.reason}`),
  };
}
