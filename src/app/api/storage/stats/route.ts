// GET /api/storage/stats — thong ke dung luong chi tiet
import { NextRequest, NextResponse } from "next/server";
import { ok, requireUser, withErrorHandling } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getStorageStats } from "@/services/storage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);
  const stats = await getStorageStats();
  return ok({ ...stats, quotaBytes: getEnv().storageQuotaBytes });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
