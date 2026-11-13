// =============================================================
// Supabase Auth (REST API truc tiep - khong can supabase-js)
// Chi chay phia server.
// Docs: https://supabase.com/docs/reference/api/auth
//
// HEADER CONTRACT (xem src/lib/supabase-keys.ts):
// - Key moi (sb_publishable_/sb_secret_) KHONG phai JWT -> chi gui o "apikey";
//   KHONG bao gio gui key moi lam "Authorization: Bearer".
// - Key legacy (anon/service_role JWT) -> gui ca apikey + Bearer (semantics cu).
// - Request user: apikey = publishable + Bearer = access token JWT THAT cua user.
// =============================================================

import { getEnv } from "@/lib/env";
import {
  supabaseAnonHeaders,
  supabaseServiceHeaders,
  supabaseUserHeaders,
} from "@/lib/supabase-keys";

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: { id: string; email?: string };
}

export class SupabaseAuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Headers cho request anon (login/refresh) — publishable key theo format phat hien. */
function anonHeaders() {
  const env = getEnv();
  if (!env.supabase.url || !env.supabase.publishableKey) {
    throw new SupabaseAuthError("Supabase chưa được cấu hình (thiếu biến môi trường)", 500, "config_missing");
  }
  return {
    ...supabaseAnonHeaders(env.supabase.publishableKey),
    "Content-Type": "application/json",
  };
}

/** Headers cho request privileged (admin API) — secret key theo format phat hien. */
function serviceHeaders() {
  const env = getEnv();
  if (!env.supabase.url || !env.supabase.serviceKey) {
    throw new SupabaseAuthError("Supabase chưa được cấu hình (thiếu biến môi trường)", 500, "config_missing");
  }
  return {
    ...supabaseServiceHeaders(env.supabase.serviceKey),
    "Content-Type": "application/json",
  };
}

/** Chuyen error cua Supabase sang thong ban tieng Viet than thien */
function friendlyError(body: Record<string, unknown>, status: number): SupabaseAuthError {
  const raw =
    (typeof body.error === "string" ? body.error : undefined) ??
    (typeof body.msg === "string" ? body.msg : undefined) ??
    "Xác thực thất bại";
  const desc =
    typeof body.error_description === "string" ? body.error_description : undefined;
  const code = typeof body.code === "string" ? body.code : undefined;

  let message = raw;
  if (raw === "Invalid login credentials") message = "Email hoặc mật khẩu không đúng.";
  else if (raw === "Email not confirmed") message = "Email chưa được xác nhận.";
  else if (code === "over_email_send_rate_limit" || raw === "Over email send rate limit")
    message = "Thao tác quá nhanh, vui lòng thử lại sau.";
  else if (status >= 500) message = "Supabase Auth đang không phản hồi, vui lòng thử lại sau.";
  if (desc && message === raw) message = `${raw}: ${desc}`;
  return new SupabaseAuthError(message, status, code);
}

