// =============================================================
// Supabase API key header contract (PURE module — client/server/scripts).
//
// Hai the he key Supabase, HAI SEMANTICS KHAC NHAU:
//
// 1) Key moi (2025+): "sb_publishable_..." va "sb_secret_..."
//    - KHONG phai JWT (opaque token) -> KHONG duoc gui o header
//      "Authorization: Bearer" (Bearer danh cho JWT: user access token).
//    - Chi can (va chi nen) gui o header "apikey". Gateway Supabase nhan
//      dien key qua co che apikey va gan role tuong ung:
//        + sb_publishable_  -> anon
//        + sb_secret_       -> service_role (privileged, bypass RLS)
//      Docs: https://supabase.com/docs/guides/api/api-keys
//
// 2) Key cu (legacy): "anon" va "service_role" — JWT co chu ky (3 doan
//    base64url, bat dau bang "eyJ").
//    - Phai gui O CA HAI header: apikey + Authorization: Bearer <key>
//      (PostgREST/GoTrue xac dinh role tu claims cua JWT o Bearer).
//
// Quy tac su dung:
//   - Request anon (chua dang nhap)        : supabaseAnonHeaders(PK)
//   - Request voi user da xac thuc          : supabaseUserHeaders(PK, accessToken)
//   - Request privileged phia server        : supabaseServiceHeaders(SK)
//
// KHONG BAO GIO in gia tri key ra log (chi nhan dien format theo prefix).
// =============================================================

export type SupabaseKeyFormat =
  | "sb-publishable" // key moi: sb_publishable_...
  | "sb-secret" // key moi: sb_secret_...
  | "legacy-jwt" // key cu: anon/service_role JWT (eyJ...)
  | "unknown";

/**
 * Nhan dien format key THEO PREFIX/dang chuoi — khong goi mang, khong in gia tri.
 * - "sb_publishable_..." -> sb-publishable
 * - "sb_secret_..."      -> sb-secret
 * - JWT (3 doan, bat dau "eyJ") -> legacy-jwt (anon/service_role cu)
 * - Con lai -> unknown (khong gui lam Bearer — fail safe theo semantics key moi)
 */
export function detectSupabaseKeyFormat(key: string): SupabaseKeyFormat {
  if (typeof key !== "string" || key.length === 0) return "unknown";
  if (key.startsWith("sb_publishable_")) return "sb-publishable";
  if (key.startsWith("sb_secret_")) return "sb-secret";
  // Legacy anon/service_role key la JWT ky: 3 doan base64url phan cach bang dau cham,
  // header thuong bat dau bang "eyJ" (base64 cua '{"').
  if (key.startsWith("eyJ") && key.split(".").length === 3) return "legacy-jwt";
  return "unknown";
}

/**
 * Headers cho request ANON (chua dang nhap):
 * - Key moi   : chi co "apikey" (KHONG gui key moi lam Bearer — no khong phai JWT).
 * - Key legacy : apikey + Authorization: Bearer <anon JWT> (semantics cu).
 */
export function supabaseAnonHeaders(publishableKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: publishableKey };
  if (detectSupabaseKeyFormat(publishableKey) === "legacy-jwt") {
    headers.Authorization = `Bearer ${publishableKey}`;
  }
  return headers;
}

/**
 * Headers cho request USER DA XAC THUC:
 * - apikey = publishable key (moi the he deu vay).
 * - Authorization: Bearer = ACCESS TOKEN JWT THAT cua user (khong phai API key!).
 */
export function supabaseUserHeaders(publishableKey: string, accessToken: string): Record<string, string> {
  return {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Headers cho request PRIVILEGED phia server (service_role):
 * - Key moi   : chi co "apikey" = sb_secret_... (gateway nhan dien key dac quyen
 *   qua co che apikey — KHONG gui sb_secret_ lam Bearer JWT).
 * - Key legacy : apikey + Authorization: Bearer <service_role JWT>.
 */
export function supabaseServiceHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: secretKey };
  if (detectSupabaseKeyFormat(secretKey) === "legacy-jwt") {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}
