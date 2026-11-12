// =============================================================
// Server-side environment configuration (validated)
// KHONG import file nay vao client component (chua service keys)
// =============================================================

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

export function getEnv() {
  return {
    authProvider: (str("AUTH_PROVIDER", "supabase") as AuthProvider) ?? "supabase",
    supabase: {
      url: str("NEXT_PUBLIC_SUPABASE_URL")?.replace(/\/$/, ""),
      publishableKey: str("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      serviceKey: str("SUPABASE_SERVICE_SECRET_KEY"),
    },
    admin: {
      email: str("ADMIN_EMAIL", "admin@manga.local"),
      password: str("ADMIN_PASSWORD", ""),
    },
    authSecret: str("AUTH_SECRET"),
    r2: {
      accountId: str("R2_ACCOUNT_ID"),
      accessKeyId: str("R2_ACCESS_KEY_ID"),
      secretAccessKey: str("R2_SECRET_ACCESS_KEY"),
      bucket: str("R2_BUCKET_NAME", "manga-storage"),
      endpoint: str("R2_ENDPOINT"),
    },
    appUrl: str("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
    storageQuotaBytes:
      (parseInt(str("STORAGE_QUOTA_GB", "100") ?? "100", 10)) * 1024 * 1024 * 1024,
    signedUrlExpiry: parseInt(str("SIGNED_URL_EXPIRY_SECONDS", "3600") ?? "3600", 10),
    isProd: process.env.NODE_ENV === "production",
  };
}

/** Kiem tra cac bien bat buoc theo provider — tra ve danh sach thieu */
export function missingEnvVars(): string[] {
  const env = getEnv();
  const missing: string[] = [];
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
