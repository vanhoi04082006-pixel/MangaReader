// POST /api/mangas/:id/cover/from-page — dat anh bia tu 1 trang cua truyen
//
// GUARD (pass 4): setMangaCover thay bia cu bang object moi thi
// safe-delete object bia CU tren R2 — PHA HOI du lieu thuc cho du endpoint
// dung POST -> Strict Session Guard (xac minh session truc tiep, khong cache 90s).
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdminDestructive, parseBody, fail, withErrorHandling, ApiError } from "@/lib/api";
import { setCoverFromPageSchema } from "@/schemas";
import { supabase } from "@/lib/supabase";
import { copyObject, coverObjectKey, extFromMime } from "@/lib/r2";
import { setMangaCover } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  // setMangaCover co safe-delete object bia cu tren R2 -> PHA HOI (pass 4).
  await requireAdminDestructive(req);
  const { id: mangaId } = await ctx.params;
  const { pageId } = await parseBody(req, setCoverFromPageSchema);

  // Select "*" — lqip (migration 0003) tu co neu ton tai, khong loi neu chua migrate
  const { data: page } = await supabase
    .from("pages")
    .select("*")
    .eq("id", pageId)
    .maybeSingle();
  if (!page) return fail("Trang không thuộc truyện này.", 404, "not_found");

  // Trang phai thuoc truyen nay (pages -> chapters -> manga_id)
  const { data: chapter } = await supabase
    .from("chapters")
    .select("manga_id")
    .eq("id", page.chapter_id)
    .maybeSingle();
  if (!chapter || chapter.manga_id !== mangaId) {
    return fail("Trang không thuộc truyện này.", 404, "not_found");
  }

  const ext = extFromMime(page.mime_type) ?? "jpg";
  const newKey = coverObjectKey(mangaId, ext);
  await copyObject(page.object_key, newKey, page.mime_type);

  const { error: insertErr } = await supabase.from("storage_objects").insert({
    object_key: newKey,
    kind: "COVER",
    status: "CONFIRMED",
    confirmed_at: new Date().toISOString(),
    manga_id: mangaId,
    chapter_id: null,
    file_name: page.file_name,
    file_size: Number(page.file_size),
    mime_type: page.mime_type,
  });
  if (insertErr) throw new ApiError(`Tạo metadata ảnh bìa thất bại: ${insertErr.message}`, 500);

  // Bia ke thua placeholder LQIP cua trang goc (cung anh, cung placeholder)
  const result = await setMangaCover(mangaId, newKey, {
    lqip: page.lqip ?? null,
    color: null,
  });
  return ok(result);
});
