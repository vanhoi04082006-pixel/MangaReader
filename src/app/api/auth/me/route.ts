// GET /api/auth/me — thong tin user hien tai (identity endpoint)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireUser, withErrorHandling } from "@/lib/api";
import { getEnv, isAdminUser } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireUser(req);
  const env = getEnv();
  return ok({
    user,
    provider: env.authProvider,
    isAdmin: isAdminUser(user),
    quotaBytes: env.storageQuotaBytes,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
