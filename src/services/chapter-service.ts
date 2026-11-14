// =============================================================
// Chapter service: CRUD, pages finalize (upload), reader payload,
// xoa chapter/page dong bo DB + R2 (idempotent, recoverable)
// Supabase REST (HTTP).
// =============================================================

import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";
import { deleteObjects, presignGetMany, headObject } from "@/lib/r2";
import { getChapterOrder } from "@/services/manga-service";
import {
  safeDeleteObjects,
  removeMetadataIfDeleted,
  invalidateStorageUsageCache,
} from "@/services/storage-service";
import { chunkKeysForUrl, chunkedSelectIn, chunkedUpdate, fetchAllRows } from "@/lib/postgrest-chunk";
import { MAX_FILE_SIZE } from "@/schemas";
import type { ChapterCreateInput, ChapterUpdateInput, PagesFinalizeInput } from "@/schemas";
import type { ChapterDto, ReaderPayloadDto, PageDto, Paginated } from "@/types";

async function chapterSizeMap(chapterIds: string[]): Promise<Map<string, number>> {
  if (chapterIds.length === 0) return new Map();
  // chunk theo ngan sach URL (200 UUID ~ 7.4KB — vuot gioi han), giu
  // nguyen filter .eq(status, CONFIRMED) cho tung chunk
  const rows = await chunkedSelectIn<{ chapter_id: string; file_size: number | string | null }>(
    "storage_objects",
    "chapter_id",
    chapterIds,
    "chapter_id, file_size",
    "tính dung lượng chương",
    (b: any) => b.eq("status", "CONFIRMED")
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.chapter_id) continue;
    map.set(r.chapter_id, (map.get(r.chapter_id) ?? 0) + Number(r.file_size ?? 0));
  }
  return map;
}

