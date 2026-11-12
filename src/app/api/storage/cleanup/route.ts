// POST /api/storage/cleanup — don dep file mo coi
// mode = "pending": xoa cac object PENDING qua han (upload bi gian doan)
// mode = "keys": xoa danh sach object cu the (tu ket qua audit, da kiem tra tham chieu)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ok, parseBody, requireUser, withErrorHandling, ApiError } from "@/lib/api";
import { cleanupPendingObjects, cleanupOrphanKeys } from "@/services/storage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cleanupRequestSchema = z.object({
  mode: z.enum(["pending", "keys"]),
  keys: z.array(z.string().min(1).max(500)).max(5000).optional(),
  maxAgeHours: z.coerce.number().int().min(1).max(720).default(24),
  dryRun: z.boolean().default(true),
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);
  const input = await parseBody(req, cleanupRequestSchema);

  if (input.mode === "pending") {
    const result = await cleanupPendingObjects({
      maxAgeHours: input.maxAgeHours,
      dryRun: input.dryRun,
    });
    return ok({ mode: "pending", dryRun: input.dryRun, ...result });
  }

  if (!input.keys || input.keys.length === 0) {
    throw new ApiError("Cần truyền danh sách keys để dọn dẹp.", 400, "missing_keys");
  }
  const result = await cleanupOrphanKeys(input.keys, input.dryRun);
  return ok({ mode: "keys", dryRun: input.dryRun, ...result });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
