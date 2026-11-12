// GET /api/health — trang thai he thong (DB, R2, cau hinh)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { headBucket } from "@/lib/r2";
import { missingEnvVars, getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  const missing = missingEnvVars();

  const checks: Record<string, unknown> = {
    database: false,
    r2: false,
    r2Bucket: env.r2.bucket,
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
      missingEnv: missing,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
