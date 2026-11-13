// GET /api/storage/audit — quet R2 phan trang de tim file mo coi
// (client goi lap lai voi nextToken cho den khi truncated = false)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdmin, withErrorHandling } from "@/lib/api";
import { auditStoragePage } from "@/services/storage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const continuationToken = url.searchParams.get("continuationToken") ?? undefined;
  const maxAgeHours = Math.max(1, parseInt(url.searchParams.get("maxAgeHours") ?? "24", 10) || 24);

  const result = await auditStoragePage({ continuationToken, maxAgeHours });
  return ok(result);
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
