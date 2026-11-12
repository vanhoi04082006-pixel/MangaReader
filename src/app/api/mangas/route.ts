// GET /api/mangas — danh sach thu vien (tim kiem/loc/sap xep/phan trang)
// POST /api/mangas — tao truyen moi
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, parseQuery, requireUser, withErrorHandling } from "@/lib/api";
import { attachCoverUrls } from "@/lib/cover-url";
import { mangaListQuerySchema, mangaCreateSchema } from "@/schemas";
import { listMangas, createManga } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireUser(req);
  const query = parseQuery(req, mangaListQuerySchema);
  const result = await listMangas({
    userId: user.id,
    search: query.search,
    genre: query.genre,
    status: query.status,
    sort: query.sort,
    order: query.order,
    favorites: query.favorites,
    page: query.page,
    pageSize: query.pageSize,
  });
  const items = await attachCoverUrls(result.items);
  return ok({ ...result, items });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);
  const input = await parseBody(req, mangaCreateSchema);
  const manga = await createManga(input);
  return ok({ id: manga.id, title: manga.title }, { status: 201 });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
