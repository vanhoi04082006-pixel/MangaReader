// GET /api/chapters/:id/pages — danh sach trang
// POST /api/chapters/:id/pages — finalize upload pages (batch, transaction)
// DELETE /api/chapters/:id/pages — xoa toan bo trang (che do thay the)
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireAdmin, requireAdminMutation, withErrorHandling } from "@/lib/api";
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
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, pagesFinalizeSchema);
  const result = await finalizePages({ ...input, chapterId: id });
  return ok(result, { status: 201 });
});

export const DELETE = withErrorHandling<Ctx>(async (req, ctx) => {
  await requireAdminMutation(req);
  const { id } = await ctx.params;
  const result = await clearPages(id);
  return ok(result);
});
