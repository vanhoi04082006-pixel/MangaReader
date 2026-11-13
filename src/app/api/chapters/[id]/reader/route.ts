// GET /api/chapters/:id/reader — payload day du cho Reader
// (pages + presigned URLs co han + prev/next + progress)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, requireAdmin, withErrorHandling } from "@/lib/api";
import { getReaderPayload } from "@/services/chapter-service";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandling<Ctx>(async (req, ctx) => {
  const user = await requireAdmin(req);
  const { id } = await ctx.params;

  const { data: chapter } = await supabase
    .from("chapters")
    .select("id, manga_id")
    .eq("id", id)
    .maybeSingle();
  if (!chapter) return fail("Không tìm thấy chương.", 404, "not_found");

  const payload = await getReaderPayload(chapter.manga_id, id, user.id);
  if (!payload) return fail("Không tìm thấy chương.", 404, "not_found");

  // Ghi nhan lich su doc (mo chuong = bat dau doc)
  await supabase.from("reading_history").upsert(
    {
      user_id: user.id,
      manga_id: chapter.manga_id,
      chapter_id: id,
      page_number: payload.progress?.pageNumber ?? 1,
      read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,chapter_id" }
  );

  return ok(payload);
});
