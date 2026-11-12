// GET /api/chapters/:id/reader — payload day du cho Reader
// (pages + presigned URLs co han + prev/next + progress)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, requireUser, withErrorHandling } from "@/lib/api";
import { getReaderPayload } from "@/services/chapter-service";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const chapter = await db.chapter.findUnique({
    where: { id },
    select: { mangaId: true },
  });
  if (!chapter) return fail("Không tìm thấy chương.", 404, "not_found");

  const payload = await getReaderPayload(chapter.mangaId, id, user.id);
  if (!payload) return fail("Không tìm thấy chương.", 404, "not_found");

  // Ghi nhan lich su doc (mo chuong = bat dau doc)
  await db.readingHistory.upsert({
    where: { userId_chapterId: { userId: user.id, chapterId: id } },
    update: { readAt: new Date() },
    create: {
      userId: user.id,
      mangaId: chapter.mangaId,
      chapterId: id,
      pageNumber: payload.progress?.pageNumber ?? 1,
    },
  });

  return ok(payload);
});
