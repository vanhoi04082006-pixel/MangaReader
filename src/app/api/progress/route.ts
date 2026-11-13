// PUT /api/progress — luu tien do doc (upsert) + touch history
import { NextRequest, NextResponse } from "next/server";
import { ok, parseBody, requireAdminMutation, withErrorHandling } from "@/lib/api";
import { progressSchema } from "@/schemas";
import { saveProgress } from "@/services/progress-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);
  const input = await parseBody(req, progressSchema);
  const result = await saveProgress(user.id, input);
  if (!result) {
    return ok({ saved: false });
  }
  return ok({ saved: true });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;

export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await requireAdminMutation(req);
  const input = await parseBody(req, progressSchema);
  const result = await saveProgress(user.id, input);
  return ok({ saved: Boolean(result) });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
