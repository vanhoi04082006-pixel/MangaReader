// =============================================================
// SQLite URL resolution — dung cho tool/script mo truc tiep file SQLite
// (bun:sqlite) CAN PHAI resolve dung goc duong dan nhu Prisma client.
//
// VAN DE: DATABASE_URL "file:../db/custom.db" la duong dan TUONG DOI.
// - Prisma resolve TUONG DOI so voi THU MUC CHUA SCHEMA (prisma/).
// - bun:sqlite (va fs) resolve TUONG DOI so voi CWD cua tien trinh.
// Chay tu thu muc khac nhau -> mo SAI file (Windows/macOS/Linux khac nhau;
// cung co the TU TAO file moi rong). Tool phai dung CUNG mot file nhu app.
//
// Quy tac resolve (khop Prisma — docs: "relative to the location of the
// schema file"):
//   file:/abs/path.db                     -> tuyet doi POSIX (giu nguyen)
//   file:C:\path\db.db  |  file:C:/path   -> o dia Windows (giu nguyen)
//   file:\\server\share |  file://srv/sh  -> UNC (giu nguyen)
//   file:./db.db | file:../db/custom.db   -> resolve theo thu muc schema
//   file:db.db                            -> resolve theo thu muc schema
//   file:?x=1 (duong dan rong)            -> LOI
//   Khong co prefix "file:"                -> LOI
// Query parameter ("?connection_limit=1...") duoc TACH ra, khong ap vao path.
// =============================================================

import { existsSync } from "node:fs";
import path from "node:path";

export interface ParsedSqliteUrl {
  ok: boolean;
  /** Duong dan file da resolve (tuyet doi, hoac o-dia/UNC nhu nhap vao). */
  path: string | null;
  /** Query string (khong dau "?") neu co. */
  query: string | null;
  /** Thong bao loi ro rang khi ok = false. */
  error?: string;
}

// O dia Windows: "C:\..." hoac "C:/..."
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
// UNC: "\\server\share\..." hoac "//server/share/..."
const UNC_RE = /^(\\\\|\/\/)/;

/**
 * Parse + resolve URL SQLite THEO THU MUC SCHEMA PRISMA (pure — khong doc fs).
 *
 * @param rawUrl        gia tri DATABASE_URL (vd "file:../db/custom.db")
 * @param prismaSchemaPath duong dan den prisma/schema.prisma (bat ky CWD nao)
 */
export function parseSqliteUrl(rawUrl: string, prismaSchemaPath: string): ParsedSqliteUrl {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, path: null, query: null, error: "DATABASE_URL đang trống." };
  }
  if (!rawUrl.startsWith("file:")) {
    return {
      ok: false,
      path: null,
      query: null,
      error: `DATABASE_URL phải là URL SQLite dạng "file:...". Giá trị hiện tại bắt đầu bằng "${rawUrl.slice(0, 24)}...".`,
    };
  }

  // Tach query parameter an toan (khong cho tham vao duong dan).
  let raw = rawUrl.slice("file:".length);
  const qIdx = raw.indexOf("?");
  const query = qIdx === -1 ? null : raw.slice(qIdx + 1);
  if (qIdx !== -1) raw = raw.slice(0, qIdx);
  raw = raw.trim();

  if (raw === "") {
    return {
      ok: false,
      path: null,
      query,
      error: 'DATABASE_URL "file:" thiếu đường dẫn file (sau khi bỏ query parameter).',
    };
  }

  // Tuyet doi (POSIX / o dia Windows / UNC) -> dung nguyen.
  if (raw.startsWith("/") || WINDOWS_DRIVE_RE.test(raw) || UNC_RE.test(raw)) {
    return { ok: true, path: raw, query };
  }

  // Tuong doi -> resolve theo thu muc chua schema (giong Prisma).
  const schemaDir = path.dirname(path.resolve(prismaSchemaPath));
  return { ok: true, path: path.resolve(schemaDir, raw), query };
}

export interface ResolvedSqliteFile extends ParsedSqliteUrl {
  /** True neu file ton tai tren dia (chi kiem tra khi ok = true). */
  exists: boolean;
}

/**
 * Parse + resolve + KIEM TRA TON TAI cua file SQLite nguon.
 * KHONG BAO GIO tao file moi: neu file khong ton tai thi bao loi ro rang
 * (kem duong dan da resolve + duong dan goc) de nguoi dung sua DATABASE_URL.
 */
export function resolveSqliteFile(rawUrl: string, prismaSchemaPath: string): ResolvedSqliteFile {
  const parsed = parseSqliteUrl(rawUrl, prismaSchemaPath);
  if (!parsed.ok || !parsed.path) {
    return { ...parsed, exists: false };
  }
  const exists = existsSync(parsed.path);
  if (!exists) {
    return {
      ...parsed,
      exists: false,
      error:
        `File SQLite KHÔNG tồn tại: ${parsed.path}\n` +
        `  (DATABASE_URL = "${rawUrl}" — resolved theo thư mục schema Prisma, giống Prisma client.)\n` +
        `  Tool KHÔNG tự tạo file mới. Kiểm tra DATABASE_URL hoặc chạy "bun run db:push" để tạo DB dev.`,
    };
  }
  return { ...parsed, exists: true };
}
