// =============================================================
// Upload Engine (client-side)
// - Concurrency gioi han (3), retry voi backoff
// - Thu dau direct PUT len R2; neu CORS/mang loi -> tu chuyen
//   sang proxy qua Next server (uploadViaProxy)
// - Lazy giai nen tung entry ZIP (toi uu RAM)
// - Finalize batch vao DB (transaction) — an toan khi retry
// =============================================================

import { api, putToR2, uploadViaProxy, ApiClientError } from "@/lib/client/api";

export type ItemStatus = "queued" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  pageNumber: number;
  status: ItemStatus;
  progress: number; // 0..1
  error?: string;
  objectKey?: string;
  width?: number;
  height?: number;
  getBlob: () => Promise<Blob>;
}

export type EnginePhase =
  | "idle"
  | "running"
  | "paused"
  | "finalizing"
  | "complete"
  | "finalize-error";

export interface EngineSnapshot {
  phase: EnginePhase;
  items: UploadItem[];
  uploadedCount: number;
  failedCount: number;
  totalBytes: number;
  uploadedBytes: number;
  speedBps: number;
  useProxy: boolean;
  finalizeMessage?: string;
  chapterId?: string;
  startedAt?: number;
  finishedAt?: number;
}

const CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1200, 3000, 6000];

async function getImageDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close();
      return dims;
    }
  } catch {
    // fallback tra ve rong
  }
  return {};
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class UploadEngine {
  private items: UploadItem[] = [];
  private phase: EnginePhase = "idle";
  private chapterId?: string;
  private mangaId?: string;
  private startedAt?: number;
  private finishedAt?: number;
  private finalizeMessage?: string;

  private useProxy = false;
  private pauseFlag = false;
  private canceled = false;
  private abortController = new AbortController();

  private uploadedBytesBase = 0; // bytes cac item done
  private speedBps = 0;
  private lastSpeedSample = { time: 0, bytes: 0 };

  private listeners = new Set<() => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: EngineSnapshot = {
    phase: "idle",
    items: [],
    uploadedCount: 0,
    failedCount: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    speedBps: 0,
    useProxy: false,
  };

  // ---- External store interface ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Snapshot duoc CACHE — chi thay doi khi emit (tranh infinite loop cua useSyncExternalStore) */
  getSnapshot = (): EngineSnapshot => this.snapshot;

  private rebuildSnapshot() {
    this.snapshot = {
      phase: this.phase,
      items: this.items,
      uploadedCount: this.items.filter((i) => i.status === "done").length,
      failedCount: this.items.filter((i) => i.status === "error").length,
      totalBytes: this.items.reduce((s, i) => s + i.size, 0),
      uploadedBytes: this.uploadedBytesBase + this.inFlightBytes(),
      speedBps: this.speedBps,
      useProxy: this.useProxy,
      finalizeMessage: this.finalizeMessage,
      chapterId: this.chapterId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  private inFlightBytes(): number {
    return this.items
      .filter((i) => i.status === "uploading")
      .reduce((s, i) => s + i.size * i.progress, 0);
  }

  private emit(throttleMs = 120) {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      // tinh toc do (EMA theo cua)
      const now = Date.now();
      const currentBytes = this.uploadedBytesBase + this.inFlightBytes();
      if (this.lastSpeedSample.time > 0) {
        const dt = (now - this.lastSpeedSample.time) / 1000;
        if (dt > 0.3) {
          const bps = Math.max(0, (currentBytes - this.lastSpeedSample.bytes) / dt);
          this.speedBps = this.speedBps === 0 ? bps : this.speedBps * 0.6 + bps * 0.4;
          this.lastSpeedSample = { time: now, bytes: currentBytes };
        }
      } else {
        this.lastSpeedSample = { time: now, bytes: currentBytes };
      }
      this.rebuildSnapshot();
      for (const l of this.listeners) l();
    }, throttleMs);
  }

  private setPhase(p: EnginePhase, message?: string) {
    this.phase = p;
    this.finalizeMessage = message;
    // flush ngay (khong doi throttle)
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.rebuildSnapshot();
    for (const l of this.listeners) l();
  }

  // ---- Lifecycle ----

  prepare(items: Array<Omit<UploadItem, "id" | "status" | "progress">>, ctx: { mangaId: string; chapterId: string }) {
    this.mangaId = ctx.mangaId;
    this.chapterId = ctx.chapterId;
    this.items = items.map((item) => ({
      ...item,
      id: genId(),
      status: "queued" as ItemStatus,
      progress: 0,
    }));
    this.uploadedBytesBase = 0;
    this.speedBps = 0;
    this.lastSpeedSample = { time: 0, bytes: 0 };
    this.canceled = false;
    this.setPhase("idle");
  }

  getChapterId(): string | undefined {
    return this.chapterId;
  }

  async start() {
    if (this.phase !== "idle" && this.phase !== "paused") return;
    this.pauseFlag = false;
    this.canceled = false;
    this.abortController = new AbortController();
    this.startedAt = Date.now();
    this.setPhase("running");
    await this.runWorkers();
    if (this.canceled) return;
    await this.finalize();
  }

  pause() {
    if (this.phase !== "running") return;
    this.pauseFlag = true;
    this.setPhase("paused");
  }

  async resume() {
    if (this.phase !== "paused") return;
    this.pauseFlag = false;
    this.setPhase("running");
    await this.runWorkers();
    if (this.canceled) return;
    await this.finalize();
  }

  async cancel() {
    this.canceled = true;
    this.pauseFlag = false;
    this.abortController.abort();
    // Cleanup nhung object da PUT nhung chua finalize + PENDING con lai
    const keysToClean = this.items
      .filter((i) => i.objectKey && i.status !== "queued")
      .map((i) => i.objectKey as string);
    if (keysToClean.length > 0) {
      try {
        await api.post("/api/uploads/abort", { objectKeys: keysToClean });
      } catch {
        // best effort — audit sẽ phát hiện sau
      }
    }
    for (const item of this.items) {
      if (item.status === "queued" || item.status === "uploading") {
        item.status = "error";
        item.error = "Đã hủy";
      }
    }
    this.setPhase("idle");
  }

  async retryFailed() {
    if (this.phase !== "finalize-error" && this.phase !== "complete" && this.phase !== "idle") return;
    let hasQueued = false;
    for (const item of this.items) {
      if (item.status === "error" && item.error !== "Đã hủy") {
        item.status = "queued";
        item.progress = 0;
        item.error = undefined;
        hasQueued = true;
      }
    }
    if (!hasQueued) return;
    this.setPhase("running");
    await this.runWorkers();
    if (this.canceled) return;
    await this.finalize();
  }

  // ---- Workers ----

  private async runWorkers() {
    const worker = async () => {
      while (!this.canceled) {
        if (this.pauseFlag) return;
        const item = this.items.find((i) => i.status === "queued");
        if (!item) return;
        item.status = "uploading";
        this.emit(0);
        await this.processItem(item);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  private async processItem(item: UploadItem) {
    let attempt = 0;
    while (attempt <= MAX_RETRIES && !this.canceled) {
      try {
        await this.uploadItem(item);
        item.status = "done";
        item.progress = 1;
        this.uploadedBytesBase += item.size;
        this.emit(0);
        return;
      } catch (err) {
        if (this.canceled || this.abortController.signal.aborted) {
          return;
        }
        attempt++;
        const message = err instanceof ApiClientError ? err.message : "Lỗi không xác định";
        if (err instanceof ApiClientError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          // loi 4xx (tru 429) — khong retry
          item.status = "error";
          item.error = message;
          this.emit(0);
          return;
        }
        if (attempt > MAX_RETRIES) {
          item.status = "error";
          item.error = `${message} (đã thử ${attempt} lần)`;
          this.emit(0);
          return;
        }
        item.error = `${message} — thử lại lần ${attempt}...`;
        this.emit(0);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]));
      }
    }
  }

  private async uploadItem(item: UploadItem): Promise<void> {
    // 1) Blob + kich thuoc
    const blob = await item.getBlob();
    if (!item.width) {
      const dims = await getImageDimensions(blob);
      item.width = dims.width;
      item.height = dims.height;
    }

    // 2) Presign
    const presign = await api.post<{ objectKey: string; uploadUrl: string }>(
      "/api/uploads/presign",
      {
        kind: "PAGE",
        mangaId: this.mangaId,
        chapterId: this.chapterId,
        pageNumber: item.pageNumber,
        fileName: item.name,
        mimeType: item.mimeType,
        fileSize: blob.size,
      }
    );
    item.objectKey = presign.objectKey;

    const onProgress = (loaded: number, total: number) => {
      item.progress = total > 0 ? loaded / total : 0;
      this.emit();
    };

    // 3) Upload: thu direct R2 truoc, fallback proxy
    if (!this.useProxy) {
      try {
        await putToR2(presign.uploadUrl, blob, item.mimeType, onProgress, this.abortController.signal);
        return;
      } catch (err) {
        if (this.canceled || this.abortController.signal.aborted) throw err;
        const networkish =
          err instanceof ApiClientError && (err.code === "network" || err.status === 0);
        if (networkish) {
          this.useProxy = true;
          this.emit(0);
          // tiep tuc qua proxy
        } else {
          throw err;
        }
      }
    }
    await uploadViaProxy(presign.objectKey, blob, item.mimeType, onProgress, this.abortController.signal);
  }

  // ---- Finalize ----

  private async finalize() {
    const done = this.items.filter((i) => i.status === "done" && i.objectKey);
    if (done.length === 0) {
      this.finishedAt = Date.now();
      this.setPhase("complete", "Không có trang nào upload thành công.");
      return;
    }
    this.setPhase("finalizing");
    try {
      const res = await api.post<{ pageCount: number }>("/api/chapters/" + this.chapterId + "/pages", {
        pages: done.map((i) => ({
          objectKey: i.objectKey,
          pageNumber: i.pageNumber,
          fileName: i.name,
          mimeType: i.mimeType,
          fileSize: i.size,
          width: i.width ?? null,
          height: i.height ?? null,
        })),
      });
      this.finishedAt = Date.now();
      this.setPhase("complete", `Đã lưu ${res.pageCount} trang vào chương.`);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Lưu dữ liệu thất bại.";
      this.setPhase("finalize-error", message);
    }
  }

  async retryFinalize() {
    if (this.phase !== "finalize-error") return;
    await this.finalize();
  }
}

/** Singleton — 1 phien upload tai 1 thoi diem */
export const uploadEngine = new UploadEngine();
