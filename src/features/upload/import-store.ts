// =============================================================
// Import Store — lưu phiên nhập truyện vào IndexedDB để tiếp tục
// sau khi làm mới trang / đóng tab (progress persistence).
//
// Thiết kế:
// - DB "mangareader-import" v1, 2 object store:
//   + "session"  : 1 record (id="active") — metadata truyện + trạng thái
//   + "files"    : { key, file } — lưu File (structured-cloneable)
// - File lưu nguyên bản (Blob) — khôi phục bằng new File([blob], ...)
// - Lỗi quota (thư mục quá lớn) → throw, caller tắt persistence
//   và cảnh báo (không chặn import).
//
// Giới hạn: nếu refresh GIỮA chừng 1 chương, chương đó sẽ được upload
// lại từ đầu khi resume (chỉ metadata đã finalize mới được coi là xong).
// =============================================================

"use client";

import type { ParsedManga, ParsedChapter, ParsedMangaMeta } from "@/features/upload/folder-parser";
import type { MangaStatus } from "@/schemas";

// ---------------- types ----------------

/** Chế độ xử lý khi truyện đã tồn tại trong thư viện */
export type DuplicateMode = "skip" | "update" | "overwrite";

export type MangaImportStatus = "pending" | "importing" | "done" | "error" | "cancelled" | "skipped" | "updated";

export interface MangaImportState {
  status: MangaImportStatus;
  mangaId?: string;
  chaptersDone: number;
  chaptersTotal: number;
  currentChapter?: string;
  phase?: "creating" | "cover" | "chapters" | "waiting" | "checking";
  error?: string;
  /** cảnh báo không chặn import (bìa lỗi...) */
  notices?: string[];
  /** Các chương đã hoàn tất (chapter number) — dùng khi resume */
  doneChapterNumbers?: string[];
}

interface StoredChapter {
  name: string;
  number: string;
  fileKeys: string[];
  fileNames: string[];
  fileTypes: string[];
  fileSizes: number[];
}

interface StoredManga {
  id: string;
  folderName: string;
  title: string;
  meta: ParsedMangaMeta;
  coverKey: string | null;
  chapters: StoredChapter[];
  totalFiles: number;
  totalBytes: number;
  warnings: string[];
  hasInfoFile: boolean;
  state: MangaImportState | null;
}

interface StoredSession {
  id: "active";
  createdAt: number;
  updatedAt: number;
  mode: DuplicateMode;
  mangas: StoredManga[];
}

export interface RestoredSession {
  createdAt: number;
  updatedAt: number;
  mode: DuplicateMode;
  mangas: ParsedManga[];
  states: Record<string, MangaImportState>;
}

// ---------------- low-level IndexedDB ----------------

const DB_NAME = "mangareader-import";
const DB_VERSION = 1;
const SESSION_STORE = "session";
const FILES_STORE = "files";
const SESSION_ID = "active";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB không khả dụng"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Không mở được IndexedDB"));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Lỗi IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction bị hủy"));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Lỗi IndexedDB"));
  });
}

// ---------------- key helpers ----------------

function coverKey(mangaId: string): string {
  return `${mangaId}::cover`;
}
function pageKey(mangaId: string, chapterIdx: number, fileIdx: number): string {
  return `${mangaId}::${chapterIdx}::${fileIdx}`;
}

// ---------------- serialize / deserialize ----------------

function toStoredManga(m: ParsedManga, state: MangaImportState | null): StoredManga {
  const chapters: StoredChapter[] = m.chapters.map((c, ci) => ({
    name: c.name,
    number: c.number,
    fileKeys: c.files.map((_f, fi) => pageKey(m.id, ci, fi)),
    fileNames: c.files.map((f) => f.name),
    fileTypes: c.files.map((f) => f.type || "application/octet-stream"),
    fileSizes: c.files.map((f) => f.size),
  }));
  return {
    id: m.id,
    folderName: m.folderName,
    title: m.title,
    meta: m.meta,
    coverKey: m.coverFile ? coverKey(m.id) : null,
    chapters,
    totalFiles: m.totalFiles,
    totalBytes: m.totalBytes,
    warnings: m.warnings,
    hasInfoFile: m.hasInfoFile,
    state,
  };
}

function reviveFile(stored: { blob: unknown; name: string; type: string }): File {
  const b = stored.blob as Blob;
  if (b instanceof File && b.name === stored.name && b.type === stored.type) return b;
  return new File([b], stored.name, { type: stored.type || "application/octet-stream" });
}

// ---------------- public API ----------------

/**
 * Lưu toàn bộ phiên nhập (metadata + file ảnh) vào IndexedDB.
 * Ném lỗi khi hết quota — caller nên catch và tắt persistence.
 */
