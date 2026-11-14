// GET /api/storage/audit — quet R2 phan trang de tim file mo coi
// (client goi lap lai voi nextToken cho den khi truncated = false)
import { NextRequest, NextResponse } from "next/server";
import { ok, requireAdmin, withErrorHandling, parseQuery } from "@/lib/api";
import { z } from "zod";
import { auditStoragePage } from "@/services/storage-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const auditQuerySchema = z.object({
  continuationToken: z.string().max(1000).optional(),
  maxAgeHours: z.coerce.number().int().min(1).max(720).optional(),
});

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdmin(req);

  // Audit quet R2 — doc nhieu (30 trang request/ gio la du cho 30k object)
  const rl = await hitRateLimit(`audit:${user.id}`, RATE_LIMITS.audit.limit, RATE_LIMITS.audit.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu quét, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const { continuationToken, maxAgeHours } = parseQuery(req, auditQuerySchema);
  const result = await auditStoragePage({ continuationToken, maxAgeHours });
  return ok(result);
}) as unknown as (req: NextRequest) => Promise<NextResponse>;

