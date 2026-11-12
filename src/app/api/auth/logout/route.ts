// POST /api/auth/logout — xoa cookie + revoke session Supabase + xoa cache xac minh
//
// Revoke dung semantics: /auth/v1/logout can ACCESS TOKEN cua user
// (revoke ca session family kem refresh tokens). Sau do xoa cache
// xac minh token tren server de token het hieu luc ngay lap tuc.
import { NextRequest, NextResponse } from "next/server";
import { ok, withErrorHandling, assertSameOrigin } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { clearAuthCookies, ACCESS_COOKIE, REFRESH_COOKIE, LOCAL_COOKIE, invalidateSessionCache } from "@/lib/session";
import { sbRevokeSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  assertSameOrigin(req);
  const env = getEnv();

  if (env.authProvider === "supabase") {
    const accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if (accessToken) {
      // Revoke session ma access token thuoc ve (kem refresh tokens cua session do)
      const revoked = await sbRevokeSession(accessToken);
      if (!revoked) {
        // Khong chan logout — cookie van bi xoa phia client. Log de theo doi.
        console.warn("[auth/logout] Supabase revoke tra ve that bai (token co the da het han).");
      }
      // Xoa cache xac minh access token -> het hieu luc ngay tren server nay
      invalidateSessionCache(accessToken);
    } else if (refreshToken) {
      // Chi co refresh token (access da het han): revoke that bai vi thieu access token.
      // Refresh token se tu het luc sau khi Supabase tu revoke session, cookie da xoa.
      console.warn("[auth/logout] Khong co access token — khong revoke duoc session qua API.");
    }
  } else if (env.authProvider === "local") {
    const localToken = req.cookies.get(LOCAL_COOKIE)?.value;
    if (localToken) invalidateSessionCache(localToken);
  }

  const res = ok({ loggedOut: true }) as NextResponse;
  return clearAuthCookies(res);
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
