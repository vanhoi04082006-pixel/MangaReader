// =============================================================
// Storage audit — PURE functions (khong import gi — chay duoc
// trong unit test KHONG can env/DB/R2).
//
// Ly do tach rieng: tests/unit.test.ts chay trong CI truoc khi co
// .env; module import supabase client se throw tai import-time.
// =============================================================

export interface OrphanRowInfo {
  status: string;
  createdAtMs: number;
}

export interface OrphanAuditItemLite {
  objectKey: string;
  size: number;
}

/**
 * Phan lop orphan cho 1 trang R2 keys.
 *
 * Quy tac:
 * - co tham chieu (pages.object_key / mangas.cover_image_key) => KHONG orphan
 * - khong co row storage_objects => orphan (file tren R2 ma DB khong biet)
 * - row PENDING + qua han (createdAtMs < staleCutoffMs) => orphan (upload bo dung)
 * - row PENDING + con tuoi => KHONG orphan (upload dang dien ra)
 * - row CONFIRMED / DELETE_PENDING ma khong con tham chieu => orphan (leak)
 */
export function classifyOrphans(
  keys: string[],
  sizes: number[],
  refs: { pageKeys: Set<string>; coverKeys: Set<string>; rows: Map<string, OrphanRowInfo> },
  staleCutoffMs: number
): OrphanAuditItemLite[] {
  const orphans: OrphanAuditItemLite[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (refs.pageKeys.has(key) || refs.coverKeys.has(key)) continue;
    const row = refs.rows.get(key);
    if (!row) {
      orphans.push({ objectKey: key, size: sizes[i] ?? 0 });
      continue;
    }
    if (row.status === "PENDING") {
      if (row.createdAtMs < staleCutoffMs) orphans.push({ objectKey: key, size: sizes[i] ?? 0 });
      continue;
    }
    if (row.status === "CONFIRMED" || row.status === "DELETE_PENDING") {
      orphans.push({ objectKey: key, size: sizes[i] ?? 0 });
    }
  }
  return orphans;
}

export interface StorageUsage {
  /** Tong bytes cac object CONFIRMED — dung luong THUC dang chiem. */
  confirmedBytes: number;
  confirmedFiles: number;
  /** PENDING: da presign nhung chua finalize. */
  pendingBytes: number;
  pendingFiles: number;
  /** PENDING tuoi (moi hon freshCutoffMs) — ke vao quota upload dang dien ra. */
  freshPendingBytes: number;
  freshPendingFiles: number;
  /** DELETE_PENDING: xoa R2 that bai, cho retry. */
  deletePendingBytes: number;
  deletePendingFiles: number;
}

export interface StorageRowLite {
  file_size: number | string | null;
  status: string;
  manga_id: string | null;
  created_at: string | null;
}

/** Aggregation dung luong theo status tu danh sach row — pure, unit-testable. */
export function computeStorageUsage(rows: StorageRowLite[], freshCutoffMs: number): StorageUsage {
  const usage: StorageUsage = {
    confirmedBytes: 0,
    confirmedFiles: 0,
    pendingBytes: 0,
    pendingFiles: 0,
    freshPendingBytes: 0,
    freshPendingFiles: 0,
    deletePendingBytes: 0,
    deletePendingFiles: 0,
  };
  for (const r of rows) {
    const size = Number(r.file_size ?? 0) || 0;
    switch (r.status) {
      case "CONFIRMED":
        usage.confirmedBytes += size;
        usage.confirmedFiles += 1;
        break;
      case "PENDING":
        usage.pendingBytes += size;
        usage.pendingFiles += 1;
        if (r.created_at && new Date(r.created_at).getTime() >= freshCutoffMs) {
          usage.freshPendingBytes += size;
          usage.freshPendingFiles += 1;
        }
        break;
      case "DELETE_PENDING":
        usage.deletePendingBytes += size;
        usage.deletePendingFiles += 1;
        break;
      default:
        break; // trang thai la — bo qua
    }
  }
  return usage;
}

/**
 * Ngan sach ky tu cho phan gia tri cua filter `in.(...)` tren URL
 * PostgREST. PostgREST/Kong chan URL khoang 8KB — de lai dư địa
 * cho path + query khac, dung 6000.
 */
export const URL_BUDGET_CHARS = 6000;

/**
 * Chia danh sach key thanh cac chunk sao cho chuoi filter
 * `in.(k1,k2,...)` cua moi chunk khong vuot ngan sach URL.
 * Pure function — unit test tai tests/unit.test.ts.
 */
export function chunkKeysForUrl(keys: string[], budgetChars: number = URL_BUDGET_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const key of keys) {
    if (!key) continue;
    // moi key ton 1 phan value + dau phay tach
    const cost = key.length + 1;
    if (current.length > 0 && used + cost > budgetChars) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(key);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
