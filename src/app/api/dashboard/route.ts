// GET /api/dashboard — tong quan (so lieu thuc te tu DB)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireUser, withErrorHandling } from "@/lib/api";
import { getDashboard } from "@/services/dashboard-service";
import { attachCoverUrls } from "@/lib/cover-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireUser(req);
  const dashboard = await getDashboard(user.id);
  const [continueReading, recentlyAdded] = await Promise.all([
    attachCoverUrls(dashboard.continueReading),
    attachCoverUrls(dashboard.recentlyAdded),
  ]);
  return ok({ ...dashboard, continueReading, recentlyAdded });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
