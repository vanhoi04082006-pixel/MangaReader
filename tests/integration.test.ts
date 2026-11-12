// =============================================================
// Integration tests — chay voi: bun test tests/integration.test.ts
// CAN: dev server dang chay tai localhost:3000 + .env hop le
// (Supabase that + R2 that + SQLite dev DB).
//
// Test bao gom: auth (dung/sai/non-admin/second-user), CSRF,
// upload roundtrip that (presign -> R2 PUT -> finalize co HeadObject
// verify -> delete), proxy limits, abort safety, logout revocation,
// rate limit. KHONG anh huong du lieu that (tao + xoa du lieu test
// rieng; user Supabase tam bi tao roi xoa).
//
// LUU Y: test rate limit (o cuoi) se khoa login tu IP nay 15 phut.
// =============================================================

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";

// ---- Doc .env ----
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(".env", "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    // fallthrough — dung process.env
  }
  return env;
}
const ENV = { ...loadEnv(), ...process.env } as Record<string, string>;
const ADMIN_EMAIL = ENV.ADMIN_EMAIL ?? "admin@manga.vn";
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD ?? "";
const SUPABASE_URL = (ENV.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_PK = ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SUPABASE_SK = ENV.SUPABASE_SERVICE_SECRET_KEY ?? "";

// ---- Cookie jar ----
class CookieJar {
  jar = new Map<string, string>();
  absorb(res: Response) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  header(): string {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const ORIGIN = "http://localhost:3000"; // same-origin hop le

async function api(
  method: string,
  path: string,
  opts: { json?: unknown; cookies?: CookieJar; origin?: string | null; bearer?: string; body?: BodyInit; headers?: Record<string, string> } = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  if (opts.cookies && opts.cookies.header()) headers["cookie"] = opts.cookies.header();
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;
  if (opts.origin !== undefined) {
    if (opts.origin !== null) headers["origin"] = opts.origin;
    // origin === null -> khong gui header Origin (xoa mac dinh cua fetch)
  } else {
    headers["origin"] = ORIGIN; // mac dinh gui Origin same-origin
  }
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });
}

// ---- Du lieu dung chung ----
const jar = new CookieJar();
// 1x1 JPEG that (134 byte)
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k=",
  "base64"
);

const TEST_EMAIL = `mangareader-rls-test+${Date.now()}@example.com`;
const TEST_PASSWORD = "TestPassword!2026";
let secondUserId: string | null = null;
let createdMangaId: string | null = null;

beforeAll(async () => {
  if (!ADMIN_PASSWORD) throw new Error("Thiếu ADMIN_PASSWORD trong .env — khong the chay integration test");
  if (!SUPABASE_SK) throw new Error("Thiếu SUPABASE_SERVICE_SECRET_KEY — khong the test second user");

  // Reset bang rate limit (chi SQLite dev) de test lap lai duoc — khong anh huong du lieu
  if ((ENV.DATABASE_URL ?? "").startsWith("file:")) {
    try {
      const { Database } = await import("bun:sqlite");
      const dbPath = (ENV.DATABASE_URL ?? "").replace(/^file:/, "");
      const sqlite = new Database(dbPath);
      sqlite.run('DELETE FROM "RateLimitHit"');
      sqlite.close();
      console.log("[test] Rate limit table cleared (SQLite dev)");
    } catch (err) {
      console.warn("[test] Khong xoa duoc rate limit table:", (err as Error).message);
    }
  }
});

