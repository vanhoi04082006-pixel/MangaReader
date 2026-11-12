// =============================================================
// Session & Authentication (server)
// - Supabase mode: access/refresh token trong httpOnly cookie
// - Local mode: JWT HMAC tu sign (CHI development — production fail closed)
// API routes goi requireUser()/requireAdmin() de xac thuc moi request.
//
// Cookie names (tsundoku_*) la identifier noi dai (persistent) —
// giu nguyen de khong mat session nguoi dung da dang nhap.
// =============================================================

import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { sbGetUser, SupabaseAuthError } from "@/lib/supabase-auth";

export const ACCESS_COOKIE = "tsundoku_at";
export const REFRESH_COOKIE = "tsundoku_rt";
export const LOCAL_COOKIE = "tsundoku_session";

export interface SessionUser {
  id: string;
  email: string;
}

// ---------------- Local JWT (HMAC-SHA256) ---------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function localJwtSign(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function localJwtVerify(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------- Cache xac minh token Supabase ---------------
// Giam so lan goi mang: cache 90s theo hash cua token.
// Cua so bao mat 90s la thoi diem toi da ma 1 token bi revoke
// van co the duoc chap nhan (logout se xoa cache ngay).
//
// LUU KY THUAT: cache dat tren globalThis de TAT CA route bundle chia se
// CUNG 1 instance (Turbopack dev co the tao instance rieng tung route —
// neu de trong module scope, logout xoa cache route minh nhung route khac
// van giu cache cu).
const globalForCache = globalThis as unknown as {
  __mrVerifyCache?: Map<string, { user: SessionUser; expiresAt: number }>;
};
const verifyCache: Map<string, { user: SessionUser; expiresAt: number }> =
  globalForCache.__mrVerifyCache ?? new Map();
globalForCache.__mrVerifyCache = verifyCache;
const VERIFY_TTL_MS = 90_000;
const VERIFY_CACHE_MAX = 500;

function cacheKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
}

function cachePut(token: string, user: SessionUser) {
  if (verifyCache.size >= VERIFY_CACHE_MAX) {
    // xoa ~50 entries cu nhat
    const keys = Array.from(verifyCache.keys()).slice(0, 50);
    for (const k of keys) verifyCache.delete(k);
  }
  verifyCache.set(cacheKey(token), { user, expiresAt: Date.now() + VERIFY_TTL_MS });
}

/** Xoa cache xac minh cua 1 token (goi khi logout / revoke). */
export function invalidateSessionCache(token: string): void {
  verifyCache.delete(cacheKey(token));
}

// ---------------- Session resolution --------------------------

/**
 * Lay user tu request (cookie hoac Authorization: Bearer).
 * Tra ve null neu chua dang nhap. Throw SupabaseAuthError neu Supabase loi mang.
 * LUU Y: provider = null (cau hinh local trong production) -> tra ve null (fail closed).
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const env = getEnv();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (env.authProvider === null) {
    // Cau hinh khong hop le (vd AUTH_PROVIDER=local trong production) — fail closed.
    return null;
  }

  if (env.authProvider === "supabase") {
    const token = bearer ?? req.cookies.get(ACCESS_COOKIE)?.value ?? null;
    if (!token) return null;
    const key = cacheKey(token);
    const cached = verifyCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.user;
    const user = await sbGetUser(token);
    if (!user) {
      verifyCache.delete(key);
      return null;
    }
    const sessionUser = { id: user.id, email: user.email ?? "" };
    cachePut(token, sessionUser);
    return sessionUser;
  }

  // local mode (chi development)
  const token = bearer ?? req.cookies.get(LOCAL_COOKIE)?.value ?? null;
  if (!token || !env.authSecret) return null;
  const payload = localJwtVerify(token, env.authSecret);
  if (!payload) return null;
  return {
    id: String(payload.sub ?? "local-admin"),
    email: String(payload.email ?? ""),
  };
}

// ---------------- Cookie helpers ------------------------------

export interface SessionCookieOptions {
  maxAgeSeconds: number;
}

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken?: string; accessMaxAge?: number; refreshToken?: string; refreshMaxAge?: number; localToken?: string; localMaxAge?: number }
) {
  const secure = getEnv().isProd;
  if (tokens.accessToken) {
    res.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: tokens.accessMaxAge ?? 3600,
    });
  }
  if (tokens.refreshToken) {
    res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/api/auth",
      maxAge: tokens.refreshMaxAge ?? 60 * 60 * 24 * 30,
    });
  }
  if (tokens.localToken) {
    res.cookies.set(LOCAL_COOKIE, tokens.localToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: tokens.localMaxAge ?? 60 * 60 * 24 * 7,
    });
  }
  return res;
}

export function clearAuthCookies(res: NextResponse) {
  for (const name of [ACCESS_COOKIE, LOCAL_COOKIE]) {
    res.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  res.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, path: "/api/auth", maxAge: 0 });
  return res;
}

export { localJwtSign };

// ---------------- Local login (fallback provider — dev only) --

export function verifyLocalCredentials(email: string, password: string): SessionUser | null {
  const env = getEnv();
  if (env.authProvider !== "local") return null; // chi dung khi provider = local (dev)
  if (!env.admin.email || !env.admin.password) return null;
  const emailOk = email.trim().toLowerCase() === env.admin.email.trim().toLowerCase();
  const a = Buffer.from(password, "utf8");
  const b = Buffer.from(env.admin.password, "utf8");
  const passOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!emailOk || !passOk) return null;
  return { id: "local-admin", email: env.admin.email };
}

export { SupabaseAuthError };
