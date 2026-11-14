// =============================================================
// Folder parser — parse cấu trúc thư mục truyện thành dữ liệu
// import (chạy hoàn toàn phía client, không cần server).
//
// Cấu trúc mong đợi (quy ước hentaivn):
//   Roubaitei (Hololive)/     ← tên thư mục = tên truyện
//   ├── info.txt              ← metadata ("Tên: ...", "Thể Loại: ..." mỗi dòng)
//   ├── cover.jpg             ← ảnh bìa (bất kỳ định dạng ảnh nào)
//   ├── Chương 1/             ← mỗi thư mục con = 1 chương (tên = tên chương)
//   │   ├── 1.jpg
//   │   ├── 2.jpg ...         ← ảnh đánh số → sort tự nhiên (2 < 10)
//   └── Chương 2/ ...
//
// - Chọn thư mục CHA chứa nhiều bộ truyện cũng được: mỗi thư mục con
//   (có info.txt/cover/chương) sẽ được coi là 1 bộ truyện.
// - Trường trong info.txt mà web KHÔNG hỗ trợ (Nhóm dịch, Lượt xem,
//   Update, Nguồn...) → bỏ qua. Trường thiếu → bỏ trống / dùng mặc định.
// =============================================================

import { naturalSortFiles } from "@/utils/natural-sort";
import type { MangaStatus } from "@/schemas";

/** Giới hạn khớp schema server: pagesFinalizeSchema max 3000 trang/chương */
export const MAX_PAGES_PER_CHAPTER = 3000;
/** mangaCreateSchema: genres max 20, mỗi tên ≤ 60 ký tự */
const MAX_GENRES = 20;
const MAX_GENRE_LEN = 60;

export interface FileWithPath {
  file: File;
  /** Đường dẫn tương đối, VD: "Manga/Chương 1/001.jpg" */
  path: string;
}

export interface ParsedChapter {
  name: string; // tên thư mục chương
  number: string; // số chương parse được ("1", "2.5") hoặc tên thư mục
  files: File[]; // ảnh đã sort đúng thứ tự tự nhiên
}

export interface ParsedMangaMeta {
  alternativeTitles: string | null;
  author: string | null;
  status: MangaStatus;
  description: string | null;
  genres: string[];
  /** "Nguồn" trong info.txt — dung de nhan dien truyen trung khi import */
  sourceUrl: string | null;
}

export interface ParsedManga {
  id: string;
  folderName: string;
  title: string;
  meta: ParsedMangaMeta;
  coverFile: File | null;
  chapters: ParsedChapter[];
  totalFiles: number;
  totalBytes: number;
  warnings: string[];
  hasInfoFile: boolean;
}

// ---------------- helpers ----------------

const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const COVER_RE = /^(cover|bia|banner|thumbnail|thumb)(?:[\s_-]?\d*)?\.(jpe?g|png|webp|avif|gif)$/i;
const INFO_RE = /^info\.txt$/i;

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Bỏ dấu tiếng Việt + lowercase để so khớp key info.txt linh hoạt */
function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface InfoTxtFields {
  title?: string;
  alternativeTitles?: string;
  genres?: string;
  author?: string;
  status?: string;
  description?: string;
  sourceUrl?: string;
}

/**
 * Parse nội dung info.txt ("Key: value" mỗi dòng).
 * Key so khớp KHÔNG phân biệt hoa thường/dấu ("Tên", "ten", "TÊN" đều được).
 * Key lạ (Nhóm dịch, Lượt xem, Update, Nguồn...) bị bỏ qua một cách im lặng.
 */
export function parseInfoTxt(text: string): InfoTxtFields {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const raw: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = normalizeKey(line.slice(0, idx));
    const value = line.slice(idx + 1).trim();
    if (key) raw[key] = value;
  }
  // Key đã được normalize (bỏ dấu, lowercase) — tra cứu bằng key không dấu
  return {
    title: raw["ten"] ?? raw["name"],
    alternativeTitles: raw["ten khac"] ?? raw["alt"] ?? raw["alternative"],
    genres: raw["the loai"] ?? raw["genre"] ?? raw["genres"] ?? raw["categories"],
    author: raw["tac gia"] ?? raw["author"] ?? raw["artist"],
    status: raw["tinh trang"] ?? raw["status"],
    description: raw["mo ta"] ?? raw["description"],
    sourceUrl: raw["nguon"] ?? raw["nguon goc"] ?? raw["source"] ?? raw["source url"] ?? raw["link"],
  };
}

