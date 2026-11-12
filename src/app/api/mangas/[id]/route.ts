// GET /api/mangas/:id — chi tiet truyen
// PATCH /api/mangas/:id — cap nhat
// DELETE /api/mangas/:id — xoa (cascade DB + R2)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, parseBody, requireAdmin, requireAdminMutation, withErrorHandling } from "@/lib/api";
import { attachCoverUrl } from "@/lib/cover-url";
import { mangaUpdateSchema } from "@/schemas";
import { getMangaDetail, updateManga, deleteManga } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  const user = await requireAdmin(req);
  const { id } = await ctx.params;
  const detail = await getMangaDetail(id, user.id);
  if (!detail) return fail("Không tìm thấy truyện.", 404, "not_found");
  return ok(await attachCoverUrl(detail));
});

export const PATCH = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, mangaUpdateSchema);
  const manga = await updateManga(id, input);
  return ok({ id: manga.id, updatedAt: manga.updatedAt.toISOString() });
});

export const DELETE = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const result = await deleteManga(id);
  return ok(result);
});
