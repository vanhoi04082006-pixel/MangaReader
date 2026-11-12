// POST /api/uploads/abort — huy upload: cleanup object da PUT len R2 + row PENDING
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireUser, withErrorHandling } from "@/lib/api";
import { uploadsAbortSchema } from "@/schemas";
import { deleteObjects } from "@/lib/r2";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  await requireUser(req);
  const { objectKeys } = await parseBody(req, uploadsAbortSchema);

  let deleted = 0;
  try {
    const res = await deleteObjects(objectKeys);
    deleted = res.deleted;
  } catch (err) {
    console.error("[uploads/abort] R2 delete failed:", err);
  }
  await db.storageObject.deleteMany({ where: { objectKey: { in: objectKeys } } });

  return ok({ deleted });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
