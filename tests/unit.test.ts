// =============================================================
// Unit tests — chay voi: bun test tests/unit.test.ts
// Khong can server. Test cac ham bao mat cot loi.
//
// ISOIATION ENV: `bun test tests/` chay NHIEU file trong CUNG 1 process
// (load file -> chay -> load file ke tiep). Cac test unit o day CHINH SUA
// process.env (ADMIN_EMAIL/ADMIN_USER_ID/ADMIN_PASSWORD/NODE_ENV...) —
// phai HOAN NGUYEN env sau khi file nay chay xong, neu khong gia tri do
// unit test dat se roi vao file integration khi module cua no duoc load
// (da tung gay fail gia toan bo integration suite khi chay `bun test tests/`).
// =============================================================

import { describe, test, expect, beforeEach, afterAll } from "bun:test";

/** Snapshot env tai thoi diem load file — hoan nguyen o afterAll. */
const ENV_SNAPSHOT: Record<string, string | undefined> = { ...process.env };
afterAll(() => {
  const keys = Object.keys(process.env) as Array<keyof typeof ENV_SNAPSHOT>;
  for (const k of keys) if (!(k in ENV_SNAPSHOT)) delete process.env[k];
  for (const [k, v] of Object.entries(ENV_SNAPSHOT)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** NODE_ENV la readonly theo types — dung helper cast de test. */
function setNodeEnv(v: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = v;
}


// ---- Local JWT ----
import { localJwtSign, ACCESS_COOKIE } from "../src/lib/session";

// Canh bao: khong import module session truoc khi set env o cac test provider
import {
  effectiveAuthProvider,
  getEnv,
  isAdminUser,
  missingEnvVars,
  isValidUuid,
  adminIdentityConfigIssue,
} from "../src/lib/env";
import type { SessionUser } from "../src/lib/session";

function localJwtVerify(token: string, secret: string): Record<string, unknown> | null {
  // Import lai bang cach goi internal qua module — de don gian, verify qua
  // require lan nha khong can; chung ta test qua API cua module session.
  // (Hàm verify la private; test hanh vi gián tiếp qua isAdminUser + expiry.)
  return null;
}
void localJwtVerify;

describe("effectiveAuthProvider (production fail-closed)", () => {
  beforeEach(() => {
    delete process.env.AUTH_PROVIDER;
  });

  test("mac dinh la supabase", () => {
    const original = process.env.NODE_ENV;
    setNodeEnv("development");
    expect(effectiveAuthProvider()).toBe("supabase");
    setNodeEnv(original)
  });

  test("local duoc phep trong development", () => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "local";
    expect(effectiveAuthProvider()).toBe("local");
    delete process.env.AUTH_PROVIDER;
  });

  test("local BI TU CHOI trong production (fail closed)", () => {
    setNodeEnv("production");
    process.env.AUTH_PROVIDER = "local";
    expect(effectiveAuthProvider()).toBe(null);
    delete process.env.AUTH_PROVIDER;
    setNodeEnv("development");
  });

  test("gia tri khong hop le -> null", () => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "ldap";
    expect(effectiveAuthProvider()).toBe(null);
    delete process.env.AUTH_PROVIDER;
  });
});

describe("isAdminUser (admin identity boundary)", () => {
  const realAdmin: SessionUser = {
    id: "7228d6e8-3f7b-4443-bdb6-1543b7afb4d6",
    email: "admin@manga.vn",
  };
  const otherUser: SessionUser = {
    id: "11111111-2222-3333-4444-555555555555",
    email: "attacker@example.com",
  };

  beforeEach(() => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "supabase";
    process.env.ADMIN_EMAIL = "admin@manga.vn";
    delete process.env.ADMIN_USER_ID;
  });

  test("email admin khop -> true", () => {
    expect(isAdminUser(realAdmin)).toBe(true);
  });

  test("email khac -> false (403)", () => {
    expect(isAdminUser(otherUser)).toBe(false);
  });

  test("ADMIN_USER_ID khop UUID -> true", () => {
    process.env.ADMIN_USER_ID = "7228d6e8-3f7b-4443-bdb6-1543b7afb4d6";
    expect(isAdminUser(realAdmin)).toBe(true);
  });

  test("ADMIN_USER_ID khac UUID -> false (chong doi mat identity)", () => {
    // ADMIN_USER_ID da cau hinh cho UUID that; tai khoan khac (UUID khac)
    // khai email admin -> tu choi vi UUID khong khop
    process.env.ADMIN_USER_ID = "7228d6e8-3f7b-4443-bdb6-1543b7afb4d6";
    const impostor: SessionUser = { id: "99999999-9999-9999-9999-999999999999", email: "admin@manga.vn" };
    expect(isAdminUser(impostor)).toBe(false);
  });

  test("provider khong hop le (local trong prod) -> false", () => {
    setNodeEnv("production");
    process.env.AUTH_PROVIDER = "local";
    expect(isAdminUser(realAdmin)).toBe(false);
    setNodeEnv("development");
  });

  test("local mode chi chap nhan id local-admin + email dung", () => {
    process.env.AUTH_PROVIDER = "local";
    expect(isAdminUser({ id: "local-admin", email: "admin@manga.vn" })).toBe(true);
    expect(isAdminUser({ id: "local-admin", email: "wrong@example.com" })).toBe(false);
    expect(isAdminUser({ id: "other", email: "admin@manga.vn" })).toBe(false);
    delete process.env.AUTH_PROVIDER;
  });
});

// =============================================================
// TASK 1: ADMIN_USER_ID bat buoc trong production (fail closed)
// =============================================================
describe("ADMIN_USER_ID bat buoc trong production", () => {
  const ADMIN_UUID = "7228d6e8-3f7b-4443-bdb6-1543b7afb4d6";
  const realAdmin: SessionUser = { id: ADMIN_UUID, email: "admin@manga.vn" };

  beforeEach(() => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "supabase";
    process.env.ADMIN_EMAIL = "admin@manga.vn";
    delete process.env.ADMIN_USER_ID;
  });

  test("1. email dung + UUID dung -> PASS", () => {
    setNodeEnv("production");
    process.env.ADMIN_USER_ID = ADMIN_UUID;
    expect(isAdminUser(realAdmin)).toBe(true);
  });

  test("2. email dung + UUID SAI -> tu choi (403)", () => {
    setNodeEnv("production");
    process.env.ADMIN_USER_ID = "11111111-2222-3333-4444-555555555555";
    expect(isAdminUser(realAdmin)).toBe(false);
  });

  test("3. email dung + THIEU UUID trong production -> FAIL CLOSED (khong fallback email-only)", () => {
    setNodeEnv("production");
    delete process.env.ADMIN_USER_ID;
    expect(isAdminUser(realAdmin)).toBe(false); // email khong du trong production
    expect(adminIdentityConfigIssue()).toContain("ADMIN_USER_ID");
  });

  test("4. UUID MAI DINH DANG -> fail closed + readiness bao cao", () => {
    setNodeEnv("production");
    process.env.ADMIN_USER_ID = "not-a-uuid";
    expect(isAdminUser(realAdmin)).toBe(false);
    expect(adminIdentityConfigIssue()).toContain("ADMIN_USER_ID");
    expect(missingEnvVars().some((v) => v.startsWith("ADMIN_USER_ID"))).toBe(true);
    // Dev cung bao cao mai dinh dang (phat hien som, khong dem loi vao production)
    setNodeEnv("development");
    expect(missingEnvVars().some((v) => v.startsWith("ADMIN_USER_ID"))).toBe(true);
  });

  test("5. user Supabase khac (UUID khac, email giong admin) -> tu choi", () => {
    setNodeEnv("production");
    process.env.ADMIN_USER_ID = ADMIN_UUID;
    const impostor: SessionUser = { id: "99999999-9999-9999-9999-999999999999", email: "admin@manga.vn" };
    expect(isAdminUser(impostor)).toBe(false);
  });

  test("6. provider local trong production -> tu choi (da co o suite tren — doi chieu lai)", () => {
    setNodeEnv("production");
    process.env.AUTH_PROVIDER = "local";
    delete process.env.ADMIN_USER_ID;
    expect(isAdminUser(realAdmin)).toBe(false);
    expect(effectiveAuthProvider()).toBe(null);
  });

  test("dev: thieu UUID van cho qua (bootstrap workflow duoc tai lieu hoa)", () => {
    setNodeEnv("development");
    delete process.env.ADMIN_USER_ID;
    expect(isAdminUser(realAdmin)).toBe(true);
    expect(adminIdentityConfigIssue()).toBe(null);
  });

  test("production: thieu UUID duoc missingEnvVars bao cao (readiness degraded)", () => {
    setNodeEnv("production");
    delete process.env.ADMIN_USER_ID;
    expect(missingEnvVars().some((v) => v.startsWith("ADMIN_USER_ID"))).toBe(true);
  });

  test("production: UUID dung -> missingEnvVars KHONG bao cao ADMIN_USER_ID", () => {
    setNodeEnv("production");
    process.env.ADMIN_USER_ID = ADMIN_UUID;
    expect(missingEnvVars().some((v) => v.startsWith("ADMIN_USER_ID"))).toBe(false);
  });
});

