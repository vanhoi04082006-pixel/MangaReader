// =============================================================
// ZIP Reader (client-side, streaming-friendly)
//
// Thay vi giai nen TOAN BO archive vao RAM, ta:
// 1. Doc Central Directory o cuoi file (chi la index — rat nho)
// 2. Natural-sort danh sach entry anh
// 3. Giai nen & upload tung entry mot theo thu tu
//
// Ho tro ZIP64 (>4GB / >65535 entries). Deflate + Store.
// =============================================================

import { inflateSync } from "fflate";

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number; // 0 = store, 8 = deflate
  localOffset: number;
}

export class ZipParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipParseError";
  }
}

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

const TAIL_SCAN_SIZE = 66_000; // EOCD(22) + max comment(65535) + dư

/** Gioi han so entry anh toi da cho 1 lan upload (khop schema finalize). */
export const MAX_ZIP_IMAGE_ENTRIES = 3000;

/** Gioi han kich thuoc giai nen 1 entry — chong decompression bomb. */
export const MAX_ENTRY_UNCOMPRESSED = 100 * 1024 * 1024; // 100MB

async function readSlice(file: File, start: number, end: number): Promise<DataView> {
  const buf = await file.slice(start, Math.min(end, file.size)).arrayBuffer();
  return new DataView(buf);
}

function u16(dv: DataView, off: number): number {
  return dv.getUint16(off, true);
}
function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true);
}
function u64(dv: DataView, off: number): number {
  // kich thuoc thuc te cua manga chapter khong vuot Number.MAX_SAFE_INTEGER
  return Number(dv.getBigUint64(off, true));
}

/** Tim End of Central Directory (quet nguoc tu cuoi file) */
async function findEOCD(file: File): Promise<{ dv: DataView; scanPos: number }> {
  const scanStart = Math.max(0, file.size - TAIL_SCAN_SIZE);
  const dv = await readSlice(file, scanStart, file.size);
  for (let i = dv.byteLength - 22; i >= 0; i--) {
    if (u32(dv, i) === EOCD_SIG) return { dv, scanPos: i };
  }
  throw new ZipParseError(
    "Không tìm thấy End of Central Directory — file ZIP hỏng hoặc không đúng định dạng ZIP."
  );
}

/** Doc index (central directory) cua file ZIP — KHONG giai nen du lieu anh */
export async function readZipIndex(file: File): Promise<ZipEntryInfo[]> {
  if (file.size < 22) throw new ZipParseError("File quá nhỏ để là một ZIP hợp lệ.");

  const { dv: eocdDv, scanPos } = await findEOCD(file);
  const eocdAbs = Math.max(0, file.size - TAIL_SCAN_SIZE) + scanPos;

  let totalEntries = u16(eocdDv, scanPos + 10);
  let cdSize = u32(eocdDv, scanPos + 12);
  let cdOffset = u32(eocdDv, scanPos + 16);

  // ZIP64?
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locatorOffset = eocdAbs + 22;
    if (locatorOffset + 20 <= file.size) {
      const loc = await readSlice(file, locatorOffset, locatorOffset + 20);
      if (u32(loc, 0) === EOCD64_LOCATOR_SIG) {
        const zip64Offset = u64(loc, 8);
        const eocd64 = await readSlice(file, zip64Offset, zip64Offset + 56);
        if (u32(eocd64, 0) === EOCD64_SIG) {
          totalEntries = u64(eocd64, 32);
          cdSize = u64(eocd64, 40);
          cdOffset = u64(eocd64, 48);
        }
      }
    }
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ZipParseError("Cấu trúc ZIP64 không hợp lệ.");
    }
  }

  if (cdOffset + cdSize > file.size) {
    throw new ZipParseError("Central Directory vượt khỏi file — ZIP có thể bị hỏng.");
  }
  if (totalEntries > 100_000) {
    throw new ZipParseError(
      `Số lượng tập tin trong ZIP quá lớn (${totalEntries}) — từ chối xử lý.`
    );
  }

  const cd = await readSlice(file, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntryInfo[] = [];

  let pos = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > cd.byteLength) break;
    if (u32(cd, pos) !== CEN_SIG) break;

    const method = u16(cd, pos + 10);
    let compressedSize = u32(cd, pos + 20);
    let uncompressedSize = u32(cd, pos + 24);
    const nameLen = u16(cd, pos + 28);
    const extraLen = u16(cd, pos + 30);
    const commentLen = u16(cd, pos + 32);
    let localOffset = u32(cd, pos + 42);

    const name = decoder.decode(new Uint8Array(cd.buffer, pos + 46, nameLen));

    // ZIP64 extra field (id = 0x0001)
    if (extraLen > 0) {
      let epos = pos + 46 + nameLen;
      const eEnd = epos + extraLen;
      while (epos + 4 <= eEnd) {
        const eId = u16(cd, epos);
        const eSize = u16(cd, epos + 2);
        if (eId === 0x0001) {
          let fpos = epos + 4;
          if (uncompressedSize === 0xffffffff && fpos + 8 <= eEnd) {
            uncompressedSize = u64(cd, fpos);
            fpos += 8;
          }
          if (compressedSize === 0xffffffff && fpos + 8 <= eEnd) {
            compressedSize = u64(cd, fpos);
            fpos += 8;
          }
          if (localOffset === 0xffffffff && fpos + 8 <= eEnd) {
            localOffset = u64(cd, fpos);
          }
          break;
        }
        epos += 4 + eSize;
      }
    }

    if (!name.endsWith("/")) {
      entries.push({ name, compressedSize, uncompressedSize, method, localOffset });
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (entries.length === 0) {
    throw new ZipParseError("ZIP không có tập tin nào hợp lệ.");
  }
  return entries;
}

