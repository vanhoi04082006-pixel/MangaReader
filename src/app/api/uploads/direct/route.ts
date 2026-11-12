// POST /api/uploads/direct?key=...&contentType=...
// Proxy upload: browser -> Next server -> R2.
// Fallback CO GIAM khi bucket chua co CORS cho presigned PUT truc tiep.
//
// BAO MAT (ban dau chi dua vao Content-Length header — da chinh sua):
// - Chi cho phep key da dang ky qua /api/uploads/presign VA con o trang
//   thai PENDING (chong thay the object tuy y / object da confirm)
// - Content-Type phai khop metadata da dang ky
// - DEM BYTE THUC TE khi doc body + chan ngay khi vuot MAX_FILE_SIZE
//   (khong tin Content-Length header — co the thieu/0)
// - Kich thuoc thuc te phai DUNG BANG da dang ky khi presign
// - Gioi han kich thuoc phu hop Vercel serverless (~4.5MB body)
//   -> file lon PHAI di qua presigned PUT truc tiep len R2
//
// KY THUAT: proxy da bi gioi han 4MB nen doc buffer + dem byte chinh xac
// (tranh van de checksum/streaming cua AWS SDK voi R2).
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { ok, fail, requireAdminMutation, withErrorHandling, ApiError } from "@/lib/api";
import { r2, deleteObjects } from "@/lib/r2";
import { db } from "@/lib/db";
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
  const row = await db.storageObject.findUnique({ where: { objectKey: key } });
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
  if (row.mimeType && row.mimeType !== contentType) {
    return fail("Content-Type không khớp metadata đã đăng ký.", 400, "mime_mismatch");
  }
  if (row.kind === "PAGE") {
    if (!row.mangaId || !row.chapterId) {
      throw new ApiError("Metadata object PAGE không đầy đủ.", 400, "bad_metadata");
    }
    if (!key.startsWith(`mangas/${row.mangaId}/chapters/${row.chapterId}/`)) {
      throw new ApiError("Object key không thuộc namespace của chương này.", 400, "bad_namespace");
    }
  } else if (row.kind === "COVER") {
    if (!row.mangaId || !key.startsWith(`mangas/${row.mangaId}/covers/`)) {
      throw new ApiError("Object key không thuộc namespace cover của truyện này.", 400, "bad_namespace");
    }
  }

  if (!req.body) {
    return fail("Thiếu dữ liệu file.", 400, "empty_body");
  }

  // Gioi han phu hop Vercel: proxy chi nhan file nho. File lon PHAI di
  // qua presigned PUT truc tiep (khong bi gioi han body size cua host).
  const declared = row.fileSize;
  if (declared > MAX_PROXY_FILE_SIZE) {
    return fail(
      `File ${Math.round(declared / 1024 / 1024)}MB vượt quá giới hạn proxy (${Math.round(
        MAX_PROXY_FILE_SIZE / 1024 / 1024
      )}MB). Cần cấu hình CORS cho bucket R2 để upload trực tiếp.`,
      413,
      "proxy_too_large"
    );
  }

  // ---- Doc body voi bo dem byte thuc te + chan vuot gioi han ----
  // (S3 PUT la atomic: upload bi gian doan khong tao object le tren R2)
  const chunks: Buffer[] = [];
  let actualBytes = 0;
  let overflowed = false;
  try {
    const reader = req.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      actualBytes += value.byteLength;
      if (actualBytes > MAX_FILE_SIZE) {
        overflowed = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    console.error("[uploads/direct] doc body that bai (client disconnect?):", err);
    return fail("Dữ liệu upload bị gián đoạn.", 400, "body_interrupted");
  }

  if (overflowed || actualBytes > MAX_FILE_SIZE) {
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

  // Cap nhat dung luong theo byte DA DEM (khong tin header)
  if (actualBytes > 0 && row.fileSize !== actualBytes) {
    await db.storageObject.update({
      where: { objectKey: key },
      data: { fileSize: actualBytes },
    });
  }

  return ok({ uploaded: true, objectKey: key, sizeBytes: actualBytes });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
