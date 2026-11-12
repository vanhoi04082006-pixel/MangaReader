// =============================================================
// Verify RLS — chay SAU khi ap dung supabase/migrations/0001_init.sql:
//   bun run scripts/verify-rls.ts
//
// Kiem qua PostgREST (khong can truy cap SQL truc tiep):
// 1. Anon (publishable key, khong dang nhap): KHONG doc duoc du lieu
// 2. User Supabase thu 2 (non-admin, tao tam roi xoa): KHONG doc/ghi duoc
// 3. (Admin khong kiem qua day — admin truy cap qua app, Prisma role
//    chu bang khong bi RLS rang buoc; ranh gioi that la requireAdmin)
//
// AN TOAN: chi TAO + XOA 1 user tam trong Supabase Auth; khong anh huong
// du lieu. Chay nhieu lan (idempotent).
// =============================================================

import { readFileSync } from "node:fs";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(".env", "utf8") as string;
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* dung process.env */
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

const ENV = loadEnv();
const SB_URL = (ENV.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const PK = ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SK = ENV.SUPABASE_SERVICE_SECRET_KEY ?? "";

if (!SB_URL || !PK || !SK) {
  console.error("Thieu NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY / SERVICE_SECRET_KEY trong .env");
  process.exit(1);
}

const TEST_EMAIL = `mangareader-rls-verify+${Date.now()}@example.com`;
const TEST_PASSWORD = "RlsVerify!2026";

async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${SB_URL}${path}`, {
    method,
    headers: {
      apikey: token,
      Authorization: `Bearer ${token}`,
      "Content-type": "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  console.log("=== MangaReader — RLS Verification (PostgREST) ===");
  console.log(`Project  : ${SB_URL}`);
  console.log("");

  // ---- 0. Migration da chua? (bang mangas phai ton tai) ----
  const anonList = await rest("GET", "/rest/v1/mangas?select=id&limit=1", PK);
  if (anonList.status === 404) {
    console.error("BANG `mangas` CHUA TON TAI — ban phai chay supabase/migrations/0001_init.sql");
    console.error("trong Supabase Dashboard > SQL Editor TRUOC khi verify RLS.");
    process.exit(1);
  }

  // ---- 1. Anon access ----
  // RLS: khong co policy cho anon -> 401/403 hoac 200 voi 0 row. Ca 2 deu OK
  // (PostgREST tra 200 + [] khi RLS loc het row; 401/403 khi khong co grant).
  const anonOk = anonList.status === 401 || anonList.status === 403 || (anonList.status === 200 && anonList.text.trim() === "[]");
  check("Anon KHONG doc duoc mangas", anonOk, `status=${anonList.status}`);

  const anonInsert = await rest("POST", "/rest/v1/mangas", PK, { title: "RLS anon insert test" });
  const anonInsOk = anonInsert.status === 401 || anonInsert.status === 403 || anonInsert.status === 404;
  check("Anon KHONG ghi duoc mangas", anonInsOk, `status=${anonInsert.status}`);

  // ---- 2. Non-admin authenticated ----
  const created = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "content-type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
  });
  if (!created.ok) {
    console.error("Khong tao duoc user Supabase tam thu 2:", created.status, await created.text());
    process.exit(1);
  }
  const createdBody = (await created.json()) as { id: string };

  try {
    // Password grant truc tiep Supabase (session that cua non-admin)
    const grant = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: PK, Authorization: `Bearer ${PK}`, "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!grant.ok) {
      console.error("Password grant that bai:", grant.status);
      process.exit(1);
    }
    const session = (await grant.json()) as { access_token: string };

    const nonAdminList = await rest("GET", "/rest/v1/mangas?select=id&limit=1", session.access_token);
    const nonAdminOk =
      nonAdminList.status === 401 || nonAdminList.status === 403 || (nonAdminList.status === 200 && nonAdminList.text.trim() === "[]");
    check("Non-admin KHONG doc duoc mangas (policy admin-only)", nonAdminOk, `status=${nonAdminList.status} body=${nonAdminList.text.slice(0, 120)}`);

    const nonAdminIns = await rest("POST", "/rest/v1/mangas", session.access_token, { title: "RLS nonadmin insert test" });
    const nonAdminInsOk = nonAdminIns.status === 401 || nonAdminIns.status === 403 || nonAdminIns.status === 404;
    check("Non-admin KHONG ghi duoc mangas", nonAdminInsOk, `status=${nonAdminIns.status}`);

    const nonAdminStorage = await rest("GET", "/rest/v1/storage_objects?select=id&limit=1", session.access_token);
    const storageOk =
      nonAdminStorage.status === 401 || nonAdminStorage.status === 403 || (nonAdminStorage.status === 200 && nonAdminStorage.text.trim() === "[]");
    check("Non-admin KHONG doc duoc storage_objects", storageOk, `status=${nonAdminStorage.status}`);

    const nonAdminConfig = await rest("GET", "/rest/v1/app_config?select=*&limit=1", session.access_token);
    const configOk =
      nonAdminConfig.status === 401 || nonAdminConfig.status === 403 || (nonAdminConfig.status === 200 && nonAdminConfig.text.trim() === "[]");
    check("Non-admin KHONG doc duoc app_config", configOk, `status=${nonAdminConfig.status}`);
  } finally {
    // Don dep user tam
    await fetch(`${SB_URL}/auth/v1/admin/users/${createdBody.id}`, {
      method: "DELETE",
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    console.log("");
    console.log("(Da xoa user Supabase tam thu 2)");
  }

  console.log("");
  if (failures > 0) {
    console.error(`KET QUA: ${failures} check FAIL — kiem tra lai migration RLS.`);
    process.exit(1);
  }
  console.log("KET QUA: TAT CA RLS CHECK PASS.");
}

main().catch((err) => {
  console.error("VERIFY RLS THAT BAI:", err instanceof Error ? err.message : err);
  process.exit(1);
});
