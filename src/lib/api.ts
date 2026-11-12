// =============================================================
// API helpers: response chuan, error handling, auth guard,
// zod validation cho body/query
// =============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { SupabaseAuthError } from "@/lib/supabase-auth";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Auth guard — throw 401/503 ApiError neu khong hop le */
export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new ApiError("Chưa đăng nhập hoặc phiên đã hết hạn.", 401, "unauthorized");
  return user;
}

/** Parse JSON body theo zod schema — throw ApiError 400 co thong bao ro rang */
export async function parseBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("Dữ liệu gửi lên không phải JSON hợp lệ.", 400, "invalid_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".");
    throw new ApiError(
      `${path ? `[${path}] ` : ""}${first?.message ?? "Dữ liệu không hợp lệ"}`,
      400,
      "validation_error"
    );
  }
  return result.data;
}

export function parseQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(
      `${first?.path?.join(".") ? `[${first.path.join(".")}] ` : ""}${first?.message ?? "Tham số không hợp lệ"}`,
      400,
      "validation_error"
    );
  }
  return result.data;
}

/** Wrapper cho route handler: chuyen exception thanh phan hoi API chuan */
export function handleError(err: unknown): NextResponse {
  if (err instanceof ApiError) return fail(err.message, err.status, err.code);
  if (err instanceof SupabaseAuthError) return fail(err.message, err.status, err.code);
  if (err instanceof z.ZodError) {
    return fail(err.issues[0]?.message ?? "Dữ liệu không hợp lệ", 400, "validation_error");
  }
  // Prisma known errors
  const e = err as { code?: string; message?: string; meta?: { target?: string[] } };
  if (e?.code === "P2002") {
    return fail(`Giá trị bị trùng: ${e.meta?.target?.join(", ") ?? "ràng buộc unique"}`, 409, "conflict");
  }
  if (e?.code === "P2025") {
    return fail("Không tìm thấy bản ghi.", 404, "not_found");
  }
  if (e?.code === "P2003") {
    return fail("Dữ liệu liên quan không tồn tại (khóa ngoại).", 400, "fk_violation");
  }
  console.error("[api] Unhandled error:", err);
  return fail("Lỗi hệ thống, vui lòng thử lại.", 500, "internal");
}

/** Tien ich tao route handler co error handling tich hop */
export function withErrorHandling<Ctx>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return handleError(err);
    }
  };
}
