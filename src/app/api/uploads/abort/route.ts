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

  // ---- Claim atomically (TOCTOU-safe) ----
  // Danh dau PENDING -> DELETE_PENDING TRUOC khi cham R2, de concurrent
  // finalize (B3) phat hien va tu choi; tranh race abort xoa object vua
  // duoc finalize CONFIRMED. updateMany la atomic o DB level — chi mot
  // request claim duoc moi row.
  await db.storageObject.updateMany({
    where: { objectKey: { in: objectKeys }, status: "PENDING" },
    data: { status: "DELETE_PENDING" },
  });

  // Chi target object vua claim (DELETE_PENDING) — khong abort object
  // da CONFIRMED (du lieu thuc) hoac khong ton tai.
  const claimedRows = await db.storageObject.findMany({
    where: { objectKey: { in: objectKeys }, status: "DELETE_PENDING" },
    select: { objectKey: true },
  });
  const pendingKeys = claimedRows.map((r) => r.objectKey);
  const skipped = objectKeys.filter((k) => !pendingKeys.includes(k));

  if (pendingKeys.length === 0) {
    return ok({ deleted: 0, skipped });
  }

  // Safe delete: chi xoa row khi R2 xac nhan object da xoa / khong ton tai
  const result = await safeDeleteObjects(pendingKeys);
  if (result.removed.length > 0) {
    await db.storageObject.deleteMany({
      where: { objectKey: { in: result.removed }, status: "DELETE_PENDING" },
    });
  }
  // Object xoa that bai giu trang thai DELETE_PENDING de cleanup retry.

  return ok({
    deleted: result.removed.length,
    pendingRetry: result.pending.length,
    skipped,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
