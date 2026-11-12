// =============================================================
// Bootstrap Admin — chay 1 LAN khi trien khai lan dau:
//   bun run scripts/bootstrap-admin.ts
//
// 1. Kiem tra cau hinh .env (ADMIN_EMAIL/ADMIN_PASSWORD/Supabase)
// 2. Tao tai khoan admin trong Supabase Auth neu chua ton tai
//    (email_confirm = true) — tach biet khoi luong login thuong
// 3. In UUID cua admin de dat vao ADMIN_USER_ID (.env) va
//    app_config.admin_user_id (SQL migration da seed san UUID hien tai)
//
// An toan: khong in mat khau, khong ghi secret ra log.
// =============================================================

import {
  sbAdminGetUserByEmail,
  sbAdminCreateUser,
} from "../src/lib/supabase-auth";
import { getEnv } from "../src/lib/env";

async function main() {
  const env = getEnv();
  console.log("=== MangaReader — Bootstrap Admin ===");
  console.log(`Supabase : ${env.supabase.url}`);
  console.log(`Admin    : ${env.admin.email}`);
  console.log("");

  if (env.authProvider !== "supabase") {
    console.error("AUTH_PROVIDER phai la 'supabase' cho production. Hien tai:", env.authProvider);
    process.exit(1);
  }
  if (!env.admin.password) {
    console.error("Thieu ADMIN_PASSWORD trong .env (dung de tao tai khoan lan dau).");
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
  } else {
    const created = await sbAdminCreateUser(env.admin.email, env.admin.password);
    userId = created.id;
    console.log(`[1/2] DA TAO tai khoan admin: ${created.email} (email_confirm = true)`);
  }

  console.log("");
  console.log("[2/2] UUID cua admin (dung cho ADMIN_USER_ID):");
  console.log(`  ${userId}`);
  console.log("");
  console.log("Cac buoc tiep theo:");
  console.log("  1. Dat ADMIN_USER_ID=" + userId + " trong .env (va bien Vercel)");
  console.log("  2. Chay supabase/migrations/0001_init.sql trong Supabase SQL Editor");
  console.log("     (da seed app_config.admin_user_id — kiem tra khop UUID tren)");
  console.log("  3. DOI MAT KHAU tai Supabase Dashboard > Authentication (ADMIN_PASSWORD");
  console.log("     chi dung bootstrap; sau do password do Supabase Auth quan ly).");
  console.log("  4. Xoa ADMIN_PASSWORD khoi .env production (khong con can).");
  console.log("");
  if (env.admin.userId && env.admin.userId !== userId.toLowerCase()) {
    console.warn("CANH BAO: ADMIN_USER_ID trong .env KHAC UUID that cua admin!");
    console.warn(`  .env      : ${env.admin.userId}`);
    console.warn(`  Supabase  : ${userId}`);
    console.warn("-> Dung lai ADMIN_USER_ID theo UUID that (moi request admin se bi tu choi).");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("BOOTSTRAP THAT BAI:", err instanceof Error ? err.message : err);
  process.exit(1);
});
