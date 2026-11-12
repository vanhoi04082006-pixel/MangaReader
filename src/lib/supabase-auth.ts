// =============================================================
// Supabase Auth (REST API truc tiep - khong can supabase-js)
// Chi chay phia server.
// Docs: https://supabase.com/docs/reference/api/auth
// =============================================================

import { getEnv } from "@/lib/env";

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

function headers(publishable: boolean) {
  const env = getEnv();
  const key = publishable ? env.supabase.publishableKey : env.supabase.serviceKey;
  if (!env.supabase.url || !key) {
    throw new SupabaseAuthError("Supabase chưa được cấu hình (thiếu biến môi trường)", 500, "config_missing");
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
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

async function post<T>(path: string, body: unknown, publishable: boolean): Promise<T> {
  const env = getEnv();
  let res: Response;
  try {
    res = await fetch(`${env.supabase.url}${path}`, {
      method: "POST",
      headers: headers(publishable),
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

/** Dang nhap bang email/password -> session */
export async function sbPasswordGrant(email: string, password: string): Promise<SupabaseSession> {
  return post<SupabaseSession>("/auth/v1/token?grant_type=password", { email, password }, true);
}

/** Refresh session bang refresh token */
export async function sbRefreshGrant(refreshToken: string): Promise<SupabaseSession> {
  return post<SupabaseSession>("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken }, true);
}

/** Xac minh access token -> user, null neu het han/khong hop le */
export async function sbGetUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const env = getEnv();
  if (!env.supabase.url || !env.supabase.publishableKey) return null;
  let res: Response;
  try {
    res = await fetch(`${env.supabase.url}/auth/v1/user`, {
      headers: {
        apikey: env.supabase.publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
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

/** Lay user theo email (admin API) */
export async function sbAdminGetUserByEmail(
  email: string
): Promise<{ id: string; email?: string } | null> {
  const env = getEnv();
  let res: Response;
  try {
    res = await fetch(
      `${env.supabase.url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      { headers: headers(false), cache: "no-store" }
    );
  } catch {
    throw new SupabaseAuthError("Không kết nối được Supabase (lỗi mạng hoặc URL)", 503, "network");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw friendlyError(data, res.status);
  }
  const data = (await res.json()) as { users?: Array<{ id: string; email?: string }> };
  const found = data.users?.[0];
  return found ? { id: found.id, email: found.email } : null;
}

/** Tao user admin (dung bootstrap) — email_confirm = true */
export async function sbAdminCreateUser(
  email: string,
  password: string
): Promise<{ id: string; email?: string }> {
  const data = await post<{ id: string; email?: string }>(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    false
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
        apikey: env.supabase.publishableKey ?? "",
        Authorization: `Bearer ${accessToken}`,
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
