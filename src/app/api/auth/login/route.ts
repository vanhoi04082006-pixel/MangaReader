// POST /api/auth/login — dang nhap (Supabase Auth hoac local)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, ok, fail, withErrorHandling } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  sbPasswordGrant,
  sbAdminGetUserByEmail,
  sbAdminCreateUser,
} from "@/lib/supabase-auth";
import {
  setAuthCookies,
  verifyLocalCredentials,
  localJwtSign,
} from "@/lib/session";
import { ensureProfile } from "@/services/profile-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  const { email, password } = await parseBody(
    req,
    z.object({
      email: z.string().trim().min(1, "Vui lòng nhập email").email("Email không hợp lệ"),
      password: z.string().min(1, "Vui lòng nhập mật khẩu").max(200),
    })
  );
  const env = getEnv();

  if (env.authProvider === "local") {
    const user = verifyLocalCredentials(email, password);
    if (!user) {
      return fail("Email hoặc mật khẩu không đúng.", 401, "invalid_credentials");
    }
    if (!env.authSecret) {
      return fail("AUTH_SECRET chưa được cấu hình.", 500, "config");
    }
    await ensureProfile(user);
    const token = localJwtSign({ sub: user.id, email: user.email }, env.authSecret, 7 * 24 * 3600);
    const res = ok({ user, provider: "local" });
    return setAuthCookies(res, { localToken: token, localMaxAge: 7 * 24 * 3600 });
  }

  // ---- Supabase mode ----
  // Chi cho phep duy nhat tai khoan admin (website ca nhan, khong co dang ky)
  if (env.admin.email && email.trim().toLowerCase() !== env.admin.email.trim().toLowerCase()) {
    return fail("Tài khoản này không được phép truy cập hệ thống.", 403, "forbidden_account");
  }

  // Bootstrap: tao admin user neu chua ton tai (email_confirm = true)
  try {
    const existing = await sbAdminGetUserByEmail(email);
    if (!existing && env.admin.password) {
      await sbAdminCreateUser(email, env.admin.password);
    }
  } catch (err) {
    console.error("[auth/login] bootstrap admin check failed:", err);
    // khong chan login neu admin API tam loi — van thu password grant
  }

  const session = await sbPasswordGrant(email, password);
  const user = { id: session.user.id, email: session.user.email ?? email };
  await ensureProfile(user);

  const res = ok({ user, provider: "supabase" }) as NextResponse;
  return setAuthCookies(res, {
    accessToken: session.access_token,
    accessMaxAge: Math.max(60, session.expires_in - 60),
    refreshToken: session.refresh_token,
    refreshMaxAge: 60 * 60 * 24 * 30,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
