// GET /api/mangas/:id/chapters — danh sach chuong (phan trang)
// POST /api/mangas/:id/chapters — tao chuong moi
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, parseQuery, requireAdmin, requireAdminMutation, withErrorHandling } from "@/lib/api";
import { chapterListQuerySchema, chapterCreateSchema } from "@/schemas";
import { listChapters, createChapter } from "@/services/chapter-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const query = parseQuery(req, chapterListQuerySchema);
  const result = await listChapters(id, query.sort, query.page, query.pageSize);
  return ok(result);
});

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, chapterCreateSchema);
  const chapter = await createChapter(id, input);
  return ok(
    {
      id: chapter.id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      volume: chapter.volume,
      pageCount: chapter.page_count,
      createdAt: chapter.created_at,
    },
    { status: 201 }
  );
});