/** Map "Tình Trạng" tiếng Việt → mã status (mặc định ONGOING) */
export function mapStatus(s: string | undefined): MangaStatus {
  const t = (s ?? "").toLowerCase();
  if (!t) return "ONGOING";
  if (t.includes("hoàn thành") || t.includes("hoan thanh") || t.includes("full") || t.includes("complete"))
    return "COMPLETED";
  if (t.includes("tạm dừng") || t.includes("tam dung") || t.includes("hiatus") || t.includes("tạm ngưng") || t.includes("tam ngung"))
    return "HIATUS";
  if (t.includes("ngừng") || t.includes("ngung") || t.includes("drop")) return "DROPPED";
  return "ONGOING";
}

/** Tách "Thể Loại" thành mảng genre hợp lệ với schema (≤20, mỗi cái ≤60 ký tự) */
export function parseGenres(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of (raw ?? "").split(/[,;]/)) {
    const name = g.trim().slice(0, MAX_GENRE_LEN).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_GENRES) break;
  }
  return out;
}

/**
 * Parse số chương từ tên thư mục: "Chương 12", "Chapter 5", "023",
 * "v2 c005", "5.5", "Extra" → "12" / "5" / "023" / "005" / "5.5" / "Extra".
 */
export function parseChapterNumber(name: string): string {
  const trimmed = name.trim();
  // Ưu tiên mẫu có chữ c/ch/chương/chapter + số (tránh nhặt số volume);
  // \bc rieng để bắt "c005" / "c 5" sau volume ("v2 c005")
  const withPrefix = trimmed.match(
    /(?:ch(?:apter|uong|ương)?\.?\s*|vol\.?\s*\d+\s*c\.?\s*|\bc\.?\s*)(\d+(?:\.\d+)?)/i
  );
  if (withPrefix) return withPrefix[1];
  const plain = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (plain) return plain[1];
  return trimmed.slice(0, 50) || "?";
}

/**
 * Số chương duy nhất theo thứ tự thư mục. Nếu 2 thư mục cùng số (VD "Chap 1"
 * và "(Jou) Chap 1") thì thư mục sau nhận hậu tố "-2", "-3"... để không đè nhau.
 * Giới hạn 50 ký tự theo chapterCreateSchema.
 */
export function assignChapterNumbers(
  chapters: Array<Pick<ParsedChapter, "number">>
): string[] {
  const used = new Set<string>();
  return chapters.map((ch, i) => {
    const base = (ch.number?.trim() || String(i + 1)).slice(0, 50);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let k = 2;
    let unique = `${base.slice(0, 50 - String(k).length - 1)}-${k}`;
    while (used.has(unique)) {
      k++;
      unique = `${base.slice(0, 50 - String(k).length - 1)}-${k}`;
    }
    used.add(unique);
    return unique;
  });
}

// ---------------- build từ danh sách file ----------------

interface FolderNode {
  name: string;
  files: FileWithPath[]; // file trực tiếp trong thư mục
  subFolders: Map<string, FolderNode>;
}

function makeNode(name: string): FolderNode {
  return { name, files: [], subFolders: new Map() };
}

/** Thêm file vào cây thư mục theo path */
function insertFile(root: FolderNode, item: FileWithPath) {
  const parts = item.path.split("/").filter(Boolean);
  if (parts.length === 0) return;
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    if (!node.subFolders.has(seg)) node.subFolders.set(seg, makeNode(seg));
    node = node.subFolders.get(seg)!;
  }
  node.files.push(item);
}

/** Gom mọi ảnh trong thư mục (kể cả thư mục con) — sort tự nhiên theo đường dẫn */
function collectImagesDeep(node: FolderNode): File[] {
  const items: FileWithPath[] = [];
  const walk = (n: FolderNode, prefix: string) => {
    for (const f of n.files) {
      if (IMAGE_RE.test(f.file.name)) items.push({ file: f.file, path: prefix + f.file.name });
    }
    for (const sub of n.subFolders.values()) walk(sub, `${prefix}${sub.name}/`);
  };
  walk(node, "");
  return naturalSortFiles(items, (it) => it.path).map((it) => it.file);
}

