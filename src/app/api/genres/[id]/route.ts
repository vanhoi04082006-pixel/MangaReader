// DELETE /api/genres/[id] — xoa the loai (admin, chi khi khong manga dung)
//
// An toan du lieu:
// - Chi cho phep xoa khi KHONG manga nao dung the loai (manga_genres = 0)
//   -> neu dang dung: 409 kem so manga de UI canh bao ro rang.
// - The loai mac dinh (trong DEFAULT_GENRES) co the xoa: admin muon rut gon
//   danh muc 223 muc; seed chi chay lan dau nen khong tao lai.
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, requireAdminMutation, withErrorHandling, ApiError } from "@/lib/api";
import { z } from "zod";
import { deleteGenreIfUnused } from "@/services/genre-service";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid("ID thể loại không hợp lệ") });

export const DELETE = withErrorHandling(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireAdminMutation(req);

  const rl = await hitRateLimit(`genre-delete:${user.id}`, RATE_LIMITS.write.limit, RATE_LIMITS.write.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Quá nhiều yêu cầu, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const { id } = paramsSchema.parse(await ctx.params);

  const result = await deleteGenreIfUnused(id);
  if (!result.deleted) {
    if (result.inUse > 0) {
      return fail(
        `Thể loại đang được ${result.inUse} truyện sử dụng — không thể xóa.`,
        409,
        "genre_in_use"
      );
    }
    throw new ApiError("Không tìm thấy thể loại.", 404, "not_found");
  }
  return ok({ deleted: true, id });
}) as unknown as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<NextResponse>;
