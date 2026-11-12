// POST /api/uploads/presign — cap presigned PUT URL (upload truc tiep browser -> R2)
// Moi URL duoc track bang StorageObject (PENDING) de xu ly orphan
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, parseBody, requireUser, withErrorHandling, ApiError } from "@/lib/api";
import { presignSchema } from "@/schemas";
import { db } from "@/lib/db";
import { presignPut, pageObjectKey, coverObjectKey, extFromMime } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);
  const input = await parseBody(req, presignSchema);

  const ext = extFromMime(input.mimeType);
  if (!ext) {
    throw new ApiError("Định dạng ảnh không được hỗ trợ.", 400, "bad_mime");
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

  const uploadUrl = await presignPut({
    key: objectKey,
    contentType: input.mimeType,
    expiresIn: 15 * 60,
  });

  return ok({
    objectKey,
    uploadUrl,
    storageObjectId: storageObject.id,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
