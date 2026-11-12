// POST /api/uploads/direct?key=...&contentType=...
// Proxy upload: browser -> Next server -> R2 (streaming).
// Fallback khi bucket chua co CORS cho presigned PUT truc tiep.
// Chi chap nhan key da duoc dang ky qua /api/uploads/presign (PENDING).
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { ok, fail, requireUser, withErrorHandling, ApiError } from "@/lib/api";
import { r2 } from "@/lib/r2";
import { db } from "@/lib/db";
import { MAX_FILE_SIZE } from "@/schemas";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const contentType = url.searchParams.get("contentType") ?? "application/octet-stream";
  if (!key) return fail("Thiếu tham số key.", 400, "missing_key");

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_FILE_SIZE) {
    return fail("File vượt quá 100MB.", 413, "too_large");
  }

  // Chi cho phep upload vao key da dang ky (chong upload tuy y)
  const row = await db.storageObject.findUnique({ where: { objectKey: key } });
  if (!row) {
    throw new ApiError("Object key chưa được đăng ký. Hãy yêu cầu presign trước.", 400, "unregistered_key");
  }

  if (!req.body) {
    return fail("Thiếu dữ liệu file.", 400, "empty_body");
  }

  const env = getEnv();
  const nodeStream = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]);

  await r2().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: nodeStream,
      ContentType: contentType,
      ContentLength: contentLength > 0 ? contentLength : undefined,
      CacheControl: "private, max-age=604800",
    })
  );

  // Cap nhat dung luong thuc te neu Content-Length ton tai
  if (contentLength > 0 && row.fileSize !== contentLength) {
    await db.storageObject.update({
      where: { objectKey: key },
      data: { fileSize: contentLength },
    });
  }

  return ok({ uploaded: true, objectKey: key });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
