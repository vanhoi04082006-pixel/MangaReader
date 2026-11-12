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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kiem tra chuoi co phai UUID hop le khong (dung cho ADMIN_USER_ID). */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

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
  /** UUID cua tai khoan admin trong Supabase Auth — BAT BUOC trong production. */
  userId?: string;
  /** Mat khau bootstrap (chi dung lan dau tao tai khoan; KHONG bao gio tra ve client). */
  password?: string;
}

/**
 * Parse so nguyen duong tu env, FAIL CLOSED khi gia tri khong hop le.
 * Khong bao gio de NaN thuong qua so sanh (VD: quota) — mot bien so hoc
 * sai phai bao loi ro rang thay vo hieu hoa control mot cach im lang.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `[env] ${name} phai la so nguyen duong (gia tri hien tai khong the parse duoc)`
    );
  }
  return parsed;
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
    // Fail closed: gia tri khong parse duoc -> throw (khong bao gio NaN qua
    // so sanh quota). SigV4 presign toi da 7 ngay (604800s).
    storageQuotaBytes:
      positiveIntFromEnv("STORAGE_QUOTA_GB", 100) * 1024 * 1024 * 1024,
    signedUrlExpiry: Math.min(
      positiveIntFromEnv("SIGNED_URL_EXPIRY_SECONDS", 3600),
      604800
    ),
    isProd: process.env.NODE_ENV === "production",
  };
}

/**
 * Van de cau hinh admin identity (neu co).
 *
 * Production (NODE_ENV=production + provider supabase):
 * - ADMIN_USER_ID PHAI ton tai va la UUID hop le (fail closed khi thieu/mai).
 * - Khong co fallback "email-only" trong production.
 *
 * Development: ADMIN_USER_ID tuy chon (de bootstrap); neu dat ma mai dinh dang
 * van duoc bao cao de sua som (khong cho phep cau hinh sai roi di vao production).
 */
export function adminIdentityConfigIssue(): string | null {
  const env = getEnv();
  if (env.authProvider !== "supabase") return null; // local dev hoac cau hinh khong hop le (da xu ly noi khac)
  const raw = str("ADMIN_USER_ID");
  if (raw === undefined || raw === "") {
    if (env.isProd) return "ADMIN_USER_ID (bat buoc trong production — UUID cua admin Supabase)";
    return null; // dev: tuy chon
  }
  if (!isValidUuid(raw)) {
    return `ADMIN_USER_ID (khong phai UUID hop le: ${"*".repeat(Math.max(1, raw.length))} — doi theo UUID in boi scripts/bootstrap-admin.ts)`;
  }
  return null;
}

/**
 * Kiem tra 1 session user co phai admin duy nhat khong.
 * - email PHAI khop ADMIN_EMAIL (email lay tu Supabase Auth da xac thuc, khong tin client)
 * - ADMIN_USER_ID:
 *   + PRODUCTION: bat buoc ton tai + UUID hop le + khop user.id (fail closed —
 *     KHONG bao gio fallback email-only trong production)
 *   + development: tuy chon, nhung neu dat thi PHAI khop (chong doi mat identity)
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
  const configured = env.admin.userId;
  if (env.isProd) {
    // Production: UUID pinning la bat buoc. Thieu hoac mai -> TU CHOI HOAN TOAN.
    if (!configured || !isValidUuid(configured)) return false;
  }
  if (configured && user.id.toLowerCase() !== configured) return false;
  return true;
}

/**
 * Kiem tra cac bien bat buoc theo provider — tra ve danh sach thieu.
 *
 * LUU Y: ADMIN_PASSWORD KHONG con la bien bat buoc — day la secret chi dung
 * BOOTSTRAP (lan dau tao tai khoan admin). Sau khi tai khoan da ton tai trong
 * Supabase Auth, login/refresh/readout hoat dong binh thuong KHONG can no
 * (mat khau do Supabase Auth quan ly). Xoa no khoi env production sau bootstrap.
 */
export function missingEnvVars(): string[] {
  const env = getEnv();
  const missing: string[] = [];
  if (env.authProvider === null) missing.push("AUTH_PROVIDER (khong hop le trong production)");
  if (!env.authSecret) missing.push("AUTH_SECRET");
  if (env.authProvider === "supabase") {
    if (!env.supabase.url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!env.supabase.publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    if (!env.supabase.serviceKey) missing.push("SUPABASE_SERVICE_SECRET_KEY");
    // ADMIN_USER_ID: bat buoc (production) / khuyen nghi (dev). Mai dinh dang -> bao cao o ca hai moi.
    const issue = adminIdentityConfigIssue();
    if (issue) missing.push(issue);
  }
  if (!env.r2.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!env.r2.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!env.r2.endpoint) missing.push("R2_ENDPOINT");
  return missing;
}

export { required };
