// POST /api/uploads/presign-batch — cap presigned PUT URL CHO NHIEU
// file trong 1 request (toi da 100). Giam so request presign tu N
// thanh ceil(N/100): import 7.297 anh chi con 73 request thay vi
// 7.297 (rate limit 1000/10phut khong con la diem nghen).
//
// Bao mat: gionh /api/uploads/presign — requireAdminMutation,
// kiem tra chapter thuoc truyen, quota cap nhat THEO TONG batch,
// moi URL van ky kem Content-Length de R2 tu choi neu sai kich thuoc.
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, parseBody, requireAdminMutation, withErrorHandling, ApiError } from "@/lib/api";
import { presignBatchSchema } from "@/schemas";
import { supabase } from "@/lib/supabase";
import { presignPut, pageObjectKey, extFromMime } from "@/lib/r2";
import { getQuotaUsageBytes } from "@/services/storage-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);

  // 1 request batch = 1 hit rate limit presign (khong phai N hit)
  const rl = await hitRateLimit(`presign:${user.id}`, RATE_LIMITS.presign.limit, RATE_LIMITS.presign.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu presign, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const input = await parseBody(req, presignBatchSchema);

  if (!input.chapterId) {
    return fail("Thiếu ID chương để upload trang (batch chỉ dành cho PAGE).", 400, "missing_chapter");
  }

  // Xac thuc moi quan he du lieu: chapter thuoc dung truyen
  const { data: chapter, error: chapterErr } = await supabase
    .from("chapters")
    .select("id, manga_id")
    .eq("id", input.chapterId)
    .maybeSingle();
  if (chapterErr) throw new ApiError(`Kiểm tra chương thất bại: ${chapterErr.message}`, 500);
  if (!chapter || chapter.manga_id !== input.mangaId) {
    return fail("Chương không thuộc truyện này.", 404, "not_found");
  }

  // Kiem tra mime tung item
  for (const item of input.items) {
    if (!extFromMime(item.mimeType)) {
      throw new ApiError("Định dạng ảnh không được hỗ trợ.", 400, "bad_mime");
    }
  }

  // Quota: kiem 1 LAN cho ca batch (tong bytes khai bao)
  const batchBytes = input.items.reduce((s, it) => s + it.fileSize, 0);
  const { usedBytes, quotaBytes } = await getQuotaUsageBytes(batchBytes);
  if (usedBytes > quotaBytes) {
    return fail(
      `Vượt hạn mức lưu trữ (${Math.round(quotaBytes / 1024 / 1024 / 1024)}GB). ` +
        `Đã dùng ~${(usedBytes / 1024 / 1024 / 1024).toFixed(2)}GB. Hãy dọn dẹp file hoặc tăng STORAGE_QUOTA_GB.`,
      507,
      "quota_exceeded"
    );
  }

  // Sinh object key tung file
  const rows = input.items.map((item) => {
    const ext = extFromMime(item.mimeType) ?? "jpg";
    const objectKey = pageObjectKey(input.mangaId, input.chapterId!, item.pageNumber ?? 0, ext);
    return {
      object_key: objectKey,
      kind: "PAGE",
      status: "PENDING",
      file_name: item.fileName,
      file_size: item.fileSize,
      mime_type: item.mimeType,
      manga_id: input.mangaId,
      chapter_id: input.chapterId,
    };
  });

  // Insert TAT CA PENDING row trong 1 request (PostgREST insert array)
  const { data: inserted, error: soErr } = await supabase
    .from("storage_objects")
    .insert(rows)
    .select("id, object_key");
  if (soErr) throw new ApiError(`Tạo storage object thất bại: ${soErr.message}`, 500);
  if (!inserted || inserted.length !== rows.length) {
    throw new ApiError("Tạo storage object thất bại (số row không khớp).", 500);
  }

  // Ky URL song song (SigV4 la tinh toan CPU — nhanh)
  const items = await Promise.all(
    rows.map(async (row, i) => {
      const uploadUrl = await presignPut({
        key: row.object_key,
        contentType: input.items[i].mimeType,
        contentLength: input.items[i].fileSize,
        expiresIn: 15 * 60,
      });
      return {
        objectKey: row.object_key,
        uploadUrl,
        storageObjectId: inserted[i].id,
      };
    })
  );

  return ok({ items, batchSize: items.length });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
