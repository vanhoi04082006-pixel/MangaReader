// POST /api/auth/login — dang nhap (Supabase Auth hoac local dev)
//
// Bao mat:
// - Rate limit theo IP + theo email (chong brute force)
// - Chi email ADMIN_EMAIL duoc phep (single-admin)
// - ADMIN_USER_ID bat buoc trong production: UUID phai khop voi user Supabase
//   (fail closed — khong co fallback email-only trong production)
// - Provider local bi tu choi trong production (fail closed)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, ok, fail, withErrorHandling, assertSameOrigin } from "@/lib/api";
import { getEnv, isAdminUser, adminIdentityConfigIssue } from "@/lib/env";
import {
  sbPasswordGrant,
  sbAdminGetUserByEmail,
  sbAdminCreateUser,
  sbRevokeSession,
} from "@/lib/supabase-auth";
import {
  setAuthCookies,
  verifyLocalCredentials,
  localJwtSign,
} from "@/lib/session";
import { SupabaseAuthError } from "@/lib/supabase-auth";
import { ensureProfile } from "@/services/profile-service";
import { hitRateLimit, clientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: NextRequest) => {
  assertSameOrigin(req);
  const { email, password } = await parseBody(
    req,
    z.object({
      email: z.string().trim().min(1, "Vui lòng nhập email").email("Email không hợp lệ"),
      password: z.string().min(1, "Vui lòng nhập mật khẩu").max(200),
    })
  );
  const env = getEnv();

  // ---- Rate limit: theo IP va theo email (chong brute force) ----
  const ip = clientIp(req);
  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(`login:ip:${ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs),
    hitRateLimit(`login:email:${email.trim().toLowerCase()}`, RATE_LIMITS.loginEmail.limit, RATE_LIMITS.loginEmail.windowMs),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const retryAfterSec = Math.ceil(Math.max(byIp.retryAfterMs, byEmail.retryAfterMs) / 1000);
    return NextResponse.json(
      { error: "Thao tác quá nhanh, vui lòng thử lại sau.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSec)) } }
    );
  }

  // ---- Provider validation (production phai Supabase, fail closed) ----
  if (env.authProvider === null) {
    // AUTH_PROVIDER=local trong production hoac gia tri khong hop le
    return fail(
      "Cấu hình xác thực không hợp lệ cho production (AUTH_PROVIDER=local bị cấm).",
      500,
      "config_invalid"
    );
  }

  // ---- Admin identity pinning: BAT BUOC trong production ----
  // ADMIN_USER_ID phai ton tai + la UUID hop le truoc khi den gan Supabase.
  // Thieu/mai -> tu choi som (fail closed), KHONG fallback email-only.
  if (env.authProvider === "supabase") {
    const issue = adminIdentityConfigIssue();
    if (issue && env.isProd) {
      return fail(
        "Cấu hình thiếu ADMIN_USER_ID (bắt buộc trong production). Chạy scripts/bootstrap-admin.ts để lấy UUID.",
        500,
        "config_invalid"
      );
    }
  }

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
  if (env.admin.email && email.trim().toLowerCase() !== env.admin.email) {
    return fail("Tài khoản này không được phép truy cập hệ thống.", 403, "forbidden_account");
  }

  // Bootstrap (lan dau): tao admin user neu chua ton tai (email_confirm = true).
  // Chi tao cho CHINH XAC email admin da cau hinh + can ADMIN_PASSWORD.
  try {
    const existing = await sbAdminGetUserByEmail(email);
    if (!existing && env.admin.password) {
      const created = await sbAdminCreateUser(email, env.admin.password);
      // Neu ADMIN_USER_ID da cau hinh ma user moi tao khac UUID -> ngay lap tuc bao loi
      // (chong chiem admin email boi nguoi khac truoc khi owner bootstrap)
      if (env.admin.userId && created.id.toLowerCase() !== env.admin.userId) {
        return fail(
          "UUID tài khoản admin vừa tạo không khớp ADMIN_USER_ID. Kiểm tra cấu hình.",
          500,
          "admin_identity_mismatch"
        );
      }
    }
  } catch (err) {
    console.error("[auth/login] bootstrap admin check failed:", err);
    // khong chan login neu admin API tam loi — van thu password grant
  }

  let session;
  try {
    session = await sbPasswordGrant(email, password);
  } catch (err) {
    // Supabase tra 400 cho sai credentials — chuan hoa thanh 401 (auth semantics)
    if (err instanceof SupabaseAuthError && err.status === 400) {
      return fail("Email hoặc mật khẩu không đúng.", 401, "invalid_credentials");
    }
    throw err;
  }
  const user = { id: session.user.id, email: session.user.email ?? email };

  // Kiem tra admin identity sau khi Supabase xac thuc thanh cong:
  // email (da xac thuc boi Supabase) + UUID (neu ADMIN_USER_ID cau hinh)
  if (!isAdminUser(user)) {
    // Session hop le nhung khong phai admin -> revoke ngay de khong de lai session lang le
    await sbRevokeSession(session.access_token).catch(() => undefined);
    return fail("Tài khoản này không được phép truy cập hệ thống.", 403, "forbidden_account");
  }

  await ensureProfile(user);

  const res = ok({ user, provider: "supabase" }) as NextResponse;
  return setAuthCookies(res, {
    accessToken: session.access_token,
    accessMaxAge: Math.max(60, session.expires_in - 60),
    refreshToken: session.refresh_token,
    refreshMaxAge: 60 * 60 * 24 * 30,
  });
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
