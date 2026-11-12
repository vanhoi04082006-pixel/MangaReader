// GET /api/health/ready — INTERNAL readiness check (ADMIN ONLY)
// Kiem tra chi tiet: DB, R2, cau hinh bien moi truong, storage access.
// Khong bao gio cong khai: gia tri secret, bucket khong can thiet,
// danh sach bien thieu, chi tiet exception.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { headBucket } from "@/lib/r2";
import { missingEnvVars, getEnv } from "@/lib/env";
import { requireAdmin, withErrorHandling } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: NextRequest) => {
  await requireAdmin(req);

  const env = getEnv();
  const missing = missingEnvVars();

  const checks: Record<string, unknown> = {
    database: false,
    r2: false,
    r2Bucket: env.r2.bucket, // chi admin thay — ten bucket khong phai secret
  };

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    checks.r2 = await headBucket();
  } catch {
    checks.r2 = false;
  }

  const healthy = checks.database === true && checks.r2 === true && missing.length === 0;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      provider: env.authProvider,
      checks,
      missingEnv: missing, // chi admin thay (ten bien, khong phai gia tri)
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
});