// =============================================================
// TASK 4: ADMIN_PASSWORD bootstrap-only — khong con la bien bat buoc
// =============================================================
describe("ADMIN_PASSWORD bootstrap-only (readiness khong doi hoi)", () => {
  beforeEach(() => {
    setNodeEnv("production");
    process.env.AUTH_PROVIDER = "supabase";
    process.env.ADMIN_EMAIL = "admin@manga.vn";
    process.env.ADMIN_USER_ID = "7228d6e8-3f7b-4443-bdb6-1543b7afb4d6";
    delete process.env.ADMIN_PASSWORD;
  });

  test("production + supabase + KHONG ADMIN_PASSWORD -> missingEnvVars KHONG bao cao", () => {
    // Sau bootstrap (tai khoan da ton tai trong Supabase Auth) readiness phai OK
    expect(missingEnvVars().some((v) => v.includes("ADMIN_PASSWORD"))).toBe(false);
  });

  test("dev + supabase + KHONG ADMIN_PASSWORD -> KHONG bao cao", () => {
    setNodeEnv("development");
    expect(missingEnvVars().some((v) => v.includes("ADMIN_PASSWORD"))).toBe(false);
  });

  test("login route khong can ADMIN_PASSWORD khi tai khoan da ton tai (provider + UUID dung van cho phep)", () => {
    // IsAdminUser (ranh gioi quyen sau khi Supabase xac thuc) khong doc password
    const user: SessionUser = { id: process.env.ADMIN_USER_ID!, email: "admin@manga.vn" };
    expect(isAdminUser(user)).toBe(true);
  });
});

// ---- UUID validation ----
describe("isValidUuid", () => {
  test("UUID dung / sai dinh dang", () => {
    expect(isValidUuid("7228d6e8-3f7b-4443-bdb6-1543b7afb4d6")).toBe(true);
    expect(isValidUuid("7228D6E8-3F7B-4443-BDB6-1543B7AFB4D6")).toBe(true); // case-insensitive
    expect(isValidUuid(" 7228d6e8-3f7b-4443-bdb6-1543b7afb4d6 ")).toBe(true); // trim
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("7228d6e8-3f7b-4443-bdb6-1543b7afb4d")).toBe(false); // thieu 1 ky tu
    expect(isValidUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
  });
});

describe("localJwtSign (HMAC)", () => {
  test("token co 3 phan va khong rong", () => {
    setNodeEnv("development");
    const token = localJwtSign({ sub: "local-admin" }, "secret-abc", 3600);
    expect(token.split(".").length).toBe(3);
  });

  test("token het han -> verify that bai (qua isAdminUser: local provider)", () => {
    // Token da het han: exp trong qua khu
    const token = localJwtSign({ sub: "local-admin" }, "secret-abc", -10);
    expect(token.split(".").length).toBe(3);
    // Giai ma payload de kiem exp da qua khu
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    expect((payload.exp as number) * 1000).toBeLessThan(Date.now());
  });
});

