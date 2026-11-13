// GET /api/chapters/:id — chi tiet chuong + danh sach trang (co presigned URL cho thumbnail)
// PATCH /api/chapters/:id — cap nhat chuong
// DELETE /api/chapters/:id — xoa chuong (DB + R2 dong bo)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, parseBody, requireAdmin, requireAdminMutation, requireAdminDestructive, withErrorHandling } from "@/lib/api";
import { chapterUpdateSchema } from "@/schemas";
import {
  updateChapter,
  deleteChapter,
  listPages,
} from "@/services/chapter-service";
import { presignGetMany } from "@/lib/r2";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;

  const { data: chapter } = await supabase.from("chapters").select("*").eq("id", id).maybeSingle();
  if (!chapter) return fail("Không tìm thấy chương.", 404, "not_found");

  const pages = await listPages(id);
  const urls = await presignGetMany(pages.map((p) => p.objectKey));

  return ok({
    chapter: {
      id: chapter.id,
      mangaId: chapter.manga_id,
      chapterNumber: chapter.chapter_number,
      title: chapter.title,
      volume: chapter.volume,
      pageCount: chapter.page_count,
      createdAt: chapter.created_at,
      updatedAt: chapter.updated_at,
    },
    pages: pages.map((p, i) => ({ ...p, url: urls[i] })),
  });
});

export const PATCH = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, chapterUpdateSchema);
  const chapter = await updateChapter(id, input);
  return ok({ id: chapter.id, updatedAt: chapter.updated_at });
});

export const DELETE = withErrorHandling<Ctx>(async (req, ctx) => {
  // Thao tac pha hoi (DB + xoa object R2) -> xac minh session truc tiep voi Supabase.
  await requireAdminDestructive(req);
  const { id } = await ctx.params;
  const result = await deleteChapter(id);
  return ok(result);
});