afterAll(async () => {
  // Don dep: xoa user Supabase tam + manga test (neu con)
  try {
    if (secondUserId) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${secondUserId}`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_SK, Authorization: `Bearer ${SUPABASE_SK}` },
      });
    }
  } catch {
    /* best effort */
  }
  try {
    if (createdMangaId) {
      const cookies = new CookieJar();
      // (da logout — dung bearer cua admin? don gian nhat: login lai. Nhung rate limit co the da burn.
      //  Thay vao do xoa truc tiep trong DB qua API da co cookie cu — neu fail thi bo qua.)
      await api("DELETE", `/api/mangas/${createdMangaId}`, { cookies: jar });
    }
  } catch {
    /* best effort */
  }
});

// =============================================================
describe("1. Public health & unauthenticated access", () => {
  test("GET /api/health public -> 200, KHONG lo thong tin nhay cam", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.checks).toBeUndefined(); // khong hien checks DB/R2 cong khai
    expect(body.missingEnv).toBeUndefined(); // khong hien danh sach bien
    expect(body.provider).toBeUndefined(); // khong hien provider
    expect(body.r2Bucket).toBeUndefined();
  });

  test("GET /api/mangas khong dang nhap -> 401", async () => {
    const res = await api("GET", "/api/mangas", { origin: null });
    expect(res.status).toBe(401);
  });

  test("GET /api/health/ready khong dang nhap -> 401 (chi admin)", async () => {
    const res = await api("GET", "/api/health/ready", { origin: null });
    expect(res.status).toBe(401);
  });

  test("GET /api/dashboard khong dang nhap -> 401", async () => {
    const res = await api("GET", "/api/dashboard", { origin: null });
    expect(res.status).toBe(401);
  });
});

// =============================================================
describe("2. Login that bai / non-admin", () => {
  test("sai mat khau -> 401 invalid_credentials", async () => {
    const res = await api("POST", "/api/auth/login", {
      json: { email: ADMIN_EMAIL, password: "SaiMatKhau!123" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("invalid_credentials");
  });

  test("email khong phai admin -> 403 forbidden_account", async () => {
    const res = await api("POST", "/api/auth/login", {
      json: { email: "randomuser@example.com", password: "Whatever!123" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("forbidden_account");
  });

  test("email khong hop le -> 400 validation", async () => {
    const res = await api("POST", "/api/auth/login", {
      json: { email: "khong-hop-le", password: "x" },
    });
    expect(res.status).toBe(400);
  });
});

// =============================================================
describe("3. Login admin chinh xac", () => {
  test("login admin -> 200 + cookie httpOnly", async () => {
    const res = await api("POST", "/api/auth/login", {
      json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status).toBe(200);
    jar.absorb(res);
    const body = (await res.json()) as { user?: { email?: string }; provider?: string };
    expect(body.user?.email).toBe(ADMIN_EMAIL);

    // Cookie phai la httpOnly
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const atCookie = setCookies.find((c) => c.startsWith("tsundoku_at="));
    expect(atCookie).toBeDefined();
    expect(atCookie).toContain("HttpOnly");
    expect(atCookie).toContain("Path=/");
  });

  test("GET /api/auth/me -> 200, isAdmin = true", async () => {
    const res = await api("GET", "/api/auth/me", { cookies: jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isAdmin?: boolean; user?: { email?: string } };
    expect(body.isAdmin).toBe(true);
    expect(body.user?.email).toBe(ADMIN_EMAIL);
  });

  test("GET /api/health/ready voi admin -> 200 + checks chi tiet", async () => {
    const res = await api("GET", "/api/health/ready", { cookies: jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks?: { database?: boolean; r2?: boolean } };
    expect(body.checks?.database).toBe(true);
    expect(body.checks?.r2).toBe(true);
  });

  test("GET /api/mangas -> 200 (co du lieu)", async () => {
    const res = await api("GET", "/api/mangas", { cookies: jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown[]; total?: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });
});

// =============================================================
describe("4. CSRF protection (cookie-authenticated mutations)", () => {
  test("POST voi Origin cross-site -> 403 csrf", async () => {
    const res = await api("POST", "/api/mangas", {
      cookies: jar,
      origin: "https://evil.attacker.example",
      json: { title: "CSRF Test" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("csrf");
  });

  test("POST khong Origin khong Referer (co cookie) -> 403 csrf", async () => {
    const res = await api("POST", "/api/mangas", {
      cookies: jar,
      origin: null,
      json: { title: "CSRF Test 2" },
    });
    expect(res.status).toBe(403);
  });

  test("POST vi Referer cross-site -> 403 csrf", async () => {
    const res = await api("POST", "/api/mangas", {
      cookies: jar,
      origin: null,
      headers: { referer: "https://evil.example.com/attack" },
      json: { title: "CSRF Test 3" },
    });
    expect(res.status).toBe(403);
  });

  test("POST same-origin -> khong bi chan (tao manga test thanh cong)", async () => {
    const res = await api("POST", "/api/mangas", {
      cookies: jar,
      json: { title: "[TEST-AUDIT] Manga tao boi integration test", genres: ["Action"] },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBeDefined();
    createdMangaId = body.id ?? null;
  });
});

// =============================================================
describe("5. Second Supabase user (non-admin) — authorization boundary", () => {
  test("tao user Supabase thu 2 (tam thoi)", async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SUPABASE_SK, Authorization: `Bearer ${SUPABASE_SK}`, "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBeDefined();
    secondUserId = body.id ?? null;
  });

  test("second user login qua APP -> 403 forbidden_account", async () => {
    const res = await api("POST", "/api/auth/login", {
      json: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(403);
  });

  test("second user call API truc tiep bang Bearer token (bypass login) -> 403", async () => {
    // Lay access token truc tiep tu Supabase (session that, khong qua app)
    const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_PK, Authorization: `Bearer ${SUPABASE_PK}`, "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    expect(grant.status).toBe(200);
    const session = (await grant.json()) as { access_token: string; user: { id: string } };

    // Goi cac API bao ve voi token cua non-admin — TAT CA phai 403
    const targets: Array<[string, string]> = [
      ["GET", "/api/mangas"],
      ["GET", "/api/dashboard"],
      ["GET", "/api/storage/stats"],
      ["GET", "/api/storage/audit"],
      ["POST", "/api/uploads/presign"],
      ["POST", "/api/storage/cleanup"],
      ["DELETE", "/api/history"],
    ];
    for (const [method, path] of targets) {
      const res = await api(method, path, { bearer: session.access_token, origin: null, json: method === "POST" ? {} : undefined });
      expect([path, res.status]).toEqual([path, 403]);
    }

    // GET /api/auth/me (identity endpoint) van 200 — nhung isAdmin: false
    const me = await api("GET", "/api/auth/me", { bearer: session.access_token, origin: null });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { isAdmin?: boolean };
    expect(meBody.isAdmin).toBe(false);
  });

  test("xoa user Supabase thu 2 (don dep)", async () => {
    if (!secondUserId) return;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${secondUserId}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_SK, Authorization: `Bearer ${SUPABASE_SK}` },
    });
    expect(res.status).toBe(200);
    secondUserId = null;
  });
});

// =============================================================
describe("6. Upload roundtrip that (presign -> R2 -> finalize verify -> delete)", () => {
  let chapterId = "";
  let objectKey = "";

  test("tao chapter test", async () => {
    const res = await api("POST", `/api/mangas/${createdMangaId}/chapters`, {
      cookies: jar,
      json: { chapterNumber: "test-1", title: "Audit integration test chapter" },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBeDefined();
    chapterId = body.id ?? "";
  });

  test("presign voi kich thuoc khai bao", async () => {
    const res = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: createdMangaId,
        chapterId,
        fileName: "tiny.jpg",
        mimeType: "image/jpeg",
        fileSize: TINY_JPEG.length,
        pageNumber: 1,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { objectKey?: string; uploadUrl?: string };
    expect(body.objectKey).toBeDefined();
    expect(body.uploadUrl).toBeDefined();
    objectKey = body.objectKey ?? "";
  });

  test("presign sai chapter (khong thuoc manga) -> 404", async () => {
    const res = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: createdMangaId,
        chapterId: "00000000-0000-0000-0000-000000000000",
        fileName: "tiny.jpg",
        mimeType: "image/jpeg",
        fileSize: 100,
        pageNumber: 1,
      },
    });
    expect(res.status).toBe(404);
  });

  test("presign qua kich thuoc -> 413/400", async () => {
    const res = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: createdMangaId,
        chapterId,
        fileName: "huge.jpg",
        mimeType: "image/jpeg",
        fileSize: 200 * 1024 * 1024,
        pageNumber: 2,
      },
    });
    expect([413, 400]).toContain(res.status);
  });

  test("PUT truc tiep len R2 bang presigned URL -> 200", async () => {
    // Lay lai presign (URL tu test presign dau tien da duoc dung bien — presign lai)
    const presign = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: createdMangaId,
        chapterId,
        fileName: "tiny.jpg",
        mimeType: "image/jpeg",
        fileSize: TINY_JPEG.length,
        pageNumber: 1,
      },
    });
    expect(presign.status).toBe(200);
    const pBody = (await presign.json()) as { objectKey: string; uploadUrl: string };
    objectKey = pBody.objectKey;

    const put = await fetch(pBody.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: TINY_JPEG,
    });
    expect(put.status).toBe(200);
  });

  test("finalize SAI kich thuoc -> 400 (verify that bai: DB check hoac HeadObject)", async () => {
    const res = await api("POST", `/api/chapters/${chapterId}/pages`, {
      cookies: jar,
      json: {
        pages: [
          {
            objectKey,
            pageNumber: 1,
            fileName: "tiny.jpg",
            mimeType: "image/jpeg",
            fileSize: TINY_JPEG.length + 999, // khai bao SAI
          },
        ],
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    // So khop DB (finalize_invalid) hoac HeadObject (r2_verify_failed) — ca hai deu chan
    expect(["finalize_invalid", "r2_verify_failed"]).toContain(body.code ?? "");
  });

  test("finalize DUNG kich thuoc -> 201", async () => {
    const res = await api("POST", `/api/chapters/${chapterId}/pages`, {
      cookies: jar,
      json: {
        pages: [
          {
            objectKey,
            pageNumber: 1,
            fileName: "tiny.jpg",
            mimeType: "image/jpeg",
            fileSize: TINY_JPEG.length,
          },
        ],
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { pageCount?: number };
    expect(body.pageCount).toBe(1);
  });

  test("finalize voi key CHUA dang ky -> 400 finalize_invalid", async () => {
    const fakeKey = `mangas/${createdMangaId}/chapters/${chapterId}/p9999-fakekey.jpg`;
    const res = await api("POST", `/api/chapters/${chapterId}/pages`, {
      cookies: jar,
      json: {
        pages: [
          {
            objectKey: fakeKey,
            pageNumber: 2,
            fileName: "fake.jpg",
            mimeType: "image/jpeg",
            fileSize: TINY_JPEG.length,
          },
        ],
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("finalize_invalid");
  });

  test("abort object da CONFIRMED -> skipped (khong xoa du lieu thuc)", async () => {
    const res = await api("POST", "/api/uploads/abort", {
      cookies: jar,
      json: { objectKeys: [objectKey] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted?: number; skipped?: string[] };
    expect(body.deleted).toBe(0);
    expect(body.skipped).toContain(objectKey);
  });

  test("reader payload co presigned URL + progress", async () => {
    const res = await api("GET", `/api/chapters/${chapterId}/reader`, { cookies: jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pages?: Array<{ url?: string; pageNumber?: number }>;
      chapter?: { pageCount?: number };
    };
    expect(body.chapter?.pageCount).toBe(1);
    expect(body.pages?.length).toBe(1);
    expect(body.pages?.[0]?.url).toContain("X-Amz-Signature"); // presigned, co han
  });
});

// =============================================================
describe("7. Upload proxy (fallback) — gioi han & toan ven", () => {
  test("proxy tu choi file khai bao > 4MB -> 413 proxy_too_large", async () => {
    // Tao manga+chapter rieng cho test proxy
    const manga = await api("POST", "/api/mangas", {
      cookies: jar,
      json: { title: "[TEST-AUDIT] Proxy limit test" },
    });
    const mBody = (await manga.json()) as { id: string };
    const chapter = await api("POST", `/api/mangas/${mBody.id}/chapters`, {
      cookies: jar,
      json: { chapterNumber: "p1" },
    });
    const cBody = (await chapter.json()) as { id: string };

    const presign = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: mBody.id,
        chapterId: cBody.id,
        fileName: "big.jpg",
        mimeType: "image/jpeg",
        fileSize: 5 * 1024 * 1024, // 5MB > 4MB proxy limit
        pageNumber: 1,
      },
    });
    expect(presign.status).toBe(200);
    const pBody = (await presign.json()) as { objectKey: string };

    const proxy = await api(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent(pBody.objectKey)}&contentType=image%2Fjpeg`,
      { cookies: jar, body: TINY_JPEG, headers: { "content-type": "image/jpeg" } }
    );
    expect(proxy.status).toBe(413);
    const body = (await proxy.json()) as { code?: string };
    expect(body.code).toBe("proxy_too_large");

    // Don dep: abort PENDING + xoa manga test
    await api("POST", "/api/uploads/abort", { cookies: jar, json: { objectKeys: [pBody.objectKey] } });
    await api("DELETE", `/api/mangas/${mBody.id}`, { cookies: jar });
  });

  test("proxy upload dung kich thuoc -> 200 va finalize OK", async () => {
    const manga = await api("POST", "/api/mangas", {
      cookies: jar,
      json: { title: "[TEST-AUDIT] Proxy roundtrip" },
    });
    const mBody = (await manga.json()) as { id: string };
    const chapter = await api("POST", `/api/mangas/${mBody.id}/chapters`, {
      cookies: jar,
      json: { chapterNumber: "p1" },
    });
    const cBody = (await chapter.json()) as { id: string };

    const presign = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: mBody.id,
        chapterId: cBody.id,
        fileName: "tiny.jpg",
        mimeType: "image/jpeg",
        fileSize: TINY_JPEG.length,
        pageNumber: 1,
      },
    });
    const pBody = (await presign.json()) as { objectKey: string };

    const proxy = await api(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent(pBody.objectKey)}&contentType=image%2Fjpeg`,
      { cookies: jar, body: TINY_JPEG, headers: { "content-type": "image/jpeg" } }
    );
    expect(proxy.status).toBe(200);
    const upBody = (await proxy.json()) as { sizeBytes?: number };
    expect(upBody.sizeBytes).toBe(TINY_JPEG.length);

    // finalize (HeadObject verify phai pass)
    const fin = await api("POST", `/api/chapters/${cBody.id}/pages`, {
      cookies: jar,
      json: {
        pages: [
          {
            objectKey: pBody.objectKey,
            pageNumber: 1,
            fileName: "tiny.jpg",
            mimeType: "image/jpeg",
            fileSize: TINY_JPEG.length,
          },
        ],
      },
    });
    expect(fin.status).toBe(201);

    // Don dep manga test (delete dong bo R2)
    const del = await api("DELETE", `/api/mangas/${mBody.id}`, { cookies: jar });
    expect(del.status).toBe(200);
    const dBody = (await del.json()) as { objectsRemoved?: number };
    expect((dBody.objectsRemoved ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test("proxy upload SAI kich thuoc thuc te -> 400 size_mismatch + object bi xoa", async () => {
    const manga = await api("POST", "/api/mangas", {
      cookies: jar,
      json: { title: "[TEST-AUDIT] Proxy mismatch" },
    });
    const mBody = (await manga.json()) as { id: string };
    const chapter = await api("POST", `/api/mangas/${mBody.id}/chapters`, {
      cookies: jar,
      json: { chapterNumber: "p1" },
    });
    const cBody = (await chapter.json()) as { id: string };

    const presign = await api("POST", "/api/uploads/presign", {
      cookies: jar,
      json: {
        kind: "PAGE",
        mangaId: mBody.id,
        chapterId: cBody.id,
        fileName: "declared.jpg",
        mimeType: "image/jpeg",
        fileSize: 5000, // khai bao 5000B
        pageNumber: 1,
      },
    });
    const pBody = (await presign.json()) as { objectKey: string };

    // Upload thuc te chi 134B != 5000B -> 400
    const proxy = await api(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent(pBody.objectKey)}&contentType=image%2Fjpeg`,
      { cookies: jar, body: TINY_JPEG, headers: { "content-type": "image/jpeg" } }
    );
    expect(proxy.status).toBe(400);
    const body = (await proxy.json()) as { code?: string };
    expect(body.code).toBe("size_mismatch");

    await api("POST", "/api/uploads/abort", { cookies: jar, json: { objectKeys: [pBody.objectKey] } });
    await api("DELETE", `/api/mangas/${mBody.id}`, { cookies: jar });
  });

  test("proxy tu choi key chua dang ky -> 400 unregistered_key", async () => {
    const proxy = await api(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent("mangas/fake/chapters/fake/p0001-x.jpg")}&contentType=image%2Fjpeg`,
      { cookies: jar, body: TINY_JPEG, headers: { "content-type": "image/jpeg" } }
    );
    expect(proxy.status).toBe(400);
    const body = (await proxy.json()) as { code?: string };
    expect(body.code).toBe("unregistered_key");
  });

  test("proxy tu choi Content-Type khong phai anh -> 400 bad_mime", async () => {
    const proxy = await api(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent("mangas/fake/chapters/fake/p0001-x.jpg")}&contentType=application%2Foctet-stream`,
      { cookies: jar, body: TINY_JPEG, headers: { "content-type": "application/octet-stream" } }
    );
    expect(proxy.status).toBe(400);
    const body = (await proxy.json()) as { code?: string };
    expect(body.code).toBe("bad_mime");
  });
});

