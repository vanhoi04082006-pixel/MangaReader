// GET /api/health/ready — INTERNAL readiness check (ADMIN ONLY)
// Kiem tra chi tiet: DB, R2, cau hinh bien moi truong, storage access,
// va do nhat quan ADMIN_USER_ID <-> app_config.admin_user_id (PostgreSQL).
// Khong bao gio cong khai: gia tri secret, bucket khong can thiet,
// danh sach bien thieu, chi tiet exception.
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { headBucket } from "@/lib/r2";
import { missingEnvVars, getEnv, isValidUuid } from "@/lib/env";
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
    // "ok" = khop | "mismatch" | "missing_env" | "skipped" (SQLite dev chua co bang app_config)
    adminIdentityPinned: "skipped",
  };

  try {
    const { error } = await supabase.from("mangas").select("id").limit(1);
    checks.database = !error;
  } catch {
    checks.database = false;
  }

  try {
    checks.r2 = await headBucket();
  } catch {
    checks.r2 = false;
  }

  // ---- ADMIN_USER_ID <-> app_config.admin_user_id (chi PostgreSQL) ----
  // Trong production, UUID admin phai khop CA hai noi: bien moi truong
  // ADMIN_USER_ID va app_config.admin_user_id (seed boi migration SQL).
  // Bang app_config chi ton tai tren PostgreSQL — SQLite dev se skip.
  if (env.admin.userId && isValidUuid(env.admin.userId)) {
    try {
      const { data: rows } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "admin_user_id")
        .limit(1);
      const pinned = (rows?.[0] as any)?.value ?? null;
      checks.adminIdentityPinned =
        pinned !== null && pinned.toLowerCase() === env.admin.userId ? "ok" : "mismatch";
      if (checks.adminIdentityPinned === "mismatch") {
        missing.push("app_config.admin_user_id khong khop ADMIN_USER_ID (chay lai seed trong migration SQL)");
      }
    } catch {
      // Bang khong ton tai (SQLite dev hoac PG chua ap migration) — khong chan
      // readiness o dev; production da duoc missingEnvVars bao canh qua viec
      // migration phai chay (bang thieu -> query khac se fail o checks khac).
      checks.adminIdentityPinned = "skipped";
    }
  } else if (env.isProd) {
    checks.adminIdentityPinned = "missing_env";
  }

  const healthy =
    checks.database === true &&
    checks.r2 === true &&
    missing.length === 0 &&
    checks.adminIdentityPinned !== "mismatch" &&
    checks.adminIdentityPinned !== "missing_env";

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
