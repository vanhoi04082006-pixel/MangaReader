// POST /api/uploads/direct?key=...&contentType=...
// Proxy upload: browser -> Next server -> R2.
// Fallback CO GIAM khi bucket chua co CORS cho presigned PUT truc tiep.
//
// BAO MAT (ban dau chi dua vao Content-Length header — da chinh sua):
// - Chi cho phep key da dang ky qua /api/uploads/presign VA con o trang
//   thai PENDING (chong thay the object tuy y / object da confirm)
// - Content-Type phai khop metadata da dang ky
// - DEM BYTE THUC TE khi doc body + CHAN NGAY khi vuot MAX_PROXY_FILE_SIZE
//   (4MB — khong tin Content-Length header, khong cho phep ngam body lon
//   hon gioi han proxy vao bo nho; file lon phai di presigned PUT truc tiep)
// - Kich thuoc thuc te phai DUNG BANG da dang ky khi presign
// - Gioi han kich thuoc phu hop Vercel serverless (~4.5MB body)
//   -> file lon PHAI di qua presigned PUT truc tiep len R2
//
// KY THUAT: proxy da bi gioi han 4MB nen doc buffer + dem byte chinh xac
// (tranh van de checksum/streaming cua AWS SDK voi R2).
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { ok, fail, requireAdminMutation, withErrorHandling, ApiError } from "@/lib/api";
import { r2 } from "@/lib/r2";
import { supabase } from "@/lib/supabase";
import { MAX_FILE_SIZE, MAX_PROXY_FILE_SIZE, IMAGE_MIME_TYPES } from "@/schemas";
import { getEnv } from "@/lib/env";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);

  const rl = await hitRateLimit(
    `upload-proxy:${user.id}`,
    RATE_LIMITS.uploadProxy.limit,
    RATE_LIMITS.uploadProxy.windowMs
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu upload, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const contentType = (url.searchParams.get("contentType") ?? "").toLowerCase();
  if (!key) return fail("Thiếu tham số key.", 400, "missing_key");

  // Chi chap nhan Content-Type anh hop le
  if (!IMAGE_MIME_TYPES.includes(contentType as (typeof IMAGE_MIME_TYPES)[number])) {
    return fail("Định dạng ảnh không được hỗ trợ.", 400, "bad_mime");
  }

  // Chi cho phep upload vao key da dang ky VA con PENDING
  const { data: row } = await supabase
    .from("storage_objects")
    .select("object_key, kind, status, mime_type, manga_id, chapter_id, file_size")
    .eq("object_key", key)
    .maybeSingle();
  if (!row) {
    throw new ApiError("Object key chưa được đăng ký. Hãy yêu cầu presign trước.", 400, "unregistered_key");
  }
  if (row.status !== "PENDING") {
    throw new ApiError(
      `Object key không còn ở trạng thái chờ upload (hiện: ${row.status}).`,
      409,
      "not_pending"
    );
  }

  // Kiem tra metadata + key thuoc namespace dung (mangas/<mangaId>/...)
  if (row.mime_type && row.mime_type !== contentType) {
    return fail("Content-Type không khớp metadata đã đăng ký.", 400, "mime_mismatch");
  }
  if (row.kind === "PAGE") {
    if (!row.manga_id || !row.chapter_id) {
      throw new ApiError("Metadata object PAGE không đầy đủ.", 400, "bad_metadata");
    }
    if (!key.startsWith(`mangas/${row.manga_id}/chapters/${row.chapter_id}/`)) {
      throw new ApiError("Object key không thuộc namespace của chương này.", 400, "bad_namespace");
    }
  } else if (row.kind === "COVER") {
    if (!row.manga_id || !key.startsWith(`mangas/${row.manga_id}/covers/`)) {
      throw new ApiError("Object key không thuộc namespace cover của truyện này.", 400, "bad_namespace");
    }
  }

  if (!req.body) {
    return fail("Thiếu dữ liệu file.", 400, "empty_body");
  }

  // Gioi han phu hop Vercel: proxy chi nhan file nho. File lon PHAI di
  // qua presigned PUT truc tiep (khong bi gioi han body size cua host).
  // LUU Y: storage_objects.file_size la BigInt -> PostgREST tra ve string.
  // PHAI chuan hoa Number(...) truoc khi so sanh/tinh toan (gia tri <= 100MB
  // nen khong mat do chinh xac).
  const declared = Number(row.file_size);
  if (!Number.isSafeInteger(declared) || declared <= 0) {
    return fail("Metadata kích thước không hợp lệ.", 400, "bad_metadata");
  }
  if (declared > MAX_PROXY_FILE_SIZE) {
    return fail(
      `File ${Math.round(declared / 1024 / 1024)}MB vượt quá giới hạn proxy (${Math.round(
        MAX_PROXY_FILE_SIZE / 1024 / 1024
      )}MB). Cần cấu hình CORS cho bucket R2 để upload trực tiếp.`,
      413,
      "proxy_too_large"
    );
  }

  // ---- Doc body voi bo dem byte thuc te + chan ngay tai gioi han PROXY ----
  // Gioi han streaming la MAX_PROXY_FILE_SIZE (4MB) chu KHONG phai MAX_FILE_SIZE
  // (100MB): proxy chi phuc vu file nho — mot body khai bao sai (nho) nhung
  // stream rat lon phai bi chan ngay khi vuot 4MB, khong cho phep tiep tuc
  // ngam body vao bo nho (S3 PUT la atomic: upload bi gian doan khong tao
  // object le tren R2; PUT chi thuc hien SAU khi doc het body thanh cong).
  const chunks: Buffer[] = [];
  let actualBytes = 0;
  let overflowedProxy = false;
  try {
    const reader = req.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const nextBytes = actualBytes + value.byteLength;
      if (nextBytes > MAX_PROXY_FILE_SIZE) {
        // Vuot gioi han proxy: huy reader NGAY LAP TUC, khong giu chunk tran.
        overflowedProxy = true;
        actualBytes = nextBytes;
        await reader.cancel().catch(() => undefined);
        break;
      }
      actualBytes = nextBytes;
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    console.error("[uploads/direct] doc body that bai (client disconnect?):", err);
    return fail("Dữ liệu upload bị gián đoạn.", 400, "body_interrupted");
  }

  if (overflowedProxy || actualBytes > MAX_PROXY_FILE_SIZE) {
    return fail(
      `Body vượt quá giới hạn proxy ${Math.round(MAX_PROXY_FILE_SIZE / 1024 / 1024)}MB (đã nhận ≥ ${actualBytes} byte). File lớn phải upload trực tiếp qua presigned PUT.`,
      413,
      "proxy_too_large"
    );
  }

  // Bao ve phong thi hai: body khong the vuot 4MB (chan o tren), nhung van
  // kiem tra lai voi gioi han tuyet doi cua anh.
  if (actualBytes > MAX_FILE_SIZE) {
    return fail(
      `File vượt quá giới hạn ${(MAX_FILE_SIZE / 1024 / 1024) | 0}MB (đã nhận ${actualBytes} byte).`,
      413,
      "too_large"
    );
  }

  // Kich thuoc thuc te phai DUNG BANG da dang ky khi presign
  // (chan quota bypass bang gia tri gia)
  if (actualBytes !== declared) {
    return fail(
      `Kích thước thực tế (${actualBytes}B) không khớp khai báo (${declared}B). Hãy upload lại.`,
      400,
      "size_mismatch"
    );
  }

  // ---- PUT len R2 (buffer da gioi han <= 4MB) ----
  const env = getEnv();
  const body = Buffer.concat(chunks);
  try {
    await r2().send(
      new PutObjectCommand({
        Bucket: env.r2.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "private, max-age=604800",
      })
    );
  } catch (err) {
    console.error("[uploads/direct] R2 put failed:", err);
    return fail("Upload lên R2 thất bại.", 502, "r2_error");
  }

  // Cap nhat dung luong theo byte DA DEM (khong tin header):
  // sau cua actualBytes === declared thi row.fileSize da dung gia tri
  // nay (update lai chi la no-op) — bo khoi de han che ghi DB khong can thiet.

  return ok({ uploaded: true, objectKey: key, sizeBytes: actualBytes });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
