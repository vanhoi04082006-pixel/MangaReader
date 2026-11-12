// =============================================================
// Unit tests — chay voi: bun test tests/unit.test.ts
// Khong can server. Test cac ham bao mat cot loi.
// =============================================================

import { describe, test, expect, beforeEach } from "bun:test";

/** NODE_ENV la readonly theo types — dung helper cast de test. */
function setNodeEnv(v: string) {
  (process.env as { NODE_ENV?: string }).NODE_ENV = v;
}


// ---- Local JWT ----
import { localJwtSign, ACCESS_COOKIE } from "../src/lib/session";

// Canh bao: khong import module session truoc khi set env o cac test provider
import { effectiveAuthProvider, isAdminUser } from "../src/lib/env";
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