/**
 * Giai nen 1 entry (chi giu 1 anh trong RAM tai 1 thoi diem).
 * Kiem tra bounds truoc khi doc de tranh RangeError/logical bug.
 */
export async function extractZipEntry(file: File, entry: ZipEntryInfo): Promise<Blob> {
  if (entry.localOffset < 0 || entry.localOffset + 30 > file.size) {
    throw new ZipParseError(`Offset tập tin không hợp lệ: ${entry.name}`);
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
    throw new ZipParseError(
      `Tập tin giải nén quá lớn (${(entry.uncompressedSize / 1024 / 1024) | 0}MB): ${entry.name}`
    );
  }
  const lfh = await readSlice(file, entry.localOffset, entry.localOffset + 30);
  if (u32(lfh, 0) !== LFH_SIG) {
    throw new ZipParseError(`Local header không hợp lệ cho tập tin: ${entry.name}`);
  }
  const nameLen = u16(lfh, 26);
  const extraLen = u16(lfh, 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataStart > file.size || dataEnd > file.size) {
    throw new ZipParseError(`Dữ liệu tập tin vượt khỏi file: ${entry.name}`);
  }

  const raw = await file.slice(dataStart, dataEnd).arrayBuffer();

  if (entry.method === 0) {
    return new Blob([raw]);
  }
  if (entry.method === 8) {
    try {
      const inflated = inflateSync(new Uint8Array(raw));
      return new Blob([inflated]);
    } catch {
      throw new ZipParseError(`Không giải nén được tập tin (dữ liệu hỏng?): ${entry.name}`);
    }
  }
  throw new ZipParseError(`Phương thức nén không được hỗ trợ (${entry.method}): ${entry.name}`);
}

/** Loc entry anh hop le + loai bo file he thong khong can thiet
 *  + gioi han so luong (MAX_ZIP_IMAGE_ENTRIES) + chong bomb (size). */
export function filterImageEntries(
  entries: ZipEntryInfo[]
): { valid: ZipEntryInfo[]; skipped: string[]; overflowed: boolean } {
  const valid: ZipEntryInfo[] = [];
  const skipped: string[] = [];
  let overflowed = false;
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    if (
      lower.includes("__macosx/") ||
      e.name.split("/").some((seg) => seg.startsWith(".")) ||
      /\.(txt|nfo|xml|json|db|zip|rar|7z|url|lnk|ds_store)$/.test(lower)
    ) {
      skipped.push(e.name);
      continue;
    }
    if (/\.(jpe?g|png|webp|avif|gif)$/.test(lower)) {
      // Chong decompression bomb: entry giai nen > 100MB -> bo qua
      if (e.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
        skipped.push(e.name);
        continue;
      }
      if (valid.length >= MAX_ZIP_IMAGE_ENTRIES) {
        overflowed = true;
        skipped.push(e.name);
        continue;
      }
      valid.push(e);
    } else {
      skipped.push(e.name);
    }
  }
  return { valid, skipped, overflowed };
}
