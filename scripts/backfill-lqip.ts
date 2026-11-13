// =============================================================
// Backfill LQIP cho dữ liệu đã có (chạy SAU migration 0003):
//   bun run scripts/backfill-lqip.ts
//
// - mangas.cover_lqip / cover_color : từ ảnh bìa trên R2
// - pages.lqip                      : từ ảnh trang trên R2
//
// Script tải từng object từ R2 (Get), sinh placeholder ~16px bằng
// sharp, rồi UPDATE qua PostgREST (service key). Idempotent — chỉ
// xử lý row còn thiếu; chạy lại không làm gì thêm.
//
// Yêu cầu .env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_SECRET_KEY,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
//
// Tuỳ chọn:
//   ONLY=covers  bun run scripts/backfill-lqip.ts   (chỉ bìa)
//   ONLY=pages   bun run scripts/backfill-lqip.ts   (chỉ trang)
//   DRY=1        bun run scripts/backfill-lqip.ts   (chỉ đếm, không ghi)
// =============================================================

import { createClient } from "@supabase/supabase-js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const ONLY = process.env.ONLY ?? ""; // "" | covers | pages
const DRY = process.env.DRY === "1";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Thiếu biến môi trường ${name} (xem .env.example).`);
    process.exit(1);
  }
  return v;
}

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
  },
});
const BUCKET = requireEnv("R2_BUCKET_NAME");

async function fetchObject(key: string): Promise<Buffer | null> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** LQIP ~16px JPEG base64 (thô, không prefix data:) */
async function makeLqip(buf: Buffer): Promise<string | null> {
  try {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 16, height: 16, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 45 })
      .toBuffer();
    return out.toString("base64");
  } catch {
    return null;
  }
}

/** Màu chủ đạo (hex) */
async function makeColor(buf: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(buf).stats();
    if (!dominant) return null;
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch {
    return null;
  }
}

async function probeColumn(table: string, column: string): Promise<boolean> {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}

async function backfillCovers(): Promise<void> {
  const okManga = await probeColumn("mangas", "cover_lqip");
  if (!okManga) {
    console.error("✗ Cột mangas.cover_lqip chưa tồn tại — chạy migration 0003 trước.");
    process.exitCode = 1;
    return;
  }
  const { data: mangas } = await supabase
    .from("mangas")
    .select("id, cover_image_key, cover_lqip")
    .not("cover_image_key", "is", null);
  const todo = (mangas ?? []).filter((m: any) => !m.cover_lqip);
  console.log(`Bìa: ${todo.length}/${mangas?.length ?? 0} cần sinh LQIP${DRY ? " (DRY)" : ""}`);
  let done = 0;
  for (const m of todo) {
    const buf = await fetchObject(m.cover_image_key);
    if (!buf) {
      console.warn(`  ! Không tải được ${m.cover_image_key} — bỏ qua`);
      continue;
    }
    const [lqip, color] = await Promise.all([makeLqip(buf), makeColor(buf)]);
    if (!DRY && lqip) {
      await supabase
        .from("mangas")
        .update({ cover_lqip: lqip, cover_color: color })
        .eq("id", m.id);
    }
    done++;
    if (done % 10 === 0) console.log(`  .. ${done}/${todo.length}`);
  }
  console.log(`✓ Bìa xong: ${done}`);
}

async function backfillPages(): Promise<void> {
  const okPage = await probeColumn("pages", "lqip");
  if (!okPage) {
    console.error("✗ Cột pages.lqip chưa tồn tại — chạy migration 0003 trước.");
    process.exitCode = 1;
    return;
  }
  // Đếm tổng để hiển thị tiến trình
  const { count: totalAll } = await supabase.from("pages").select("*", { count: "exact", head: true });
  const { count: totalTodo } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .or("lqip.is.null");
  console.log(`Trang: ${totalTodo ?? 0}/${totalAll ?? 0} cần sinh LQIP${DRY ? " (DRY)" : ""}`);

  const PAGE = 200;
  let done = 0;
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("pages")
      .select("id, object_key")
      .or("lqip.is.null")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (!batch || batch.length === 0) break;
    let advanced = 0;
    for (const p of batch) {
      const buf = await fetchObject(p.object_key);
      advanced++;
      if (!buf) {
        console.warn(`  ! Không tải được ${p.object_key} — bỏ qua`);
        continue;
      }
      const lqip = await makeLqip(buf);
      if (!DRY && lqip) {
        await supabase.from("pages").update({ lqip }).eq("id", p.id);
      }
      done++;
    }
    console.log(`  .. ${done}/${totalTodo ?? "?"}`);
    if (batch.length < PAGE) break;
    // Sau update, row có lqip sẽ rơi khỏi filter — luôn duy trì offset 0
    if (advanced === 0) break;
    offset = 0;
  }
  console.log(`✓ Trang xong: ${done}`);
}

async function main() {
  if (ONLY === "" || ONLY === "covers") await backfillCovers();
  if (ONLY === "" || ONLY === "pages") await backfillPages();
}

main().catch((e) => {
  console.error("Backfill lỗi:", e);
  process.exitCode = 1;
});
