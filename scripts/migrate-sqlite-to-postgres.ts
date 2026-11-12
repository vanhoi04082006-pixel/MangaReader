// =============================================================
// Migrate SQLite (dev) -> PostgreSQL (Supabase) — BUN RUN:
//   bun run db:migrate:sqlite-to-postgres            (DRY-RUN mac dinh)
//   bun run db:migrate:sqlite-to-postgres --apply    (ghi that — can xac nhan)
//   bun run db:migrate:sqlite-to-postgres --apply --yes          (bo prompt)
//   bun run db:migrate:sqlite-to-postgres --skip-test-data       (bo mangas [TEST-AUDIT]*)
//
// EXIT CODE: 0 = OK | 1 = FAIL | 2 = BLOCKED (bang dich chua tao / thieu env).
//
// MUC DICH: tao bang PostgreSQL (supabase/migrations/0001_init.sql) KHONG
// tu dong chuyen du lieu SQLite cu. Tool nay chuyen TOAN BO du lieu that:
// Profile, Manga, Chapter, Page, Genre, MangaGenre, Favorite,
// ReadingProgress, ReadingHistory, StorageObject (giu nguyen UUID,
// timestamp, khoa ngoai, so trang, R2 object key; Int -> BIGINT).
//
// DUONG DAN SQLITE (Windows/Linux/macOS — chay tu bat ky CWD nao):
// - DATABASE_URL "file:..." duoc resolve THEO THU MUC CHUA SCHEMA PRISMA
//   (prisma/) — dung goc resolution nhu Prisma client (xem src/lib/sqlite-url.ts).
// - Ho tro: duong dan tuong doi, tuyet doi POSIX, o dia Windows (C:\... | C:/...),
//   UNC (\\server\share), query parameter (?...) — khong bao gio tu tao
//   file moi; file thieu / thieu bang Prisma -> LOI RO RANG, dung lai.
//
// HEADER CONTRACT (key Supabase — xem src/lib/supabase-keys.ts):
// - Key moi sb_secret_... KHONG phai JWT -> chi gui o "apikey",
//   KHONG gui lam "Authorization: Bearer".
// - Key legacy (service_role JWT) -> gui ca apikey + Bearer (semantics cu).
//
// NGUYEN TAC AN TOAN:
//  - Dry-run la MAC DINH; ghi that phai co --apply + xac nhan ro rang.
//  - Ghi qua PostgREST (service key) voi resolution=ignore-duplicates
//    -> IDEMPOTENT/RESUMABLE: chay lai chi them dong con thieu, khong trung lap.
//  - KHONG BAO GIO xoa/sua du lieu dich; KHONG xoa/sua SQLite nguon (mo readonly);
//    KHONG upload/xoa/doi key bat ky object R2 nao — chi HeadObject de xac minh.
//  - Xac minh moi UUID khoa chinh/ngoai; xac minh profile ton tai trong
//    Supabase Auth (FK auth.users); xac minh object R2 ton tai (CONFIRMED + Page).
//  - RateLimitHit KHONG duoc chuyen (du lieu tan thoi, khong co gia tri).
//
// CANH BAO PRODUCTION: chi chay --apply sau khi (1) da ap migration SQL,
// (2) CO BACKUP, (3) duoc chu so huu cho phep roi. Tool in ro URL dich
// de nguoi chay kiem tra truoc khi xac nhan.
// =============================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { supabaseServiceHeaders } from "../src/lib/supabase-keys";
import { resolveSqliteFile } from "../src/lib/sqlite-url";

// Cua so lam viec co the khac goc repo — moi duong dan relative phai dua tren
// vi tri CUA FILE SCRIPT nay, khong phai CWD.
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const PRISMA_SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");

// ---------------- CLI ----------------
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const YES = args.includes("--yes");
const SKIP_TEST_DATA = args.includes("--skip-test-data");

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

// ---------------- ENV ----------------
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    // Doc .env o GOC REPO (khong phu thuoc CWD) — chay tu thu muc khac van dung.
    const raw = readFileSync(path.join(REPO_ROOT, ".env"), "utf8") as string;
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]!] = m[2].trim();
    }
  } catch {
    /* dung process.env */
  }
  return { ...env, ...(process.env as Record<string, string>) };
}
const ENV = loadEnv();

