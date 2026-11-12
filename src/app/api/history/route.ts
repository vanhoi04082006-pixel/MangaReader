// GET /api/history — lich su doc (phan trang)
// DELETE /api/history?mangaId=... — xoa lich su 1 truyen
// DELETE /api/history — xoa toan bo lich su
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdmin, requireAdminMutation, withErrorHandling } from "@/lib/api";
import { historyQuerySchema } from "@/schemas";
import { listHistory, deleteHistoryForManga, clearHistory } from "@/services/progress-service";
import { attachCoverUrls } from "@/lib/cover-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdmin(req);
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20));
  const result = await listHistory(user.id, page, pageSize);
  const items = await attachCoverUrls(result.items);
  return ok({ ...result, items });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);
  const mangaId = new URL(req.url).searchParams.get("mangaId");
  if (mangaId) {
    await deleteHistoryForManga(user.id, mangaId);
    return ok({ cleared: "manga", mangaId });
  }
  await clearHistory(user.id);
  return ok({ cleared: "all" });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
