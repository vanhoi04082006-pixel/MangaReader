// POST /api/auth/logout — xoa cookie + revoke refresh token
import { NextRequest, NextResponse } from "next/server";
import { ok, withErrorHandling } from "@/lib/api";
import { clearAuthCookies, REFRESH_COOKIE } from "@/lib/session";
import { sbRevokeToken } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await sbRevokeToken(refreshToken);
  }
  const res = ok({ loggedOut: true }) as NextResponse;
  return clearAuthCookies(res);
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
