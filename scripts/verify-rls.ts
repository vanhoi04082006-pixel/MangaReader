// =============================================================
// Verify RLS — chay SAU khi ap dung supabase/migrations/0001_init.sql:
//   bun run scripts/verify-rls.ts
//
// Kiem qua PostgREST (khong can truy cap SQL truc tiep), TACH Biet:
//   - apikey header           = publishable key (goi PostgREST)
//   - Authorization: Bearer   = publishable key (anon) hoac access token
//                               THAT cua user (authenticated)
// Truoc day script dung cung 1 gia tri cho ca hai header -> user non-admin
// bi 401 TU API KEY truoc khi den chinh sach RLS -> co the bao PASS gia.
//
// Cac kiem tra (deu phai danh gia tren yeu cau HOP LE):
//   1. Publishable key hop le (goi /rest/v1/ -> 200) — loai tru 401 do key sai.
//   2. Bang du lieu TON TAI (service key doc duoc) — loai tru 404/PGRST205.
//   3. Session non-admin THAT hop le (GET /auth/v1/user -> 200) — loai tru
//      token het han/sai de dam bao request den DUNG chinh sach RLS.
//   4. Anon SELECT/INSERT bi chan (RLS loc/hang che).
//   5. Non-admin SELECT/INSERT/UPDATE/DELETE bi chan (RLS admin-only);
//      UPDATE/DELETE danh vao dong test that (tao qua service key) va
//      KIEM TRA LAI dong nguyen ven sau moi thu (0 row bi anh huong).
//   6. Non-admin KHONG doc duoc storage_objects + app_config; KHONG ghi
//      duoc vao app_config.
//
// AN TOAN: chi TAO + XOA 1 user Supabase tam + 1 dong manga test (cua chinh
// script, tao qua service key, xoa sach sau test); KHONG anh huong du lieu
// ung dung that. Idempotent — chay nhieu lan duoc.
// =============================================================

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
const TEST_MANGA_ID = randomUUID();
const TEST_MANGA_TITLE = `[RLS-VERIFY] temp ${Date.now()} — XOA SAU TEST`;

interface RestResult {
  status: number;
  text: string;
}

/**
 * Goi PostgREST voi TACH Biet apikey va bearer token:
 * - apikey        : publishable key (yeu cau cua Kong/PostgREST gateway)
 * - bearerToken   : publishable key (anon) hoac access token user (authenticated)
 * DUNG bao gio truyen access token lam apikey.
 */