function buildChaptersFromNode(mangaNode: FolderNode, warnings: string[]): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  const chapterNames = [...mangaNode.subFolders.keys()];
  const sortedNames = naturalSortFiles(chapterNames, (n) => n);
  for (const name of sortedNames) {
    const node = mangaNode.subFolders.get(name)!;
    const images = collectImagesDeep(node);
    if (images.length === 0) {
      warnings.push(`Thư mục "${name}" không có ảnh — bỏ qua.`);
      continue;
    }
    if (images.length > MAX_PAGES_PER_CHAPTER) {
      warnings.push(
        `Chương "${name}" có ${images.length} ảnh (tối đa ${MAX_PAGES_PER_CHAPTER}) — chỉ giữ ${MAX_PAGES_PER_CHAPTER} ảnh đầu.`
      );
      images.length = MAX_PAGES_PER_CHAPTER;
    }
    chapters.push({ name, number: parseChapterNumber(name), files: images });
  }
  return chapters;
}

/** Tìm file bìa trong các file trực tiếp của thư mục truyện */
function findCover(node: FolderNode): File | null {
  const direct = node.files;
  // Ưu tiên tên chuẩn "cover.*" / "bia.*" / "banner.*" / "thumbnail.*"
  const cover = direct.find((f) => COVER_RE.test(f.file.name));
  if (cover) return cover.file;
  // Fallback: ảnh đầu tiên ở gốc thư mục (sau khi sort)
  const images = naturalSortFiles(
    direct.filter((f) => IMAGE_RE.test(f.file.name)),
    (f) => f.file.name
  );
  return images[0]?.file ?? null;
}

/** Parse 1 thư mục truyện thành ParsedManga (async — đọc info.txt) */
async function buildMangaFromNode(node: FolderNode): Promise<ParsedManga> {
  const warnings: string[] = [];
  const meta: ParsedMangaMeta = {
    alternativeTitles: null,
    author: null,
    status: "ONGOING",
    description: null,
    genres: [],
    sourceUrl: null,
  };
  let title = node.name;
  let hasInfoFile = false;

  const infoFile = node.files.find((f) => INFO_RE.test(f.file.name));
  if (infoFile) {
    hasInfoFile = true;
    try {
      const text = await infoFile.file.text();
      const fields = parseInfoTxt(text);
      // "Tên" trong info.txt ưu tiên; thiếu/rỗng thì dùng tên thư mục
      if (fields.title?.trim()) title = fields.title;
      meta.alternativeTitles = fields.alternativeTitles?.trim().slice(0, 1000) || null;
      meta.author = fields.author?.trim().slice(0, 200) || null;
      meta.status = mapStatus(fields.status);
      meta.description = fields.description?.trim().slice(0, 8000) || null;
      meta.genres = parseGenres(fields.genres);
      meta.sourceUrl = fields.sourceUrl?.trim().slice(0, 500) || null;
    } catch {
      warnings.push("Không đọc được info.txt.");
    }
  } else {
    warnings.push("Không có info.txt — dùng tên thư mục làm tên truyện.");
  }

  const coverFile = findCover(node);
  if (!coverFile) warnings.push("Không tìm thấy ảnh bìa (cover).");

  const chapters = buildChaptersFromNode(node, warnings);
  if (chapters.length === 0) {
    warnings.push("Không có chương nào (thư mục con chứa ảnh).");
  }

  const totalFiles = chapters.reduce((s, c) => s + c.files.length, 0);
  const totalBytes = chapters.reduce(
    (s, c) => s + c.files.reduce((ss, f) => ss + f.size, 0),
    0
  );

  return {
    id: uid(),
    folderName: node.name,
    title: title.trim().slice(0, 300) || node.name,
    meta,
    coverFile,
    chapters,
    totalFiles,
    totalBytes,
    warnings,
    hasInfoFile,
  };
}

