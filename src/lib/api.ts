// =============================================================
// API helpers: response chuan, error handling, auth guard,
// zod validation cho body/query, CSRF origin check
//
// requireUser()  : xac thuc session hop le (401 neu khong)
// requireAdmin() : xac thuc + phai la admin duy nhat (401/403)
// assertSameOrigin(): chong CSRF cho mutation co cookie session
// =============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { SupabaseAuthError } from "@/lib/supabase-auth";
import { isAdminUser, getEnv } from "@/lib/env";

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

/** Auth guard — throw 401/503 ApiError neu session khong hop le */
export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new ApiError("Chưa đăng nhập hoặc phiên đã hết hạn.", 401, "unauthorized");
  return user;
}

/**
 * Admin guard — ranh gioi phan quyen trung tam (server-side).
 * - 401: chua dang nhap / token het han
 * - 403: da xac thuc nhung KHONG phai admin (vd tai khoan Supabase khac)
 *
 * Moi API bao ve du lieu phai dung guard nay chu KHONG chi tin route
 * protection phia frontend. Email/UUID duoc lay tu session da xac thuc
 * voi Supabase (khong tin gia tri client gui len).
 */
export async function requireAdmin(req: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new ApiError("Chưa đăng nhập hoặc phiên đã hết hạn.", 401, "unauthorized");
  if (!isAdminUser(user)) {
    throw new ApiError("Tài khoản không có quyền thực hiện thao tác này.", 403, "forbidden");
  }
  return user;
}

// ---------------- CSRF / Origin validation ---------------------

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Chong CSRF cho cac request mutation co cookie dang nhap:
 * - Origin (hoac Referer) phai cung host voi request (hoac host do proxy forward).
 * - Sec-Fetch-Site (neu trinh duyet gui) phai la same-origin/same-site/none.
 *
 * Request xac thuc bang Bearer token khong co cookie -> khong anh huong
 * (CSRF chi tinh huong cookie tu dong gui kem cross-site).
 * Upload presigned PUT truc tiep len R2 khong di qua day (khong bi anh huong).
 */
export function assertSameOrigin(req: NextRequest): void {
  if (!MUTATION_METHODS.has(req.method.toUpperCase())) return;
  // Chi kiem tra khi request dung cookie session (CSRF vector)
  if (req.cookies.size === 0) return;

  // Fetch Metadata: neu co Sec-Fetch-Site va khong phai same-origin/same-site/none -> chan
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw new ApiError("Yêu cầu cross-site bị từ chối.", 403, "csrf");
  }

  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");

  const originHeader = req.headers.get("origin");
  const referer = req.headers.get("referer");

  const originHost = (() => {
    if (originHeader && originHeader !== "null") {
      try {
        return new URL(originHeader).host;
      } catch {
        return "__invalid__";
      }
    }
    if (referer) {
      try {
        return new URL(referer).host;
      } catch {
        return "__invalid__";
      }
    }
    return null; // khong co ca Origin lan Referer
  })();

  if (originHost === null) {
    // Trinh duyet hien dai luon gui Origin (fetch/XHR/form POST).
    // Mat ca hai header voi cookie -> bat thuong -> chan (fail closed).
    throw new ApiError("Thiếu thông tin nguồn yêu cầu (Origin/Referer).", 403, "csrf");
  }
  if (host) {
    // Host chinh la anchor tin cay (browser khong the gia mao Host header)
    if (originHost !== host) {
      throw new ApiError("Yêu cầu cross-site bị từ chối.", 403, "csrf");
    }
    return;
  }
  // Khong co Host header (hiem) — so voi NEXT_PUBLIC_APP_URL lam anchor thu hai
  try {
    const appHost = new URL(getEnv().appUrl).host;
    if (originHost !== appHost) {
      throw new ApiError("Yêu cầu cross-site bị từ chối.", 403, "csrf");
    }
  } catch {
    throw new ApiError("Yêu cầu cross-site bị từ chối.", 403, "csrf");
  }
}

/** Guard day du cho mutation admin: CSRF + admin. */
export async function requireAdminMutation(req: NextRequest): Promise<SessionUser> {
  assertSameOrigin(req);
  return requireAdmin(req);
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
