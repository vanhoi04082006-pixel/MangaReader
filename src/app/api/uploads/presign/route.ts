// POST /api/uploads/presign — cap presigned PUT URL (upload truc tiep browser -> R2)
// Moi URL duoc track bang StorageObject (PENDING) de xu ly orphan.
//
// Bao mat:
// - requireAdmin (chi admin duoc cap URL)
// - KY ca Content-Length (fileSize da khai bao) -> R2 tu choi neu sai kich thuoc
// - Kiem tra storage quota phia server (CONFIRMED + PENDING moi)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, parseBody, requireAdminMutation, withErrorHandling, ApiError } from "@/lib/api";
import { presignSchema, MAX_FILE_SIZE } from "@/schemas";
import { supabase } from "@/lib/supabase";
import { presignPut, pageObjectKey, coverObjectKey, extFromMime } from "@/lib/r2";
import { getQuotaUsageBytes } from "@/services/storage-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);

  // Rate limit presign theo user (upload hang loat can nhieu URL)
  const rl = await hitRateLimit(`presign:${user.id}`, RATE_LIMITS.presign.limit, RATE_LIMITS.presign.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu presign, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const input = await parseBody(req, presignSchema);

  const ext = extFromMime(input.mimeType);
  if (!ext) {
    throw new ApiError("Định dạng ảnh không được hỗ trợ.", 400, "bad_mime");
  }
  if (input.fileSize > MAX_FILE_SIZE) {
    throw new ApiError("Mỗi ảnh tối đa 100MB.", 413, "too_large");
  }

  // Xac thuc moi quan he du lieu
  // (FK chapters.manga_id -> mangas.id: chapter ton tai = manga ton tai,
  //  nen voi PAGE chi can kiem tra chapter thuoc dung truyen.)
  if (input.kind === "PAGE") {
    if (!input.chapterId) {
      return fail("Thiếu ID chương để upload trang.", 400, "missing_chapter");
    }
    const { data: chapter } = await supabase.from("chapters").select("id, manga_id").eq("id", input.chapterId).maybeSingle();
    if (!chapter || chapter.manga_id !== input.mangaId) {
      return fail("Chương không thuộc truyện này.", 404, "not_found");
    }
  } else {
    const { data: manga } = await supabase.from("mangas").select("id").eq("id", input.mangaId).maybeSingle();
    if (!manga) return fail("Không tìm thấy truyện.", 404, "not_found");
  }

  // ---- Kiem tra storage quota (server-side) ----
  // CONFIRMED + PENDING tuoi (< 24h) + file sap them. Dung helper co
  // cache 60s (phan trang dung — cu scan toan bang cho MOI presign va
  // con sai vi PostgREST cat 1000 row).
  const { usedBytes, quotaBytes } = await getQuotaUsageBytes(input.fileSize);
  if (usedBytes > quotaBytes) {
    return fail(
      `Vượt hạn mức lưu trữ (${Math.round(quotaBytes / 1024 / 1024 / 1024)}GB). ` +
        `Đã dùng ~${(usedBytes / 1024 / 1024 / 1024).toFixed(2)}GB. Hãy dọn dẹp file hoặc tăng STORAGE_QUOTA_GB.`,
      507,
      "quota_exceeded"
    );
  }

  const objectKey =
    input.kind === "PAGE" && input.chapterId
      ? pageObjectKey(input.mangaId, input.chapterId, input.pageNumber ?? 0, ext)
      : coverObjectKey(input.mangaId, ext);

  // Track object truoc khi cap URL (neu upload bi gian doan -> audit phat hien)
  const { data: storageObject, error: soErr } = await supabase
    .from("storage_objects")
    .insert({
      object_key: objectKey,
      kind: input.kind,
      status: "PENDING",
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      manga_id: input.mangaId,
      chapter_id: input.kind === "PAGE" ? input.chapterId ?? null : null,
    })
    .select()
    .single();
  if (soErr) throw new ApiError(`Tạo storage object thất bại: ${soErr.message}`, 500);

  // KY kem Content-Length: R2 tu choi PUT neu kich thuoc thuc te khac khai bao.
  // (neu R2 khong ap dung, finalize se HeadObject verify — lop thu hai)
  const uploadUrl = await presignPut({
    key: objectKey,
    contentType: input.mimeType,
    contentLength: input.fileSize,
    expiresIn: 15 * 60,
  });

  return ok({
    objectKey,
    uploadUrl,
    storageObjectId: storageObject.id,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
