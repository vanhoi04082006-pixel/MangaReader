"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FileImage,
  FileWarning,
  HardDrive,
  RefreshCw,
  ScanSearch,
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
}

export function StorageView() {
  const { data, isLoading, isError, error, refetch } = useStorageStats();
  const [audit, setAudit] = useState<AuditState>({ running: false, scanned: 0, orphans: [], done: false });
  const [confirmCleanOrphans, setConfirmCleanOrphans] = useState(false);
  const [confirmCleanPending, setConfirmCleanPending] = useState(false);

  const runAudit = async () => {
    setAudit({ running: true, scanned: 0, orphans: [], done: false });
    try {
      let token: string | undefined = undefined;
      let scanned = 0;
      const orphans: OrphanAuditItemDto[] = [];
      // Lap qua tung trang listing R2
      for (let i = 0; i < 200; i++) {
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
      setAudit((s) => ({ ...s, running: false, done: true }));
      toastMutationError(err, "Quét lưu trữ thất bại.");
    }
  };

  const cleanOrphans = async () => {
    const keys = audit.orphans.map((o) => o.objectKey);
    try {
      const res = await api.post<{ deleted: number; skippedReferenced: string[] }>(
        "/api/storage/cleanup",
        { mode: "keys", keys, dryRun: false }
      );
      toast.success(`Đã xóa ${res.deleted} file mồ côi khỏi R2.`);
      setAudit({ running: false, scanned: audit.scanned, orphans: [], done: true });
      void refetch();
    } catch (err) {
      toastMutationError(err, "Dọn dẹp thất bại.");
      throw err;
    }
  };

  const cleanPending = async () => {
    try {
      const res = await api.post<{ deleted: number; candidates: number }>("/api/storage/cleanup", {
        mode: "pending",
        dryRun: false,
        maxAgeHours: 24,
      });
      toast.success(
        res.candidates === 0
          ? "Không có phiên upload nào bị gián đoạn quá 24h."
          : `Đã dọn ${res.deleted} object từ phiên upload gián đoạn.`
      );
      void refetch();
    } catch (err) {
      toastMutationError(err, "Dọn dẹp thất bại.");
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
            <StatCard icon={FileWarning} label="File mồ côi R2" value={audit.done ? formatNumber(audit.orphans.length) : "—"} sub={audit.done ? formatBytes(orphanBytes) : "Chạy quét để kiểm tra"} accent="violet" />
            <StatCard icon={RefreshCw} label="Truyện / Chương" value={`${formatNumber(data.mangaCount)} / ${formatNumber(data.chapterCount)}`} sub={`${formatNumber(data.pageCount)} trang`} accent="emerald" />
          </div>

          <div className="rounded-xl border bg-card p-5">
            <QuotaBar usedBytes={data.totalBytes} quotaBytes={data.quotaBytes} />
          </div>

          {/* Audit & cleanup */}
          <section className="rounded-xl border bg-card p-5" aria-label="Kiểm tra file mồ côi">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-bold">
                  <ScanSearch className="h-4.5 w-4.5 text-primary" />
                  Kiểm tra file mồ côi
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quét toàn bộ object trên R2, so sánh với database để tìm file không còn được sử dụng
                  (upload gián đoạn, xóa dữ liệu lỗi...).
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => void runAudit()}
                  disabled={audit.running}
                >
                  <ScanSearch className="h-4 w-4" />
                  {audit.running ? "Đang quét..." : "Quét ngay"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setConfirmCleanPending(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Dọn upload gián đoạn
                </Button>
              </div>
            </div>

            {audit.running && (
              <div className="mt-4 space-y-2">
                <Progress value={undefined} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  Đã quét {formatNumber(audit.scanned)} object... (tìm thấy {audit.orphans.length} mồ côi)
                </p>
              </div>
            )}

            {audit.done && !audit.running && (
              <div className="mt-4">
                {audit.orphans.length === 0 ? (
                  <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
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
                    <ul className="scrollbar-thin max-h-56 divide-y overflow-y-auto rounded-lg border bg-background/50">
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
        description={`${formatBytes(orphanBytes)} sẽ bị xóa vĩnh viễn khỏi Cloudflare R2. Các file này không còn được trang/chapter nào tham chiếu trong database.`}
        confirmLabel="Xóa vĩnh viễn"
        destructive
        onConfirm={cleanOrphans}
      />

      <ConfirmDialog
        open={confirmCleanPending}
        onOpenChange={setConfirmCleanPending}
        title="Dọn dẹp phiên upload gián đoạn?"
        description="Các object đã được cấp presign URL nhưng chưa hoàn tất sau hơn 24 giờ sẽ bị xóa."
        confirmLabel="Dọn dẹp"
        destructive
        onConfirm={cleanPending}
      />
    </div>
  );
}