export async function listChapters(
  mangaId: string,
  sort: "asc" | "desc",
  page: number,
  pageSize: number
): Promise<Paginated<ChapterDto>> {
  // Phân trang theo NATURAL ORDER của số chương (không dùng created_at):
  // import chương lệch thứ tự (vd ch 7 trước ch 2) không làm sai
  // "mới nhất" / trang / chương đầu. getChapterOrder đã natural-sort.
  const order = await getChapterOrder(mangaId);
  if (sort === "desc") order.reverse();
  const total = order.length;

  const pageIds = order.slice((page - 1) * pageSize, page * pageSize).map((c) => c.id);
  const byId = new Map<string, any>();
  if (pageIds.length > 0) {
    const { data: chapters, error } = await supabase
      .from("chapters")
      .select("*")
      .eq("manga_id", mangaId)
      .in("id", pageIds);
    if (error) throw new ApiError(`Không lấy được danh sách chương: ${error.message}`, 500);
    for (const c of chapters ?? []) byId.set(c.id, c);
  }

  const sizeMap = await chapterSizeMap(pageIds);

  // Giữ đúng thứ tự natural của trang (pageIds đã xếp sẵn)
  const items: ChapterDto[] = pageIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c: any) => ({
      id: c.id,
      mangaId: c.manga_id,
      chapterNumber: c.chapter_number,
      title: c.title,
      volume: c.volume,
      pageCount: c.page_count,
      sizeBytes: sizeMap.get(c.id) ?? 0,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function createChapter(mangaId: string, input: ChapterCreateInput) {
  const { data: manga } = await supabase.from("mangas").select("id").eq("id", mangaId).maybeSingle();
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");

  const { data: duplicate } = await supabase
    .from("chapters")
    .select("id")
    .eq("manga_id", mangaId)
    .eq("chapter_number", input.chapterNumber)
    .maybeSingle();
  if (duplicate) {
    throw new ApiError(`Chương "${input.chapterNumber}" đã tồn tại trong truyện này.`, 409, "chapter_exists");
  }

  const { data, error } = await supabase
    .from("chapters")
    .insert({
      manga_id: mangaId,
      chapter_number: input.chapterNumber,
      title: input.title ?? null,
      volume: input.volume ?? null,
      page_count: 0,
    })
    .select()
    .single();
  if (error) throw new ApiError(`Tạo chương thất bại: ${error.message}`, 500);
  return data;
}

export async function updateChapter(chapterId: string, input: ChapterUpdateInput) {
  const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).maybeSingle();
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");

  if (input.chapterNumber !== undefined && input.chapterNumber !== chapter.chapter_number) {
    const { data: duplicate } = await supabase
      .from("chapters")
      .select("id")
      .eq("manga_id", chapter.manga_id)
      .eq("chapter_number", input.chapterNumber)
      .neq("id", chapterId)
      .maybeSingle();
    if (duplicate) {
      throw new ApiError(`Chương "${input.chapterNumber}" đã tồn tại trong truyện này.`, 409, "chapter_exists");
    }
  }

  const updateData: Record<string, unknown> = {};
  if (input.chapterNumber !== undefined) updateData.chapter_number = input.chapterNumber;
  if (input.title !== undefined) updateData.title = input.title ?? null;
  if (input.volume !== undefined) updateData.volume = input.volume ?? null;

  if (Object.keys(updateData).length > 0) {
    const { data, error } = await supabase.from("chapters").update(updateData).eq("id", chapterId).select().single();
    if (error) throw new ApiError(`Cập nhật chương thất bại: ${error.message}`, 500);
    return data;
  }
  return chapter;
}

export async function deleteChapter(chapterId: string) {
  // pages theo phan trang (PostgREST cat 1000 row — chapter lon se mat key)
  const pageRows = await fetchAllRows<{ object_key: string }>(
    (from, to) =>
      supabase
        .from("pages")
        .select("object_key")
        .eq("chapter_id", chapterId)
        .order("page_number", { ascending: true })
        .range(from, to),
    "đọc pages để xóa chương"
  );
  const keys = pageRows.map((p) => p.object_key);

  if (keys.length > 0) {
    await chunkedUpdate(
      (chunk) =>
        supabase
          .from("storage_objects")
          .update({ status: "DELETE_PENDING" })
          .in("object_key", chunk)
          .in("status", ["PENDING", "CONFIRMED"]),
      keys,
      "đánh dấu DELETE_PENDING (xóa chương)"
    );
  }

  await supabase.from("chapters").delete().eq("id", chapterId);

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
  invalidateStorageUsageCache();

  return { deleted: true, objectsRemoved: removedCount, objectsPendingRetry: retryNeeded };
}

export async function listPages(chapterId: string): Promise<PageDto[]> {
  // Phan trang — PostgREST cat 1000 row/chapter co the co 3000 trang
  const rows = await fetchAllRows<any>(
    (from, to) =>
      supabase
        .from("pages")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("page_number", { ascending: true })
        .range(from, to),
    "đọc pages của chương"
  );

  return rows.map((p: any) => ({
    id: p.id,
    pageNumber: p.page_number,
    objectKey: p.object_key,
    fileName: p.file_name,
    mimeType: p.mime_type,
    fileSize: Number(p.file_size),
    width: p.width,
    height: p.height,
  }));
}

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
        problems.push(`${p.objectKey}: kích thước trên R2 (${head.contentLength}B) khác khai báo (${p.fileSize}B)`);
        continue;
      }
      if (head.contentLength > MAX_FILE_SIZE) {
        problems.push(`${p.objectKey}: vượt giới hạn ${MAX_FILE_SIZE} byte`);
        continue;
      }
      const normalize = (m?: string | null) => (m === "image/jpg" ? "image/jpeg" : m ?? "");
      if (normalize(head.contentType) !== normalize(p.mimeType)) {
        problems.push(`${p.objectKey}: Content-Type trên R2 (${head.contentType ?? "?"}) khác khai báo (${p.mimeType})`);
      }
      if (!p.objectKey.startsWith(expectedPrefix)) {
        problems.push(`${p.objectKey}: không thuộc namespace ${expectedPrefix}`);
      }
    }
  });
  await Promise.all(workers);
  return problems;
}

