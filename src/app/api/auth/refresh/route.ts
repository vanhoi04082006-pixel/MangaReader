// POST /api/auth/refresh — lam moi session (Supabase refresh token)
import { NextRequest, NextResponse } from "next/server";
import { ok, fail, withErrorHandling } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { sbRefreshGrant } from "@/lib/supabase-auth";
import { REFRESH_COOKIE, setAuthCookies, getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const env = getEnv();

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