// =============================================================
describe("8. Logout & session revocation", () => {
  test("logout -> 200 + cookie cleared", async () => {
    // Lay access token hien tai tu jar de kiem tra revoke sau nay
    const accessToken = jar.jar.get("tsundoku_at") ?? "";
    expect(accessToken.length).toBeGreaterThan(20);

    const res = await api("POST", "/api/auth/logout", { cookies: jar });
    expect(res.status).toBe(200);
    jar.absorb(res);
    expect(jar.jar.has("tsundoku_at")).toBe(false); // cookie da bi xoa

    // Cookie session da xoa -> request sau do 401
    const after = await api("GET", "/api/mangas", { cookies: jar, origin: null });
    expect(after.status).toBe(401);

    // Access token CU (da revoke o Supabase) cung phai tu choi khi dung Bearer
    const bearer = await api("GET", "/api/mangas", { bearer: accessToken, origin: null });
    expect(bearer.status).toBe(401);
  });
});

// =============================================================
describe("9. Rate limit login (chay CUOI — khoa IP 15 phut)", () => {
  test("brute force -> 429 rate_limited", async () => {
    let got429 = false;
    // Gioi han: 10 lan / 15 phut / IP. Cac test truoc da dung ~5 lan.
    // Burn them toi da 10 lan nua — phai gap 429.
    for (let i = 0; i < 10; i++) {
      const res = await api("POST", "/api/auth/login", {
        json: { email: `burn-${i}@example.com`, password: "SaiMatKhau!999" },
      });
      if (res.status === 429) {
        got429 = true;
        const body = (await res.json()) as { code?: string };
        expect(body.code).toBe("rate_limited");
        break;
      }
      expect([403, 401, 429]).toContain(res.status);
    }
    expect(got429).toBe(true);
  });
});

// =============================================================
describe("10. Don dep du lieu test", () => {
  test("xoa manga test chinh", async () => {
    if (!createdMangaId) return;
    // Login lai (rate limit co the chan — neu bi chan thi dung DB truc tiep khong duoc
    // tu test; thay vao do cho 429 va danh dau cleanup = pending)
    const login = await api("POST", "/api/auth/login", {
      json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (login.status === 429) {
      console.warn("Rate limit con khoa IP — manga test se bi xoa boi cleanup pending (24h).");
      return;
    }
    jar.absorb(login);
    const res = await api("DELETE", `/api/mangas/${createdMangaId}`, { cookies: jar });
    expect(res.status).toBe(200);
    createdMangaId = null;
    // Logout lai
    await api("POST", "/api/auth/logout", { cookies: jar });
  });
});
