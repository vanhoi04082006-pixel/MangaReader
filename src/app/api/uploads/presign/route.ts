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
import { db } from "@/lib/db";
import { presignPut, pageObjectKey, coverObjectKey, extFromMime } from "@/lib/r2";
import { getEnv } from "@/lib/env";
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
  const manga = await db.manga.findUnique({ where: { id: input.mangaId }, select: { id: true } });
  if (!manga) return fail("Không tìm thấy truyện.", 404, "not_found");

  if (input.kind === "PAGE") {
    if (!input.chapterId) {
      return fail("Thiếu ID chương để upload trang.", 400, "missing_chapter");
    }
    const chapter = await db.chapter.findUnique({
      where: { id: input.chapterId },
      select: { id: true, mangaId: true },
    });
    if (!chapter || chapter.mangaId !== input.mangaId) {
      return fail("Chương không thuộc truyện này.", 404, "not_found");
    }
  }

  // ---- Kiem tra storage quota (server-side) ----
  // Tinh: dung luong CONFIRMED + PENDING "con song" (tao < 24h — qua han se bi cleanup)
  const env = getEnv();
  const activePendingSince = new Date(Date.now() - 24 * 3600 * 1000);
  const [confirmedAgg, pendingAgg] = await Promise.all([
    db.storageObject.aggregate({
      where: { status: "CONFIRMED" },
      _sum: { fileSize: true },
    }),
    db.storageObject.aggregate({
      where: { status: "PENDING", createdAt: { gte: activePendingSince } },
      _sum: { fileSize: true },
    }),
  ]);
  const usedBytes =
    Number(confirmedAgg._sum.fileSize ?? 0) + Number(pendingAgg._sum.fileSize ?? 0);
  if (usedBytes + input.fileSize > env.storageQuotaBytes) {
    return fail(
      `Vượt hạn mức lưu trữ (${Math.round(env.storageQuotaBytes / 1024 / 1024 / 1024)}GB). ` +
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
  const storageObject = await db.storageObject.create({
    data: {
      objectKey,
      kind: input.kind,
      status: "PENDING",
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      mangaId: input.mangaId,
      chapterId: input.kind === "PAGE" ? input.chapterId ?? null : null,
    },
  });

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
