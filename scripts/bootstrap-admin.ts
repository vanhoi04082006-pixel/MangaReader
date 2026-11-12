// =============================================================
// Bootstrap Admin — chay 1 LAN khi trien khai lan dau:
//   bun run scripts/bootstrap-admin.ts
//
// 1. Kiem tra cau hinh .env (ADMIN_EMAIL/ADMIN_PASSWORD/Supabase)
// 2. Tao tai khoan admin trong Supabase Auth neu chua ton tai
//    (email_confirm = true) — tach biet khoi luong login thuong
// 3. In UUID cua admin de dat vao ADMIN_USER_ID (.env + bien Vercel)
//    va kiem tra khop app_config.admin_user_id (seed boi migration SQL)
//
// VONG DOI ADMIN_PASSWORD (bootstrap-only):
// - Can thiet: CHI khi tai khoan chua ton tai va ban muon tao no tu script nay.
// - Sau bootstrap: DOI MAT KHAU tai Supabase Dashboard > Authentication
//   roi XOA ADMIN_PASSWORD khoi .env / bien Vercel production.
// - Login/refresh/logout/readiness KHONG can ADMIN_PASSWORD khi tai khoan
//   da ton tai (mat khau do Supabase Auth quan ly doc lap).
// - Ung dung KHONG bao gio reset/tai tao tai khoan admin da ton tai.
//
// An toan: khong in mat khau, khong ghi secret ra log.
// =============================================================

import {
  sbAdminGetUserByEmail,
  sbAdminCreateUser,
} from "../src/lib/supabase-auth";
import { getEnv, isValidUuid } from "../src/lib/env";

async function main() {
  const env = getEnv();
  const isProd = process.env.NODE_ENV === "production";
  console.log("=== MangaReader — Bootstrap Admin ===");
  console.log(`Supabase : ${env.supabase.url}`);
  console.log(`Admin    : ${env.admin.email}`);
  console.log("");

  if (env.authProvider !== "supabase") {
    console.error("AUTH_PROVIDER phai la 'supabase' cho production. Hien tai:", env.authProvider);
    process.exit(1);
  }

  // 1) Kiem tra user da ton tai chua
  const existing = await sbAdminGetUserByEmail(env.admin.email).catch((err) => {
    console.error("Khong truy cap duoc Supabase Admin API:", err instanceof Error ? err.message : err);
    console.error("-> Kiem tra NEXT_PUBLIC_SUPABASE_URL va SUPABASE_SERVICE_SECRET_KEY.");
    process.exit(1);
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
    console.log(`[1/2] Tai khoan admin DA ton tai: ${existing.email}`);
    console.log("      (Ung dung khong tao lai / reset tai khoan da ton tai.)");
    if (!env.admin.password) {
      console.log("      ADMIN_PASSWORD khong co trong env — BINH THUONG sau bootstrap (chi can luc tao lan dau).");
    }
  } else {
    if (!env.admin.password) {
      console.error("Tai khoan admin CHUA ton tai va thieu ADMIN_PASSWORD trong .env.");
      console.error("Dat ADMIN_PASSWORD (manh) de bootstrap lan dau — sau do xoa no khoi env production.");
      process.exit(1);
    }
    const created = await sbAdminCreateUser(env.admin.email, env.admin.password);
    userId = created.id;
    console.log(`[1/2] DA TAO tai khoan admin: ${created.email} (email_confirm = true)`);
  }

  console.log("");
  console.log("[2/2] UUID cua admin (dung cho ADMIN_USER_ID):");
  console.log(`  ${userId}`);
  console.log("");
  console.log("Cac buoc tiep theo:");
  console.log("  1. Dat ADMIN_USER_ID=" + userId + " trong .env (va bien Vercel).");
  console.log("     BAT BUOC trong production — moi request admin kiem tra UUID nay.");
  console.log("  2. Chay supabase/migrations/0001_init.sql trong Supabase SQL Editor");
  console.log("     (seed app_config.admin_user_id — phai DUNG UUID tren; readiness");
  console.log("     se bao cao neu 2 noi khong khop).");
  console.log("  3. DOI MAT KHAU tai Supabase Dashboard > Authentication (ADMIN_PASSWORD");
  console.log("     chi dung bootstrap; sau do password do Supabase Auth quan ly).");
  console.log("  4. XOA ADMIN_PASSWORD khoi .env / bien Vercel production (bootstrap-only;");
  console.log("     login/refresh/logout/readiness khong can no khi tai khoan da ton tai).");
  console.log("");

  // Kiem tra ADMIN_USER_ID hien co trong env (neu dat)
  if (env.admin.userId === undefined) {
    if (isProd) {
      console.error("LOI: PRODUCTION chua dat ADMIN_USER_ID — bat buoc (fail closed).");
      console.error(`Dat: ADMIN_USER_ID=${userId}`);
      process.exit(1);
    }
    console.warn("NHAC: chua dat ADMIN_USER_ID trong .env (dev van dang nhap duoc bang email,");
    console.warn("nhung production se TU CHOI hoan toan khi thieu UUID — dat ngay:")
    console.warn(`  ADMIN_USER_ID=${userId}`);
  } else if (!isValidUuid(env.admin.userId)) {
    console.error("LOI: ADMIN_USER_ID trong .env KHONG phai UUID hop le:", env.admin.userId);
    console.error(`Doi thanh: ADMIN_USER_ID=${userId}`);
    process.exit(1);
  } else if (env.admin.userId !== userId.toLowerCase()) {
    console.error("LOI: ADMIN_USER_ID trong .env KHAC UUID that cua admin!");
    console.error(`  .env      : ${env.admin.userId}`);
    console.error(`  Supabase  : ${userId}`);
    console.error("-> Dung lai ADMIN_USER_ID theo UUID that (moi request admin se bi tu choi).");
    process.exit(1);
  } else {
    console.log("ADMIN_USER_ID trong .env khop UUID that cua admin: OK");
  }
}

main().catch((err) => {
  console.error("BOOTSTRAP THAT BAI:", err instanceof Error ? err.message : err);
  process.exit(1);
});
