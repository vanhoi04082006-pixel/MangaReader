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
import { getEnv, type AuthProvider } from "@/lib/env";
import { sbGetUser, SupabaseAuthError } from "@/lib/supabase-auth";
import { verifyActiveSession } from "@/lib/session-verify";

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
//
// GIOI HAN (ghi chan than): cache chi ton tai tren runtime instance HIEN TAI
// (globalThis). Logout xoa cache cua instance xu ly logout — KHONG xoa duoc
// cache cua cac instance Vercel khac. Nghia la: access token da revoke nhung
// con han co the duoc chap nhan toi da 90s tren instance khac cho cac route
// dung cache nay. Cac thao tac PHA HOAI phai dung getSessionUserStrict
// (khong cache + kiem tra auth.sessions uy quyen) — xem comment o duoi.
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

function extractToken(req: NextRequest, provider: AuthProvider | null): string | null {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (provider === "supabase") {
    return bearer ?? req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  }
  return bearer ?? req.cookies.get(LOCAL_COOKIE)?.value ?? null;
}

/**
 * Lay user tu request (cookie hoac Authorization: Bearer).
 * Tra ve null neu chua dang nhap. Throw SupabaseAuthError neu Supabase loi mang.
 * LUU Y: provider = null (cau hinh local trong production) -> tra ve null (fail closed).
 *
 * Cache 90s de giam so lan goi mang (chiem hanh vi doc thuong). Cac thao tac
 * PHA HOAI (xoa truyen/chapter/trang, cleanup storage) phai dung bien the
 * strict (getSessionUserStrict) de kiem tra truc tiep voi Supabase — xem
 * comment phia duoi ve cua so hieu luc.
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const env = getEnv();

  if (env.authProvider === null) {
    // Cau hinh khong hop le (vd AUTH_PROVIDER=local trong production) — fail closed.
    return null;
  }

  const token = extractToken(req, env.authProvider);
  if (!token) return null;

  if (env.authProvider === "supabase") {
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
  if (!env.authSecret) return null;
  const payload = localJwtVerify(token, env.authSecret);
  if (!payload) return null;
  return {
    id: String(payload.sub ?? "local-admin"),
    email: String(payload.email ?? ""),
  };
}

/**
 * Xac minh session KHONG qua cache — danh cho thao tac PHA HOAI (xoa truyen/
 * chapter/trang, cleanup storage) va cac thao tac nhay cam tuong duong.
 *
 * HAI LOP xac minh (defense-in-depth):
 * 1. GET /auth/v1/user voi access token (danh tinh + het han). Tren du an
 *    nay GoTrue con kiem tra claim session_id -> replay sau logout bi
 *    403 session_not_found (chung minh bang thu nghiem thuc). NHUNG theo
 *    tai lieu Supabase, access-token JWT co the con hieu luc den khi het
 *    han sau sign-out tren mot so phien ban/cau hinh — KHONG gia dinh cho
 *    moi deployment.
 * 2. Kiem tra UY QUYEN: doc bang auth.sessions (qua Prisma postgres role,
 *    tham so hoa, KHONG qua PostgREST cong khai) — session_id phai con
 *    ton tai + thuoc dung user + chua het han tuyet doi (xem
 *    src/lib/session-verify.ts). Ket qua "unavailable" -> TU CHOI (fail
 *    closed). Dev tren SQLite khong co schema auth -> bo lop 2 (da ghi chu).
 *
 * VE CACHE PHIEN BAN: cache 90s (globalThis) chi ton tai tren 1 runtime
 * instance — logout XOA cache cua instance xu ly no, KHONG xoa duoc cache
 * cua cac instance Vercel khac. Bien the strict KHONG doc cache, dong thoi
 * 2 lop xac minh tren deu goi Supabase/DB truc tiep -> phat hien revoke
 * ngay tren BAT KY instance nao, khong phu thuoc cache.
 *
 * CUA SO CON LAI (da ghi chan than trong bao cao): voi cac route KHONG dung
 * bien the strict (doc thuong, mutation thong thuong — cache 90s), access
 * token da revoke nhung con han co the duoc chap nhan toi da 90s tren cac
 * instance khac. Day la compromise thiet ke (JWT stateless + hieu nang);
 * ranh gioi that do auth.sessions cua Supabase quan ly.
 */
export async function getSessionUserStrict(req: NextRequest): Promise<SessionUser | null> {
  const env = getEnv();

  if (env.authProvider === null) return null; // fail closed

  const token = extractToken(req, env.authProvider);
  if (!token) return null;

  if (env.authProvider === "supabase") {
    const user = await sbGetUser(token); // KHONG doc/ghi cache
    if (!user) return null;
    // Lop 2: kiem tra session con song trong auth.sessions (uy quyen).
    // "inactive" = da logout; "unavailable" = khong xac minh duoc -> fail closed.
    const liveness = await verifyActiveSession(token, user.id);
    if (liveness !== "active") {
      if (liveness === "unavailable") {
        console.error(
          "[session] STRICT verification UNAVAILABLE (auth.sessions khong doc duoc / thieu claim session_id) — tu choi thao tac (fail closed)."
        );
      }
      return null;
    }
    return { id: user.id, email: user.email ?? "" };
  }

  // local mode (chi development) — JWT verify local, khong co cache
  if (!env.authSecret) return null;
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
