// DELETE /api/chapters/:id/pages/:pageId — xoa 1 trang (R2 + DB)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdminDestructive, fail, withErrorHandling } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { deletePage } from "@/services/chapter-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; pageId: string }> };

export const DELETE = withErrorHandling<Ctx>(async (req, ctx) => {
  // Thao tac pha hoi (R2 + DB) -> xac minh session truc tiep voi Supabase.
  await requireAdminDestructive(req);
  const { id, pageId } = await ctx.params;

  const { data: page } = await supabase
    .from("pages")
    .select("id, chapter_id")
    .eq("id", pageId)
    .maybeSingle();
  if (!page || page.chapter_id !== id) {
    return fail("Trang không thuộc chương này.", 404, "not_found");
  }

  const result = await deletePage(pageId);
  return ok(result);
});
