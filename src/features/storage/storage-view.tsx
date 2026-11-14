"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FileImage,
  FileWarning,
  HardDrive,
  History,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState } from "@/components/common/states";
import { StatCard, QuotaBar } from "@/components/common/stat-card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useStorageStats, toastMutationError } from "@/hooks/queries";
import { api, ApiClientError } from "@/lib/client/api";
import { navigate } from "@/lib/client/hash-router";
import type { OrphanAuditItemDto } from "@/types";
import { formatBytes, formatNumber, formatDateTime } from "@/utils/format";
import { toast } from "sonner";

interface AuditState {
  running: boolean;
  scanned: number;
  orphans: OrphanAuditItemDto[];
  done: boolean;
  error?: string;
}

interface CleanupPreview {
  mode: "pending" | "failed" | "keys";
  candidates: number;
  deleted: number;
  skippedReferenced?: string[];
  skippedActivePending?: string[];
  retryNeeded: number;
}

const MAX_PAGES = 200; // gioi han phong ve: 200 x 1000 object = 200k

export function StorageView() {
  const { data, isLoading, isError, error, refetch } = useStorageStats();
  const [audit, setAudit] = useState<AuditState>({ running: false, scanned: 0, orphans: [], done: false });
  const [confirmCleanOrphans, setConfirmCleanOrphans] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<CleanupPreview | null>(null);
  const [failedPreview, setFailedPreview] = useState<CleanupPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ---------------- Audit (quet R2 <-> DB) ----------------

  const runAudit = async () => {
    setAudit({ running: true, scanned: 0, orphans: [], done: false, error: undefined });
    try {
      let token: string | undefined = undefined;
      let scanned = 0;
      const orphans: OrphanAuditItemDto[] = [];
      for (let i = 0; i < MAX_PAGES; i++) {
        const url = `/api/storage/audit${token ? `?continuationToken=${encodeURIComponent(token)}` : ""}`;
        const page = await api.get<{
          items: OrphanAuditItemDto[];
          scanned: number;
          truncated: boolean;
          nextToken?: string;
        }>(url);
        scanned += page.scanned;
        orphans.push(...page.items);
        setAudit({ running: true, scanned, orphans: [...orphans], done: false });
        if (!page.truncated || !page.nextToken) break;
        token = page.nextToken;
      }
      setAudit({ running: false, scanned, orphans, done: true });
      if (orphans.length === 0) {
        toast.success(`Đã quét ${formatNumber(scanned)} object — không phát hiện file mồ côi.`);
      } else {
        toast.warning(`Phát hiện ${orphans.length} file mồ côi (${formatBytes(orphans.reduce((s, o) => s + o.size, 0))}).`);
      }
    } catch (err) {
      // Loi that su (mang/DB) — khong bao gia "0 orphan" khi khong quet duoc
      const msg = err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Lỗi không xác định";
      setAudit({ running: false, scanned: audit.scanned, orphans: [], done: true, error: msg });
      toastMutationError(err, "Quét lưu trữ thất bại.");
    }
  };

  // ---------------- Cleanup (3 mode, dry-run truoc khi thuc hien) ----------------

  const previewCleanup = async (mode: CleanupPreview["mode"], keys?: string[]): Promise<CleanupPreview | null> => {
    setBusy(`preview:${mode}`);
    try {
      const res = await api.post<CleanupPreview>("/api/storage/cleanup", {
        mode,
        keys,
        dryRun: true,
        maxAgeHours: 24,
      });
      return res;
    } catch (err) {
      toastMutationError(err, "Xem trước thất bại.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const cleanOrphans = async () => {
    const keys = audit.orphans.map((o) => o.objectKey);
    try {
      const res = await api.post<{ deleted: number; skippedReferenced: string[]; skippedActivePending?: string[] }>(
        "/api/storage/cleanup",
        { mode: "keys", keys, dryRun: false, maxAgeHours: 24 }
      );
      const skipped = res.skippedReferenced.length + (res.skippedActivePending?.length ?? 0);
      if (skipped > 0) {
        toast.warning(`Đã xóa ${res.deleted} file; bỏ qua ${skipped} file vẫn được tham chiếu/đang upload.`);
      } else {
        toast.success(`Đã xóa ${res.deleted} file mồ côi khỏi R2.`);
      }
      setAudit({ running: false, scanned: audit.scanned, orphans: [], done: true });
      void refetch();
    } catch (err) {
      toastMutationError(err, "Dọn dẹp thất bại.");
      throw err;
    }
  };

  // Flow: dry-run -> mo dialog voi so lieu that -> nguoi dung xac nhan -> thuc hien
  const pendingFlow = async () => {
    const preview = await previewCleanup("pending");
    if (!preview) return;
    if (preview.candidates === 0) {
      toast.info("Không có phiên upload nào bị gián đoạn quá 24h — không cần dọn.");
      return;
    }
    setPendingPreview(preview);
  };

  const pendingExecute = async () => {
    try {
      const res = await api.post<{ deleted: number; candidates: number; retryNeeded: number }>(
        "/api/storage/cleanup",
        { mode: "pending", dryRun: false, maxAgeHours: 24 }
      );
      toast.success(
        `Đã dọn ${res.deleted}/${res.candidates} object gián đoạn.` +
          (res.retryNeeded > 0 ? ` ${res.retryNeeded} object còn chờ retry.` : "")
      );
      setPendingPreview(null);
      void refetch();
    } catch (err) {
      toastMutationError(err, "Dọn dẹp thất bại.");
      throw err;
    }
  };

  const failedFlow = async () => {
    const preview = await previewCleanup("failed");
    if (!preview) return;
    if (preview.candidates === 0) {
      toast.info("Không có object nào đang chờ retry xóa (DELETE_PENDING = 0).");
      return;
    }
    setFailedPreview(preview);
  };

  const failedExecute = async () => {
    try {
      const res = await api.post<{ deleted: number; candidates: number; retryNeeded: number }>(
        "/api/storage/cleanup",
        { mode: "failed", dryRun: false }
      );
      toast.success(
        `Đã retry xóa ${res.deleted}/${res.candidates} object.` +
          (res.retryNeeded > 0 ? ` Còn ${res.retryNeeded} object chờ retry tiếp.` : "")
      );
      setFailedPreview(null);
      void refetch();
    } catch (err) {
      toastMutationError(err, "Thử lại thất bại.");
      throw err;
    }
  };

  const orphanBytes = audit.orphans.reduce((s, o) => s + o.size, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Quản lý lưu trữ</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Thống kê dung lượng Cloudflare R2 và dọn dẹp file không còn sử dụng
        </p>
      </div>

      {isError ? (
        <ErrorState
          message={(error as Error)?.message ?? "Không tải được thống kê lưu trữ."}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={HardDrive} label="Đã dùng" value={formatBytes(data.totalBytes)} sub={`Hạn mức ${formatBytes(data.quotaBytes, { decimals: 0 })}`} accent="amber" />
            <StatCard icon={FileImage} label="Tổng số file" value={formatNumber(data.totalFiles)} sub={`${data.pendingObjects} đang chờ`} />
            <StatCard icon={FileWarning} label="File mồ côi R2" value={audit.done ? formatNumber(audit.orphans.length) : "—"} sub={audit.done ? (audit.error ? "Lỗi quét" : formatBytes(orphanBytes)) : "Chạy quét để kiểm tra"} accent="violet" />
            <StatCard icon={RefreshCw} label="Truyện / Chương" value={`${formatNumber(data.mangaCount)} / ${formatNumber(data.chapterCount)}`} sub={`${formatNumber(data.pageCount)} trang`} accent="emerald" />
          </div>

          <div className="rounded-xl border bg-card p-5">
            <QuotaBar usedBytes={data.totalBytes} quotaBytes={data.quotaBytes} />
            {/* Breakdown theo trang thai — tong = CONFIRMED, phan con lai la tam thoi */}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg border bg-background/50 px-3 py-2">
                <dt className="text-muted-foreground">Đã xác nhận</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                  {formatBytes(data.totalBytes)}
                  <span className="ml-1 text-muted-foreground">({formatNumber(data.totalFiles)})</span>
                </dd>
              </div>
              <div className="rounded-lg border bg-background/50 px-3 py-2">
                <dt className="text-muted-foreground">Chờ finalize</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                  {formatBytes(data.pendingBytes ?? 0)}
                  <span className="ml-1 text-muted-foreground">({formatNumber(data.pendingObjects)})</span>
                </dd>
              </div>
              <div className="rounded-lg border bg-background/50 px-3 py-2">
                <dt className="text-muted-foreground">Chờ xóa (retry)</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                  {formatBytes(data.deletePendingBytes ?? 0)}
                  <span className="ml-1 text-muted-foreground">({formatNumber(data.deletePendingObjects)})</span>
                </dd>
              </div>
              <div className="rounded-lg border bg-background/50 px-3 py-2">
                <dt className="text-muted-foreground">Mồ côi</dt>
                <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                  {audit.done && !audit.error ? formatNumber(audit.orphans.length) : "—"}
                  <span className="ml-1 text-muted-foreground">(quét để chốt)</span>
                </dd>
              </div>
            </dl>
          </div>

          {/* Audit & cleanup */}
          <section className="rounded-xl border bg-card p-5" aria-label="Kiểm tra file mồ côi">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-bold">
                  <ScanSearch className="h-4.5 w-4.5 text-primary" />
                  Kiểm tra file mồ côi
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quét toàn bộ object trên R2, so khớp từng object với database (quét theo trang, an toàn URL).
                </p>
              </div>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => void runAudit()}
                disabled={audit.running}
              >
                <ScanSearch className="h-4 w-4" />
                {audit.running ? "Đang quét..." : "Quét ngay"}
              </Button>
            </div>

            {audit.running && (
              <div className="mt-4 flex items-center gap-4">
                <img
                  src="/mascots/scan.png"
                  alt=""
                  aria-hidden
                  className="mascot-bob pointer-events-none hidden h-20 w-20 select-none rounded-2xl drop-shadow-[0_10px_28px_color-mix(in_oklch,var(--primary)_35%,transparent)] sm:block"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <Progress value={undefined} className="h-1.5" />
                  <p className="text-xs text-muted-foreground">
                    Đã quét {formatNumber(audit.scanned)} object... (tìm thấy {audit.orphans.length} mồ côi)
                  </p>
                </div>
              </div>
            )}

            {audit.done && !audit.running && (
              <div className="mt-4">
                {audit.error ? (
                  <p className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Quét bị lỗi: {audit.error}. Kết quả cũ không còn hợp lệ — chạy lại sau khi sửa lỗi mạng.
                  </p>
                ) : audit.orphans.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
                    <ShieldCheck className="h-4 w-4" />
                    Đã quét {formatNumber(audit.scanned)} object — không có file mồ côi. Lưu trữ sạch sẽ.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-medium text-amber-500">
                        <AlertTriangle className="h-4 w-4" />
                        {audit.orphans.length} file mồ côi — {formatBytes(orphanBytes)} có thể thu hồi
                      </p>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-2"
                        onClick={() => setConfirmCleanOrphans(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Dọn dẹp file mồ côi
                      </Button>
                    </div>
                    <ul className="scrollbar-thin max-h-72 divide-y overflow-y-auto rounded-lg border bg-background/50">
                      {audit.orphans.slice(0, 100).map((o) => (
                        <li key={o.objectKey} className="flex items-center justify-between gap-3 px-3 py-2">
                          <code className="truncate font-mono text-xs text-muted-foreground">
                            {o.objectKey}
                          </code>
                          <span className="shrink-0 font-mono text-xs tabular-nums">
                            {formatBytes(o.size)}
                          </span>
                        </li>
                      ))}
                      {audit.orphans.length > 100 && (
                        <li className="px-3 py-2 text-center text-xs text-muted-foreground">
                          ... và {audit.orphans.length - 100} file khác
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Cleanup 3 mode — dry-run mac dinh, xac nhan truoc khi thuc hien */}
          <section className="rounded-xl border bg-card p-5" aria-label="Dọn dẹp lưu trữ">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-bold">
                  <History className="h-4.5 w-4.5 text-primary" />
                  Dọn dẹp lưu trữ
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Mọi thao tác đều <strong>xem trước (dry-run) trước</strong> rồi mới xác nhận thực hiện.
                  Metadata DB chỉ bị gỡ khi R2 xác nhận đã xóa.
                </p>
              </div>
              <img
                src="/mascots/sweeping.png"
                alt=""
                aria-hidden
                className="mascot-float pointer-events-none hidden h-24 w-24 select-none rounded-2xl drop-shadow-[0_10px_28px_color-mix(in_oklch,var(--primary)_35%,transparent)] md:block"
              />
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              <li className="rounded-lg border bg-background/50 p-4">
                <p className="text-sm font-semibold">Upload gián đoạn</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Object đã cấp URL nhưng chưa hoàn tất sau 24h. Hiện có:{" "}
                  <span className="font-mono tabular-nums">{formatNumber(data.pendingObjects)}</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full gap-2"
                  disabled={busy !== null}
                  onClick={() => void pendingFlow()}
                >
                  <Trash2 className="h-4 w-4" />
                  {busy === "preview:pending" ? "Đang xem trước..." : "Xem trước & dọn"}
                </Button>
              </li>
              <li className="rounded-lg border bg-background/50 p-4">
                <p className="text-sm font-semibold">Xóa thất bại — retry</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Object DELETE_PENDING (xóa R2 lỗi trước đó). Hiện có:{" "}
                  <span className="font-mono tabular-nums">{formatNumber(data.deletePendingObjects)}</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full gap-2"
                  disabled={busy !== null}
                  onClick={() => void failedFlow()}
                >
                  <RotateCcw className="h-4 w-4" />
                  {busy === "preview:failed" ? "Đang xem trước..." : "Xem trước & thử lại"}
                </Button>
              </li>
              <li className="rounded-lg border bg-background/50 p-4">
                <p className="text-sm font-semibold">File mồ côi</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Chỉ dọn theo danh sách <em>từ kết quả quét vừa chạy</em>; hệ thống tái kiểm tra tham chiếu
                  trước khi xóa.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full gap-2"
                  disabled={busy !== null || audit.orphans.length === 0 || !audit.done}
                  onClick={() => setConfirmCleanOrphans(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Dọn {audit.done ? formatNumber(audit.orphans.length) : ""} mồ côi
                </Button>
              </li>
            </ul>
          </section>

          {/* Dung luong tung truyen */}
          <section aria-label="Dung lượng theo truyện">
            <h2 className="mb-3 font-bold">Dung lượng theo truyện</h2>
            {data.perManga.length === 0 ? (
              <EmptyState icon={HardDrive} title="Chưa có dữ liệu" description="Upload truyện để thấy thống kê dung lượng." compact />
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {data.perManga.map((m) => {
                  const percent = data.totalBytes > 0 ? (m.sizeBytes / data.totalBytes) * 100 : 0;
                  return (
                    <li
                      key={m.mangaId}
                      className="cursor-pointer px-4 py-3 transition-colors hover:bg-accent/40"
                      onClick={() => navigate(`/manga/${m.mangaId}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{m.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(m.chapterCount)} chương · {formatNumber(m.fileCount)} file
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {formatBytes(m.sizeBytes)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {percent.toFixed(1).replace(".", ",")}%
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(percent, 0.5)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* File lon nhat */}
          <section aria-label="File lớn nhất">
            <h2 className="mb-3 font-bold">File lớn nhất</h2>
            {data.largestFiles.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Chưa có file nào.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {data.largestFiles.map((f) => (
                  <li key={f.objectKey} className="flex items-center gap-3 px-4 py-3">
                    <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {f.mangaTitle ?? "?"}
                        {f.chapterNumber ? ` · Chương ${f.chapterNumber}` : ""}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {f.fileName} · {formatDateTime(f.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                      {formatBytes(f.fileSize)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmCleanOrphans}
        onOpenChange={setConfirmCleanOrphans}
        title={`Xóa ${audit.orphans.length} file mồ côi?`}
        description={`${formatBytes(orphanBytes)} sẽ bị xóa vĩnh viễn khỏi Cloudflare R2. Các file này không còn được trang/chapter nào tham chiếu trong database (hệ thống sẽ kiểm tra lại lần nữa trước khi xóa).`}
        confirmLabel="Xóa vĩnh viễn"
        destructive
        onConfirm={cleanOrphans}
      />

      <ConfirmDialog
        open={pendingPreview !== null}
        onOpenChange={(open) => { if (!open) setPendingPreview(null); }}
        title="Dọn dẹp phiên upload gián đoạn?"
        description={
          pendingPreview
            ? `Dry-run tìm thấy ${formatNumber(pendingPreview.candidates)} object quá 24h chưa hoàn tất. Chúng sẽ bị xóa vĩnh viễn khỏi R2 và gỡ metadata sau khi R2 xác nhận đã xóa.`
            : ""
        }
        confirmLabel={`Dọn ${formatNumber(pendingPreview?.candidates ?? 0)} object`}
        destructive
        onConfirm={pendingExecute}
      />

      <ConfirmDialog
        open={failedPreview !== null}
        onOpenChange={(open) => { if (!open) setFailedPreview(null); }}
        title="Thử lại các lần xóa thất bại?"
        description={
          failedPreview
            ? `Dry-run tìm thấy ${formatNumber(failedPreview.candidates)} object DELETE_PENDING (xóa R2 thất bại trước đó). Chúng sẽ bị xóa khỏi R2 và gỡ metadata.`
            : ""
        }
        confirmLabel={`Thử lại ${formatNumber(failedPreview?.candidates ?? 0)} object`}
        destructive
        onConfirm={failedExecute}
      />
    </div>
  );
}