const SB_URL = (flagValue("--url") ?? ENV.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SK = flagValue("--service-key") ?? ENV.SUPABASE_SERVICE_SECRET_KEY ?? "";

const R2_ACCOUNT_ID = ENV.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = ENV.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = ENV.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = ENV.R2_BUCKET_NAME ?? "manga-storage";
const R2_ENDPOINT = ENV.R2_ENDPOINT ?? "";

if (!SB_URL || !SK) {
  console.error("Thieu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_SECRET_KEY (hoac --url/--service-key).");
  process.exit(2);
}

// ---------------- Resolve duong dan SQLite (cung goc voi Prisma) ----------------
const SQLITE_URL = ENV.DATABASE_URL ?? "";
const sqliteFile = resolveSqliteFile(SQLITE_URL, PRISMA_SCHEMA_PATH);
if (!sqliteFile.ok || !sqliteFile.path) {
  console.error("LOI DUONG DAN SQLITE:");
  console.error(sqliteFile.error ?? "DATABASE_URL khong hop le.");
  console.error(`(CWD hien tai: ${process.cwd()} — tool resolve theo thu muc schema Prisma, giong Prisma client.)`);
  process.exit(1);
}
if (!sqliteFile.exists) {
  console.error("LOI FILE SQLITE NGUON:");
  console.error(sqliteFile.error);
  process.exit(1);
}
const SQLITE_PATH = sqliteFile.path;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** SQLite luu DateTime la so ms (hoac chuoi ISO) -> chuyen thanh ISO cho timestamptz. */
function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return new Date(parseInt(v, 10)).toISOString();
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

// ---------------- PostgREST helper (header contract moi — xem supabase-keys.ts) ----------------
async function pg(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const res = await fetch(`${SB_URL}${path}`, {
    method,
    headers: {
      ...supabaseServiceHeaders(SK), // sb_secret_ -> chi apikey; legacy JWT -> apikey + Bearer
      ...(body !== undefined ? { Prefer: "resolution=ignore-duplicates" } : {}),
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function pgCount(table: string): Promise<number | null> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      ...supabaseServiceHeaders(SK),
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (res.status !== 200 && res.status !== 206) return null;
  const cr = res.headers.get("content-range") ?? ""; // "0-0/123"
  const m = cr.match(/\/(\d+)$/);
  return m ? parseInt(m[1]!, 10) : null;
}

// ---------------- Doc SQLite (readonly — khong bao gio ghi nguon) ----------------
interface Row {
  [k: string]: unknown;
}
const sqlite = new Database(SQLITE_PATH, { readonly: true });

// Xac minh DB nguon co bang Prisma ky vong truoc khi doc (chong mo SAI file:
// file SQLite khac/rong se thieu bang -> loi ro rang, khong chuyen du lieu rac).
const EXPECTED_TABLES = [
  "Profile", "Genre", "Manga", "Chapter", "Page", "MangaGenre",
  "Favorite", "ReadingProgress", "ReadingHistory", "StorageObject",
];
const presentTables = new Set(
  (
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name)
);
const missingTables = EXPECTED_TABLES.filter((t) => !presentTables.has(t));
if (missingTables.length > 0) {
  console.error("LOI: FILE SQLITE NGUON THIEU BANG PRISMA KY VONG:");
  for (const t of missingTables) console.error(`  - ${t}`);
  console.error(`File: ${SQLITE_PATH}`);
  console.error(`Bang hien co: ${Array.from(presentTables).join(", ") || "(khong co bang nao)"}`);
  console.error("-> Co the ban da tro DATABASE_URL den file SQLite SAI (file rong/cua du an khac).");
  console.error("   Tool KHONG chuyen tu DB thieu bang. Kiem tra DATABASE_URL hoac chay \"bun run db:push\".");
  sqlite.close();
  process.exit(1);
}

function all(table: string): Row[] {
  return sqlite.query(`SELECT * FROM "${table}"`).all() as Row[];
}

const profiles = all("Profile");
const genres = all("Genre");
const mangas = all("Manga");
const chapters = all("Chapter");
const pages = all("Page");
const mangaGenres = all("MangaGenre");
const favorites = all("Favorite");
const readingProgress = all("ReadingProgress");
const readingHistory = all("ReadingHistory");
const storageObjects = all("StorageObject");

console.log("=== MangaReader — SQLite -> PostgreSQL Migration ===");
console.log(`Nguon (readonly) : ${SQLITE_PATH}`);
console.log(`   (DATABASE_URL = ${SQLITE_URL}${sqliteFile.query ? ` ? ${sqliteFile.query}` : ""} — resolve theo ${path.dirname(PRISMA_SCHEMA_PATH)}, giong Prisma)`);
console.log(`   Bang Prisma ky vong: ${EXPECTED_TABLES.length}/${EXPECTED_TABLES.length} deu ton tai`);
console.log(`Dich (PostgREST) : ${SB_URL}`);
console.log(`Che do           : ${APPLY ? "APPLY (ghi that)" : "DRY-RUN (khong ghi)"}`);
console.log("");
console.log("Du lieu SQLite doc duoc:");
console.log(`  profiles=${profiles.length} genres=${genres.length} mangas=${mangas.length} chapters=${chapters.length} pages=${pages.length}`);
console.log(`  manga_genres=${mangaGenres.length} favorites=${favorites.length} reading_progress=${readingProgress.length}`);
console.log(`  reading_history=${readingHistory.length} storage_objects=${storageObjects.length}`);
console.log(`  (rate_limit_hits: KHONG chuyen — du lieu tan thi)`);
console.log("");

// ---------------- Bo du lieu test (tuy chon) ----------------
const TEST_PREFIX = "[TEST-AUDIT]";
let skippedTestMangas = new Set<string>();
let effMangas = mangas;
if (SKIP_TEST_DATA) {
  skippedTestMangas = new Set(mangas.filter((m) => String(m.title ?? "").startsWith(TEST_PREFIX)).map((m) => String(m.id)));
  effMangas = mangas.filter((m) => !skippedTestMangas.has(String(m.id)));
  console.log(`--skip-test-data: bo ${skippedTestMangas.size} manga bat dau bang "${TEST_PREFIX}" va cac dong lien quan.`);
  console.log("");
}

// ---------------- Chuyen doi + xac minh ----------------
const warnings: string[] = [];
const errors: string[] = [];

function checkUuid(v: unknown, label: string, rowId: string): string | null {
  if (!isUuid(v)) {
    errors.push(`${label} khong phai UUID hop le (row ${rowId}): ${String(v)}`);
    return null;
  }
  return v as string;
}

function ts(v: unknown, label: string, rowId: string): string {
  const iso = toIso(v);
  if (!iso) {
    errors.push(`${label} khong the chuyen thanh timestamp (row ${rowId}): ${String(v)}`);
    return new Date(0).toISOString();
  }
  return iso;
}

const outProfiles = profiles
  .map((r) => ({
    id: checkUuid(r.id, "profiles.id", String(r.id)),
    email: String(r.email ?? ""),
    display_name: (r.displayName as string | null) ?? null,
    created_at: ts(r.createdAt, "profiles.created_at", String(r.id)),
    updated_at: ts(r.updatedAt, "profiles.updated_at", String(r.id)),
  }))
  .filter((r): r is typeof r & { id: string } => r.id !== null);

const outGenres = genres
  .map((r) => ({
    id: checkUuid(r.id, "genres.id", String(r.name)),
    name: String(r.name ?? ""),
  }))
  .filter((r): r is typeof r & { id: string } => r.id !== null);

const outMangas = effMangas
  .map((r) => ({
    id: checkUuid(r.id, "mangas.id", String(r.title)),
    title: String(r.title ?? ""),
    alternative_titles: (r.alternativeTitles as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    author: (r.author as string | null) ?? null,
    artist: (r.artist as string | null) ?? null,
    status: String(r.status ?? "ONGOING"),
    publication_year: (r.publicationYear as number | null) ?? null,
    cover_image_key: (r.coverImageKey as string | null) ?? null,
    created_at: ts(r.createdAt, "mangas.created_at", String(r.id)),
    updated_at: ts(r.updatedAt, "mangas.updated_at", String(r.id)),
  }))
  .filter((r): r is typeof r & { id: string } => r.id !== null);

const mangaIds = new Set(outMangas.map((m) => m.id));
const chapterSrc = chapters.filter((c) => mangaIds.has(String(c.mangaId)));
const outChapters = chapterSrc
  .map((r) => ({
    id: checkUuid(r.id, "chapters.id", String(r.chapterNumber)),
    manga_id: checkUuid(r.mangaId, "chapters.manga_id", String(r.id)),
    chapter_number: String(r.chapterNumber ?? ""),
    title: (r.title as string | null) ?? null,
    volume: (r.volume as string | null) ?? null,
    page_count: (r.pageCount as number) ?? 0,
    created_at: ts(r.createdAt, "chapters.created_at", String(r.id)),
    updated_at: ts(r.updatedAt, "chapters.updated_at", String(r.id)),
  }))
  .filter((r): r is typeof r & { id: string; manga_id: string } => r.id !== null && r.manga_id !== null);

const chapterIds = new Set(outChapters.map((c) => c.id));
const outPages = pages
  .filter((p) => chapterIds.has(String(p.chapterId)))
  .map((r) => ({
    id: checkUuid(r.id, "pages.id", String(r.objectKey)),
    chapter_id: checkUuid(r.chapterId, "pages.chapter_id", String(r.id)),
    page_number: (r.pageNumber as number) ?? 1,
    object_key: String(r.objectKey ?? ""),
    file_name: String(r.fileName ?? ""),
    mime_type: String(r.mimeType ?? ""),
    file_size: (r.fileSize as number) ?? 0, // Int (SQLite) -> BIGINT (PG): JSON number
    width: (r.width as number | null) ?? null,
    height: (r.height as number | null) ?? null,
    created_at: ts(r.createdAt, "pages.created_at", String(r.id)),
  }))
  .filter((r): r is typeof r & { id: string; chapter_id: string } => r.id !== null && r.chapter_id !== null);

const genreIds = new Set(outGenres.map((g) => g.id));
const outMangaGenres = mangaGenres
  .filter((mg) => mangaIds.has(String(mg.mangaId)) && genreIds.has(String(mg.genreId)))
  .map((r) => ({
    manga_id: checkUuid(r.mangaId, "manga_genres.manga_id", String(r.genreId)),
    genre_id: checkUuid(r.genreId, "manga_genres.genre_id", String(r.mangaId)),
  }))
  .filter((r): r is { manga_id: string; genre_id: string } => r.manga_id !== null && r.genre_id !== null);

const profileIds = new Set(outProfiles.map((p) => p.id));
const outFavorites = favorites
  .filter((f) => profileIds.has(String(f.userId)) && mangaIds.has(String(f.mangaId)))
  .map((r) => ({
    user_id: checkUuid(r.userId, "favorites.user_id", String(r.mangaId)),
    manga_id: checkUuid(r.mangaId, "favorites.manga_id", String(r.userId)),
    created_at: ts(r.createdAt, "favorites.created_at", String(r.mangaId)),
  }))
  .filter((r): r is { user_id: string; manga_id: string; created_at: string } => r.user_id !== null && r.manga_id !== null);

const outProgress = readingProgress
  .filter((rp) => profileIds.has(String(rp.userId)) && mangaIds.has(String(rp.mangaId)) && chapterIds.has(String(rp.chapterId)))
  .map((r) => ({
    user_id: checkUuid(r.userId, "reading_progress.user_id", String(r.mangaId)),
    manga_id: checkUuid(r.mangaId, "reading_progress.manga_id", String(r.userId)),
    chapter_id: checkUuid(r.chapterId, "reading_progress.chapter_id", String(r.userId)),
    page_number: (r.pageNumber as number) ?? 1,
    scroll_position: (r.scrollPosition as number) ?? 0,
    updated_at: ts(r.updatedAt, "reading_progress.updated_at", String(r.userId)),
  }))
  .filter((r): r is typeof r & { user_id: string; manga_id: string; chapter_id: string } => r.user_id !== null && r.manga_id !== null && r.chapter_id !== null);

const outHistory = readingHistory
  .filter((h) => profileIds.has(String(h.userId)) && mangaIds.has(String(h.mangaId)) && chapterIds.has(String(h.chapterId)))
  .map((r) => ({
    id: checkUuid(r.id, "reading_history.id", String(r.userId)),
    user_id: checkUuid(r.userId, "reading_history.user_id", String(r.id)),
    manga_id: checkUuid(r.mangaId, "reading_history.manga_id", String(r.id)),
    chapter_id: checkUuid(r.chapterId, "reading_history.chapter_id", String(r.id)),
    page_number: (r.pageNumber as number) ?? 1,
    read_at: ts(r.readAt, "reading_history.read_at", String(r.id)),
  }))
  .filter((r): r is typeof r & { id: string; user_id: string; manga_id: string; chapter_id: string } => r.id !== null && r.user_id !== null && r.manga_id !== null && r.chapter_id !== null);

const outStorageObjects = storageObjects
  .filter((so) => {
    // Giu metadata OBJECT (moi key la duy nhat, can nguyen ven de doi chieu R2);
    // chi bo cac row tham chieu manga da bi bo qua boi --skip-test-data.
    const mid = so.mangaId as string | null;
    return mid === null || !skippedTestMangas.has(mid);
  })
  .map((r) => ({
    id: checkUuid(r.id, "storage_objects.id", String(r.objectKey)),
    object_key: String(r.objectKey ?? ""),
    kind: String(r.kind ?? "PAGE"),
    status: String(r.status ?? "PENDING"),
    file_name: (r.fileName as string | null) ?? null,
    file_size: (r.fileSize as number) ?? 0, // Int -> BIGINT
    mime_type: (r.mimeType as string | null) ?? null,
    manga_id: r.mangaId === null || r.mangaId === undefined ? null : checkUuid(r.mangaId, "storage_objects.manga_id", String(r.objectKey)),
    chapter_id: r.chapterId === null || r.chapterId === undefined ? null : checkUuid(r.chapterId, "storage_objects.chapter_id", String(r.objectKey)),
    created_at: ts(r.createdAt, "storage_objects.created_at", String(r.objectKey)),
    confirmed_at: r.confirmedAt === null || r.confirmedAt === undefined ? null : toIso(r.confirmedAt),
  }))
  .filter((r): r is typeof r & { id: string } => r.id !== null);

console.log("Ke hoach chuyen (sau xac minh UUID/timestamp, theo thu tu FK):");
console.log(`  profiles=${outProfiles.length} genres=${outGenres.length} mangas=${outMangas.length} chapters=${outChapters.length} pages=${outPages.length}`);
console.log(`  manga_genres=${outMangaGenres.length} favorites=${outFavorites.length} reading_progress=${outProgress.length}`);
console.log(`  reading_history=${outHistory.length} storage_objects=${outStorageObjects.length}`);
console.log("");

for (const m of outMangas) {
  console.log(`  - manga: "${m.title}" (${m.id}) created=${m.created_at}`);
}
for (const p of outProfiles) {
  console.log(`  - profile: ${p.email} (${p.id})`);
}
console.log("");

// ---------------- Xac minh FK tham chieu cheo ----------------
for (const c of outChapters) if (!mangaIds.has(c.manga_id)) errors.push(`chapters ${c.id}: manga_id ${c.manga_id} khong ton tai trong mangas`);
for (const p of outPages) if (!chapterIds.has(p.chapter_id)) errors.push(`pages ${p.id}: chapter_id ${p.chapter_id} khong ton tai`);
for (const f of outFavorites) if (!mangaIds.has(f.manga_id)) errors.push(`favorites: manga_id ${f.manga_id} khong ton tai`);
for (const rp of outProgress) if (!chapterIds.has(rp.chapter_id)) errors.push(`reading_progress: chapter_id ${rp.chapter_id} khong ton tai`);
for (const h of outHistory) if (!chapterIds.has(h.chapter_id)) errors.push(`reading_history: chapter_id ${h.chapter_id} khong ton tai`);

// ---------------- Kiem tra bang DICH ton tai (fail nhanh truoc cac buoc mang) ----------------
// (service key doc duoc — key moi: chi apikey; legacy: apikey + Bearer)
const requiredTables = [
  "profiles", "genres", "mangas", "chapters", "pages", "manga_genres",
  "favorites", "reading_progress", "reading_history", "storage_objects",
];
for (const t of requiredTables) {
  const res = await pg("GET", `/rest/v1/${t}?select=*&limit=1`);
  if (res.status === 404 || res.text.includes("PGRST205")) {
    console.error(`BLOCKED: Bang \`${t}\` CHUA TON TAI tren dich (${SB_URL}).`);
    console.error("Hay chay supabase/migrations/0001_init.sql trong Supabase SQL Editor TRUOC.");
    console.error("(Cac buoc xac minh Auth/R2 phia duoi chi chay khi dich da co bang — tiet kiem thoi gian.)");
    sqlite.close();
    process.exit(2);
  }
  if (res.status !== 200) {
    console.error(`BLOCKED: Khong doc duoc bang \`${t}\` (status=${res.status}) — kiem tra service key / URL dich.`);
    sqlite.close();
    process.exit(2);
  }
}
console.log("Bang dich ton tai (service key doc duoc): OK");
console.log("");

// ---------------- Xac minh profile ton tai trong Supabase Auth (FK auth.users) ----------------
for (const p of outProfiles) {
  const res = await fetch(`${SB_URL}/auth/v1/admin/users/${p.id}`, {
    headers: supabaseServiceHeaders(SK),
  });
  if (res.status === 404) {
    errors.push(`profiles ${p.email} (${p.id}): KHONG ton tai trong Supabase Auth — FK auth.users se that bai. Bo dong nay hoac tao user Auth tuong ung.`);
  } else if (res.status !== 200) {
    warnings.push(`profiles ${p.id}: Auth API tra ${res.status} — khong xac minh duoc ton tai.`);
  }
}

// ---------------- Xac minh object R2 ton tai (KHONG ghi/xoa gi) ----------------
const r2ok = R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT;
if (r2ok) {
  const s3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  async function head(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  const keysToVerify = new Set<string>();
  for (const so of outStorageObjects) {
    if (so.status === "CONFIRMED" || so.status === "DELETE_PENDING") keysToVerify.add(so.object_key);
  }
  for (const p of outPages) keysToVerify.add(p.object_key);

  console.log(`Xac minh ${keysToVerify.size} object key tren R2 (HeadObject — chi doc):`);
  const missing: string[] = [];
  let checked = 0;
  for (const key of keysToVerify) {
    if (await head(key)) {
      checked += 1;
    } else {
      missing.push(key);
    }
  }
  console.log(`  ton tai: ${checked}/${keysToVerify.size}`);
  if (missing.length > 0) {
    console.log(`  THIEU (${missing.length}) — metadata van duoc chuyen (nguyen vong), chu so huu dung Storage > Audit de xu ly:`);
    for (const k of missing) console.log(`    - ${k}`);
    warnings.push(`${missing.length} object key khong ton tai tren R2 (danh sach o tren).`);
  }
  const pendingCount = outStorageObjects.filter((s) => s.status === "PENDING").length;
  if (pendingCount > 0) console.log(`  (PENDING: ${pendingCount} object chua finalize — khong bat buoc ton tai tren R2)`);
} else {
  warnings.push("Khong co bien R2_* — bo qua xac minh object R2.");
}
console.log("");

// ---------------- Ket qua xac minh ----------------
if (errors.length > 0) {
  console.error(`XAC MINH THAT BAI (${errors.length} loi):`);
  for (const e of errors) console.error(`  - ${e}`);
  sqlite.close();
  process.exit(1);
}
for (const w of warnings) console.warn(`CANH BAO: ${w}`);
console.log("Xac minh du lieu: OK (khong loi chan che).");
console.log("");

// ---------------- DRY-RUN ket thuc o day ----------------
if (!APPLY) {
  console.log("DRY-RUN HOAN TAT — khong ghi gi. Chay lai voi --apply de ghi that");
  console.log("(can xac nhan + backup; xem canh bao production trong dau file).");
  process.exit(0);
}

// ---------------- APPLY ----------------
if (!YES) {
  console.log("CANH BAO: sap GHI THAT vao PostgreSQL dich:");
  console.log(`  ${SB_URL}`);
  console.log("  Dam bao (1) da co BACKUP, (2) day la dich dung (staging/production),");
  console.log("  (3) chu so huu cho phep chuyen du lieu.");
  process.stdout.write("Go 'migrate' (khong dau) de xac nhan: ");
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (d) => resolve(String(d).trim()));
  });
  if (answer !== "migrate") {
    console.log("Khong xac nhan — THOAT (khong ghi gi).");
    process.exit(1);
  }
}

async function insertBatched(table: string, rows: Array<Record<string, unknown>>, batchSize = 100) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await pg("POST", `/rest/v1/${table}`, batch);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`INSERT ${table} batch ${i / batchSize + 1} that bai: ${res.status} ${res.text.slice(0, 200)}`);
    }
    inserted += batch.length; // ignore-duplicates: so dong moi = batch - conflicts (xac minh lai bang count)
  }
  return inserted;
}

