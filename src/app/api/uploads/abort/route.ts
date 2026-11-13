// POST /api/uploads/abort — huy upload: cleanup object da PUT len R2 + row PENDING
//
// TOAN VEN DU LIEU (da chinh sua): row StorageObject chi duoc xoa khi
// object tren R2 da duoc xac nhan XOA (hoac xac nhan khong ton tai).
// Neu R2 delete that bai -> GIU row (trang thai PENDING) de retry sau —
// khong bao gio mat tham chieu den object that.
//
// Bao mat: chi cho phep abort object dang PENDING (khong cho abort
// object da CONFIRMED — do la du lieu thuc).
//
// GUARD (pass 4): abort thuc hien xoa object TREN R2 (safe-delete) —
// tuy chi ap dung cho object PENDING (chua finalize), day van la thao tac
// XOA tren R2 -> Strict Session Guard (xac minh session truc tiep,
// khong qua cache 90s) de dong nhat voi moi route co xoa R2.
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireAdminDestructive, withErrorHandling } from "@/lib/api";
import { uploadsAbortSchema } from "@/schemas";
import { db } from "@/lib/db";
import { safeDeleteObjects } from "@/services/storage-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Xoa object tren R2 (safe-delete) -> Strict Session Guard (pass 4).
  const user = await requireAdminDestructive(req);

  const rl = await hitRateLimit(`abort:${user.id}`, RATE_LIMITS.abort.limit, RATE_LIMITS.abort.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const { objectKeys } = await parseBody(req, uploadsAbortSchema);

  // Chi target object dang PENDING — khong abort object da CONFIRMED (du lieu thuc)
  const rows = await db.storageObject.findMany({
    where: { objectKey: { in: objectKeys }, status: "PENDING" },
    select: { objectKey: true },
  });
  const pendingKeys = rows.map((r) => r.objectKey);
  const skipped = objectKeys.filter((k) => !pendingKeys.includes(k));

  if (pendingKeys.length === 0) {
    return ok({ deleted: 0, skipped });
  }

  // Safe delete: chi xoa row khi R2 xac nhan object da xoa / khong ton tai
  const result = await safeDeleteObjects(pendingKeys);
  if (result.removed.length > 0) {
    await db.storageObject.deleteMany({
      where: { objectKey: { in: result.removed } },
    });
  }

  return ok({
    deleted: result.removed.length,
    // Giu nguyen row cho object xoa that bai — cleanup route se retry
    pendingRetry: result.pending.length,
    skipped,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
