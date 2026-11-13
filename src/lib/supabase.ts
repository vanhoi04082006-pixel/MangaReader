// =============================================================
// Supabase client (server-side, service role) — dung REST API
// (PostgREST) thay vi Prisma TCP connection, de tuong thich voi
// Vercel serverless (chi cho phep outbound HTTP, khong TCP 5432).
// =============================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_SECRET_KEY!;

/** Service-role client: bypass RLS, dung cho server-side DB access. */
export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Helper: lay client (singleton). */
export function getSupabase() {
  return supabase;
}