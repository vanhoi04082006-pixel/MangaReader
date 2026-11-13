// POST /api/storage/cleanup — don dep file mo coi (admin only, rate-limited)
// mode = "pending": xoa cac object PENDING qua han (upload bi gian doan)
// mode = "keys": xoa danh sach object cu the (tu ket qua audit, da kiem tra tham chieu)
// mode = "failed": retry cac object DELETE_PENDING (xoa R2 that bai truoc do)
//
// TOAN VEN: chi go metadata khi R2 xac nhan object da xoa — xoa that bai
// -> giu row de retry (bao gom trong ket qua retryNeeded).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ok, parseBody, requireAdminDestructive, withErrorHandling, ApiError } from "@/lib/api";
import {
  cleanupPendingObjects,
  cleanupOrphanKeys,
  retryFailedDeletions,
} from "@/services/storage-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cleanupRequestSchema = z.object({
  mode: z.enum(["pending", "keys", "failed"]),
  keys: z.array(z.string().min(1).max(500)).max(5000).optional(),
  maxAgeHours: z.coerce.number().int().min(1).max(720).default(24),
  dryRun: z.boolean().default(true),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Cleanup xoa object R2 (pha hoi) -> xac minh session truc tiep voi Supabase.
  const user = await requireAdminDestructive(req);

  const rl = await hitRateLimit(`cleanup:${user.id}`, RATE_LIMITS.cleanup.limit, RATE_LIMITS.cleanup.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu cleanup, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const input = await parseBody(req, cleanupRequestSchema);

  if (input.mode === "pending") {
    const result = await cleanupPendingObjects({
      maxAgeHours: input.maxAgeHours,
      dryRun: input.dryRun,
    });
    return ok({ mode: "pending", dryRun: input.dryRun, ...result });
  }

  if (input.mode === "failed") {
    const result = await retryFailedDeletions({ dryRun: input.dryRun });
    return ok({ mode: "failed", dryRun: input.dryRun, ...result });
  }

  if (!input.keys || input.keys.length === 0) {
    throw new ApiError("Cần truyền danh sách keys để dọn dẹp.", 400, "missing_keys");
  }
  const result = await cleanupOrphanKeys(input.keys, input.dryRun);
  return ok({ mode: "keys", dryRun: input.dryRun, ...result });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
