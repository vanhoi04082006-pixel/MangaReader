// POST /api/mangas/:id/cover — finalize upload anh bia (sau khi PUT len R2)
//
// BAO MAT: verify object TON TAI tren R2 (HeadObject) + kich thuoc/mime
// khop khai bao + key thuoc namespace cover cua truyen TRUOC khi confirm.
//
// GUARD (pass 4): setMangaCover thay bia cu bang object moi thi
// safe-delete object bia CU tren R2 (mark DELETE_PENDING -> xoa R2).
// Do la thao tac PHA HOI du lieu thuc cho du endpoint dung POST —
// dung Strict Session Guard (xac minh session truc tiep, khong qua cache 90s).
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdminDestructive, parseBody, fail, withErrorHandling, ApiError } from "@/lib/api";
import { coverFinalizeSchema, MAX_FILE_SIZE } from "@/schemas";
import { supabase } from "@/lib/supabase";
import { headObject } from "@/lib/r2";
import { setMangaCover } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  // setMangaCover co safe-delete object bia cu tren R2 -> PHA HOI (pass 4).
  await requireAdminDestructive(req);
  const { id: mangaId } = await ctx.params;
  const input = await parseBody(req, coverFinalizeSchema);

  const { data: manga } = await supabase.from("mangas").select("id").eq("id", mangaId).maybeSingle();
  if (!manga) return fail("Không tìm thấy truyện.", 404, "not_found");

  // Verify metadata dang ky trong DB
  const { data: row } = await supabase
    .from("storage_objects")
    .select("object_key, kind, status, manga_id, file_size")
    .eq("object_key", input.objectKey)
    .maybeSingle();
  const expectedPrefix = `mangas/${mangaId}/covers/`;
  if (!row) {
    throw new ApiError("Object key chưa được đăng ký qua /api/uploads/presign.", 400, "unregistered_key");
  }
  if (row.kind !== "COVER") {
    throw new ApiError("Object không phải loại COVER.", 400, "bad_kind");
  }
  if (row.status === "DELETE_PENDING") {
    throw new ApiError("Object đang chờ xóa.", 409, "delete_pending");
  }
  if (row.manga_id !== mangaId) {
    throw new ApiError("Object không thuộc truyện này.", 403, "bad_owner");
  }
  if (!input.objectKey.startsWith(expectedPrefix)) {
    throw new ApiError("Object key không thuộc namespace cover của truyện.", 400, "bad_namespace");
  }
  if (Number(row.file_size) !== input.fileSize) {
    throw new ApiError(
      `Kích thước đăng ký (${Number(row.file_size)}B) khác gửi lên (${input.fileSize}B).`,
      400,
      "size_mismatch"
    );
  }

  // Verify object ton tai tren R2 voi dung kich thuoc/mime
  const head = await headObject(input.objectKey);
  if (!head) {
    throw new ApiError("Object chưa tồn tại trên R2 (upload chưa hoàn tất?).", 400, "r2_missing");
  }
  if (head.contentLength !== input.fileSize) {
    throw new ApiError(
      `Kích thước trên R2 (${head.contentLength}B) khác khai báo (${input.fileSize}B).`,
      400,
      "size_mismatch"
    );
  }
  if (head.contentLength > MAX_FILE_SIZE) {
    throw new ApiError("File vượt quá 100MB.", 413, "too_large");
  }
  const normalize = (m?: string | null) => (m === "image/jpg" ? "image/jpeg" : m ?? "");
  if (normalize(head.contentType) !== normalize(input.mimeType)) {
    throw new ApiError(
      `Content-Type trên R2 (${head.contentType ?? "?"}) khác khai báo (${input.mimeType}).`,
      400,
      "mime_mismatch"
    );
  }

  const { error: upsertErr } = await supabase.from("storage_objects").upsert(
    {
      object_key: input.objectKey,
      kind: "COVER",
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
      manga_id: mangaId,
      chapter_id: null,
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
    },
    { onConflict: "object_key" }
  );
  if (upsertErr) throw new ApiError(`Xác nhận ảnh bìa thất bại: ${upsertErr.message}`, 500);

  const result = await setMangaCover(mangaId, input.objectKey, {
    lqip: input.coverLqip ?? null,
    color: input.coverColor ?? null,
  });
  return ok(result);
});
