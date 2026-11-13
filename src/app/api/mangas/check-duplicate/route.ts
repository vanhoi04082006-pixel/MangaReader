// GET /api/mangas/check-duplicate?title=...&sourceUrl=...
// Kiem tra truyen da ton tai chua TRUOC khi tao (batch import).
// So khop: ten chuan hoa (bo dau, chi chu+so) voi title / tung ten
// khac, HOAC URL nguon ("Nguon" trong info.txt) trung nhau.
import { NextRequest, NextResponse } from "next/server";
import { ok, parseQuery, requireAdmin, withErrorHandling } from "@/lib/api";
import { mangaDuplicateCheckQuerySchema } from "@/schemas";
import { findMangaDuplicates } from "@/services/manga-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireAdmin(req);
  const query = parseQuery(req, mangaDuplicateCheckQuerySchema);
  const matches = await findMangaDuplicates({
    title: query.title,
    sourceUrl: query.sourceUrl,
  });
  return ok({ matches, isDuplicate: matches.length > 0 });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
