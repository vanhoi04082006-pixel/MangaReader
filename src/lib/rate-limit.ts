// =============================================================
// Rate limiter (server) — DB-backed fixed window
//
// Hoat dong ca SQLite (dev) va PostgreSQL (production/Vercel)
// vi du lieu luu trong DB, khong phai in-memory Map (khong tin cay
// tren Vercel serverless — moi instance co bo nho rieng).
//
// That bai DB -> fail-open + log (app van can DB de lam viec chinh,
// neu DB hong thi request se fail o layer khac anyway).
// =============================================================

import { db } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  /** So request da dung trong cua so hien tai (bao gom request nay neu duoc chap nhan). */
  count: number;
  /** Thoi diem (epoch ms) cua so hien tai. */
  windowStart: number;
  /** Thoi diem (epoch ms) request co the thu lai. */
  retryAfterMs: number;
}

function windowStartFor(windowMs: number): number {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

/** Xoa cac cua so cu (chay nguoc dinh ky, best-effort). */
let lastSweep = 0;
async function sweepOldWindows(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 10 * 60 * 1000) return; // toi da 1 lan / 10 phut
  lastSweep = now;
  try {
    await db.rateLimitHit.deleteMany({
      where: { windowStart: { lt: new Date(now - 24 * 3600 * 1000) } },
    });
  } catch {
    // best-effort
  }
}

function failOpen(windowStart: number): RateLimitResult {
  return { allowed: true, count: 0, windowStart, retryAfterMs: 0 };
}

/**
 * Dem 1 request vao cua so va kiem tra gioi han.
 * @param key    phan bich theo nguoi dung/IP/endpoint, vd "login:1.2.3.4"
 * @param limit  so request toi da moi cua so
 * @param windowMs do rong cua so (ms)
 */
export async function hitRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const windowStart = windowStartFor(windowMs);
  const windowDate = new Date(windowStart);
  let count: number;

  try {
    try {
      // Upsert theo composite PK (key, windowStart) — increment neu da co
      const res = await db.rateLimitHit.upsert({
        where: { key_windowStart: { key, windowStart: windowDate } },
        update: { count: { increment: 1 } },
        create: { key, windowStart: windowDate, count: 1 },
        select: { count: true },
      });
      count = res.count;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      // Race: request khac vua tao dong -> doc lai
      const existing = await db.rateLimitHit.findUnique({
        where: { key_windowStart: { key, windowStart: windowDate } },
        select: { count: true },
      });
      count = existing?.count ?? limit + 1;
    }
  } catch (err) {
    // Loi DB (bang chua tao, mang...) — fail-open + log
    console.error("[rate-limit] DB error:", (err as { code?: string }).code ?? err);
    return failOpen(windowStart);
  }

  void sweepOldWindows().catch(() => undefined);

  return {
    allowed: count <= limit,
    count,
    windowStart,
    retryAfterMs: windowStart + windowMs - Date.now(),
  };
}

/** Lay IP client tu headers proxy (Vercel/Caddy deu dat x-forwarded-for). */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

// ---------------- Cac chinh sach cho endpoint ----------------

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 }, // 10 lan / 15 phut / IP
  loginEmail: { limit: 10, windowMs: 15 * 60 * 1000 }, // 10 lan / 15 phut / email
  refresh: { limit: 60, windowMs: 5 * 60 * 1000 }, // 60 lan / 5 phut
  presign: { limit: 1000, windowMs: 10 * 60 * 1000 }, // 1000 / 10 phut (upload hang loat)
  uploadProxy: { limit: 600, windowMs: 10 * 60 * 1000 },
  abort: { limit: 60, windowMs: 10 * 60 * 1000 },
  cleanup: { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 lan / gio (expensive)
  audit: { limit: 30, windowMs: 60 * 60 * 1000 },
  write: { limit: 300, windowMs: 10 * 60 * 1000 }, // cac mutation chung
} as const;