async function post<T>(path: string, body: unknown, privileged: boolean): Promise<T> {
  const env = getEnv();
  let res: Response;
  try {
    res = await fetch(`${env.supabase.url}${path}`, {
      method: "POST",
      headers: privileged ? serviceHeaders() : anonHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new SupabaseAuthError("Không kết nối được Supabase (lỗi mạng hoặc URL)", 503, "network");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw friendlyError(data, res.status);
  return data as T;
}

/** Dang nhap bang email/password -> session (request anon — publishable key) */
export async function sbPasswordGrant(email: string, password: string): Promise<SupabaseSession> {
  return post<SupabaseSession>("/auth/v1/token?grant_type=password", { email, password }, false);
}

/** Refresh session bang refresh token (request anon — publishable key) */
export async function sbRefreshGrant(refreshToken: string): Promise<SupabaseSession> {
  return post<SupabaseSession>("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken }, false);
}

/** Xac minh access token -> user, null neu het han/khong hop le */
export async function sbGetUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const env = getEnv();
  if (!env.supabase.url || !env.supabase.publishableKey) return null;
  let res: Response;
  try {
    res = await fetch(`${env.supabase.url}/auth/v1/user`, {
      // apikey = publishable key + Bearer = access token THAT cua user
      headers: supabaseUserHeaders(env.supabase.publishableKey, accessToken),
      cache: "no-store",
    });
  } catch {
    throw new SupabaseAuthError("Không kết nối được Supabase (lỗi mạng hoặc URL)", 503, "network");
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw friendlyError(data, res.status);
  }
  const user = (await res.json()) as { id: string; email?: string };
  return { id: user.id, email: user.email };
}

/** Lay user theo email (admin API) — phan trang va doi chieu email chinh xac */
export async function sbAdminGetUserByEmail(
  email: string
): Promise<{ id: string; email?: string } | null> {
  const env = getEnv();
  const targetEmail = email.trim().toLowerCase();
  const perPage = 100;
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page++) {
    let res: Response;

    try {
      const url = new URL(
        `${env.supabase.url}/auth/v1/admin/users`
      );
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(perPage));

      res = await fetch(url.toString(), {
        headers: serviceHeaders(),
        cache: "no-store",
      });
    } catch {
      throw new SupabaseAuthError(
        "Không kết nối được Supabase (lỗi mạng hoặc URL)",
        503,
        "network"
      );
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw friendlyError(data, res.status);
    }

    const data = (await res.json()) as {
      users?: Array<{ id: string; email?: string }>;
    };

    const users = data.users;

    if (!Array.isArray(users)) {
      throw new SupabaseAuthError(
        "Supabase Admin API trả về dữ liệu user không hợp lệ",
        502,
        "invalid_response"
      );
    }

    const found = users.find(
      (user) =>
        typeof user.email === "string" &&
        user.email.trim().toLowerCase() === targetEmail
    );

    if (found) {
      return { id: found.id, email: found.email };
    }

    if (users.length < perPage) {
      return null;
    }
  }

  throw new SupabaseAuthError(
    "Đã vượt giới hạn phân trang khi tìm tài khoản Admin",
    500,
    "pagination_limit"
  );
}

/** Tao user admin (dung bootstrap) — email_confirm = true (admin API — secret key) */
export async function sbAdminCreateUser(
  email: string,
  password: string
): Promise<{ id: string; email?: string }> {
  const data = await post<{ id: string; email?: string }>(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    true
  );
  return { id: data.id, email: data.email };
}

/**
 * Trang thai revoke session — phan biet ro ket qua that de logout ghi nhan
 * TRUNG THUC (khong bao cao "da revoke" khi Supabase tu choi/khong lien lac duoc).
 *
 * - "revoked"    : Supabase xac nhan revoke (204).
 * - "rejected"   : 401/403 — access token bi tu choi (het han/da revoke/sai).
 *                  LUU Y: session family co the VAN CON SONG qua refresh token
 *                  -> nguoi goi phai thu refresh-then-revoke khi con refresh token.
 * - "unreachable": loi mang — khong the xac nhan trang thai that.
 * - "error"      : Supabase tra loi khac (5xx...) — khong xac nhan duoc.
 */
export type RevokeStatus = "revoked" | "rejected" | "unreachable" | "error";

/**
 * Revoke session (logout) — POST /auth/v1/logout.
 *
 * Semantics Supabase Auth: endpoint nay revoke SESSION ma ACCESS TOKEN
 * truyen o header Authorization thuoc ve (kem moi refresh token sinh tu
 * session do). Truoc day code truyen publishable key lam Bearer -> Supabase
 * khong revoke dung session (loi 401 im lang). Phai dung access token cua user.
 */
export async function sbRevokeSessionStatus(accessToken: string): Promise<RevokeStatus> {
  try {
    const env = getEnv();
    if (!env.supabase.url) return "error";
    const res = await fetch(`${env.supabase.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        ...supabaseUserHeaders(env.supabase.publishableKey ?? "", accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      cache: "no-store",
    });
    if (res.status === 204 || res.ok) return "revoked";
    if (res.status === 401 || res.status === 403) return "rejected";
    console.error("[supabase-auth] logout revoke failed:", res.status, await res.text().catch(() => ""));
    return "error";
  } catch (err) {
    console.error("[supabase-auth] logout revoke network error:", err);
    return "unreachable";
  }
}

/** Wrapper tien ich (best-effort) — dung cho cac noi chi can thu revoke co hoi. */
export async function sbRevokeSession(accessToken: string): Promise<boolean> {
  return (await sbRevokeSessionStatus(accessToken)) === "revoked";
}
