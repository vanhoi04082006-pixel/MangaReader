// =============================================================
// Rate limiter (server) — DB-backed fixed window (Supabase REST)
//
// Dung Supabase PostgREST (HTTP) thay vi Prisma TCP, de tuong thich
// voi Vercel serverless (chi cho phep outbound HTTP).
// =============================================================

import { supabase } from "@/lib/supabase";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  windowStart: number;
  retryAfterMs: number;
}

function windowStartFor(windowMs: number): number {
  return Math.floor(Date.now() / windowMs) * windowMs;
}

let lastSweep = 0;
async function sweepOldWindows(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now;
  try {
    await supabase
      .from("rate_limit_hits")
      .delete()
      .lt("window_start", new Date(now - 24 * 3600 * 1000).toISOString());
  } catch {
    // best-effort
  }
}

function failOpen(windowStart: number): RateLimitResult {
  return { allowed: true, count: 0, windowStart, retryAfterMs: 0 };
}

export async function hitRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const windowStart = windowStartFor(windowMs);
  const windowDate = new Date(windowStart).toISOString();
  let count: number;

  try {
    // Select existing
    const { data: existing } = await supabase
      .from("rate_limit_hits")
      .select("count")
      .eq("key", key)
      .eq("window_start", windowDate)
      .maybeSingle();

    if (existing) {
      // Increment
      const newCount = (existing.count ?? 0) + 1;
      await supabase
        .from("rate_limit_hits")
        .update({ count: newCount })
        .eq("key", key)
        .eq("window_start", windowDate);
      count = newCount;
    } else {
      // Insert
      const { error } = await supabase
        .from("rate_limit_hits")
        .insert({ key, window_start: windowDate, count: 1 });
      if (error) {
        // Race: another request inserted first -> read again
        const { data: retry } = await supabase
          .from("rate_limit_hits")
          .select("count")
          .eq("key", key)
          .eq("window_start", windowDate)
          .maybeSingle();
        count = retry ? (retry.count ?? 0) + 1 : limit + 1;
        if (retry) {
          await supabase
            .from("rate_limit_hits")
            .update({ count })
            .eq("key", key)
            .eq("window_start", windowDate);
        }
      } else {
        count = 1;
      }
    }
  } catch (err) {
    console.error("[rate-limit] DB error:", err);
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

export function clientIp(req: { headers: { get(name: string): string | null } }) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const RATE_LIMITS = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  loginEmail: { limit: 10, windowMs: 15 * 60 * 1000 },
  refresh: { limit: 60, windowMs: 5 * 60 * 1000 },
  presign: { limit: 1000, windowMs: 10 * 60 * 1000 },
  uploadProxy: { limit: 600, windowMs: 10 * 60 * 1000 },
  abort: { limit: 60, windowMs: 10 * 60 * 1000 },
  cleanup: { limit: 10, windowMs: 60 * 60 * 1000 },
  audit: { limit: 30, windowMs: 60 * 60 * 1000 },
  write: { limit: 300, windowMs: 10 * 60 * 1000 },
} as const;