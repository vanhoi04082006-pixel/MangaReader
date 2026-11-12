// POST /api/mangas/:id/cover — finalize upload anh bia (sau khi PUT len R2)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireUser, parseBody, fail, withErrorHandling } from "@/lib/api";
import { coverFinalizeSchema } from "@/schemas";
import { db } from "@/lib/db";
import { setMangaCover } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireUser(req);
  const { id: mangaId } = await ctx.params;
  const input = await parseBody(req, coverFinalizeSchema);

  const manga = await db.manga.findUnique({ where: { id: mangaId }, select: { id: true } });
  if (!manga) return fail("Không tìm thấy truyện.", 404, "not_found");

  await db.storageObject.upsert({
    where: { objectKey: input.objectKey },
    update: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      kind: "COVER",
      mangaId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    },
    create: {
      objectKey: input.objectKey,
      kind: "COVER",
      status: "CONFIRMED",
      confirmedAt: new Date(),
      mangaId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    },
  });

  const result = await setMangaCover(mangaId, input.objectKey);
  return ok(result);
});
