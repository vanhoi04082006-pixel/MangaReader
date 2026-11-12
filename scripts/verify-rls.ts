// =============================================================
// Verify RLS + Supabase API key compatibility — chay SAU khi ap dung
// supabase/migrations/0001_init.sql:
//   bun run scripts/verify-rls.ts
//
// ================= HEADER CONTRACT (key moi sb_* vs legacy JWT) ==========
// Theo tai lieu Supabase API keys (https://supabase.com/docs/guides/api/api-keys):
//   - Key moi "sb_publishable_..." / "sb_secret_..." KHONG phai JWT:
//     chi gui o header "apikey" — KHONG bao gio gui lam "Authorization: Bearer".
//   - Key legacy (anon/service_role JWT "eyJ..."): gui CA apikey + Bearer.
//   - Request user: apikey = publishable key + Bearer = access token THAT.
// Cac header duoc tao boi src/lib/supabase-keys.ts (phan biet format tu dong).
//
// ================= KIEM TRA =================
// Phase A — API key compatibility (KHONG can bang du lieu):
//   A1. Publishable key (sb_moi) duoc chap nhan khi KHONG gui Bearer.
//   A2. Secret key (sb_moi) duoc chap nhan khi KHONG gui Bearer.
//   A3. Secret key duoc nhan dien la dac quyen (admin API tra 200).
//   A4. API key SAI bi gateway tu choi (401).
//   A5. User JWT SAI bi tu choi (GoTrue + PostgREST).
// Phase B — Bang du lieu ton tai (service key doc duoc). THIEU -> BLOCKED
//   (exit 2) — KHONG bao gio coi loi gateway 401 lam bang chung RLS.
// Phase C — RLS tren session non-admin THAT (tao user tam + seed 1 dong
//   manga test roi xoa sach): anon + non-admin bi chan; service key
//   doc/ghi duoc (duong dan migration dung). Kiem tra lai dong nguyen ven
//   sau moi thu (0 row bi anh huong).
//
// ================= DON DEP LUON CHAY (cleanup) =================
// KHONG dung process.exit() trong vung co tai nguyen tam — dung throw +
// finally. Exit code chi duoc tra SAU khi cleanup chay xong:
//   0 = tat ca PASS | 1 = FAIL hoac cleanup loi | 2 = BLOCKED (chua migration).
// Cleanup chi xoa du lieu DO SCRIPT NAY TAO (id cu the), bao loi ro rang
// neu khong don duoc; khong bao gio anh huong du lieu ung dung that.
// =============================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  detectSupabaseKeyFormat,
  supabaseAnonHeaders,
  supabaseServiceHeaders,
  supabaseUserHeaders,
} from "../src/lib/supabase-keys";

/** Loi kiem soat: exit code 1 (FAIL) hoac 2 (BLOCKED). */
class VerifyError extends Error {
  exitCode: number;
  constructor(message: string, exitCode: 1 | 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

export interface VerifyEnv {
  SB_URL: string;
  PK: string; // NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SK: string; // SUPABASE_SERVICE_SECRET_KEY
}

export interface VerifyDeps {
  /** Override env (unit test). Mac dinh doc .env (goc repo) + process.env. */
  env?: Partial<VerifyEnv>;
  /** Inject fetch (unit test). Mac dinh global fetch. */
  fetchImpl?: typeof fetch;
}

/** Doc .env o GOC REPO (khong phu thuoc CWD) — process.env uu tien hon file. */
function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const envPath = path.resolve(import.meta.dir, "..", ".env");
    const raw = readFileSync(envPath, "utf8") as string;
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]!] = m[2].trim();
    }
  } catch {
    /* khong co .env — dung process.env / envOverride */
  }
  return env;
}

