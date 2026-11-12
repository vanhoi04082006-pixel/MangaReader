// =============================================================
// Upload Engine (client-side)
//
// - Worker pool (3 anh cung thoi diem) de khong lam ro mang
// - Moi trang: presign -> PUT truc tiep R2 -> fallback proxy qua server
// - Progress theo so trang + theo bytes (EMA speed, ETA)
// - Cancel: abort XHR + goi /api/uploads/abort de don object mo coi tren R2
// - Retry an toan: item da presign thi KHONG presign lai (tranh trung
//   objectKey unique trong storage_objects), chi PUT lai
// =============================================================

"use client";

import { api, putToR2, uploadViaProxy } from "@/lib/client/api";
import { MAX_PROXY_FILE_SIZE } from "@/schemas";
import type { PresignResponseDto } from "@/types";

export type PageStatus = "pending" | "uploading" | "uploaded" | "error";

export interface PageItem {
  id: string;
  /** Ten file hien thi (basename, da gioi han 255 ky tu) */
  name: string;
  /** Dung luong giai nen (bytes) */
  size: number;
  mimeType: string;
  /** So thu tu trang (1-based) — gan truoc khi upload */
  pageNumber?: number;
  status: PageStatus;
  error?: string;
  objectKey?: string;
  uploadUrl?: string;
  width: number | null;
  height: number | null;
  /** Lazy load noi dung anh (ZIP: extract tung entry; file: tra truc tiep) */
  loadBlob: () => Promise<Blob>;
}

export interface UploadProgress {
  total: number;
  uploaded: number;
  failed: number;
  bytesTotal: number;
  bytesUploaded: number;
  /** bytes/giay (EMA) */
  speed: number;
  etaSeconds: number | null;
}

export interface UploadRunResult {
  uploaded: number;
  failed: number;
  cancelled: boolean;
}

const CONCURRENCY = 3;
const PROGRESS_THROTTLE_MS = 150;
const SPEED_SAMPLE_MS = 500;

export class UploadEngine {
  private cancelledFlag = false;
  private ctrl = new AbortController();
  private loaded = new Map<string, number>();
  private presignedKeys: string[] = [];
  private uploadedBytes = 0;
  private items: PageItem[] = [];
  private counts = { uploaded: 0, failed: 0 };
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSample = { t: 0, bytes: 0, speed: 0 };
  private finalized = false;

  constructor(
    private opts: {
      mangaId: string;
      chapterId: string;
      onItemChange: (id: string, patch: Partial<PageItem>) => void;
      onProgress: (p: UploadProgress) => void;
    }
  ) {}

  get isCancelled(): boolean {
    return this.cancelledFlag;
  }

  cancel(): void {
    this.cancelledFlag = true;
    this.ctrl.abort();
  }

  // ---------------- progress ----------------

  private bytesUploadedNow(): number {
    let inFlight = 0;
    for (const v of this.loaded.values()) inFlight += v;
    return this.uploadedBytes + inFlight;
  }

