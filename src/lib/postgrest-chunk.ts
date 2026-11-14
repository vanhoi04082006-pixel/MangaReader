// =============================================================
// PostgREST (Supabase REST) — helpers chống 2 giới hạn:
//
// 1. GIỚI HẠN ĐỘ DÀI URL (~8KB qua Kong/edge): filter `.in(...)`
//    với danh sách key dài (object key ~108 ký tự) sẽ vượt giới
//    hạn → request bị từ chối → nếu code bỏ qua `error` thì mọi
//    key đều bị coi là "không có" (nguồn gốc bug audit 10.755 file
//    mồ côi giả). => chunk theo ngân sách URL + ĐẨY lỗi lên (throw).
//
// 2. GIỚI HẠN SỐ ROW MỖI RESPONSE (default 1000): mọi phép tính
//    tổng/đầy đủ dữ liệu phải phân trang `.range()` (order ổn định
//    để không trượt row giữa các trang).
//
// Dùng chung bởi: storage-service, chapter-service, manga-service.
// =============================================================

import { supabase } from "@/lib/supabase";
import { URL_BUDGET_CHARS, chunkKeysForUrl } from "@/lib/storage-audit";

// Re-export de caller cu van import tu day (chunkKeysForUrl thuan
// khong phu thuoc supabase — nam o lib/storage-audit.ts de unit test
// chay duoc KHONG can env)
export { URL_BUDGET_CHARS, chunkKeysForUrl };

/** Unwrap ket qua Supabase — loi PHAI duoc nang len, khong nuot im lang. */
export function unwrap<T>(
  res: { data: T | null; error: { message: string; code?: string } | null },
  ctx: string
): T {
  if (res.error) {
    throw new Error(`[postgrest] ${ctx} thất bại: ${res.error.message}${res.error.code ? ` (code ${res.error.code})` : ""}`);
  }
  return (res.data ?? []) as T;
}

/**
 * Select `.in(column, keys)` an toan: tu dong chunk theo ngan sach
 * URL, chay cac chunk song song, nem loi neu mot chunk that bai.
 * `extra`: bo loc bo sung (vd .eq("status", "CONFIRMED")) ap dung
 * cho moi chunk.
 */
export async function chunkedSelectIn<T = Record<string, unknown>>(
  table: string,
  column: string,
  keys: string[],
  select: string,
  ctx: string,
  extra?: (builder: any) => any
): Promise<T[]> {
  if (keys.length === 0) return [];
  const chunks = chunkKeysForUrl(keys);
  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      let builder: any = supabase.from(table).select(select).in(column, chunk);
      if (extra) builder = extra(builder);
      const res = await builder;
      return unwrap<T[]>(res as { data: T[] | null; error: { message: string; code?: string } | null }, `${ctx} (chunk ${chunk.length} key)`);
    })
  );
  return parts.flat();
}

/**
 * Update `.in(column, keys)` an toan: chunk theo ngan sach URL,
 * dem tong so row bi anh huong, nem loi neu that bai.
 * `apply(chunk)` tra ve builder da co patch + filter bo sung.
 */
export async function chunkedUpdate(
  apply: (chunk: string[]) => PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }>,
  keys: string[],
  ctx: string
): Promise<number> {
  let total = 0;
  for (const chunk of chunkKeysForUrl(keys)) {
    const res = await apply(chunk);
    unwrap(res as unknown as { data: unknown[] | null; error: { message: string; code?: string } | null }, ctx);
    total += res.count ?? 0;
  }
  return total;
}

/**
 * Delete `.in(column, keys)` an toan: chunk theo ngan sach URL,
 * tra ve tong so row da xoa.
 */
export async function chunkedDelete(
  apply: (chunk: string[]) => PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }>,
  keys: string[],
  ctx: string
): Promise<number> {
  let total = 0;
  for (const chunk of chunkKeysForUrl(keys)) {
    const res = await apply(chunk);
    unwrap(res as unknown as { data: unknown[] | null; error: { message: string; code?: string } | null }, ctx);
    total += res.count ?? 0;
  }
  return total;
}

const MAX_ROWS_PER_QUERY = 1000;
/** Gioi han phong ve: 200 trang x 1000 row = 200k row — du cho thu vien lon. */
const MAX_SCAN_PAGES = 200;

/**
 * Fetch toan bo row cua mot query bang phan trang `.range()` (order
 * dinh danh de on dinh giua cac trang). Dung cho cac bang khoi luong
 * (storage_objects, pages, chapters...) — tranh bi PostgREST cat
 * 1000 row.
 */
export async function fetchAllRows<T = Record<string, unknown>>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  ctx: string
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const from = page * MAX_ROWS_PER_QUERY;
    const res = await buildQuery(from, from + MAX_ROWS_PER_QUERY - 1);
    const rows = unwrap<T[]>(res as { data: T[] | null; error: { message: string; code?: string } | null }, `${ctx} (range ${from}-${from + MAX_ROWS_PER_QUERY - 1})`);
    all.push(...rows);
    if (rows.length < MAX_ROWS_PER_QUERY) return all; // het du lieu
  }
  return all; // cham mốc bao ve — khong quet vo han
}