async function rest(
  method: string,
  path: string,
  apiKey: string,
  bearerToken: string,
  body?: unknown
): Promise<RestResult> {
  const res = await fetch(`${SB_URL}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      ...(body !== undefined ? { Prefer: "resolution=ignore-duplicates" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

/** SELECT bi RLS loc het -> 200 + "[]"; hoac 403 permission denied. Ca 2 deu la "bi chan hop le". */
function isReadDenied(r: RestResult): boolean {
  if (r.status === 200 && r.text.trim() === "[]") return true; // RLS loc 0 row
  if (r.status === 403) return true; // permission denied / RLS
  return false;
}

/** Ghi (INSERT/UPDATE/DELETE) bi chan -> 403 + ma RLS; hoac 0 row anh huong (200 + "[]"). */
function isWriteDenied(r: RestResult): boolean {
  if (r.status === 403) return true;
  // PostgREST tra 200 + [] khi UPDATE/DELETE anh huong 0 row (RLS USING loc het)
  if (r.status === 200 && r.text.trim() === "[]") return true;
  return false;
}

async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  console.log("=== MangaReader — RLS Verification (PostgREST, apikey/bearer tach biet) ===");
  console.log(`Project  : ${SB_URL}`);
  console.log("");

  // ---- 0a. Publishable key hop le? (neu sai -> moi ket qua sau dau vo nghia) ----
  // PHAN BIEC: key sai = 401 "Invalid API key" (Kong); key dung nhung bang
  // chua tao = 404 PGRST205 (PostgREST). Dung endpoint bang (khong dung
  // /rest/v1/ — root OpenAPI tra 401 voi ca key hop le tren mot so project).
  const pkProbe = await rest("GET", "/rest/v1/mangas?select=id&limit=1", PK, PK);
  if (pkProbe.status === 401 || pkProbe.text.includes("Invalid API key")) {
    console.error(`FALL: Publishable key KHONG hop le (GET /rest/v1/mangas -> ${pkProbe.status}).`);
    console.error("Khong the kiem tra RLS voi key sai — sua NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
    process.exit(1);
  }
  check("Publishable key hop le (PostgREST phan hoi, khong bi Kong 401)", true);

  // ---- 0b. Bang du lieu ton tai? (service key doc duoc) — neu chua ap migration thi DUNG ----
  const requiredTables = ["mangas", "storage_objects", "app_config", "profiles"];
  for (const table of requiredTables) {
    const svc = await rest("GET", `/rest/v1/${table}?select=*&limit=1`, SK, SK);
    if (svc.status === 401 || svc.text.includes("Invalid API key")) {
      console.error(`FALL: Service key KHONG hop le (GET /rest/v1/${table} -> ${svc.status}).`);
      console.error("Kiem tra SUPABASE_SERVICE_SECRET_KEY.");
      process.exit(1);
    }
    if (svc.status === 404 || svc.text.includes("PGRST205")) {
      console.error(`BLOCKED: Bang \`${table}\` CHUA TON TAI — migration chua duoc ap.`);
      console.error("Hay chay supabase/migrations/0001_init.sql trong Supabase Dashboard > SQL Editor");
      console.error("TRUOC khi verify RLS. (Ket qua RLS khong duoc danh gia tren bang khong ton tai.)");
      process.exit(1);
    }
    if (svc.status !== 200) {
      console.error(`FALL: Khong doc duoc bang \`${table}\` bang service key (status=${svc.status}).`);
      console.error("Kiem tra quyen cua role service / cau hinh PostgREST.");
      process.exit(1);
    }
    check(`Bang \`${table}\` ton tai (service key doc duoc)`, true);
  }
  console.log("");

  // ---- 1. Anon access (publishable key ca hai header — dung format request anon) ----
  const anonSelect = await rest("GET", "/rest/v1/mangas?select=id&limit=1", PK, PK);
  check(
    "Anon KHONG doc duoc mangas (RLS loc het / 403)",
    isReadDenied(anonSelect),
    `status=${anonSelect.status} body=${anonSelect.text.slice(0, 80)}`
  );

  const anonInsert = await rest("POST", "/rest/v1/mangas", PK, PK, {
    id: randomUUID(),
    title: "[RLS-VERIFY] anon insert — phai bi chan",
  });
  check(
    "Anon KHONG ghi duoc mangas",
    isWriteDenied(anonInsert),
    `status=${anonInsert.status} body=${anonInsert.text.slice(0, 80)}`
  );
  console.log("");

  // ---- 2. Tao user Supabase tam (non-admin) + session THAT ----
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

  // Tao 1 dong manga test QUA SERVICE KEY (service_role bypass RLS — dung lam
  // mau cho cac thu UPDATE/DELETE; se xoa sach o finally).
  const seedManga = await rest("POST", "/rest/v1/mangas", SK, SK, [
    { id: TEST_MANGA_ID, title: TEST_MANGA_TITLE },
  ]);
  if (seedManga.status !== 200 && seedManga.status !== 201) {
    console.error("Khong tao duoc dong manga test (service key):", seedManga.status, seedManga.text);
    // van phai don dep user tam
    await fetch(`${SB_URL}/auth/v1/admin/users/${createdBody.id}`, {
      method: "DELETE",
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    process.exit(1);
  }

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
    const AT = session.access_token; // access token THAT — chi dung lam Bearer

    // ---- 3. Chung minh session non-admin HOP LE truoc khi danh gia RLS ----
    // (Neu buoc nay fail thi moi ket qua 401 o duoi la do token, KHONG phai RLS.)
    const whoami = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: PK, Authorization: `Bearer ${AT}` },
    });
    if (whoami.status !== 200) {
      console.error(`FALL: Session non-admin KHONG hop le (GET /auth/v1/user -> ${whoami.status}).`);
      console.error("Khong the ket luan RLS — sua session truoc khi verify.");
      process.exit(1);
    }
    const whoamiBody = (await whoami.json()) as { email?: string };
    check(
      "Session non-admin THAT hop le (GET /auth/v1/user -> 200)",
      whoamiBody.email === TEST_EMAIL,
      `email=${whoamiBody.email}`
    );
    console.log("");

    // ---- 4. Non-admin SELECT (apikey=PK, Bearer=AT) ----
    const naSelect = await rest("GET", "/rest/v1/mangas?select=id&limit=1", PK, AT);
    check(
      "Non-admin KHONG doc duoc mangas (RLS admin-only loc het)",
      isReadDenied(naSelect),
      `status=${naSelect.status} body=${naSelect.text.slice(0, 100)}`
    );

    // ---- 5. Non-admin INSERT ----
    const naInsert = await rest("POST", "/rest/v1/mangas", PK, AT, [
      { id: randomUUID(), title: "[RLS-VERIFY] nonadmin insert — phai bi chan" },
    ]);
    check(
      "Non-admin KHONG ghi duoc mangas",
      isWriteDenied(naInsert),
      `status=${naInsert.status} body=${naInsert.text.slice(0, 100)}`
    );

    // ---- 6. Non-admin UPDATE danh vao dong test (phai anh huong 0 row) ----
    const naUpdate = await rest(
      "PATCH",
      `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}`,
      PK,
      AT,
      { title: "[RLS-VERIFY] HACKED — KHONG duoc phep" }
    );
    let updateDenied = isWriteDenied(naUpdate);
    // Kiem tra lai dong that su nguyen ven (chang han RLS bi tat hoac policy sai)
    const afterUpdate = await rest("GET", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}&select=title`, SK, SK);
    const rowAfterUpdate = (JSON.parse(afterUpdate.text || "[]") as Array<{ title: string }>)[0];
    if (!rowAfterUpdate || rowAfterUpdate.title !== TEST_MANGA_TITLE) updateDenied = false;
    check(
      "Non-admin KHONG update duoc dong mangas (0 row anh huong + du lieu nguyen ven)",
      updateDenied,
      `status=${naUpdate.status} titleCon=${rowAfterUpdate?.title?.slice(0, 30)}`
    );

    // ---- 7. Non-admin DELETE danh vao dong test (phai anh huong 0 row) ----
    const naDelete = await rest("DELETE", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}`, PK, AT);
    let deleteDenied = isWriteDenied(naDelete);
    const afterDelete = await rest("GET", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}&select=id`, SK, SK);
    const rowAfterDelete = JSON.parse(afterDelete.text || "[]") as Array<{ id: string }>;
    if (rowAfterDelete.length !== 1) deleteDenied = false; // dong da bi xoa -> RLS FAIL
    check(
      "Non-admin KHONG delete duoc dong mangas (0 row anh huong + dong con nguyen)",
      deleteDenied,
      `status=${naDelete.status} rows=${rowAfterDelete.length}`
    );

    // ---- 8. Non-admin tren storage_objects ----
    const naStorage = await rest("GET", "/rest/v1/storage_objects?select=id&limit=1", PK, AT);
    check(
      "Non-admin KHONG doc duoc storage_objects",
      isReadDenied(naStorage),
      `status=${naStorage.status}`
    );

    // ---- 9. Non-admin tren app_config (ca doc lan ghi) ----
    const naConfig = await rest("GET", "/rest/v1/app_config?select=*&limit=1", PK, AT);
    check(
      "Non-admin KHONG doc duoc app_config",
      isReadDenied(naConfig),
      `status=${naConfig.status}`
    );
    const naConfigWrite = await rest("POST", "/rest/v1/app_config", PK, AT, [
      { key: "rls-verify-evil", value: "00000000-0000-0000-0000-000000000000" },
    ]);
    check(
      "Non-admin KHONG ghi duoc app_config",
      isWriteDenied(naConfigWrite),
      `status=${naConfigWrite.status}`
    );
  } finally {
    // ---- Don dep: xoa dong manga test + user tam (CHI du lieu do script nay tao) ----
    console.log("");
    const delManga = await rest("DELETE", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}`, SK, SK);
    console.log(
      `(Xoa dong manga test: ${delManga.status === 200 || delManga.status === 204 ? "OK" : "CANH BAO " + delManga.status})`
    );
    await fetch(`${SB_URL}/auth/v1/admin/users/${createdBody.id}`, {
      method: "DELETE",
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    console.log("(Da xoa user Supabase tam thu 2)");
  }

  console.log("");
  if (failures > 0) {
    console.error(`KET QUA: ${failures} check FAIL — kiem tra lai migration RLS.`);
    process.exit(1);
  }
  console.log("KET QUA: TAT CA RLS CHECK PASS (tren session non-admin that + bang ton tai).");
}

main().catch((err) => {
  console.error("VERIFY RLS THAT BAI:", err instanceof Error ? err.message : err);
  process.exit(1);
});