function nodeHasInfo(node: FolderNode): boolean {
  return node.files.some((f) => INFO_RE.test(f.file.name));
}
function nodeHasCoverLike(node: FolderNode): boolean {
  return node.files.some((f) => COVER_RE.test(f.file.name));
}
/** Thư mục con có vẻ là 1 bộ truyện (có info/cover ở gốc, hoặc có thư mục cháu chứa ảnh) */
function looksLikeMangaFolder(node: FolderNode): boolean {
  if (nodeHasInfo(node) || nodeHasCoverLike(node)) return true;
  for (const sub of node.subFolders.values()) {
    if (sub.files.some((f) => IMAGE_RE.test(f.file.name))) return true;
  }
  return false;
}

/**
 * Build danh sách truyện từ các file đã chọn.
 * Tự nhận diện:
 *  - Thư mục được chọn CHÍNH LÀ 1 bộ truyện (có info.txt/cover ở gốc)
 *  - Thư mục được chọn là CHA chứa nhiều bộ truyện (thư mục con trông giống 1 bộ)
 */
export async function buildMangasFromFiles(items: FileWithPath[]): Promise<{
  mangas: ParsedManga[];
  warnings: string[];
}> {
  const globalWarnings: string[] = [];
  if (items.length === 0) return { mangas: [], warnings: ["Không có file nào."] };

  // Lọc bỏ file ẩn macOS/Windows rác
  const usable = items.filter((it) => {
    const segs = it.path.split("/");
    return !segs.some((s) => s === "__MACOSX" || s.startsWith("._") || s === ".DS_Store" || s === "Thumbs.db");
  });
  if (usable.length === 0) return { mangas: [], warnings: ["Không có file hợp lệ."] };

  const root = makeNode("__root__");
  for (const it of usable) insertFile(root, it);

  // Các "gốc" = thư mục cấp 1 (tên thư mục được chọn / được kéo vào)
  const roots = [...root.subFolders.values()];
  if (roots.length === 0) return { mangas: [], warnings: ["Không đọc được cấu trúc thư mục."] };

  const mangas: ParsedManga[] = [];

  for (const r of roots) {
    // Root KHÔNG phải là 1 bộ truyện (không info.txt, không cover ở gốc)
    // và các thư mục con trông giống bộ truyện → root là thư mục CHA
    const isContainer =
      r.subFolders.size > 0 &&
      !nodeHasInfo(r) &&
      !nodeHasCoverLike(r) &&
      [...r.subFolders.values()].some((sub) => looksLikeMangaFolder(sub));

    if (isContainer) {
      // Mỗi thư mục con là 1 bộ truyện
      const subNames = naturalSortFiles([...r.subFolders.keys()], (n) => n);
      for (const name of subNames) {
        const node = r.subFolders.get(name)!;
        const manga = await buildMangaFromNode(node);
        if (manga.chapters.length > 0 || manga.coverFile) {
          mangas.push(manga);
        } else {
          globalWarnings.push(`Bỏ qua "${name}" — không có chương/ảnh.`);
        }
      }
    } else {
      // Root chính là 1 bộ truyện
      const manga = await buildMangaFromNode(r);
      if (manga.chapters.length > 0 || manga.coverFile) {
        mangas.push(manga);
      } else {
        globalWarnings.push(`Bỏ qua "${r.name}" — không có chương/ảnh.`);
      }
    }
  }

  return { mangas, warnings: globalWarnings };
}

/** Lấy danh sách file từ drop (đệ quy thư mục, giữ đường dẫn) */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<FileWithPath[]> {
  const out: FileWithPath[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    return Array.from(dt.files ?? []).map((f) => ({ file: f, path: f.name }));
  }

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((res) =>
        (entry as FileSystemFileEntry).file(
          (f) => res(f),
          () => res(null)
        )
      );
      if (file) out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const dir = entry as FileSystemDirectoryEntry;
      const reader = dir.createReader();
      const readBatch = (): Promise<FileSystemEntry[]> =>
        new Promise((res) => reader.readEntries((b) => res(b), () => res([])));
      let batch = await readBatch();
      while (batch.length > 0) {
        for (const e of batch) await walk(e, `${prefix}${dir.name}/`);
        batch = await readBatch();
      }
    }
  };

  for (const e of entries) await walk(e, "");
  return out;
}

/** Lấy FileWithPath[] từ input[webkitdirectory] hoặc input multiple */
export function fromInputFiles(files: FileList | null): FileWithPath[] {
  if (!files) return [];
  return Array.from(files).map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    return { file: f, path: rel };
  });
}
