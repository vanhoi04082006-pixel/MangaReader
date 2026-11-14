// =============================================================
// Upload Engine (client-side)
//
// - Worker pool (3 anh cung thoi diem) de khong lam ro mang
// - BATCH PRESIGN: 1 request cap URL cho toi da 100 file (lazy theo
//   cua so truoc khi upload) — import 7.297 anh chi con 73 request
//   presign thay vi 7.297 (hết cảnh 429 rate limit 1000/10phut).
// - Moi trang: presign -> PUT truc tiep R2 -> fallback proxy qua server
//   (engine TRACK mode direct/proxy de UI canh bao khi phai dung proxy)
// - Progress theo so trang + theo bytes (EMA speed, ETA)
// - Cancel: abort XHR + goi /api/uploads/abort de don object mo coi tren R2
// - Retry an toan: item da presign thi KHONG presign lai (tranh trung
//   objectKey unique trong storage_objects), chi PUT lai
// - 429/5xx: presign batch cho doi + retry backoff (R2/Supabase tam
//   thoi nghen — khong danh dau that bai ngay)
// - CHONG TREO 60s (Vercel serverless): api.ts dat timeout + watchdog
//   "stalled"; engine retry tung anh (backoff) khi gap loi tam thoi
//   (mang/timeout/5xx/429) truoc khi danh dau that bai
// =============================================================

"use client";

import { api, putToR2, uploadViaProxy, ApiClientError } from "@/lib/client/api";
import { MAX_PROXY_FILE_SIZE } from "@/schemas";
import type { PresignResponseDto } from "@/types";

export type PageStatus = "pending" | "uploading" | "uploaded" | "error";
/** Ke qua nao file duoc day len — hien thi "trực tiếp/qua máy chủ" tren UI. */
export type UploadVia = "direct" | "proxy";

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
  /** Ket noi nao da day file nay len (di theo sau khi upload xong) */
  via?: UploadVia;
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
  /** Ket noi gan nhat upload thanh cong (direct R2 hoac proxy). */
  via: UploadVia | null;
  /** So file phai fallback qua proxy (CORS R2 chan direct). */
  proxyCount: number;
}

export interface UploadRunResult {
  uploaded: number;
  failed: number;
  cancelled: boolean;
}

const CONCURRENCY = 3;
const PROGRESS_THROTTLE_MS = 150;
const SPEED_SAMPLE_MS = 500;
/** So lan retry tung anh khi gap loi tam thoi (ngoai lan dau) */
const MAX_ITEM_RETRIES = 2;
/** Backoff giua cac lan retry (ms) */
const RETRY_BACKOFF_MS = [2_000, 6_000];
/** 1 batch presign = toi da 100 URL */
const PRESIGN_BATCH_SIZE = 100;
/** Retry batch presign khi tam thoi nghen (429/5xx/mang) */
const MAX_PRESIGN_BATCH_RETRIES = 4;
const PRESIGN_RETRY_BACKOFF_MS = [3_000, 8_000, 15_000, 30_000];
/** 429: cho theo Retry-After (toi thieu 30s, toi da 90s) */
const RATE_LIMIT_WAIT_MIN_MS = 30_000;
const RATE_LIMIT_WAIT_MAX_MS = 90_000;

/** Loi tam thoi — retry cung presign URL se co kha nang thanh cong */
function isRetryableUploadError(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    if (err.code === "network" || err.code === "timeout" || err.code === "stalled") return true;
    if (err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504) return true;
  }
  return false;
}