const plan: Array<[string, Array<Record<string, unknown>>]> = [
  ["profiles", outProfiles as unknown as Array<Record<string, unknown>>],
  ["genres", outGenres as unknown as Array<Record<string, unknown>>],
  ["mangas", outMangas as unknown as Array<Record<string, unknown>>],
  ["chapters", outChapters as unknown as Array<Record<string, unknown>>],
  ["pages", outPages as unknown as Array<Record<string, unknown>>],
  ["manga_genres", outMangaGenres as unknown as Array<Record<string, unknown>>],
  ["favorites", outFavorites as unknown as Array<Record<string, unknown>>],
  ["reading_progress", outProgress as unknown as Array<Record<string, unknown>>],
  ["reading_history", outHistory as unknown as Array<Record<string, unknown>>],
  ["storage_objects", outStorageObjects as unknown as Array<Record<string, unknown>>],
];

console.log("BAT DAU GHI (resolution=ignore-duplicates — idempotent, chay lai an toan):");
for (const [table, rows] of plan) {
  if (rows.length === 0) {
    console.log(`  ${table}: 0 dong — bo qua`);
    continue;
  }
  const sent = await insertBatched(table, rows);
  const after = await pgCount(table);
  console.log(`  ${table}: gui ${sent} dong, tong hien tai tren dich = ${after ?? "?"}`);
}