  private emit(force = false): void {
    if (this.finalized && !force) return;
    const doEmit = () => {
      this.emitTimer = null;
      const now = performance.now();
      const bytes = this.bytesUploadedNow();
      if (this.lastSample.t === 0) {
        this.lastSample = { t: now, bytes, speed: 0 };
      }
      const dt = (now - this.lastSample.t) / 1000;
      if (dt >= SPEED_SAMPLE_MS / 1000) {
        const inst = Math.max(0, (bytes - this.lastSample.bytes) / dt);
        // EMA de lam muon nhieu
        this.lastSample = { t: now, bytes, speed: this.lastSample.speed * 0.6 + inst * 0.4 };
      }
      const bytesTotal = this.items.reduce((s, it) => s + it.size, 0);
      const speed = this.lastSample.speed;
      const eta = speed > 1024 && bytesTotal > bytes ? (bytesTotal - bytes) / speed : null;
      this.opts.onProgress({
        total: this.items.length,
        uploaded: this.counts.uploaded,
        failed: this.counts.failed,
        bytesTotal,
        bytesUploaded: Math.min(bytes, bytesTotal),
        speed,
        etaSeconds: eta,
      });
    };

    if (force) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.finalized = true;
      doEmit();
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(doEmit, PROGRESS_THROTTLE_MS);
    }
  }

  // ---------------- presign ----------------

  private async ensurePresigned(item: PageItem): Promise<PresignResponseDto> {
    if (item.objectKey && item.uploadUrl) {
      // Retry: dung lai presign cu (URL con han 15 phut) — khong tao key moi
      return { objectKey: item.objectKey, uploadUrl: item.uploadUrl, storageObjectId: "" };
    }
    const res = await api.post<PresignResponseDto>("/api/uploads/presign", {
      kind: "PAGE",
      mangaId: this.opts.mangaId,
      chapterId: this.opts.chapterId,
      fileName: item.name,
      mimeType: item.mimeType,
      fileSize: item.size,
      pageNumber: item.pageNumber ?? 1,
    });
    this.presignedKeys.push(res.objectKey);
    this.opts.onItemChange(item.id, { objectKey: res.objectKey, uploadUrl: res.uploadUrl });
    return res;
  }

  /** Do kich thuoc anh (de reader tinh khung + preload) — best effort */
  private async measure(item: PageItem, blob: Blob): Promise<void> {
    if (item.width != null) return;
    try {
      const bmp = await createImageBitmap(blob);
      this.opts.onItemChange(item.id, { width: bmp.width, height: bmp.height });
      bmp.close();
    } catch {
      // GIF lien tuc / du lieu la — bo qua, khong chan upload
    }
  }

  // ---------------- upload 1 trang ----------------

  private async uploadOne(item: PageItem): Promise<void> {
    const { signal } = this.ctrl;
    this.opts.onItemChange(item.id, { status: "uploading", error: undefined });
    try {
      const presign = await this.ensurePresigned(item);
      const blob = await item.loadBlob();
      await this.measure(item, blob);

      const track = (loaded: number) => {
        this.loaded.set(item.id, loaded);
        this.emit();
      };

      try {
        await putToR2(presign.uploadUrl, blob, item.mimeType, track, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        // CORS / presigned URL het han -> proxy qua Next server.
        // NHUNG: proxy bi gioi han kich thuoc (Vercel ~4.5MB body) — file
        // lon hon thi KHONG thu proxy, bao loi ro rang (can CORS cho bucket).
        if (blob.size > MAX_PROXY_FILE_SIZE) {
          throw new Error(
            `Không upload trực tiếp được R2 (CORS/mạng) và file (${(blob.size / 1024 / 1024).toFixed(1)}MB) vượt giới hạn proxy (${(
              MAX_PROXY_FILE_SIZE / 1024 / 1024
            ) | 0}MB). Hãy cấu hình CORS cho bucket R2.`
          );
        }
        await uploadViaProxy(presign.objectKey, blob, item.mimeType, track, signal);
      }

      this.loaded.delete(item.id);
      this.uploadedBytes += item.size;
      this.counts.uploaded += 1;
      this.opts.onItemChange(item.id, { status: "uploaded" });
    } catch (err) {
      this.loaded.delete(item.id);
      if (this.cancelledFlag || signal.aborted) {
        throw new DOMException("Cancelled", "AbortError");
      }
      this.counts.failed += 1;
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      this.opts.onItemChange(item.id, { status: "error", error: msg });
    } finally {
      this.emit();
    }
  }

  // ---------------- run ----------------

  /** Chay worker pool cho danh sach items (item.pageNumber phai da gan). */
  async run(items: PageItem[]): Promise<UploadRunResult> {
    this.items = items;
    this.emit(true);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!this.cancelledFlag) {
        const i = cursor++;
        if (i >= items.length) break;
        try {
          await this.uploadOne(items[i]);
        } catch {
          break; // cancelled
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, worker)
    );

    this.emit(true);
    return {
      uploaded: this.counts.uploaded,
      failed: this.counts.failed,
      cancelled: this.cancelledFlag,
    };
  }

  /**
   * Don dep khi huy / upload do: xoa object tren R2 + row PENDING.
   * Luon goi khi KHONG finalize (dung de chong lai object mo coi).
   */
  async abortAll(): Promise<void> {
    const keys = [...this.presignedKeys];
    this.presignedKeys = [];
    for (let i = 0; i < keys.length; i += 500) {
      try {
        await api.post("/api/uploads/abort", { objectKeys: keys.slice(i, i + 500) });
      } catch {
        // best-effort — cleanup route con song
      }
    }
  }
}