export async function saveImportSession(
  mangas: ParsedManga[],
  mode: DuplicateMode,
  states?: Record<string, MangaImportState>
): Promise<void> {
  const db = await openDb();
  const stored = mangas.map((m) => toStoredManga(m, states?.[m.id] ?? null));

  const now = Date.now();
  const existing = await readSessionRecord(db).catch(() => null);
  const session: StoredSession = {
    id: SESSION_ID,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    mode,
    mangas: stored,
  };

  // 1) Ghi file theo lô 400/transaction (tránh transaction quá lớn)
  const fileEntries: Array<{ key: string; blob: Blob; name: string; type: string }> = [];
  for (let mi = 0; mi < mangas.length; mi++) {
    const m = mangas[mi];
    if (m.coverFile)
      fileEntries.push({
        key: coverKey(m.id),
        blob: m.coverFile,
        name: m.coverFile.name,
        type: m.coverFile.type,
      });
    m.chapters.forEach((c, ci) => {
      c.files.forEach((f, fi) =>
        fileEntries.push({ key: pageKey(m.id, ci, fi), blob: f, name: f.name, type: f.type })
      );
    });
  }
  const BATCH = 400;
  for (let i = 0; i < fileEntries.length; i += BATCH) {
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    for (const e of fileEntries.slice(i, i + BATCH)) store.put(e);
    await txDone(tx);
  }

  // 2) Ghi session record
  const tx = db.transaction(SESSION_STORE, "readwrite");
  tx.objectStore(SESSION_STORE).put(session);
  await txDone(tx);
}

/** Cập nhật nhẹ chỉ metadata trạng thái (không chép lại file) */
export async function patchImportSessionStates(
  states: Record<string, MangaImportState>,
  mode: DuplicateMode
): Promise<void> {
  const db = await openDb();
  const session = await readSessionRecord(db);
  if (!session) return;
  session.mangas = session.mangas.map((m) => ({ ...m, state: states[m.id] ?? m.state ?? null }));
  session.updatedAt = Date.now();
  const tx = db.transaction(SESSION_STORE, "readwrite");
  tx.objectStore(SESSION_STORE).put(session);
  await txDone(tx);
}

async function readSessionRecord(db: IDBDatabase): Promise<StoredSession | null> {
  const tx = db.transaction(SESSION_STORE, "readonly");
  const rec = await reqToPromise<StoredSession | undefined>(
    tx.objectStore(SESSION_STORE).get(SESSION_ID) as IDBRequest<StoredSession | undefined>
  );
  return rec ?? null;
}

/**
 * Đọc phiên nhập đang lưu — khôi phục ParsedManga (kèm File) + trạng thái.
 * Trả về null nếu không có phiên nào.
 */
export async function readImportSession(): Promise<RestoredSession | null> {
  const db = await openDb();
  const session = await readSessionRecord(db);
  if (!session || session.mangas.length === 0) return null;

  // Đọc toàn bộ file 1 lượt theo lô
  const allKeys: string[] = [];
  for (const m of session.mangas) {
    if (m.coverKey) allKeys.push(m.coverKey);
    for (const c of m.chapters) allKeys.push(...c.fileKeys);
  }
  const fileMap = new Map<string, { key: string; blob: unknown; name: string; type: string }>();
  const BATCH = 800;
  for (let i = 0; i < allKeys.length; i += BATCH) {
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const keys = allKeys.slice(i, i + BATCH);
    const gets = keys.map((k) =>
      reqToPromise<{ key: string; blob: unknown; name: string; type: string } | undefined>(
        store.get(k) as IDBRequest<any>
      )
    );
    const rows = await Promise.all(gets);
    for (const r of rows) if (r) fileMap.set(r.key, r);
    await txDone(tx);
  }

  const states: Record<string, MangaImportState> = {};
  const mangas: ParsedManga[] = [];
  for (const sm of session.mangas) {
    const coverRow = sm.coverKey ? fileMap.get(sm.coverKey) : undefined;
    const coverFile = coverRow ? reviveFile(coverRow) : null;

    const chapters: ParsedChapter[] = sm.chapters.map((c) => ({
      name: c.name,
      number: c.number,
      files: c.fileKeys.map((k, i) => {
        const row = fileMap.get(k);
        if (!row) throw new Error(`Thiếu file trong phiên đã lưu: ${c.fileNames[i]}`);
        return reviveFile(row);
      }),
    }));

    mangas.push({
      id: sm.id,
      folderName: sm.folderName,
      title: sm.title,
      meta: sm.meta,
      coverFile,
      chapters,
      totalFiles: sm.totalFiles,
      totalBytes: sm.totalBytes,
      warnings: sm.warnings,
      hasInfoFile: sm.hasInfoFile,
    });

    if (sm.state) states[sm.id] = sm.state;
  }

  return {
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    mode: session.mode,
    mangas,
    states,
  };
}

/** Xóa phiên nhập (khi hoàn tất / user hủy bỏ) */
export async function deleteImportSession(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([SESSION_STORE, FILES_STORE], "readwrite");
    tx.objectStore(SESSION_STORE).clear();
    tx.objectStore(FILES_STORE).clear();
    await txDone(tx);
  } catch {
    // best-effort
  }
}

/** Đếm số truyện còn dang dở trong phiên (nhanh — không đọc file) */
export async function peekUnfinishedCount(): Promise<number> {
  try {
    const db = await openDb();
    const session = await readSessionRecord(db);
    if (!session) return 0;
    const pending = session.mangas.filter((m) => {
      const s = m.state?.status;
      return !s || s === "pending" || s === "importing" || s === "error" || s === "cancelled";
    });
    return pending.length;
  } catch {
    return 0;
  }
}