function resolveEnv(override?: Partial<VerifyEnv>): VerifyEnv {
  const file = loadEnvFile();
  const merged = {
    SB_URL: (override?.SB_URL ?? process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? file["NEXT_PUBLIC_SUPABASE_URL"] ?? "").replace(/\/$/, ""),
    PK: override?.PK ?? process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? file["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    SK: override?.SK ?? process.env["SUPABASE_SERVICE_SECRET_KEY"] ?? file["SUPABASE_SERVICE_SECRET_KEY"] ?? "",
  };
  if (!merged.SB_URL || !merged.PK || !merged.SK) {
    throw new VerifyError(
      "Thieu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_SECRET_KEY (.env hoac process.env).",
      2
    );
  }
  return merged;
}

/** Tai nguyen tam do script tao — cleanup chi xoa nhung gi o day. */
interface Created {
  tempUserId: string | null;
  /** Cac id manga ma script THU insert (anon/non-admin) — xoa phong thi hai. */
  attemptedMangaIds: string[];
  /** Id dong manga seed qua service key. */
  seededMangaId: string | null;
  /** Key app_config ma script thu ghi — xoa phong thi hai. */
  attemptedConfigKeys: string[];
}

interface RestResult {
  status: number;
  text: string;
}

interface Ctx {
  env: VerifyEnv;
  f: typeof fetch;
  failures: number;
  created: Created;
}

/** fetch co timeout — request treo se throw va di qua cleanup. */
async function fetchT(ctx: Ctx, url: string, init: RequestInit = {}): Promise<Response> {
  return ctx.f(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** POST/GET co headers + body JSON. */
async function call(
  ctx: Ctx,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<RestResult> {
  const res = await fetchT(ctx, `${ctx.env.SB_URL}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { "content-type": "application/json", Prefer: "resolution=ignore-duplicates" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

function anonRest(ctx: Ctx, method: string, p: string, body?: unknown) {
  // Anon: key moi -> chi apikey; legacy -> apikey + Bearer anon JWT.
  return call(ctx, method, p, supabaseAnonHeaders(ctx.env.PK), body);
}
function serviceRest(ctx: Ctx, method: string, p: string, body?: unknown) {
  // Privileged: key moi -> chi apikey; legacy -> apikey + Bearer service JWT.
  return call(ctx, method, p, supabaseServiceHeaders(ctx.env.SK), body);
}
function userRest(ctx: Ctx, method: string, p: string, accessToken: string, body?: unknown) {
  // User da xac thuc: apikey = PK + Bearer = access token THAT.
  return call(ctx, method, p, supabaseUserHeaders(ctx.env.PK, accessToken), body);
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
  if (r.status === 200 && r.text.trim() === "[]") return true; // UPDATE/DELETE 0 row
  return false;
}

const check = (ctx: Ctx, name: string, ok: boolean, detail?: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) ctx.failures += 1;
};

// =============================================================
// CLEANUP — luon chay (finally); chi xoa du lieu script nay tao.
// =============================================================
async function cleanup(ctx: Ctx): Promise<boolean> {
  const c = ctx.created;
  let allOk = true;
  console.log("");
  console.log("--- Don dep tai nguyen tam (chi du lieu script nay tao) ---");

  // 1. Dong manga seed qua service key
  if (c.seededMangaId) {
    try {
      const r = await serviceRest(ctx, "DELETE", `/rest/v1/mangas?id=eq.${c.seededMangaId}`);
      if (r.status === 200 || r.status === 204) {
        console.log(`OK    xoa manga test (seed) ${c.seededMangaId}`);
      } else {
        allOk = false;
        console.error(`LOI   khong xoa duoc manga test (seed) ${c.seededMangaId}: status=${r.status}`);
        console.error(`      XOA TAY: DELETE ${ctx.env.SB_URL}/rest/v1/mangas?id=eq.${c.seededMangaId} (service key)`);
      }
    } catch (err) {
      allOk = false;
      console.error(`LOI   xoa manga test (seed) ${c.seededMangaId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2. Cac manga ma script THU insert (neu RLS hong -> row co the da tao)
  for (const id of c.attemptedMangaIds) {
    try {
      const r = await serviceRest(ctx, "DELETE", `/rest/v1/mangas?id=eq.${id}`);
      if (r.status === 200 || r.status === 204) {
        console.log(`OK    xoa manga thu insert ${id} (phong thi hai)`);
      } else {
        allOk = false;
        console.error(`LOI   khong xoa duoc manga thu insert ${id}: status=${r.status}`);
      }
    } catch (err) {
      allOk = false;
      console.error(`LOI   xoa manga thu insert ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3. Key app_config ma script thu ghi (neu RLS hong)
  for (const key of c.attemptedConfigKeys) {
    try {
      const r = await serviceRest(ctx, "DELETE", `/rest/v1/app_config?key=eq.${encodeURIComponent(key)}`);
      if (r.status === 200 || r.status === 204) {
        console.log(`OK    xoa app_config "${key}" (phong thi hai)`);
      } else {
        allOk = false;
        console.error(`LOI   khong xoa duoc app_config "${key}": status=${r.status}`);
      }
    } catch (err) {
      allOk = false;
      console.error(`LOI   xoa app_config "${key}":`, err instanceof Error ? err.message : err);
    }
  }

  // 4. User Supabase tam
  if (c.tempUserId) {
    try {
      const res = await fetchT(ctx, `${ctx.env.SB_URL}/auth/v1/admin/users/${c.tempUserId}`, {
        method: "DELETE",
        headers: supabaseServiceHeaders(ctx.env.SK),
      });
      if (res.ok) {
        console.log(`OK    xoa user Supabase tam ${c.tempUserId}`);
      } else {
        allOk = false;
        console.error(`LOI   khong xoa duoc user Supabase tam ${c.tempUserId}: status=${res.status}`);
        console.error(`      XOA TAY: Supabase Dashboard > Authentication > Users (email mangareader-rls-verify+...)`);
      }
    } catch (err) {
      allOk = false;
      console.error(`LOI   xoa user Supabase tam ${c.tempUserId}:`, err instanceof Error ? err.message : err);
    }
  }

  if (!c.tempUserId && !c.seededMangaId && c.attemptedMangaIds.length === 0 && c.attemptedConfigKeys.length === 0) {
    console.log("(Khong co tai nguyen tam nao duoc tao — khong can don dep.)");
  }
  if (!allOk) {
    console.error(">>> CLEANUP KHONG HOAN TAT — xem cac dong LOI o tren (exit code se la 1).");
  }
  return allOk;
}

// =============================================================
// MAIN
// =============================================================
export async function runVerification(deps: VerifyDeps = {}): Promise<number> {
  let env: VerifyEnv;
  try {
    env = resolveEnv(deps.env);
  } catch (err) {
    if (err instanceof VerifyError) {
      console.error(`BLOCKED  ${err.message}`);
      return err.exitCode;
    }
    throw err;
  }
  const f = deps.fetchImpl ?? fetch;
  const ctx: Ctx = {
    env,
    f,
    failures: 0,
    created: { tempUserId: null, seededMangaId: null, attemptedMangaIds: [], attemptedConfigKeys: [] },
  };

  const TEST_EMAIL = `mangareader-rls-verify+${Date.now()}@example.com`;
  const TEST_PASSWORD = "RlsVerify!2026";
  const TEST_MANGA_ID = randomUUID();
  const TEST_MANGA_TITLE = `[RLS-VERIFY] temp ${Date.now()} — XOA SAU TEST`;

  console.log("=== MangaReader — RLS + API Key Verification ===");
  console.log(`Project  : ${env.SB_URL}`);
  // In FORMAT key (khong in gia tri): phan biet ro key moi vs legacy.
  console.log(`PK format: ${detectSupabaseKeyFormat(env.PK)}  (apikey header${detectSupabaseKeyFormat(env.PK) === "legacy-jwt" ? " + Bearer (legacy JWT)" : " — KHONG gui lam Bearer"})`);
  console.log(`SK format: ${detectSupabaseKeyFormat(env.SK)}  (apikey header${detectSupabaseKeyFormat(env.SK) === "legacy-jwt" ? " + Bearer (legacy JWT)" : " — KHONG gui lam Bearer"})`);
  console.log("");

  let blockedMessage: string | null = null;
  let cleanupOk = true;

  try {
    // ---------- Phase A: API key compatibility (khong can bang) ----------
    // A1. PK duoc chap nhan khi KHONG gui Bearer (key moi).
    //     Gateway tra 401 "Invalid API key" <-> key sai; PGRST205/200/403 = key OK.
    const pkProbe = await anonRest(ctx, "GET", "/rest/v1/mangas?select=id&limit=1");
    if (pkProbe.status === 401 || pkProbe.text.includes("Invalid API key")) {
      throw new VerifyError(
        `Publishable key KHONG hop le (GET /rest/v1/mangas -> ${pkProbe.status}) — moi ket qua saudeu vo nghia. Sua NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.`,
        2
      );
    }
    check(ctx, "A1. Publishable key duoc chap nhan KHONG can Bearer (gateway khong tra 401)", true, `status=${pkProbe.status}`);

    // A2. SK duoc chap nhan khi KHONG gui Bearer.
    const skProbe = await serviceRest(ctx, "GET", "/rest/v1/mangas?select=id&limit=1");
    if (skProbe.status === 401 || skProbe.text.includes("Invalid API key")) {
      throw new VerifyError(
        `Secret key KHONG hop le (GET /rest/v1/mangas -> ${skProbe.status}) — sua SUPABASE_SERVICE_SECRET_KEY.`,
        2
      );
    }
    check(ctx, "A2. Secret key duoc chap nhan KHONG can Bearer (gateway khong tra 401)", true, `status=${skProbe.status}`);

    // A3. SK duoc nhan dien DAC QUYEN qua co che apikey (admin API can service_role).
    const adminProbe = await fetchT(ctx, `${env.SB_URL}/auth/v1/admin/users?per_page=1`, {
      headers: supabaseServiceHeaders(env.SK),
    });
    const adminOk = adminProbe.status === 200;
    check(ctx, "A3. Secret key duoc nhan dien dac quyen (GET /auth/v1/admin/users -> 200, chi apikey)", adminOk, `status=${adminProbe.status}`);
    if (!adminOk) {
      throw new VerifyError(
        `Secret key KHONG duoc nhan dien la service role (admin API -> ${adminProbe.status}) — kiem tra SUPABASE_SERVICE_SECRET_KEY la key sb_secret_ dung.`,
        1
      );
    }

    // A4. API key SAI bi tu choi (chung minh gateway co xac thuc key).
    const badKey = await call(ctx, "GET", "/rest/v1/mangas?select=id&limit=1", { apikey: "sb_publishable_INVALIDKEY0000000000" });
    check(
      ctx,
      "A4. API key SAI bi gateway tu choi (401)",
      badKey.status === 401,
      `status=${badKey.status} body=${badKey.text.slice(0, 60)}`
    );

    // A5. User JWT SAI bi tu choi — ca GoTrue lan PostgREST.
    const GARBAGE_JWT = "eyJhbGciOiJIUzI1NiJ9.garbage-payload.sig";
    const badJwtGoTrue = await fetchT(ctx, `${env.SB_URL}/auth/v1/user`, {
      headers: supabaseUserHeaders(env.PK, GARBAGE_JWT),
    });
    check(
      ctx,
      "A5a. User JWT SAI bi GoTrue tu choi (401/403)",
      badJwtGoTrue.status === 401 || badJwtGoTrue.status === 403,
      `status=${badJwtGoTrue.status}`
    );
    const badJwtPgrst = await userRest(ctx, "GET", "/rest/v1/mangas?select=id&limit=1", GARBAGE_JWT);
    check(
      ctx,
      "A5b. User JWT SAI bi PostgREST tu choi (401/403)",
      badJwtPgrst.status === 401 || badJwtPgrst.status === 403,
      `status=${badJwtPgrst.status}`
    );
    console.log("");

    // ---------- Phase B: bang du lieu ton tai (BLOCKED som neu chua migration) ----------
    const requiredTables = ["mangas", "storage_objects", "app_config", "profiles"];
    for (const table of requiredTables) {
      const svc = await serviceRest(ctx, "GET", `/rest/v1/${table}?select=*&limit=1`);
      if (svc.status === 404 || svc.text.includes("PGRST205")) {
        throw new VerifyError(
          `Bang \`${table}\` CHUA TON TAI (PGRST205) — migration chua duoc ap dung.\n` +
            `   Hay chay supabase/migrations/0001_init.sql trong Supabase Dashboard > SQL Editor TRUOC khi verify RLS.\n` +
            `   (RLS KHONG duoc danh gia tren bang khong ton tai; ket qua Phase A o tren van hop le.)`,
          2
        );
      }
      if (svc.status !== 200) {
        throw new VerifyError(
          `Khong doc duoc bang \`${table}\` bang service key (status=${svc.status}) — kiem tra quyen service key / cau hinh PostgREST.`,
          1
        );
      }
      check(ctx, `B.  Bang \`${table}\` ton tai (service key doc duoc)`, true);
    }
    console.log("");

    // ---------- Phase C1: tao user Supabase tam (non-admin) ----------
    const createdRes = await fetchT(ctx, `${env.SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { ...supabaseServiceHeaders(env.SK), "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
    });
    if (!createdRes.ok) {
      throw new VerifyError(
        `Khong tao duoc user Supabase tam: ${createdRes.status} ${(await createdRes.text().catch(() => "")).slice(0, 120)}`,
        1
      );
    }
    const createdBody = (await createdRes.json()) as { id: string };
    ctx.created.tempUserId = createdBody.id;

    // ---------- Phase C2: password grant (PK apikey-only voi key moi) ----------
    const grantRes = await fetchT(ctx, `${env.SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { ...supabaseAnonHeaders(env.PK), "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (!grantRes.ok) {
      throw new VerifyError(
        `Password grant that bai (${grantRes.status}) — KHONG the tao session non-admin that de kiem tra RLS.`,
        1
      );
    }
    const session = (await grantRes.json()) as { access_token: string };
    const AT = session.access_token; // access token THAT — chi dung lam Bearer

    // ---------- Phase C3: chung minh session non-admin HOP LE ----------
    const whoamiRes = await fetchT(ctx, `${env.SB_URL}/auth/v1/user`, {
      headers: supabaseUserHeaders(env.PK, AT),
    });
    if (whoamiRes.status !== 200) {
      throw new VerifyError(
        `Session non-admin KHONG hop le (GET /auth/v1/user -> ${whoamiRes.status}) — moi ket qua 401 phia duoi la do token, KHONG phai RLS. Sua session truoc khi verify.`,
        1
      );
    }
    const whoamiBody = (await whoamiRes.json()) as { email?: string };
    check(
      ctx,
      "C3. Session non-admin THAT hop le (PK + Bearer access token -> /auth/v1/user 200)",
      whoamiBody.email === TEST_EMAIL,
      `email=${whoamiBody.email}`
    );

    // ---------- Phase C4: seed 1 dong manga test QUA SERVICE KEY ----------
    // (vua la kiem tra doc/ghi service key = duong dan migration dung, vua lam
    //  mau cho cac thu UPDATE/DELETE; se xoa sach o cleanup.)
    const seedManga = await serviceRest(ctx, "POST", "/rest/v1/mangas", [
      { id: TEST_MANGA_ID, title: TEST_MANGA_TITLE },
    ]);
    if (seedManga.status !== 200 && seedManga.status !== 201) {
      throw new VerifyError(
        `Khong tao duoc dong manga test qua service key (write): ${seedManga.status} ${seedManga.text.slice(0, 120)}`,
        1
      );
    }
    ctx.created.seededMangaId = TEST_MANGA_ID;
    const readBack = await serviceRest(ctx, "GET", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}&select=id,title`);
    const readOk = readBack.status === 200 && readBack.text.includes(TEST_MANGA_ID);
    check(
      ctx,
      "C4. Service key DOC/CHI duoc qua PostgREST (write + read back — duong dan migration)",
      readOk,
      `status=${readBack.status}`
    );
    console.log("");

    // ---------- Phase C5: anon (publishable key) ----------
    const anonSelect = await anonRest(ctx, "GET", "/rest/v1/mangas?select=id&limit=1");
    if (anonSelect.status === 401) {
      throw new VerifyError(
        `Anon SELECT bi 401 (LOI GATEWAY/API KEY — khong phai bang chung RLS): ${anonSelect.text.slice(0, 80)}`,
        1
      );
    }
    check(ctx, "C5a. Anon KHONG doc duoc mangas (RLS loc het / 403)", isReadDenied(anonSelect), `status=${anonSelect.status}`);

    const anonInsertId = randomUUID();
    ctx.created.attemptedMangaIds.push(anonInsertId);
    const anonInsert = await anonRest(ctx, "POST", "/rest/v1/mangas", [
      { id: anonInsertId, title: "[RLS-VERIFY] anon insert — phai bi chan" },
    ]);
    check(ctx, "C5b. Anon KHONG ghi duoc mangas", isWriteDenied(anonInsert), `status=${anonInsert.status}`);
    console.log("");

    // ---------- Phase C6: non-admin (PK + Bearer access token THAT) ----------
    const naSelect = await userRest(ctx, "GET", "/rest/v1/mangas?select=id&limit=1", AT);
    if (naSelect.status === 401) {
      throw new VerifyError(
        `Non-admin SELECT bi 401 (TOKEN/API KEY loi — khong phai bang chung RLS): ${naSelect.text.slice(0, 80)}`,
        1
      );
    }
    check(ctx, "C6a. Non-admin KHONG doc duoc mangas (RLS admin-only loc het)", isReadDenied(naSelect), `status=${naSelect.status} body=${naSelect.text.slice(0, 80)}`);

    const naInsertId = randomUUID();
    ctx.created.attemptedMangaIds.push(naInsertId);
    const naInsert = await userRest(ctx, "POST", "/rest/v1/mangas", AT, [
      { id: naInsertId, title: "[RLS-VERIFY] nonadmin insert — phai bi chan" },
    ]);
    check(ctx, "C6b. Non-admin KHONG ghi duoc mangas", isWriteDenied(naInsert), `status=${naInsert.status}`);

    // C6c. UPDATE danh vao dong test (phai anh huong 0 row + du lieu nguyen ven)
    const naUpdate = await userRest(ctx, "PATCH", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}`, AT, {
      title: "[RLS-VERIFY] HACKED — KHONG duoc phep",
    });
    let updateDenied = isWriteDenied(naUpdate);
    const afterUpdate = await serviceRest(ctx, "GET", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}&select=title`);
    const rowAfterUpdate = (JSON.parse(afterUpdate.text || "[]") as Array<{ title: string }>)[0];
    if (!rowAfterUpdate || rowAfterUpdate.title !== TEST_MANGA_TITLE) updateDenied = false;
    check(
      ctx,
      "C6c. Non-admin KHONG update duoc dong mangas (0 row anh huong + du lieu nguyen ven)",
      updateDenied,
      `status=${naUpdate.status} titleCon=${rowAfterUpdate?.title?.slice(0, 30)}`
    );

    // C6d. DELETE danh vao dong test (phai anh huong 0 row + dong con nguyen)
    const naDelete = await userRest(ctx, "DELETE", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}`, AT);
    let deleteDenied = isWriteDenied(naDelete);
    const afterDelete = await serviceRest(ctx, "GET", `/rest/v1/mangas?id=eq.${TEST_MANGA_ID}&select=id`);
    const rowsAfterDelete = JSON.parse(afterDelete.text || "[]") as Array<{ id: string }>;
    if (rowsAfterDelete.length !== 1) deleteDenied = false;
    check(
      ctx,
      "C6d. Non-admin KHONG delete duoc dong mangas (0 row anh huong + dong con nguyen)",
      deleteDenied,
      `status=${naDelete.status} rows=${rowsAfterDelete.length}`
    );

    // ---------- Phase C7: bang nhay cam khac ----------
    const naStorage = await userRest(ctx, "GET", "/rest/v1/storage_objects?select=id&limit=1", AT);
    check(ctx, "C7a. Non-admin KHONG doc duoc storage_objects", isReadDenied(naStorage), `status=${naStorage.status}`);

    const naConfig = await userRest(ctx, "GET", "/rest/v1/app_config?select=*&limit=1", AT);
    check(ctx, "C7b. Non-admin KHONG doc duoc app_config", isReadDenied(naConfig), `status=${naConfig.status}`);

    ctx.created.attemptedConfigKeys.push("rls-verify-evil");
    const naConfigWrite = await userRest(ctx, "POST", "/rest/v1/app_config", AT, [
      { key: "rls-verify-evil", value: "00000000-0000-0000-0000-000000000000" },
    ]);
    check(ctx, "C7c. Non-admin KHONG ghi duoc app_config", isWriteDenied(naConfigWrite), `status=${naConfigWrite.status}`);
  } catch (err) {
    if (err instanceof VerifyError) {
      if (err.exitCode === 2) {
        blockedMessage = err.message;
      } else {
        console.error(`FAIL  ${err.message}`);
        ctx.failures += 1;
      }
    } else {
      // Loi mang/timeout/ngoai le — cleanup van chay; bao la FAIL (khong phai BLOCKED,
      // tru khi chua tao tai nguyen nao va loi la mang).
      console.error("VERIFY RLS GAP LOI:", err instanceof Error ? err.message : err);
      ctx.failures += 1;
    }
  } finally {
    // LUON DON DEP truoc khi tra exit code — khong bao gio process.exit o trong nay.
    cleanupOk = await cleanup(ctx);
  }

  console.log("");
  if (!cleanupOk) {
    console.error("KET QUA: CLEANUP LOI — coi nhu FAIL (kiem tra tai nguyen tam con sot lai o tren).");
    return 1;
  }
  if (blockedMessage !== null) {
    console.error("KET QUA: BLOCKED — chua the kiem tra RLS:");
    console.error(blockedMessage);
    return 2;
  }
  if (ctx.failures > 0) {
    console.error(`KET QUA: ${ctx.failures} check FAIL — kiem tra lai migration RLS.`);
    return 1;
  }
  console.log("KET QUA: TAT CA CHECK PASS (API key compatibility + RLS tren session non-admin that + bang ton tai).");
  return 0;
}

// Chi chay truc tiep khi thuc thi file (bun run scripts/verify-rls.ts);
// khi duoc import (unit test) thi KHONG tu chay.
if (import.meta.main) {
  runVerification()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error("VERIFY RLS THAT BAI:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