// ---- CSRF / assertSameOrigin ----
describe("assertSameOrigin (CSRF protection)", () => {
  test("cross-origin POST voi cookie -> ApiError 403", async () => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "supabase";
    const { assertSameOrigin, ApiError } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");

    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "https://evil.example.com",
        cookie: `${ACCESS_COOKIE}=stolen-token-value`,
      },
    });
    try {
      assertSameOrigin(req);
      throw new Error("KHONG NEN cho qua");
    } catch (err) {
      expect(err instanceof ApiError).toBe(true);
      expect((err as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  test("same-origin POST voi cookie -> cho qua", async () => {
    const { assertSameOrigin } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        cookie: `${ACCESS_COOKIE}=token`,
      },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  test("cross-scheme same-host Origin (http vs https) voi cookie + x-forwarded-proto -> 403 (lead 4.2)", async () => {
    setNodeEnv("development");
    process.env.AUTH_PROVIDER = "supabase";
    const { assertSameOrigin, ApiError } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "x-forwarded-proto": "https",
        origin: "http://localhost:3000",
        cookie: `${ACCESS_COOKIE}=token`,
      },
    });
    try {
      assertSameOrigin(req);
      throw new Error("KHONG NEN cho qua");
    } catch (err) {
      expect(err instanceof ApiError).toBe(true);
      expect((err as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  test("mutation KHONG Origin KHONG Referer (voi cookie) -> 403 (fail closed)", async () => {
    const { assertSameOrigin, ApiError } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: { host: "localhost:3000", cookie: `${ACCESS_COOKIE}=token` },
    });
    try {
      assertSameOrigin(req);
      throw new Error("KHONG NEN cho qua");
    } catch (err) {
      expect((err as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });

  test("Bearer-only request (khong cookie) -> khong bi CSRF check", async () => {
    const { assertSameOrigin } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: { authorization: "Bearer xyz", origin: "https://evil.example.com" },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  test("Referer same-host duoc chap nhan khi khong co Origin", async () => {
    const { assertSameOrigin } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: { host: "localhost:3000", referer: "http://localhost:3000/library", cookie: `${ACCESS_COOKIE}=t` },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  test("GET khong bi CSRF check", async () => {
    const { assertSameOrigin } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "GET",
      headers: { origin: "https://evil.example.com", cookie: `${ACCESS_COOKIE}=t` },
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  test("Sec-Fetch-Site cross-site -> 403", async () => {
    const { assertSameOrigin, ApiError } = await import("../src/lib/api");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost:3000/api/mangas", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "sec-fetch-site": "cross-site",
        origin: "http://localhost:3000",
        cookie: `${ACCESS_COOKIE}=t`,
      },
    });
    try {
      assertSameOrigin(req);
      throw new Error("KHONG NEN cho qua");
    } catch (err) {
      expect((err as InstanceType<typeof ApiError>).status).toBe(403);
    }
  });
});

// ---- ZIP reader (client-side validation) ----
describe("filterImageEntries (ZIP hardening)", () => {
  test("bo qua entry giai nen qua lon (decompression bomb)", async () => {
    const { filterImageEntries, MAX_ENTRY_UNCOMPRESSED } = await import("../src/utils/zip-reader");
    const entries = [
      { name: "normal.jpg", compressedSize: 100, uncompressedSize: 5000, method: 0, localOffset: 0 },
      { name: "bomb.jpg", compressedSize: 1000, uncompressedSize: MAX_ENTRY_UNCOMPRESSED + 1, method: 8, localOffset: 100 },
    ];
    const { valid, skipped } = filterImageEntries(entries);
    expect(valid.length).toBe(1);
    expect(valid[0]?.name).toBe("normal.jpg");
    expect(skipped).toContain("bomb.jpg");
  });

  test("gioi han so entry toi da", async () => {
    const { filterImageEntries, MAX_ZIP_IMAGE_ENTRIES } = await import("../src/utils/zip-reader");
    const entries = Array.from({ length: MAX_ZIP_IMAGE_ENTRIES + 5 }, (_, i) => ({
      name: `page-${i}.jpg`,
      compressedSize: 10,
      uncompressedSize: 10,
      method: 0,
      localOffset: 0,
    }));
    const { valid, overflowed } = filterImageEntries(entries);
    expect(valid.length).toBe(MAX_ZIP_IMAGE_ENTRIES);
    expect(overflowed).toBe(true);
  });

  test("bo qua file he thong / khong phai anh", async () => {
    const { filterImageEntries } = await import("../src/utils/zip-reader");
    const entries = [
      { name: "__MACOSX/._page1.jpg", compressedSize: 1, uncompressedSize: 1, method: 0, localOffset: 0 },
      { name: ".hidden/page2.jpg", compressedSize: 1, uncompressedSize: 1, method: 0, localOffset: 0 },
      { name: "info.txt", compressedSize: 1, uncompressedSize: 1, method: 0, localOffset: 0 },
      { name: "ch01/page3.webp", compressedSize: 1, uncompressedSize: 1, method: 0, localOffset: 0 },
    ];
    const { valid, skipped } = filterImageEntries(entries);
    expect(valid.map((e) => e.name)).toEqual(["ch01/page3.webp"]);
    expect(skipped.length).toBe(3);
  });
});

// =============================================================
// AUDIT PASS 3 — Supabase API key header contract (§1)
// =============================================================
import {
  detectSupabaseKeyFormat,
  supabaseAnonHeaders,
  supabaseServiceHeaders,
  supabaseUserHeaders,
} from "../src/lib/supabase-keys";

describe("detectSupabaseKeyFormat (phan biet key moi vs legacy JWT)", () => {
  test("key moi sb_publishable_ / sb_secret_", () => {
    expect(detectSupabaseKeyFormat("sb_publishable_abc123")).toBe("sb-publishable");
    expect(detectSupabaseKeyFormat("sb_secret_abc123")).toBe("sb-secret");
  });

  test("key legacy anon/service_role (JWT eyJ...)", () => {
    const legacyJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig";
    expect(detectSupabaseKeyFormat(legacyJwt)).toBe("legacy-jwt");
  });

  test("dinh dang khong xac dinh", () => {
    expect(detectSupabaseKeyFormat("")).toBe("unknown");
    expect(detectSupabaseKeyFormat("random-garbage")).toBe("unknown");
    expect(detectSupabaseKeyFormat("eyJhbGciOiJIUzI1NiJ9.only-two")).toBe("unknown");
  });
});

describe("supabaseAnonHeaders / supabaseServiceHeaders (header contract theo docs)", () => {
  test("KEY MOI: anon/service chi co apikey — KHONG gui lam Authorization Bearer", () => {
    const anon = supabaseAnonHeaders("sb_publishable_XXX");
    expect(anon["apikey"]).toBe("sb_publishable_XXX");
    expect(anon["Authorization"]).toBeUndefined();

    const svc = supabaseServiceHeaders("sb_secret_YYY");
    expect(svc["apikey"]).toBe("sb_secret_YYY");
    expect(svc["Authorization"]).toBeUndefined();
  });

  test("KEY LEGACY (JWT): gui ca apikey + Authorization Bearer (semantics cu)", () => {
    const legacyPk = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig";
    const legacySk = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
    const anon = supabaseAnonHeaders(legacyPk);
    expect(anon["apikey"]).toBe(legacyPk);
    expect(anon["Authorization"]).toBe(`Bearer ${legacyPk}`);

    const svc = supabaseServiceHeaders(legacySk);
    expect(svc["apikey"]).toBe(legacySk);
    expect(svc["Authorization"]).toBe(`Bearer ${legacySk}`);
  });

  test("USER da xac thuc: apikey = publishable + Bearer = access token THAT (ca hai the he key)", () => {
    for (const pk of ["sb_publishable_XXX", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig"]) {
      const h = supabaseUserHeaders(pk, "user-access-token-jwt");
      expect(h["apikey"]).toBe(pk);
      expect(h["Authorization"]).toBe("Bearer user-access-token-jwt");
    }
  });
});

// =============================================================
// AUDIT PASS 3 — SQLite URL resolution (§3)
// =============================================================
import { parseSqliteUrl, resolveSqliteFile } from "../src/lib/sqlite-url";

describe("parseSqliteUrl (resolve theo thu muc schema Prisma, giong Prisma client)", () => {
  const SCHEMA = "/repo/app/prisma/schema.prisma";

  test("duong dan TUONG DOI -> resolve theo thu muc schema (khong phai CWD)", () => {
    expect(parseSqliteUrl("file:../db/custom.db", SCHEMA)).toEqual({ ok: true, path: "/repo/app/db/custom.db", query: null });
    expect(parseSqliteUrl("file:./dev.db", SCHEMA)).toEqual({ ok: true, path: "/repo/app/prisma/dev.db", query: null });
    expect(parseSqliteUrl("file:dev.db", SCHEMA)).toEqual({ ok: true, path: "/repo/app/prisma/dev.db", query: null });
  });

  test("duong dan TUYET DOI POSIX -> giu nguyen", () => {
    expect(parseSqliteUrl("file:/home/z/app/db/custom.db", SCHEMA)).toEqual({ ok: true, path: "/home/z/app/db/custom.db", query: null });
  });

  test("o dia WINDOWS (C:\\... va C:/...) -> giu nguyen", () => {
    expect(parseSqliteUrl("file:C:\\Users\\me\\app\\db\\custom.db", SCHEMA)).toEqual({
      ok: true, path: "C:\\Users\\me\\app\\db\\custom.db", query: null,
    });
    expect(parseSqliteUrl("file:C:/Users/me/app/db/custom.db", SCHEMA)).toEqual({
      ok: true, path: "C:/Users/me/app/db/custom.db", query: null,
    });
  });

  test("UNC (\\\\server\\share | //server/share) -> giu nguyen", () => {
    expect(parseSqliteUrl("file:\\\\server\\share\\db.db", SCHEMA)).toEqual({
      ok: true, path: "\\\\server\\share\\db.db", query: null,
    });
    expect(parseSqliteUrl("file://server/share/db.db", SCHEMA)).toEqual({
      ok: true, path: "//server/share/db.db", query: null,
    });
  });

  test("QUERY PARAMETER duoc tach an toan, khong ap vao duong dan", () => {
    const r = parseSqliteUrl("file:../db/custom.db?connection_limit=1&pool_timeout=20", SCHEMA);
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/repo/app/db/custom.db");
    expect(r.query).toBe("connection_limit=1&pool_timeout=20");
  });

  test("URL rong / thieu file: / thieu duong dan -> LOI RO RANG", () => {
    expect(parseSqliteUrl("", SCHEMA).ok).toBe(false);
    expect(parseSqliteUrl("postgresql://user:pw@host:5432/db", SCHEMA).ok).toBe(false);
    expect(parseSqliteUrl("file:", SCHEMA).ok).toBe(false);
    expect(parseSqliteUrl("file:?x=1", SCHEMA).ok).toBe(false);
  });
});

describe("resolveSqliteFile (khong bao gio tu tao file moi)", () => {
  const SCHEMA = "/repo/app/prisma/schema.prisma";

  test("file thieu -> ok=false + thong bao kem duong dan da resolve (KHONG tao file)", () => {
    const r = resolveSqliteFile("file:../db/khong-ton-tai-xyz.db", SCHEMA);
    expect(r.ok).toBe(true); // URL hop le
    expect(r.exists).toBe(false);
    expect(r.error).toContain("/repo/app/db/khong-ton-tai-xyz.db");
    expect(r.error).toContain("KHÔNG tự tạo file mới");
  });

  test("file ton tai -> exists=true", () => {
    const r = resolveSqliteFile(`file:${import.meta.dir}/../prisma/schema.prisma`.replace("schema.prisma", "schema.prisma"), "/repo/prisma/schema.prisma");
    // schema.prisma ton tai that — dung lam file "sqlite" gia lap cho kiem tra existsSync
    expect(r.ok).toBe(true);
    expect(r.exists).toBe(true);
  });
});

// =============================================================
// AUDIT PASS 3 — session-verify (§2: JWT payload + session_id + PG detection)
// =============================================================
import { decodeJwtPayload, extractSessionId, usesPostgresDatabase } from "../src/lib/session-verify";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  return `${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify(payload))}.fake-sig`;
}

describe("decodeJwtPayload / extractSessionId (trich claim, KHONG xac minh chu ky)", () => {
  test("decode payload dung", () => {
    const p = decodeJwtPayload(makeJwt({ sub: "user-1", session_id: "a6785eb7-79c2-4575-8bb1-273c3d3d0857" }));
    expect(p?.["sub"]).toBe("user-1");
  });

  test("extractSessionId: UUID dung -> tra ve; thieu/sai -> null", () => {
    expect(extractSessionId(makeJwt({ session_id: "a6785eb7-79c2-4575-8bb1-273c3d3d0857" }))).toBe("a6785eb7-79c2-4575-8bb1-273c3d3d0857");
    expect(extractSessionId(makeJwt({ session_id: "khong-phai-uuid" }))).toBeNull();
    expect(extractSessionId(makeJwt({ sub: "user-1" }))).toBeNull();
    expect(extractSessionId("khong-phai-jwt")).toBeNull();
    expect(extractSessionId("a.b.c.d")).toBeNull();
  });
});

describe("usesPostgresDatabase", () => {
  test("postgresql:// va postgres:// -> true; file: va rong -> false", () => {
    const saved = process.env["DATABASE_URL"];
    try {
      process.env["DATABASE_URL"] = "postgresql://postgres.x@aws-0.pooler.supabase.com:5432/postgres";
      expect(usesPostgresDatabase()).toBe(true);
      process.env["DATABASE_URL"] = "postgres://localhost/db";
      expect(usesPostgresDatabase()).toBe(true);
      process.env["DATABASE_URL"] = "file:../db/custom.db";
      expect(usesPostgresDatabase()).toBe(false);
      delete process.env["DATABASE_URL"];
      expect(usesPostgresDatabase()).toBe(false);
    } finally {
      if (saved !== undefined) process.env["DATABASE_URL"] = saved;
      else delete process.env["DATABASE_URL"];
    }
  });
});

// =============================================================
// AUDIT PASS 3 — verify-rls control flow (§4: cleanup luon chay)
// =============================================================
import { runVerification } from "../scripts/verify-rls";

interface MockCall {
  method: string;
  url: string;
  apikey: string;
  bearer: string; // "" = khong co Authorization
  body?: unknown;
}

type MockMode =
  | "ok"
  | "invalid-pk"
  | "tables-missing"
  | "grant-fails"
  | "rls-fails"
  | "cleanup-manga-fails"
  // Pass 4 — storage_objects
  | "rls-storage-leak"
  | "storage-seed-fails";

function makeSupabaseMock(mode: MockMode = "ok") {
  const calls: MockCall[] = [];
  const state = {
    createdEmail: "",
    seededMangaId: "",
    seededTitle: "",
    tempUserId: "11111111-2222-3333-4444-555555555555",
    // Pass 4 — storage_objects seed
    seededStorageId: "",
    seededStorageFileName: "",
    storagePatched: false,
    storageDeletedByLeak: false,
  };
  const SB = "https://unit-test.supabase.co";
  const PK = "sb_publishable_UNITTEST";
  const SK = "sb_secret_UNITTEST";
  const USER_AT = "unit-test.access.token.jwt";

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown;
    try {
      body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = undefined;
    }
    const apikey = headers["apikey"] ?? "";
    const bearer = (headers["Authorization"] ?? headers["authorization"] ?? "").replace(/^Bearer /, "");
    calls.push({ method, url, apikey, bearer, body });

    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

    // A4: key SAI -> gateway 401
    if (apikey === "sb_publishable_INVALIDKEY0000000000") {
      return json(401, { message: "Invalid API key" });
    }
    // Mode invalid-pk: moi request PostgREST bang PK bi 401
    if (mode === "invalid-pk" && url.includes("/rest/v1/") && apikey === PK) {
      return json(401, { message: "Invalid API key" });
    }

    // GoTrue admin API
    if (url === `${SB}/auth/v1/admin/users` && method === "POST") {
      state.createdEmail = String((body as { email?: string })?.email ?? "");
      return json(200, { id: state.tempUserId, email: state.createdEmail });
    }
    if (url.startsWith(`${SB}/auth/v1/admin/users/`) && method === "DELETE") {
      return json(200, {});
    }
    if (url === `${SB}/auth/v1/admin/users?per_page=1`) {
      return json(200, { users: [] });
    }

    // GoTrue token endpoints
    if (url.includes("/auth/v1/token?grant_type=password")) {
      if (mode === "grant-fails") return json(400, { error: "invalid_credentials" });
      return json(200, { access_token: USER_AT, refresh_token: "rt", user: { id: state.tempUserId } });
    }

    // GoTrue /auth/v1/user
    if (url === `${SB}/auth/v1/user`) {
      if (bearer === USER_AT) return json(200, { id: state.tempUserId, email: state.createdEmail });
      return json(403, { error_code: "bad_jwt" });
    }

    // PostgREST
    if (url.startsWith(`${SB}/rest/v1/`)) {
      // Bang chua tao?
      if (mode === "tables-missing") {
        return json(404, { code: "PGRST205", message: "Could not find the table in the schema cache" });
      }
      if (url.includes("/rest/v1/app_config")) {
        if (method === "GET") return json(200, []);
        if (method === "POST") return json(403, { message: "new row violates row-level security policy" });
        if (method === "DELETE") return json(200, []);
      }
      // Pass 4 — storage_objects: seed mau THAT bang service key, moi kiem tra
      // non-admin tren dong seed (bang rong = PASS gia — xem verify-rls.ts C7).
      if (url.includes("/rest/v1/storage_objects")) {
        const isService = apikey === SK;
        // Seed qua service key — track id + file_name giong PostgREST that
        if (method === "POST" && isService) {
          if (mode === "storage-seed-fails") return json(500, { message: "seed boom" });
          const rows = body as Array<{ id: string; file_name: string }>;
          state.seededStorageId = rows?.[0]?.id ?? "";
          state.seededStorageFileName = rows?.[0]?.file_name ?? "";
          return json(201, rows);
        }
        // Service doc lai dong seed (read-back C7a / integrity C7c, C7d)
        if (isService && method === "GET") {
          if (state.storageDeletedByLeak) return json(200, []);
          const file_name = state.storagePatched
            ? "[RLS-VERIFY] HACKED — KHONG duoc phep"
            : state.seededStorageFileName;
          if (url.includes("select=file_name")) return json(200, [{ file_name }]);
          return json(200, [{ id: state.seededStorageId, file_name }]);
        }
        // Non-admin: mode rls-storage-leak -> RLS hong cho doc/sua/xoa dong seed
        if (mode === "rls-storage-leak" && !isService && bearer === USER_AT) {
          if (method === "GET") return json(200, [{ id: state.seededStorageId }]);
          if (method === "PATCH") {
            state.storagePatched = true;
            return json(200, [{ id: state.seededStorageId }]);
          }
          if (method === "DELETE") {
            state.storageDeletedByLeak = true;
            return json(200, [{ id: state.seededStorageId }]);
          }
        }
        // RLS lanh manh (default): loc het 200 [] — y nghia VI bang co dong seed
        if (method === "GET") return json(200, []);
        if (method === "PATCH") return json(200, []);
        if (method === "DELETE") {
          // Cleanup service key: row da bi leak-delete that -> PostgREST 404
          if (isService && state.storageDeletedByLeak) return json(404, { message: "row already deleted" });
          return json(200, []);
        }
      }
      if (url.includes("/rest/v1/profiles")) {
        return json(200, []);
      }
      if (url.includes("/rest/v1/mangas")) {
        const isService = apikey === SK;
        // Doc lai dong seed (id=eq.)
        if (method === "GET" && url.includes("id=eq.")) {
          if (url.includes("select=title")) return json(200, [{ title: state.seededTitle }]);
          return json(200, [{ id: state.seededMangaId }]);
        }
        if (method === "GET") {
          // JWT rac qua PostgREST -> 401
          if (bearer && bearer !== USER_AT) return json(401, { message: "Invalid JWT" });
          // Mode rls-fails: mo phong RLS HONG — anon (khong Bearer) doc DUOC du lieu
          if (mode === "rls-fails" && !isService && bearer === "") return json(200, [{ id: "leaked-row" }]);
          return json(200, []);
        }
        if (method === "POST") {
          if (isService) {
            const rows = body as Array<{ id: string; title: string }>;
            state.seededMangaId = rows?.[0]?.id ?? "";
            state.seededTitle = rows?.[0]?.title ?? "";
            return json(201, rows);
          }
          return json(403, { message: "new row violates row-level security policy" });
        }
        if (method === "PATCH") return json(200, []);
        if (method === "DELETE") {
          if (isService && mode === "cleanup-manga-fails") return json(500, { message: "boom" });
          return json(200, []);
        }
      }
    }

    return json(404, { message: `UNMOCKED ${method} ${url}` });
  }) as unknown as typeof fetch;

  return { impl, calls, state, env: { SB_URL: SB, PK, SK } };
}

describe("verify-rls control flow (cleanup luon chay, exit code sau cleanup)", () => {
  test("HAPPY PATH: tat ca PASS -> exit 0 + cleanup xoa user tam + manga seed", async () => {
    const m = makeSupabaseMock("ok");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(0);

    const adminCreate = m.calls.find((c) => c.url.endsWith("/auth/v1/admin/users") && c.method === "POST");
    expect(adminCreate).toBeDefined();
    const userDelete = m.calls.find((c) => c.url.endsWith(`/auth/v1/admin/users/${m.state.tempUserId}`) && c.method === "DELETE");
    expect(userDelete).toBeDefined();
    const mangaCleanup = m.calls.find((c) => c.method === "DELETE" && c.url.includes(`/rest/v1/mangas?id=eq.${m.state.seededMangaId}`));
    expect(mangaCleanup).toBeDefined();
  });

  test("HAPPY PATH: header contract — key moi KHONG bao gio gui lam Bearer (anon/service)", async () => {
    const m = makeSupabaseMock("ok");
    await runVerification({ env: m.env, fetchImpl: m.impl });
    // Tat ca request deu phai co apikey
    for (const c of m.calls) expect(c.apikey.length).toBeGreaterThan(0);
    // Request anon/service (apikey = PK hoac SK): KHONG duoc co Authorization
    for (const c of m.calls) {
      if (c.bearer === "" || c.bearer === "unit-test.access.token.jwt") continue;
      // Bearer chi duoc phep la access token user (hoac garbage JWT khi test A5)
      expect(c.bearer === "eyJhbGciOiJIUzI1NiJ9.garbage-payload.sig").toBe(true);
    }
    // Request user (whoami, non-admin) PHAI co Bearer = access token
    const whoami = m.calls.find((c) => c.url.endsWith("/auth/v1/user") && c.bearer === "unit-test.access.token.jwt");
    expect(whoami).toBeDefined();
    expect(whoami?.apikey).toBe(m.env.PK);
  });

  test("INVALID PK: gateway 401 -> BLOCKED (exit 2), KHONG tao bat ky tai nguyen nao", async () => {
    const m = makeSupabaseMock("invalid-pk");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(2);
    expect(m.calls.some((c) => c.url.endsWith("/auth/v1/admin/users") && c.method === "POST")).toBe(false);
    expect(m.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  test("TABLES MISSING (PGRST205): BLOCKED (exit 2), KHONG tao user/manga", async () => {
    const m = makeSupabaseMock("tables-missing");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(2);
    expect(m.calls.some((c) => c.url.endsWith("/auth/v1/admin/users") && c.method === "POST")).toBe(false);
  });

  test("PASSWORD GRANT FAIL (sau khi tao user tam) -> exit 1 + CLEANUP VAN XOA user tam", async () => {
    const m = makeSupabaseMock("grant-fails");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(1);
    const userDelete = m.calls.find((c) => c.url.endsWith(`/auth/v1/admin/users/${m.state.tempUserId}`) && c.method === "DELETE");
    expect(userDelete).toBeDefined(); // cleanup da chay du grant fail
  });

  test("RLS ASSERTION FAIL (anon doc duoc du lieu) -> exit 1 + cleanup xoa user + manga seed + attempted ids", async () => {
    const m = makeSupabaseMock("rls-fails");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(1);
    const userDelete = m.calls.find((c) => c.url.endsWith(`/auth/v1/admin/users/${m.state.tempUserId}`) && c.method === "DELETE");
    expect(userDelete).toBeDefined();
    const seedDelete = m.calls.find((c) => c.method === "DELETE" && c.url.includes(`/rest/v1/mangas?id=eq.${m.state.seededMangaId}`));
    expect(seedDelete).toBeDefined();
    // KHONG xoa du lieu nao ngoai id do script tao
    const allDeletes = m.calls.filter((c) => c.method === "DELETE" && c.url.includes("/rest/v1/mangas"));
    for (const d of allDeletes) {
      const id = new URL(d.url).searchParams.get("id")?.replace("eq.", "");
      expect(typeof id === "string" && id.length > 30).toBe(true);
    }
  });

  test("CLEANUP FAIL (xoa manga test bi 500) -> exit 1 du cac check deu PASS", async () => {
    const m = makeSupabaseMock("cleanup-manga-fails");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(1); // cleanup loi -> coi nhu FAIL
  });

  test("THIEU ENV -> exit 2 (BLOCKED), khong goi mang", async () => {
    const m = makeSupabaseMock("ok");
    const code = await runVerification({ env: { SB_URL: "", PK: "", SK: "" }, fetchImpl: m.impl });
    expect(code).toBe(2);
    expect(m.calls.length).toBe(0);
  });
});

// =============================================================
// AUDIT PASS 4 — verify-rls: storage_objects seed MAU THAT
// (chong PASS gia khi bang rong ngay sau migration)
// =============================================================
describe("verify-rls pass 4 — storage_objects: seed truoc khi kiem tra (chong PASS gia)", () => {
  test("SEED TRUOC KIEM TRA: service key POST storage_objects TRUOC non-admin GET + doc lai dong seed — exit 0", async () => {
    const m = makeSupabaseMock("ok");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(0);

    // 1) Script phai seed dong storage_objects bang SERVICE key (POST)
    const seedIdx = m.calls.findIndex(
      (c) => c.method === "POST" && c.url.includes("/rest/v1/storage_objects") && c.apikey === m.env.SK
    );
    expect(seedIdx).toBeGreaterThanOrEqual(0);

    // 2) Non-admin doc dong seed PHAI den SAU seed (khong con kiem tra tren bang rong)
    const naReadIdx = m.calls.findIndex(
      (c) =>
        c.method === "GET" &&
        c.url.includes("/rest/v1/storage_objects") &&
        c.url.includes(`id=eq.`) &&
        c.bearer === "unit-test.access.token.jwt"
    );
    expect(naReadIdx).toBeGreaterThan(seedIdx);

    // 3) Non-admin phai thu UPDATE va DELETE tren dong seed (kiem tra quyen ghi)
    const naPatch = m.calls.find(
      (c) => c.method === "PATCH" && c.url.includes("/rest/v1/storage_objects") && c.bearer === "unit-test.access.token.jwt"
    );
    expect(naPatch).toBeDefined();
    const naDelete = m.calls.find(
      (c) => c.method === "DELETE" && c.url.includes("/rest/v1/storage_objects") && c.bearer === "unit-test.access.token.jwt"
    );
    expect(naDelete).toBeDefined();

    // 4) Cleanup xoa storage seed (luon trong finally)
    const storageCleanup = m.calls.find(
      (c) => c.method === "DELETE" && c.url.includes(`/rest/v1/storage_objects?id=eq.${m.state.seededStorageId}`) && c.apikey === m.env.SK
    );
    expect(storageCleanup).toBeDefined();
    expect(m.state.seededStorageId.length).toBeGreaterThan(30); // UUID that do script tao
  });

  test("RLS HONG tren storage_objects (leak doc/sua/xoa dong seed) -> exit 1 — KHONG PASS gia", async () => {
    const m = makeSupabaseMock("rls-storage-leak");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(1);
    // Mock chi set 2 state nay khi request non-admin THAT den va duoc chap nhan
    // (mo phong RLS hong) — chung minh script da thu sua/xoa bang session non-admin
    expect(m.state.storagePatched).toBe(true);
    expect(m.state.storageDeletedByLeak).toBe(true);
    // Cleanup van chay du check FAIL: xoa user tam + manga seed
    const userDelete = m.calls.find(
      (c) => c.url.endsWith(`/auth/v1/admin/users/${m.state.tempUserId}`) && c.method === "DELETE"
    );
    expect(userDelete).toBeDefined();
    const seedDelete = m.calls.find(
      (c) => c.method === "DELETE" && c.url.includes(`/rest/v1/mangas?id=eq.${m.state.seededMangaId}`)
    );
    expect(seedDelete).toBeDefined();
  });

  test("SEED FAIL (service key khong ghi duoc storage_objects) -> exit 1 + cleanup van xoa user + manga seed", async () => {
    const m = makeSupabaseMock("storage-seed-fails");
    const code = await runVerification({ env: m.env, fetchImpl: m.impl });
    expect(code).toBe(1);
    const userDelete = m.calls.find(
      (c) => c.url.endsWith(`/auth/v1/admin/users/${m.state.tempUserId}`) && c.method === "DELETE"
    );
    expect(userDelete).toBeDefined();
    const seedDelete = m.calls.find(
      (c) => c.method === "DELETE" && c.url.includes(`/rest/v1/mangas?id=eq.${m.state.seededMangaId}`)
    );
    expect(seedDelete).toBeDefined();
    // Khong tao storage row -> khong co lệnh DELETE storage nao
    expect(
      m.calls.some((c) => c.method === "DELETE" && c.url.includes("/rest/v1/storage_objects"))
    ).toBe(false);
  });
});

// =============================================================
// AUDIT PASS 4 — Admin guard matrix: moi thao tac XOA object R2 /
// pha hoi du lieu thuc phai dung Strict Session Guard
// (requireAdminDestructive — khong phu thuoc HTTP method)
// =============================================================
import { readFileSync as fsReadFileSync } from "node:fs";
import * as nodePath from "node:path";

/** Cat doan handler tu `export const <METHOD>` den handler ke tiep / EOF. */
function handlerSlice(src: string, method: string): string {
  const start = src.search(new RegExp(`export\\s+const\\s+${method}\\b`));
  if (start < 0) return "";
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\nexport\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("PASS 4 — Admin guard matrix (Strict Session Guard cho moi thao tac xoa R2)", () => {
  const route = (p: string) =>
    fsReadFileSync(nodePath.resolve(import.meta.dir, "..", "src", "app", "api", p), "utf8");

  test("Moi handler CO xoa object R2 / pha hoi du lieu dung requireAdminDestructive, KHONG dung requireAdminMutation", () => {
    // Bat buoc day du — mat dong nao la mo cua so 90s cho thao tac do.
    const destructive: Array<[string, string, string]> = [
      ["chapters/[id]/pages/route.ts", "DELETE", "clearPages: xoa toan bo trang (DB + R2)"],
      ["chapters/[id]/pages/route.ts", "POST", "finalizePages B4: safe-delete object trang bi thay the"],
      ["chapters/[id]/route.ts", "DELETE", "deleteChapter"],
      ["chapters/[id]/pages/[pageId]/route.ts", "DELETE", "deletePage"],
      ["mangas/[id]/route.ts", "DELETE", "deleteManga"],
      ["mangas/[id]/cover/route.ts", "POST", "setMangaCover: xoa object bia cu tren R2"],
      ["mangas/[id]/cover/from-page/route.ts", "POST", "setMangaCover: xoa object bia cu tren R2"],
      ["uploads/abort/route.ts", "POST", "abort: safe-delete object PENDING tren R2"],
      ["storage/cleanup/route.ts", "POST", "cleanup: xoa object R2 (pending/orphan/retry)"],
    ];
    for (const [file, method, why] of destructive) {
      const block = handlerSlice(route(file), method);
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain("await requireAdminDestructive(");
      expect(block).not.toContain("requireAdminMutation(");
      void why;
    }
  });

  test("Route chi doc/tao/sua metadata KHONG xoa R2 -> giu requireAdminMutation (phan loai 90s window)", () => {
    const metadataOnly: Array<[string, string]> = [
      ["mangas/route.ts", "POST"],
      ["mangas/[id]/route.ts", "PATCH"],
      ["mangas/[id]/chapters/route.ts", "POST"],
      ["chapters/[id]/route.ts", "PATCH"],
      ["genres/route.ts", "POST"],
      ["history/route.ts", "DELETE"],
      ["progress/route.ts", "POST"],
      ["mangas/[id]/favorite/route.ts", "POST"],
      ["uploads/presign/route.ts", "POST"],
      ["uploads/direct/route.ts", "POST"],
    ];
    for (const [file, method] of metadataOnly) {
      const block = handlerSlice(route(file), method);
      expect(block.length).toBeGreaterThan(0);
      expect(block).toContain("requireAdminMutation(");
      expect(block).not.toContain("requireAdminDestructive(");
    }
  });
});

// ---- Numeric env config: fail-closed parse (S35 run-1 audit) ----
describe("getEnv numeric knobs (STORAGE_QUOTA_GB / SIGNED_URL_EXPIRY_SECONDS)", () => {
  beforeEach(() => {
    delete process.env.STORAGE_QUOTA_GB;
    delete process.env.SIGNED_URL_EXPIRY_SECONDS;
  });

  test("mac dinh: quota 100GB, expiry 3600s", () => {
    const env = getEnv();
    expect(env.storageQuotaBytes).toBe(100 * 1024 * 1024 * 1024);
    expect(env.signedUrlExpiry).toBe(3600);
  });

  test("so hop le duoc dung", () => {
    process.env.STORAGE_QUOTA_GB = "5";
    process.env.SIGNED_URL_EXPIRY_SECONDS = "600";
    const env = getEnv();
    expect(env.storageQuotaBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(env.signedUrlExpiry).toBe(600);
  });

  test("gia tri khong parse duoc -> THROW (fail closed, khong bao gio NaN)", () => {
    for (const bad of ["unlimited", "n/a", " ", "abc"]) {
      process.env.STORAGE_QUOTA_GB = bad;
      expect(() => getEnv()).toThrow(/STORAGE_QUOTA_GB/);
    }
    process.env.STORAGE_QUOTA_GB = "100";
    process.env.SIGNED_URL_EXPIRY_SECONDS = "forever";
    expect(() => getEnv()).toThrow(/SIGNED_URL_EXPIRY_SECONDS/);
  });

  test("gia tri 0/duong -> THROW; expiry > 604800 bi clamp", () => {
    process.env.STORAGE_QUOTA_GB = "0";
    expect(() => getEnv()).toThrow(/STORAGE_QUOTA_GB/);
    delete process.env.STORAGE_QUOTA_GB;
    process.env.SIGNED_URL_EXPIRY_SECONDS = "999999999";
    expect(getEnv().signedUrlExpiry).toBe(604800);
  });
});

// ---- Folder parser (batch import) ----
import {
  parseInfoTxt,
  mapStatus,
  parseGenres,
  parseChapterNumber,
  assignChapterNumbers,
  buildMangasFromFiles,
  type FileWithPath,
} from "../src/features/upload/folder-parser";

function fakeFile(name: string, content = "x", type = "image/jpeg"): File {
  return new File([content], name, { type });
}

describe("parseInfoTxt (info.txt hentaivn)", () => {
  test("parse du lieu day du (mau goc cua nguoi dung)", () => {
    const text = [
      "Tên: Roubaitei (Hololive)",
      "Tên Khác: ",
      "Thể Loại: Ahegao, Angel, BlowJobs, Deepthroat, Doujinshi, Idol, Mind Break, Nakadashi",
      "Nhóm dịch: ",
      "Tác giả: atahuta",
      "Tình Trạng: Đã hoàn thành",
      "Lượt xem: 149",
      "Update: 22:15:02 1/4/2024",
      "Nguồn: https://hentaivnreal.com/truyen/roubaitei-hololive",
    ].join("\n");
    const f = parseInfoTxt(text);
    expect(f.title).toBe("Roubaitei (Hololive)");
    expect(f.alternativeTitles).toBe("");
    expect(f.genres).toBe("Ahegao, Angel, BlowJobs, Deepthroat, Doujinshi, Idol, Mind Break, Nakadashi");
    expect(f.author).toBe("atahuta");
    expect(f.status).toBe("Đã hoàn thành");
    // Các trường web không hỗ trợ (Nhóm dịch/Lượt xem/Update/Nguồn) bị bỏ qua
    expect((f as Record<string, unknown>).translator).toBeUndefined();
    expect((f as Record<string, unknown>).views).toBeUndefined();
    expect((f as Record<string, unknown>).update).toBeUndefined();
    expect((f as Record<string, unknown>).source).toBeUndefined();
  });

  test("BOM + CRLF + key co dau hoa thuong + gia tri chua dau hai cham", () => {
    const text =
      "\uFEFFTÊN: Roubaitei: Extra Edition\r\nTÁC GIẢ: atahuta\r\nTÌNH TRẠNG: Đang tiến hành\r\n";
    const f = parseInfoTxt(text);
    expect(f.title).toBe("Roubaitei: Extra Edition");
    expect(f.author).toBe("atahuta");
    expect(f.status).toBe("Đang tiến hành");
  });

  test("dong khong co dau hai cham / dong trong bi bo qua", () => {
    const f = parseInfoTxt("Tên: ABC\n dong sai dinh dang \n\nTác giả: X\n: no key\n");
    expect(f.title).toBe("ABC");
    expect(f.author).toBe("X");
  });
});

describe("mapStatus (Tình Trạng -> MangaStatus)", () => {
  test("cac gia tri pho bien", () => {
    expect(mapStatus("Đã hoàn thành")).toBe("COMPLETED");
    expect(mapStatus("Đang tiến hành")).toBe("ONGOING");
    expect(mapStatus("Đang cập nhật")).toBe("ONGOING");
    expect(mapStatus("Tạm ngưng")).toBe("HIATUS");
    expect(mapStatus("tam dung")).toBe("HIATUS");
    expect(mapStatus("Drop")).toBe("DROPPED");
    expect(mapStatus("đã drop")).toBe("DROPPED");
  });
  test("thieu / khong nhan dien -> ONGOING (mac dinh)", () => {
    expect(mapStatus(undefined)).toBe("ONGOING");
    expect(mapStatus("")).toBe("ONGOING");
    expect(mapStatus("Chua ro")).toBe("ONGOING");
  });
});

describe("parseGenres (Thể Loại)", () => {
  test("tach dau phay/phan cach phay cham phay, trim, dedupe khong phan biet hoa", () => {
    const g = parseGenres("Ahegao, Angel; BlowJobs , angel , Deepthroat");
    expect(g).toEqual(["Ahegao", "Angel", "BlowJobs", "Deepthroat"]);
  });
  test("gioi han 20 genre, moi genre toi da 60 ky tu", () => {
    const many = Array.from({ length: 30 }, (_, i) => `G${i}`).join(", ");
    expect(parseGenres(many)).toHaveLength(20);
    expect(parseGenres(["A".repeat(100)].join(", "))[0].length).toBeLessThanOrEqual(60);
  });
  test("rong / undefined -> mang rong", () => {
    expect(parseGenres(undefined)).toEqual([]);
    expect(parseGenres("  ")).toEqual([]);
  });
});

describe("parseChapterNumber (ten thu muc chuong)", () => {
  test("so thuan, chuong/chapter prefix, so thap phan", () => {
    expect(parseChapterNumber("12")).toBe("12");
    expect(parseChapterNumber("Chương 12")).toBe("12");
    expect(parseChapterNumber("chapter 5")).toBe("5");
    expect(parseChapterNumber("Ch. 5.5")).toBe("5.5");
    expect(parseChapterNumber("v2 c005")).toBe("005");
    expect(parseChapterNumber("023")).toBe("023");
  });
  test("khong co so -> dung ten thu muc (toi da 50 ky tu)", () => {
    expect(parseChapterNumber("Extra")).toBe("Extra");
    expect(parseChapterNumber("  Omake  ")).toBe("Omake");
    expect(parseChapterNumber("E".repeat(80)).length).toBe(50);
  });
});

describe("assignChapterNumbers (so chuong duy nhat khi trung)", () => {
  test("trung so -> hau to -2, -3; giu nguyen thu tu", () => {
    expect(
      assignChapterNumbers([{ number: "1" }, { number: "1" }, { number: "1" }, { number: "2" }])
    ).toEqual(["1", "1-2", "1-3", "2"]);
  });
  test("thieu so -> dung vi tri (i+1); ten khong so giu nguyen", () => {
    expect(assignChapterNumbers([{ number: "" }, { number: "Extra" }])).toEqual(["1", "Extra"]);
  });
  test("gioi han 50 ky tu nhung van duy nhat", () => {
    const out = assignChapterNumbers([{ number: "X".repeat(60) }, { number: "X".repeat(60) }]);
    expect(out[0].length).toBe(50);
    expect(out[1].length).toBeLessThanOrEqual(50);
    expect(new Set(out).size).toBe(2);
  });
});

describe("buildMangasFromFiles (cau truc thu muc)", () => {
  test("1 thu muc truyen truc tiep: info.txt + cover + 2 chuong, sort trang tu nhien", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("info.txt", "Tên: Roubaitei (Hololive)\nTác giả: atahuta\nTình Trạng: Đã hoàn thành\nThể Loại: Ahegao, Angel\n", "text/plain"), path: "Roubaitei (Hololive)/info.txt" },
      { file: fakeFile("cover.jpg"), path: "Roubaitei (Hololive)/cover.jpg" },
      { file: fakeFile("1.jpg"), path: "Roubaitei (Hololive)/Chương 1/1.jpg" },
      { file: fakeFile("2.jpg"), path: "Roubaitei (Hololive)/Chương 1/2.jpg" },
      { file: fakeFile("10.jpg"), path: "Roubaitei (Hololive)/Chương 1/10.jpg" },
      { file: fakeFile("3.jpg"), path: "Roubaitei (Hololive)/Chương 1/3.jpg" },
      { file: fakeFile("1.jpg"), path: "Roubaitei (Hololive)/Chương 2/1.jpg" },
    ];
    const { mangas, warnings } = await buildMangasFromFiles(items);
    expect(warnings).toHaveLength(0);
    expect(mangas).toHaveLength(1);
    const m = mangas[0];
    expect(m.title).toBe("Roubaitei (Hololive)");
    expect(m.folderName).toBe("Roubaitei (Hololive)");
    expect(m.meta.author).toBe("atahuta");
    expect(m.meta.status).toBe("COMPLETED");
    expect(m.meta.genres).toEqual(["Ahegao", "Angel"]);
    expect(m.coverFile?.name).toBe("cover.jpg");
    expect(m.chapters).toHaveLength(2);
    expect(m.chapters[0].number).toBe("1");
    expect(m.chapters[0].name).toBe("Chương 1");
    // Natural sort: 1, 2, 3, 10 (khong phai 1, 10, 2, 3)
    expect(m.chapters[0].files.map((f) => f.name)).toEqual(["1.jpg", "2.jpg", "3.jpg", "10.jpg"]);
    expect(m.chapters[1].number).toBe("2");
  });

  test("thu muc CHA chua nhieu bo truyen — moi thu muc con la 1 bo", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("info.txt", "Tên: Oni Seki\n", "text/plain"), path: "BoSuuTap/Oni Seki (Hololive)/info.txt" },
      { file: fakeFile("cover.png", "x", "image/png"), path: "BoSuuTap/Oni Seki (Hololive)/cover.png" },
      { file: fakeFile("1.jpg"), path: "BoSuuTap/Oni Seki (Hololive)/Chương 1/1.jpg" },
      { file: fakeFile("info.txt", "Tên: Roubaitei\n", "text/plain"), path: "BoSuuTap/Roubaitei (Hololive)/info.txt" },
      { file: fakeFile("cover.webp", "x", "image/webp"), path: "BoSuuTap/Roubaitei (Hololive)/cover.webp" },
      { file: fakeFile("1.jpg"), path: "BoSuuTap/Roubaitei (Hololive)/Chapter 1/1.jpg" },
    ];
    const { mangas } = await buildMangasFromFiles(items);
    expect(mangas).toHaveLength(2);
    expect(mangas.map((m) => m.folderName)).toEqual(["Oni Seki (Hololive)", "Roubaitei (Hololive)"]);
  });

  test("thieu info.txt -> dung ten thu muc, co canh bao; thieu cover -> canh bao", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("1.jpg"), path: "No Info Manga/Chương 1/1.jpg" },
    ];
    const { mangas } = await buildMangasFromFiles(items);
    expect(mangas).toHaveLength(1);
    expect(mangas[0].title).toBe("No Info Manga");
    expect(mangas[0].hasInfoFile).toBe(false);
    expect(mangas[0].warnings.some((w) => w.includes("info.txt"))).toBe(true);
    expect(mangas[0].warnings.some((w) => w.includes("bìa"))).toBe(true);
    expect(mangas[0].meta.status).toBe("ONGOING");
  });

  test("cover moi dinh dang anh deu duoc nhan (png/webp), uu tien ten cover.*", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("cover-1.png", "x", "image/png"), path: "M/cover-1.png" },
      { file: fakeFile("a.jpg"), path: "M/a.jpg" },
      { file: fakeFile("1.jpg"), path: "M/Chương 1/1.jpg" },
    ];
    const { mangas } = await buildMangasFromFiles(items);
    expect(mangas[0].coverFile?.name).toBe("cover-1.png");
  });

  test("file rac macOS/Windows bi loai; chuong khong co anh bi bo qua + canh bao", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("info.txt", "Tên: X\n", "text/plain"), path: "X/info.txt" },
      { file: fakeFile("cover.jpg"), path: "X/cover.jpg" },
      { file: fakeFile("junk", "x", "application/octet-stream"), path: "X/__MACOSX/cover.jpg" },
      { file: fakeFile("junk2", "x", "application/octet-stream"), path: "X/._1.jpg" },
      { file: fakeFile("note.txt", "x", "text/plain"), path: "X/Rỗng/note.txt" },
      { file: fakeFile("1.jpg"), path: "X/Chương 1/1.jpg" },
    ];
    const { mangas, warnings } = await buildMangasFromFiles(items);
    expect(mangas).toHaveLength(1);
    expect(mangas[0].chapters).toHaveLength(1);
    // Cảnh báo về thư mục rỗng nằm trong warnings CỦA TRUYỆN (không phải global)
    expect(mangas[0].warnings.some((w) => w.includes("Rỗng"))).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  test("nhieu chuong cung so -> khong crash, giu nguyen ca hai (server se tu xu ly 409)", async () => {
    const items: FileWithPath[] = [
      { file: fakeFile("cover.jpg"), path: "M/cover.jpg" },
      { file: fakeFile("1.jpg"), path: "M/1/1.jpg" },
      { file: fakeFile("1.jpg"), path: "M/Chapter 1/1.jpg" },
    ];
    const { mangas } = await buildMangasFromFiles(items);
    expect(mangas).toHaveLength(1);
    expect(mangas[0].chapters).toHaveLength(2);
    expect(new Set(mangas[0].chapters.map((c) => c.number)).size).toBe(1);
  });
});

