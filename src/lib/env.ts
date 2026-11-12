// =============================================================
// Server-side environment configuration (validated)
// KHONG import file nay vao client component (chua service keys)
//
// Production phai dung Supabase Auth (fail-closed):
// - AUTH_PROVIDER=local bi tu choi khi NODE_ENV=production
// - Supabase hong khong tu dong xy sang local JWT
// =============================================================

import type { SessionUser } from "@/lib/session";

function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[env] Missing required variable: ${name}`);
  return v;
}

export type AuthProvider = "supabase" | "local";

/** Local JWT provider chi duoc phep trong development. Production phai fail-closed. */
export function localProviderAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Provider hieu qua sau khi validate. Neu cau hinh local trong production
 * -> tra ve null (INVALID) de moi duong auth tu choi (fail-closed).
 */
export function effectiveAuthProvider(): AuthProvider | null {
  const raw = (str("AUTH_PROVIDER", "supabase") as AuthProvider) ?? "supabase";
  if (raw !== "supabase" && raw !== "local") return null;
  if (raw === "local" && !localProviderAllowed()) return null;
  return raw;
}

export interface AdminIdentity {
  email: string;
  /** UUID cua tai khoan admin trong Supabase Auth (khong bat buoc nhung khuyen dung). */
  userId?: string;
  /** Mat khau bootstrap (chi dung lan dau tao tai khoan; KHONG bao gio tra ve client). */
  password?: string;
}

export function getEnv() {
  const provider = effectiveAuthProvider();
  return {
    // provider = null nghia la cau hinh khong hop le (local trong prod) -> fail closed
    authProvider: provider,
    supabase: {
      url: str("NEXT_PUBLIC_SUPABASE_URL")?.replace(/\/$/, ""),
      publishableKey: str("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      serviceKey: str("SUPABASE_SERVICE_SECRET_KEY"),
    },
    admin: {
      email: (str("ADMIN_EMAIL", "admin@manga.local") ?? "").trim().toLowerCase(),
      password: str("ADMIN_PASSWORD", ""),
      userId: str("ADMIN_USER_ID")?.trim().toLowerCase() || undefined,
    } satisfies AdminIdentity,
    authSecret: str("AUTH_SECRET"),
    r2: {
      accountId: str("R2_ACCOUNT_ID"),
      accessKeyId: str("R2_ACCESS_KEY_ID"),
      secretAccessKey: str("R2_SECRET_ACCESS_KEY"),
      bucket: str("R2_BUCKET_NAME", "manga-storage"),
      endpoint: str("R2_ENDPOINT"),
    },
    appUrl: str("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
    storageQuotaBytes:
      (parseInt(str("STORAGE_QUOTA_GB", "100") ?? "100", 10)) * 1024 * 1024 * 1024,
    signedUrlExpiry: parseInt(str("SIGNED_URL_EXPIRY_SECONDS", "3600") ?? "3600", 10),
    isProd: process.env.NODE_ENV === "production",
  };
}

/**
 * Kiem tra 1 session user co phai admin duy nhat khong.
 * - email PHAI khop ADMIN_EMAIL (email lay tu Supabase Auth da xac thuc, khong tin client)
 * - neu ADMIN_USER_ID duoc cau hinh thi user.id PHAI khop (chong doi mat admin identity)
 * - local mode: chi chap nhan id "local-admin"
 */
export function isAdminUser(user: SessionUser): boolean {
  const env = getEnv();
  const provider = env.authProvider;
  if (provider === "local") {
    return user.id === "local-admin" && user.email.trim().toLowerCase() === env.admin.email;
  }
  if (provider !== "supabase") return false; // cau hinh khong hop le -> fail closed
  const emailOk = user.email.trim().toLowerCase() === env.admin.email;
  if (!emailOk) return false;
  if (env.admin.userId && user.id.toLowerCase() !== env.admin.userId) return false;
  return true;
}

/** Kiem tra cac bien bat buoc theo provider — tra ve danh sach thieu */
export function missingEnvVars(): string[] {
  const env = getEnv();
  const missing: string[] = [];
  if (env.authProvider === null) missing.push("AUTH_PROVIDER (khong hop le trong production)");
  if (!env.authSecret) missing.push("AUTH_SECRET");
  if (env.authProvider === "supabase") {
    if (!env.supabase.url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!env.supabase.publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    if (!env.supabase.serviceKey) missing.push("SUPABASE_SERVICE_SECRET_KEY");
    if (!env.admin.password) missing.push("ADMIN_PASSWORD");
  }
  if (!env.r2.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!env.r2.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!env.r2.endpoint) missing.push("R2_ENDPOINT");
  return missing;
}

export { required };
