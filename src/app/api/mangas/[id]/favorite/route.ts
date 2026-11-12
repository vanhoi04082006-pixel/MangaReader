// POST /api/mangas/:id/favorite — bat/tat yeu thich
import { NextRequest, NextResponse } from "next/server";
import { ok, requireUser, withErrorHandling } from "@/lib/api";
import { toggleFavorite } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandling<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const result = await toggleFavorite(user.id, id);
  return ok(result);
});