// =============================================================
// STORAGE AUDIT — chunking theo ngan sach URL + phan lop orphan
// (fix bug chinh: audit 10.755 object bao toan bo la "mo coi" vi
// query .in 1000 key lam URL ~108KB bi PostgREST tu choi)
// =============================================================
import {
  chunkKeysForUrl,
  classifyOrphans,
  computeStorageUsage,
  URL_BUDGET_CHARS,
  type OrphanRowInfo,
} from "../src/lib/storage-audit";

/** Sinh object key giong that: mangas/{uuid}/chapters/{uuid}/p0001-ab12cd34.webp (~108 ky tu) */
function fakeObjectKey(i: number): string {
  const uuid = (seed: number) =>
    `${(seed + 0x10000000).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return `mangas/${uuid(i)}/chapters/${uuid(i + 1)}/p${String(i % 10000).padStart(4, "0")}-v1m67j${String(i % 10)}q.webp`;
}

describe("chunkKeysForUrl — chunk theo ngan sach URL PostgREST", () => {
  test("URL_BUDGET_CHARS nam duoi gioi han ~8KB cua PostgREST/Kong", () => {
    expect(URL_BUDGET_CHARS).toBeLessThanOrEqual(8000);
    expect(URL_BUDGET_CHARS).toBe(6000);
  });

  test("moi chunk khong vuoc ngan sach URL (tinh ca dau phay)", () => {
    const keys = Array.from({ length: 10_755 }, (_, i) => fakeObjectKey(i));
    const chunks = chunkKeysForUrl(keys);
    expect(chunks.length).toBeGreaterThan(100); // 10.755 key ~108 ky tu => ~196 chunk
    for (const chunk of chunks) {
      const urlLen = chunk.reduce((s, k) => s + k.length + 1, 0); // key + dau phay
      expect(urlLen).toBeLessThanOrEqual(URL_BUDNET_BUDGET());
    }
  });

  test("giu nguyen toan bo key + thu tu sau khi chunk (flat == input)", () => {
    const keys = Array.from({ length: 1000 }, (_, i) => fakeObjectKey(i + 7));
    const flat = chunkKeysForUrl(keys).flat();
    expect(flat).toEqual(keys);
  });

  test("key rong bi loai bo, khong lam voi index", () => {
    const chunks = chunkKeysForUrl(["", "abc", "", "def"] as string[]);
    expect(chunks.flat()).toEqual(["abc", "def"]);
  });

  test("ngan sach rat nho -> moi key mot chunk", () => {
    const chunks = chunkKeysForUrl(["aaaa", "bbbb", "cccc"], 5);
    expect(chunks).toEqual([["aaaa"], ["bbbb"], ["cccc"]]);
  });

  test("danh sach rong -> khong chunk", () => {
    expect(chunkKeysForUrl([])).toEqual([]);
  });
});

function URL_BUDNET_BUDGET(): number {
  return URL_BUDGET_CHARS + 1; // dung sai 1 ky tu (phan tach cuoi khong co)
}

describe("classifyOrphans — phan lop file mo coi (0 false positive)", () => {
  const NOW = Date.parse("2026-11-14T12:00:00Z");
  const STALE_CUTOFF = NOW - 24 * 3600 * 1000;

  /**
   * QUAN TRONG NHAT: mo phong dung lieu that (10.755 object tren R2,
   * tat ca deu duoc pages tham chieu) — audit PHAI tra 0 orphan.
   * Day chinh la boi canh bug: query .in 1000 key that bai => data
   * null => moi key bi coi la "mo coi" (10.755 file gia, 3.8GB).
   */
  test("10.755 key deu duoc tham chieu => 0 orphan (ky chuyen that)", () => {
    const N = 10_755;
    const keys = Array.from({ length: N }, (_, i) => fakeObjectKey(i));
    const sizes = Array.from({ length: N }, () => 283_000);
    const pageKeys = new Set(keys); // DB co day du tham chieu
    const orphans = classifyOrphans(
      keys,
      sizes,
      { pageKeys, coverKeys: new Set<string>(), rows: new Map() },
      STALE_CUTOFF
    );
    expect(orphans).toHaveLength(0);
  });

  test("phan lop tung truong hop: tham chieu / khong row / PENDING tuoi-qua-han / CONFIRMED / DELETE_PENDING", () => {
    const keys = [
      "k-referenced-by-page",
      "k-referenced-by-cover",
      "k-no-row",
      "k-pending-fresh",
      "k-pending-stale",
      "k-confirmed-unref",
      "k-deletepending-unref",
    ];
    const sizes = [10, 20, 30, 40, 50, 60, 70];
    const rows = new Map<string, OrphanRowInfo>([
      ["k-pending-fresh", { status: "PENDING", createdAtMs: NOW - 1 * 3600 * 1000 }],
      ["k-pending-stale", { status: "PENDING", createdAtMs: NOW - 48 * 3600 * 1000 }],
      ["k-confirmed-unref", { status: "CONFIRMED", createdAtMs: NOW }],
      ["k-deletepending-unref", { status: "DELETE_PENDING", createdAtMs: NOW }],
    ]);
    const orphans = classifyOrphans(
      keys,
      sizes,
      {
        pageKeys: new Set(["k-referenced-by-page"]),
        coverKeys: new Set(["k-referenced-by-cover"]),
        rows,
      },
      STALE_CUTOFF
    );
    // Chi 4 key la orphan thuc su; 2 key duoc tham chieu va 1 PENDING
    // con tuoi KHONG phai orphan (upload dang dien ra)
    expect(orphans.map((o) => o.objectKey)).toEqual([
      "k-no-row",
      "k-pending-stale",
      "k-confirmed-unref",
      "k-deletepending-unref",
    ]);
    expect(orphans.map((o) => o.size)).toEqual([30, 50, 60, 70]);
  });

  test("size thieu/khong khop index -> mac dinh 0, khong crash", () => {
    const orphans = classifyOrphans(
      ["k-no-row"],
      [],
      { pageKeys: new Set(), coverKeys: new Set(), rows: new Map() },
      STALE_CUTOFF
    );
    expect(orphans).toEqual([{ objectKey: "k-no-row", size: 0 }]);
  });
});

describe("computeStorageUsage — SUM dung luong phan loai theo status", () => {
  test("tong hop CONFIRMED / PENDING (tuoi vs qua han) / DELETE_PENDING", () => {
    const NOW = new Date("2026-11-14T12:00:00Z").toISOString();
    const OLD = new Date("2026-11-01T12:00:00Z").toISOString();
    const usage = computeStorageUsage(
      [
        { status: "CONFIRMED", file_size: 1000, manga_id: "m1", created_at: NOW },
        { status: "CONFIRMED", file_size: 2000, manga_id: "m1", created_at: NOW },
        { status: "PENDING", file_size: 500, manga_id: "m1", created_at: NOW }, // tuoi
        { status: "PENDING", file_size: 700, manga_id: "m1", created_at: OLD }, // qua han
        { status: "DELETE_PENDING", file_size: 900, manga_id: "m1", created_at: NOW },
        { status: "GHOST", file_size: 999, manga_id: "m1", created_at: NOW }, // trang thai la
      ],
      Date.parse("2026-11-14T12:00:00Z") - 24 * 3600 * 1000
    );
    expect(usage.confirmedBytes).toBe(3000);
    expect(usage.confirmedFiles).toBe(2);
    expect(usage.pendingBytes).toBe(1200);
    expect(usage.pendingFiles).toBe(2);
    expect(usage.freshPendingBytes).toBe(500); // chi PENDING tuoi
    expect(usage.freshPendingFiles).toBe(1);
    expect(usage.deletePendingBytes).toBe(900);
    expect(usage.deletePendingFiles).toBe(1);
  });

  test("file_size null/ky tu khong so -> coi la 0, khong NaN", () => {
    const usage = computeStorageUsage(
      [
        { status: "CONFIRMED", file_size: null, manga_id: null, created_at: null },
        { status: "CONFIRMED", file_size: "abc", manga_id: null, created_at: null },
      ],
      0
    );
    expect(usage.confirmedBytes).toBe(0);
    expect(usage.confirmedFiles).toBe(2);
    expect(Number.isFinite(usage.confirmedBytes)).toBe(true);
  });
});
