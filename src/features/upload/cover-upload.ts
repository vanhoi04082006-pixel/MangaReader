// =============================================================
// Cover upload helper — dùng chung cho MangaFormDialog và
// Batch Import (presign COVER → PUT R2/proxy → finalize).
// =============================================================

import { api, putToR2, uploadViaProxy, ApiClientError } from "@/lib/client/api";
import { MAX_PROXY_FILE_SIZE } from "@/schemas";

/** Chuẩn hóa MIME từ tên file — COVER presign yêu cầu MIME thuộc whitelist */
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

export function coverMimeFromFile(file: File): string | null {
  const byType = file.type.toLowerCase();
  if (Object.values(EXT_TO_MIME).includes(byType)) return byType;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Upload ảnh bìa cho truyện: presign → PUT trực tiếp R2 (fallback proxy
 * ≤ 4MB) → finalize POST /api/mangas/:id/cover (server HeadObject xác minh).
 */
export async function uploadCoverToR2(mangaId: string, file: File): Promise<string> {
  const mimeType = coverMimeFromFile(file);
  if (!mimeType) {
    throw new Error(`Ảnh bìa không đúng định dạng (jpg/png/webp/avif/gif): ${file.name}`);
  }
  const presign = await api.post<{ objectKey: string; uploadUrl: string }>(
    "/api/uploads/presign",
    {
      kind: "COVER",
      mangaId,
      fileName: file.name,
      mimeType,
      fileSize: file.size,
    }
  );
  try {
    await putToR2(presign.uploadUrl, file, mimeType);
  } catch (err) {
    if (err instanceof ApiClientError && (err.code === "network" || err.status === 0)) {
      // CORS/mạng → proxy qua server (giới hạn 4MB)
      if (file.size > MAX_PROXY_FILE_SIZE) {
        throw new Error(
          `Không upload trực tiếp được R2 (CORS/mạng) và ảnh bìa (${(
            file.size /
            1024 /
            1024
          ).toFixed(1)}MB) vượt giới hạn proxy (4MB). Hãy cấu hình CORS cho bucket R2.`
        );
      }
      await uploadViaProxy(presign.objectKey, file, mimeType);
    } else {
      throw err;
    }
  }
  await api.post(`/api/mangas/${mangaId}/cover`, {
    mangaId,
    objectKey: presign.objectKey,
    fileName: file.name,
    mimeType,
    fileSize: file.size,
  });
  return presign.objectKey;
}
