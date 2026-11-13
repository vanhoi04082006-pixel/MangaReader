// POST /api/auth/refresh — lam moi session (Supabase refresh token)
// Rate limit theo IP de chong hammer endpoint nay.
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, withErrorHandling, assertSameOrigin } from "@/lib/api";
import { getEnv, isAdminUser } from "@/lib/env";
import { sbRefreshGrant, sbRevokeSession } from "@/lib/supabase-auth";
import { REFRESH_COOKIE, setAuthCookies, getSessionUser, invalidateSessionCache, ACCESS_COOKIE } from "@/lib/session";
import { hitRateLimit, clientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  // CSRF: refresh la mutation co cookie -> kiem tra origin (lead 4.1)
  assertSameOrigin(req);

  const env = getEnv();

  // Rate limit refresh (chong hammer)
  const rl = await hitRateLimit(
    `refresh:${clientIp(req)}`,
    RATE_LIMITS.refresh.limit,
    RATE_LIMITS.refresh.windowMs
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Thao tác quá nhanh, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  if (env.authProvider === null) {
    return fail("Cấu hình xác thực không hợp lệ cho production.", 500, "config_invalid");
  }

  if (env.authProvider === "local") {
    const user = await getSessionUser(req);
    if (!user) return fail("Phiên đã hết hạn.", 401, "unauthorized");
    return ok({ refreshed: true });
  }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return fail("Không có refresh token.", 401, "no_refresh_token");
  }

  const session = await sbRefreshGrant(refreshToken);
  const user = { id: session.user.id, email: session.user.email ?? "" };

  // Session moi van phai la admin (chong truong hop admin bi thay doi cau hinh)
  if (!isAdminUser(user)) {
    // Refresh token cua tai khoan khac -> revoke session vua cap
    await sbRevokeSession(session.access_token).catch(() => undefined);
    return fail("Tài khoản này không được phép truy cập hệ thống.", 403, "forbidden_account");
  }

  // Xoa cache cua access token cu (neu co) de khong ton 2 entry
  const oldAccess = req.cookies.get(ACCESS_COOKIE)?.value;
  if (oldAccess && oldAccess !== session.access_token) {
    invalidateSessionCache(oldAccess);
  }

  const res = ok({
    refreshed: true,
    user: { id: session.user.id, email: session.user.email },
  }) as NextResponse;
  return setAuthCookies(res, {
    accessToken: session.access_token,
    accessMaxAge: Math.max(60, session.expires_in - 60),
    refreshToken: session.refresh_token,
    refreshMaxAge: 60 * 60 * 24 * 30,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