/** Cho khi gap 429 (ut tin Retry-After neu co, doi 30–90s) */
function rateLimitWaitMs(err: unknown): number {
  const retryAfter = err instanceof ApiClientError ? err.retryAfterMs : null;
  const wait = retryAfter ?? RATE_LIMIT_WAIT_MIN_MS;
  return Math.min(Math.max(wait, RATE_LIMIT_WAIT_MIN_MS), RATE_LIMIT_WAIT_MAX_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

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
  /** Mode ket noi: null chua biet, "direct" gan nhat thanh cong qua R2, "proxy" qua server. */
  private lastVia: UploadVia | null = null;
  private proxyCount = 0;
  /** Lazy batch presign: item [0, presignCursor) da duoc cap URL. */
  private presignCursor = 0;
  private presignInflight: Promise<void> | null = null;
  /** Presign ket qua theo item.id — engine giu reference RIENG (onItemChange
   *  cua UI co the tao object moi theo immutable state, khong anh huong). */
  private presignMap = new Map<string, PresignResponseDto>();

  constructor(
    private opts: {
      mangaId: string;
      chapterId: string;
      onItemChange: (id: string, patch: Partial<PageItem>) => void;
      onProgress: (p: UploadProgress) => void;
      /** Hook tùy chọn: báo lỗi kèm HTTP status (batch import dùng để nhận diện 429) */
      onItemError?: (id: string, status: number | null) => void;
    }
  ) {}

  get isCancelled(): boolean {
    return this.cancelledFlag;
  }

  /** So file phai di qua proxy (CORS R2 chan direct) — UI dung de canh bao. */
  get proxyFallbackCount(): number {
    return this.proxyCount;
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
        via: this.lastVia,
        proxyCount: this.proxyCount,
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

  // ---------------- presign (BATCH, lazy) ----------------

  /**
   * Batch presign cho items trong [from, to). Bo qua item da co
   * objectKey (retry lai upload that bai khong tao key moi).
   * 429/5xx/mang: cho doi + retry (backoff, 429 cho 30–90s).
   */
  private async presignBatchRange(from: number, to: number): Promise<void> {
    const need = this.items.slice(from, to).filter((it) => !(it.objectKey && it.uploadUrl));
    if (need.length === 0) return;

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= MAX_PRESIGN_BATCH_RETRIES; attempt++) {
      if (this.ctrl.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        const res = await api.post<{ items: PresignResponseDto[]; batchSize: number }>(
          "/api/uploads/presign-batch",
          {
            mangaId: this.opts.mangaId,
            chapterId: this.opts.chapterId,
            items: need.map((it) => ({
              fileName: it.name,
              mimeType: it.mimeType,
              fileSize: it.size,
              pageNumber: it.pageNumber ?? 1,
            })),
          }
        );
        if (!res.items || res.items.length !== need.length) {
          throw new ApiClientError("Phản hồi presign batch không khớp số file.", 0, "protocol");
        }
        need.forEach((it, idx) => {
          const r = res.items[idx];
          this.presignedKeys.push(r.objectKey);
          this.presignMap.set(it.id, r);
          this.opts.onItemChange(it.id, { objectKey: r.objectKey, uploadUrl: r.uploadUrl });
        });
        return;
      } catch (err) {
        lastErr = err;
        if (this.ctrl.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const is429 = err instanceof ApiClientError && err.status === 429;
        if (!isRetryableUploadError(err) || attempt === MAX_PRESIGN_BATCH_RETRIES) throw err;
        // 429 -> cho theo Retry-After; cac loi tam thoi khac -> backoff nang dan
        const waitMs = is429 ? rateLimitWaitMs(err) : (PRESIGN_RETRY_BACKOFF_MS[attempt] ?? 30_000);
        await sleep(waitMs, this.ctrl.signal);
      }
    }
    if (lastErr) throw lastErr;
  }

  /**
   * Dam bao moi item thuoc [0, index] da duoc presign. Batch di theo
   * cua so 100 file; cac worker goi ham nay — chi 1 batch bay mot
   * diem thoi (moi worker cho chung batch).
   */
  private async ensurePresignThrough(index: number): Promise<void> {
    while (this.presignCursor <= index && this.presignCursor < this.items.length) {
      if (this.presignInflight) {
        await this.presignInflight;
        continue;
      }
      const from = this.presignCursor;
      const to = Math.min(from + PRESIGN_BATCH_SIZE, this.items.length);
      const p = this.presignBatchRange(from, to).then(() => {
        this.presignCursor = to;
      });
      this.presignInflight = p;
      try {
        await p;
      } finally {
        this.presignInflight = null;
      }
    }
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

  /** PUT 1 lan (truc tiep R2, fallback proxy) — nem loi de layer retry xu ly */
  private async putOnce(item: PageItem, presign: PresignResponseDto, blob: Blob): Promise<UploadVia> {
    const { signal } = this.ctrl;
    const track = (loaded: number) => {
      this.loaded.set(item.id, loaded);
      this.emit();
    };

    try {
      await putToR2(presign.uploadUrl, blob, item.mimeType, track, signal);
      return "direct";
    } catch (err) {
      if (signal.aborted) throw err;
      // CORS / presigned URL het han / timeout / stalled -> proxy qua Next server.
      // NHUNG: proxy bi gioi han kich thuoc (Vercel ~4.5MB body) — file
      // lon hon thi KHONG thu proxy, bao loi ro rang (can CORS cho bucket).
      if (blob.size > MAX_PROXY_FILE_SIZE) {
        if (err instanceof ApiClientError && (err.code === "network" || err.code === "timeout" || err.code === "stalled" || err.status === 0)) {
          throw new Error(
            `Không upload trực tiếp được R2 (mạng/timeout) và file (${(blob.size / 1024 / 1024).toFixed(1)}MB) vượt giới hạn proxy (${(
              MAX_PROXY_FILE_SIZE / 1024 / 1024
            ) | 0}MB). Hãy cấu hình CORS cho bucket R2.`
          );
        }
        throw err;
      }
      await uploadViaProxy(presign.objectKey, blob, item.mimeType, track, signal);
      return "proxy";
    }
  }

  private async uploadOne(item: PageItem): Promise<void> {
    const { signal } = this.ctrl;
    this.opts.onItemChange(item.id, { status: "uploading", error: undefined });
    try {
      // Batch presign lazy: dam bao item nay (va cua so quanh no) da co URL
      const index = this.items.indexOf(item);
      if (index >= 0) await this.ensurePresignThrough(index);

      // Lay presign TU ENGINE MAP (onItemChange cua UI co the tao object
      // moi — immutable state — nen doc tu item se thay gia tri cu).
      // Fallback: item mang URL cu (retry chong len — batch tab tao engine
      // moi nhung tai su dung presign con han de tranh tao objectKey moi).
      const cached =
        this.presignMap.get(item.id) ??
        (item.objectKey && item.uploadUrl
          ? { objectKey: item.objectKey, uploadUrl: item.uploadUrl, storageObjectId: "" }
          : null);
      if (!cached || !cached.objectKey || !cached.uploadUrl) {
        throw new Error(`Chưa có presign URL cho ${item.name} — lỗi nội bộ engine.`);
      }
      const presign: PresignResponseDto = cached;
      const blob = await item.loadBlob();
      await this.measure(item, blob);

      // Retry tung anh voi backoff — tranh treo ca hang doi chi vi 1 anh
      // mang do (serverless 60s / mat goi tin).
      let lastErr: unknown = null;
      let via: UploadVia = "direct";
      for (let attempt = 0; attempt <= MAX_ITEM_RETRIES; attempt++) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        try {
          via = await this.putOnce(item, presign, blob);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (signal.aborted) throw err;
          if (!isRetryableUploadError(err) || attempt === MAX_ITEM_RETRIES) throw err;
          // Cho roi thu lai (presign URL con han 15 phut — tai su dung)
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 6_000, signal);
        }
      }
      if (lastErr) throw lastErr;

      // Ghi nhan mode ket noi (de UI hien thi + canh bao proxy)
      if (via === "proxy") this.proxyCount += 1;
      this.lastVia = via;

      this.loaded.delete(item.id);
      this.uploadedBytes += item.size;
      this.counts.uploaded += 1;
      this.opts.onItemChange(item.id, { status: "uploaded", via });
    } catch (err) {
      this.loaded.delete(item.id);
      if (this.cancelledFlag || signal.aborted) {
        throw new DOMException("Cancelled", "AbortError");
      }
      this.counts.failed += 1;
      const msg = err instanceof Error ? err.message : "Lỗi không xác định";
      this.opts.onItemChange(item.id, { status: "error", error: msg });
      this.opts.onItemError?.(item.id, err instanceof ApiClientError ? err.status : null);
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
