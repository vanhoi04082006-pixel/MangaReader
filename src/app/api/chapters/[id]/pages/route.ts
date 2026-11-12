// GET /api/chapters/:id/pages — danh sach trang
// POST /api/chapters/:id/pages — finalize upload pages (batch, transaction)
// DELETE /api/chapters/:id/pages — xoa toan bo trang (che do thay the)
//
// GUARD (pass 4): POST finalize va DELETE clearPages deu di qua
// requireAdminDestructive (Strict Session Guard — xac minh session truc tiep
// voi Supabase + auth.sessions, KHONG qua cache 90s):
// - finalizePages buoc B4 safe-delete object R2 cua trang bi thay the;
// - clearPages xoa TOAN BO trang cua chuong ca tren DB lan tren R2.
// Ca hai deu la thao tac PHA HOAI du lieu thuc — khong duoc chiu cua so
// cache xac thuc 90 giay tren instance khac sau khi logout.
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireAdmin, requireAdminDestructive, withErrorHandling } from "@/lib/api";
import { pagesFinalizeSchema } from "@/schemas";
import { listPages, finalizePages, clearPages } from "@/services/chapter-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const pages = await listPages(id);
  return ok({ pages });
});

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  // finalizePages buoc B4 safe-delete object R2 cua trang bi thay the -> PHA HOAI.
  await requireAdminDestructive(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, pagesFinalizeSchema);
  const result = await finalizePages({ ...input, chapterId: id });
  return ok(result, { status: 201 });
});

export const DELETE = withErrorHandling<Ctx>(async (req, ctx) => {
  // Xoa toan bo trang (DB + object R2) — PHA HOAI du lieu thuc.
  await requireAdminDestructive(req);
  const { id } = await ctx.params;
  const result = await clearPages(id);
  return ok(result);
});
