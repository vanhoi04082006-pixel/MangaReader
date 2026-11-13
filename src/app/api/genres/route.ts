// GET /api/genres — danh sach the loai (seed mac dinh lan dau)
// POST /api/genres — tao the loai moi
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireAdmin, requireAdminMutation, withErrorHandling } from "@/lib/api";
import { genreCreateSchema } from "@/schemas";
import { listGenres, seedDefaultGenres, ensureGenres } from "@/services/genre-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireAdmin(req);
  await seedDefaultGenres();
  const genres = await listGenres();
  return ok({ genres });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireAdminMutation(req);
  const { name } = await parseBody(req, genreCreateSchema);
  await ensureGenres([name]);
  const genres = await listGenres();
  return ok({ genres }, { status: 201 });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