console.log("");
console.log("XAC MINH SAU GHI:");
let verifyOk = true;
const expectCounts: Array<[string, number]> = [
  ["profiles", outProfiles.length],
  ["genres", outGenres.length],
  ["mangas", outMangas.length],
  ["chapters", outChapters.length],
  ["pages", outPages.length],
  ["manga_genres", outMangaGenres.length],
  ["favorites", outFavorites.length],
  ["reading_progress", outProgress.length],
  ["reading_history", outHistory.length],
  ["storage_objects", outStorageObjects.length],
];
for (const [table, expected] of expectCounts) {
  const actual = await pgCount(table);
  // genres duoc seed san boi migration SQL -> tong >= expected (hop le)
  const ok = actual !== null && actual >= expected;
  if (!ok) verifyOk = false;
  console.log(`  ${table}: dich=${actual ?? "?"} / nguon(expected)=${expected} ${ok ? "OK" : "FAIL"}`);
}

sqlite.close();
console.log("");
if (!verifyOk) {
  console.error("MOT SO BANG CO LE CHUA DU DONG — kiem tra loi INSERT o tren (chay lai tool: idempotent).");
  process.exit(1);
}
console.log("MIGRATION HOAN TAT. SQLite nguon KHONG bi thay doi; R2 khong bi ghi/xoa; cac object key giu nguyen.");
