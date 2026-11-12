// POST /api/mangas/:id/cover/from-page — dat anh bia tu 1 trang cua truyen
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdminMutation, parseBody, fail, withErrorHandling } from "@/lib/api";
import { setCoverFromPageSchema } from "@/schemas";
import { db } from "@/lib/db";
import { copyObject, coverObjectKey, extFromMime } from "@/lib/r2";
import { setMangaCover } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id: mangaId } = await ctx.params;
  const { pageId } = await parseBody(req, setCoverFromPageSchema);

  const page = await db.page.findUnique({
    where: { id: pageId },
    include: { chapter: { select: { mangaId: true } } },
  });
  if (!page || page.chapter.mangaId !== mangaId) {
    return fail("Trang không thuộc truyện này.", 404, "not_found");
  }

  const ext = extFromMime(page.mimeType) ?? "jpg";
  const newKey = coverObjectKey(mangaId, ext);
  await copyObject(page.objectKey, newKey, page.mimeType);

  await db.storageObject.create({
    data: {
      objectKey: newKey,
      kind: "COVER",
      status: "CONFIRMED",
      confirmedAt: new Date(),
      mangaId,
      chapterId: null,
      fileName: page.fileName,
      fileSize: page.fileSize,
      mimeType: page.mimeType,
    },
  });

  const result = await setMangaCover(mangaId, newKey);
  return ok(result);
});