export async function finalizePages(input: PagesFinalizeInput) {
  const { data: chapter } = await supabase.from("chapters").select("id, manga_id").eq("id", input.chapterId).maybeSingle();
  if (!chapter) throw new ApiError("Không tìm thấy chương.", 404, "not_found");

  const pageNumbers = input.pages.map((p) => p.pageNumber);
  const uniqueNumbers = new Set(pageNumbers);
  if (uniqueNumbers.size !== pageNumbers.length) {
    throw new ApiError("Có số trang bị trùng lặp trong dữ liệu gửi lên.", 400, "duplicate_page");
  }

  const expectedPrefix = `mangas/${chapter.manga_id}/chapters/${chapter.id}/`;

  // B1: Verify metadata — CHUNK theo ngan sach URL (object key ~108 ky
  // tu; 3000 key = URL ~300KB se bi PostgREST tu choi)
  const storageRows = await chunkedSelectIn<any>(
    "storage_objects",
    "object_key",
    input.pages.map((p) => p.objectKey),
    "object_key, kind, status, manga_id, chapter_id, file_size, mime_type",
    "finalize: đối chiếu storage_objects"
  );

  const rowMap = new Map((storageRows ?? []).map((r: any) => [r.object_key, r]));
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
    if (row.manga_id !== chapter.manga_id || row.chapter_id !== chapter.id) {
      problems.push(`${p.objectKey}: object không thuộc chương/truyện này`);
      continue;
    }
    if (row.status === "DELETE_PENDING") {
      problems.push(`${p.objectKey}: object đang chờ xóa`);
      continue;
    }
    if (Number(row.file_size) !== p.fileSize) {
      problems.push(`${p.objectKey}: kích thước đăng ký (${Number(row.file_size)}B) khác gửi lên (${p.fileSize}B)`);
    }
    if (row.mime_type && row.mime_type !== p.mimeType) {
      problems.push(`${p.objectKey}: mime đăng ký (${row.mime_type}) khác gửi lên (${p.mimeType})`);
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

  // B2: Verify R2
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

  // Existing pages — so trang la so ngan (chunk theo ky tu: 3000 so ~ 15KB URL)
  const existing: Array<{ page_number: number; object_key: string }> = [];
  for (const numChunk of chunkKeysForUrl(pageNumbers.map(String), 4000)) {
    const { data: rows, error } = await supabase
      .from("pages")
      .select("page_number, object_key")
      .eq("chapter_id", chapter.id)
      .in("page_number", numChunk.map((n) => Number(n)));
    if (error) throw new ApiError(`Không lấy được trang hiện có: ${error.message}`, 500);
    existing.push(...(rows ?? []));
  }

  const existingMap = new Map((existing ?? []).map((e: any) => [e.page_number, e.object_key]));

  const replacedOldKeys: string[] = [];
  for (const p of input.pages) {
    const oldKey = existingMap.get(p.pageNumber);
    if (oldKey && oldKey !== p.objectKey) replacedOldKeys.push(oldKey);
  }

  // B3: Ghi nhan DB — UPSERT THEO BATCH (200 row/request thay vi 1 row
  // moi request: chapter 3000 trang = 3000 request -> chi con 15)
  const upsertRows = input.pages.map((p) => ({
    chapter_id: chapter.id,
    page_number: p.pageNumber,
    object_key: p.objectKey,
    file_name: p.fileName,
    mime_type: p.mimeType,
    file_size: p.fileSize,
    width: p.width ?? null,
    height: p.height ?? null,
  }));
  for (let i = 0; i < upsertRows.length; i += 200) {
    const { error } = await supabase
      .from("pages")
      .upsert(upsertRows.slice(i, i + 200), { onConflict: "chapter_id,page_number" });
    if (error) throw new ApiError(`Lưu trang thất bại: ${error.message}`, 500);
  }

  // Confirm storage objects — CHUNK (status + confirmed_at dong nhat cho
  // ca nhom; file_name/file_size/mime da ghi dung tu luc presign va da duoc
  // B1+B2 xac minh khop — khong can ghi lai tung row)
  const confirmedAt = new Date().toISOString();
  const allKeys = input.pages.map((p) => p.objectKey);
  for (const chunk of chunkKeysForUrl(allKeys)) {
    // count: "exact" = so row bi anh huong (khong truyen -> count null
    // -> ham tuong tuat moi object la "chua confirm" — bug da fix)
    const { count, error } = await supabase
      .from("storage_objects")
      .update(
        {
          status: "CONFIRMED",
          confirmed_at: confirmedAt,
          chapter_id: chapter.id,
          manga_id: chapter.manga_id,
        },
        { count: "exact" }
      )
      .in("object_key", chunk)
      .neq("status", "DELETE_PENDING");
    if (error) throw new ApiError(`Xác nhận object thất bại: ${error.message}`, 500);
    if ((count ?? 0) !== chunk.length) {
      // Xac dinh chinh xac key nao chua confirm (bao loi ro rang)
      const { data: rows } = await supabase
        .from("storage_objects")
        .select("object_key, status")
        .in("object_key", chunk);
      const confirmedSet = new Set((rows ?? []).filter((r) => r.status === "CONFIRMED").map((r) => r.object_key));
      const missing = chunk.filter((k) => !confirmedSet.has(k));
      throw new ApiError(
        `${missing[0] ?? chunk[0]}: object dang cho xoa hoac chua dang ky`,
        409,
        "finalize_conflict"
      );
    }
  }

  const { count: totalCount } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .eq("chapter_id", chapter.id);

  await supabase.from("chapters").update({ page_count: totalCount ?? 0 }).eq("id", chapter.id);

  // B4: Cleanup replaced objects — CHUNK select + CHUNK update
  const batchKeys = new Set(input.pages.map((p) => p.objectKey));
  const candidates = [...new Set(replacedOldKeys)].filter((k) => !batchKeys.has(k));
  if (candidates.length > 0) {
    const stillReferenced = await chunkedSelectIn<{ object_key: string }>(
      "pages",
      "object_key",
      candidates,
      "object_key",
      "finalize: kiểm tra tham chiếu thay thế"
    );
    const refSet = new Set(stillReferenced.map((r) => r.object_key));
    const toDelete = candidates.filter((k) => !refSet.has(k));
    if (toDelete.length > 0) {
      await chunkedUpdate(
        (chunk) =>
          supabase
            .from("storage_objects")
            .update({ status: "DELETE_PENDING" })
            .in("object_key", chunk)
            .in("status", ["PENDING", "CONFIRMED"]),
        toDelete,
        "finalize: đánh dấu DELETE_PENDING"
      );
      const result = await safeDeleteObjects(toDelete);
      await removeMetadataIfDeleted(result.removed).catch(() => undefined);
      if (result.pending.length > 0) {
        console.warn(`[chapter-service] ${result.pending.length} object thay the xoa that bai — DELETE_PENDING retry.`);
      }
    }
  }
  invalidateStorageUsageCache();

  const { count: finalCount } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .eq("chapter_id", chapter.id);

  return { chapterId: chapter.id, pageCount: finalCount ?? 0 };
}

export async function deletePage(pageId: string) {
  const { data: page } = await supabase
    .from("pages")
    .select("*, chapter:chapters(id)")
    .eq("id", pageId)
    .maybeSingle();
  if (!page) throw new ApiError("Không tìm thấy trang.", 404, "not_found");

  await supabase
    .from("storage_objects")
    .update({ status: "DELETE_PENDING" })
    .eq("object_key", page.object_key)
    .in("status", ["PENDING", "CONFIRMED"]);

  await supabase.from("pages").delete().eq("id", pageId);

  const { count: pageCount } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .eq("chapter_id", page.chapter_id);

  await supabase.from("chapters").update({ page_count: pageCount ?? 0 }).eq("id", page.chapter_id);

  const result = await safeDeleteObjects([page.object_key]);
  const removedCount = await removeMetadataIfDeleted(result.removed).catch(() => 0);
  invalidateStorageUsageCache();

  return { deleted: true, pageCount: pageCount ?? 0, objectsRemoved: removedCount, objectsPendingRetry: result.pending.length };
}

export async function clearPages(chapterId: string) {
  // Phan trang (chapter co the > 1000 trang — PostgREST cat 1000 row)
  const pageRows = await fetchAllRows<{ object_key: string }>(
    (from, to) =>
      supabase
        .from("pages")
        .select("object_key")
        .eq("chapter_id", chapterId)
        .order("page_number", { ascending: true })
        .range(from, to),
    "đọc pages để xóa sạch"
  );
  const keys = pageRows.map((p) => p.object_key);

  if (keys.length > 0) {
    await chunkedUpdate(
      (chunk) =>
        supabase
          .from("storage_objects")
          .update({ status: "DELETE_PENDING" })
          .in("object_key", chunk)
          .in("status", ["PENDING", "CONFIRMED"]),
      keys,
      "xóa sạch: đánh dấu DELETE_PENDING"
    );
  }

  await supabase.from("pages").delete().eq("chapter_id", chapterId);
  await supabase.from("chapters").update({ page_count: 0 }).eq("id", chapterId);

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
  invalidateStorageUsageCache();

  return { cleared: removedCount, objectsPendingRetry: retryNeeded };
}

export async function getReaderPayload(
  mangaId: string,
  chapterId: string,
  userId: string
): Promise<ReaderPayloadDto | null> {
  const { data: manga } = await supabase.from("mangas").select("id, title").eq("id", mangaId).maybeSingle();
  const { data: chapter } = await supabase.from("chapters").select("*").eq("id", chapterId).maybeSingle();
  if (!manga || !chapter || chapter.manga_id !== mangaId) return null;

  const [pagesRows, order, progressRes] = await Promise.all([
    // Phan trang — chapter > 1000 trang se bi PostgREST cat 1000 row
    fetchAllRows<any>(
      (from, to) =>
        supabase
          .from("pages")
          .select("*")
          .eq("chapter_id", chapterId)
          .order("page_number", { ascending: true })
          .range(from, to),
      "đọc pages cho reader"
    ),
    getChapterOrder(mangaId),
    supabase.from("reading_progress").select("page_number, scroll_position, chapter_id").eq("user_id", userId).eq("manga_id", mangaId).maybeSingle(),
  ]);

  const pages = pagesRows;
  const urls = await presignGetMany(pages.map((p: any) => p.object_key));

  const idx = order.findIndex((c) => c.id === chapterId);
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  const progress = progressRes.data;

  return {
    manga: { id: manga.id, title: manga.title },
    chapter: {
      id: chapter.id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      volume: chapter.volume,
      pageCount: chapter.page_count,
    },
    pages: pages.map((p: any, i: number) => ({
      pageNumber: p.page_number,
      url: urls[i],
      width: p.width,
      height: p.height,
      fileSize: Number(p.file_size),
      mimeType: p.mime_type,
    })),
    prevChapter: prev ? { id: prev.id, chapterNumber: prev.chapterNumber } : null,
    nextChapter: next ? { id: next.id, chapterNumber: next.chapterNumber } : null,
    progress:
      progress && progress.chapter_id === chapterId
        ? { pageNumber: progress.page_number, scrollPosition: progress.scroll_position }
        : null,
  };
}