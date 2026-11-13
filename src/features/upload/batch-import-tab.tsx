"use client";

// =============================================================
// Batch Import Tab — nhập NHIỀU truyện cùng lúc từ thư mục
//
// Cách dùng:
//  1. Chọn thư mục (hoặc kéo-thả): có thể chọn ngay 1 bộ truyện
//     ("Roubaitei (Hololive)") hoặc thư mục cha chứa nhiều bộ.
//  2. Xem lại danh sách truyện đã nhận diện (từ info.txt + bìa + chương).
//  3. Bấm "Bắt đầu nhập" — với từng truyện: tạo truyện → upload bìa →
//     tạo từng chương → upload trang (presign → R2) → finalize.
//
// Kiến trúc upload dùng lại UploadEngine (worker pool 3 ảnh, presign
// tái sử dụng khi retry). Lỗi 429 (hạn mức presign 1000/10 phút) được
// chờ và thử lại tự động. Lỗi một truyện KHÔNG chặn các truyện sau.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  FolderOpen,
  FolderTree,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { api, ApiClientError } from "@/lib/client/api";
import { navigate } from "@/lib/client/hash-router";
import { formatBytes, formatNumber } from "@/utils/format";
import { STATUS_LABELS } from "@/components/manga/manga-card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ChapterDto, MangaSummaryDto, Paginated } from "@/types";
import { UploadEngine, type PageItem } from "@/features/upload/upload-engine";
import { uploadCoverToR2 } from "@/features/upload/cover-upload";
import {
  buildMangasFromFiles,
  filesFromDataTransfer,
  fromInputFiles,
  uid,
  type ParsedManga,
} from "@/features/upload/folder-parser";

// ---------------- constants & helpers ----------------

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB / ảnh (khớp schema)
const MAX_CHAPTER_ATTEMPTS = 3; // số lần chạy engine cho 1 chương (lỗi thường)
const MAX_RATE_LIMIT_WAITS = 10; // số lần chờ hạn mức presign (60s/lần)
const RATE_LIMIT_WAIT_MS = 60_000;

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

function mimeFromFile(file: File): string | null {
  const t = file.type.toLowerCase();
  if (ACCEPTED_MIME.includes(t)) return t;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function toPageItems(files: File[]): PageItem[] {
  return files.map((f, i) => ({
    id: uid(),
    name: baseName(f.name).slice(0, 255) || f.name.slice(0, 255),
    size: f.size,
    mimeType: mimeFromFile(f) ?? "application/octet-stream",
    pageNumber: i + 1,
    status: "pending" as const,
    width: null,
    height: null,
    loadBlob: () => Promise.resolve(f),
  }));
}

/** So sánh tên truyện "gần đúng" để bỏ qua truyện đã có */
function normalizeTitleForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Lấy toàn bộ tên truyện hiện có (phân trang, tối đa 3000) */
async function fetchExistingTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  const pageSize = 60; // max theo schema
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const res = await api.get<Paginated<MangaSummaryDto>>(
      `/api/mangas?page=${page}&pageSize=${pageSize}&sort=title&order=asc`
    );
    for (const m of res.items) titles.add(normalizeTitleForMatch(m.title));
    if (page >= (res.totalPages ?? 1)) break;
    page++;
  }
  return titles;
}

class CancelledError extends Error {
  constructor() {
    super("Đã hủy");
    this.name = "CancelledError";
  }
}

/** Sleep có thể hủy (check cờ mỗi giây) */
function sleepAbortable(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isCancelled() || Date.now() - started >= ms) resolve();
      else setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });
}

// ---------------- state ----------------

type MangaImportStatus = "pending" | "importing" | "done" | "error" | "cancelled" | "skipped";

interface MangaImportState {
  status: MangaImportStatus;
  mangaId?: string;
  chaptersDone: number;
  chaptersTotal: number;
  currentChapter?: string;
  /** giai đoạn hiện tại để hiển thị chi tiết */
  phase?: "creating" | "cover" | "chapters" | "waiting";
  error?: string;
  /** cảnh báo không chặn import (bìa lỗi...) */
  notices?: string[];
}

// ---------------- Ảnh bìa preview ----------------

function CoverPreview({ file }: { file: File | null }) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <BookOpen className="h-6 w-6 text-muted-foreground/60" />
      </div>
    );
  }
  return <img src={url} alt="Ảnh bìa" className="h-full w-full object-cover" />;
}

// ---------------- Card 1 truyện đã parse ----------------

function MangaParseCard({
  manga,
  state,
  onRemove,
  disabled,
}: {
  manga: ParsedManga;
  state?: MangaImportState;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
        {/* Bìa */}
        <div className="relative h-28 w-[72px] shrink-0 overflow-hidden rounded-lg border bg-muted sm:h-36 sm:w-24">
          <CoverPreview file={manga.coverFile} />
          {state?.status === "done" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            </div>
          )}
          {state?.status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
          )}
        </div>

        {/* Thông tin */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold sm:text-base">{manga.title}</h3>
              <p className="truncate text-xs text-muted-foreground">
                Thư mục: {manga.folderName}
                {!manga.hasInfoFile && " · không có info.txt"}
              </p>
            </div>
            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
                disabled={disabled}
                aria-label="Bỏ truyện này"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
              {STATUS_LABELS[manga.meta.status]}
            </Badge>
            {manga.meta.author && (
              <Badge variant="secondary" className="max-w-40 font-normal">
                <span className="truncate">{manga.meta.author}</span>
              </Badge>
            )}
          </div>

          {manga.meta.genres.length > 0 && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {manga.meta.genres.join(" · ")}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {manga.chapters.length} chương · {formatNumber(manga.totalFiles)} trang
            </span>
            <span>{formatBytes(manga.totalBytes)}</span>
          </div>

          {/* Trạng thái import */}
          {state && state.status === "importing" && (
            <div className="mt-2.5 space-y-1.5">
              <Progress
                value={
                  state.chaptersTotal > 0
                    ? (state.chaptersDone / state.chaptersTotal) * 100
                    : 5
                }
                className="h-1.5"
              />
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {state.phase === "waiting" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {state.currentChapter}
                  </>
                ) : (
                  state.currentChapter ??
                  (state.phase === "creating"
                    ? "Đang tạo truyện..."
                    : state.phase === "cover"
                      ? "Đang tải ảnh bìa..."
                      : "Đang chuẩn bị...")
                )}
                {state.phase !== "waiting" && state.chaptersTotal > 0 && (
                  <span className="opacity-70">
                    ({state.chaptersDone}/{state.chaptersTotal} chương)
                  </span>
                )}
              </p>
            </div>
          )}
          {state?.status === "done" && (
            <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Đã nhập {state.chaptersDone} chương
              {state.mangaId && (
                <button
                  className="ml-1 text-primary underline-offset-2 hover:underline"
                  onClick={() => navigate(`/manga/${state.mangaId}`)}
                >
                  Xem truyện
                </button>
              )}
            </p>
          )}
          {state?.status === "skipped" && (
            <p className="mt-2 text-[11px] font-medium text-amber-500">
              Bỏ qua — truyện đã có trong thư viện.
            </p>
          )}
          {state?.status === "error" && (
            <p className="mt-2 text-[11px] font-medium text-destructive">
              Lỗi: {state.error}
              {state.chaptersDone > 0 && ` (đã nhập được ${state.chaptersDone} chương)`}
            </p>
          )}
          {state?.status === "cancelled" && (
            <p className="mt-2 text-[11px] font-medium text-amber-500">Đã hủy giữa chừng.</p>
          )}
          {state?.notices && state.notices.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-500">{state.notices.join(" · ")}</p>
          )}

          {/* Cảnh báo + mở rộng */}
          <div className="mt-2 flex items-center gap-3">
            {manga.warnings.length > 0 && (
              <button
                className="flex items-center gap-1 text-[11px] text-amber-500 hover:underline"
                onClick={() => setExpanded((e) => !e)}
              >
                <AlertTriangle className="h-3 w-3" />
                {manga.warnings.length} lưu ý
                <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
              </button>
            )}
            {manga.chapters.length > 0 && (
              <button
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((e) => !e)}
              >
                <FolderTree className="h-3 w-3" />
                {expanded ? "Ẩn chương" : "Xem chương"}
              </button>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t"
          >
            <div className="space-y-2 bg-muted/30 px-3 py-3 sm:px-4">
              {manga.warnings.map((w, i) => (
                <p
                  key={i}
                  className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {w}
                </p>
              ))}
              {manga.chapters.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {manga.chapters.map((c) => (
                    <span
                      key={c.name}
                      className="rounded-md border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                      title={`${c.files.length} ảnh`}
                    >
                      <span className="font-mono font-semibold text-foreground">{c.number}</span>
                      {c.name !== c.number && ` · ${c.name}`}
                      <span className="opacity-60"> ({c.files.length})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

// ---------------- Main tab ----------------

export function BatchImportTab() {
  const qc = useQueryClient();

  const [mangas, setMangas] = useState<ParsedManga[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [skipExisting, setSkipExisting] = useState(true);

  // Trạng thái import
  const [importing, setImporting] = useState(false);
  const [importStates, setImportStates] = useState<Record<string, MangaImportState>>({});
  const [finished, setFinished] = useState(false);

  const cancelledRef = useRef(false);
  const engineRef = useRef<UploadEngine | null>(null);
  /** Chương đã hoàn tất trong phiên này: key `${mangaUid}:${chapterNumber}` */
  const doneChaptersRef = useRef<Set<string>>(new Set());

  const folderInputRef = useRef<HTMLInputElement>(null);
  // webkitdirectory không có trong TS types — set bằng DOM API
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
    folderInputRef.current?.setAttribute("mozdirectory", "");
  }, []);

  // Hủy import khi rời màn hình giữa chừng (dọn object PENDING trên R2)
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      const engine = engineRef.current;
      if (engine && !engine.isCancelled) {
        engine.cancel();
        void engine.abortAll();
      }
    };
  }, []);

  const handleItems = useCallback(async (items: ReturnType<typeof fromInputFiles>) => {
    setParsing(true);
    setFinished(false);
    try {
      // Nhường CPU một chút cho UI kịp cập nhật
      await new Promise((r) => setTimeout(r, 30));
      const { mangas: parsed, warnings } = await buildMangasFromFiles(items);
      if (parsed.length === 0) {
        toast.error("Không nhận diện được truyện nào", {
          description:
            "Đảm bảo cấu trúc: thư mục truyện > info.txt + cover.jpg + các thư mục chương chứa ảnh.",
        });
      } else {
        toast.success(`Đã nhận diện ${parsed.length} truyện`);
      }
      setMangas((prev) => [...prev, ...parsed]);
      setParseWarnings((prev) => [...prev, ...warnings]);
      setImportStates({});
    } catch (err) {
      toast.error("Không đọc được thư mục", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setParsing(false);
    }
  }, []);

  const onFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const items = fromInputFiles(e.target.files);
    e.target.value = ""; // cho phép chọn lại cùng thư mục
    if (items.length === 0) return;
    void handleItems(items);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = await filesFromDataTransfer(e.dataTransfer);
    if (items.length === 0) return;
    void handleItems(items);
  };

  const removeManga = (id: string) => {
    setMangas((prev) => prev.filter((m) => m.id !== id));
    setImportStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const reset = () => {
    setMangas([]);
    setImportStates({});
    setParseWarnings([]);
    setFinished(false);
    doneChaptersRef.current = new Set();
  };

  const totalChapters = useMemo(
    () => mangas.reduce((s, m) => s + m.chapters.length, 0),
    [mangas]
  );
  const doneCount = Object.values(importStates).filter((s) => s.status === "done").length;
  const errorCount = Object.values(importStates).filter(
    (s) => s.status === "error" || s.status === "cancelled"
  ).length;
  const skippedCount = Object.values(importStates).filter((s) => s.status === "skipped").length;

  const patchState = (states: Record<string, MangaImportState>, id: string, patch: Partial<MangaImportState>) => {
    states[id] = { ...states[id], ...patch };
    setImportStates({ ...states });
  };

  // ---------------- Upload 1 chương (engine + retry 429) ----------------

  const uploadChapterPages = async (
    mangaId: string,
    chapterId: string,
    initialItems: PageItem[],
    onProgress: (uploaded: number, total: number) => void,
    onWaitNotice: (msg: string | null) => void
  ): Promise<PageItem[]> => {
    let items = initialItems;
    let attempt = 0;
    let rateLimitWaits = 0;

    while (true) {
      if (cancelledRef.current) throw new CancelledError();

      let sawRateLimit = false;
      const engine = new UploadEngine({
        mangaId,
        chapterId,
        onItemChange: (id, patch) => {
          const it = items.find((x) => x.id === id);
          if (it) Object.assign(it, patch);
        },
        onProgress: (p) => onProgress(p.uploaded, p.total),
        onItemError: (_id, status) => {
          if (status === 429) sawRateLimit = true;
        },
      });
      engineRef.current = engine;
      const res = await engine.run(items);

      if (res.cancelled || engine.isCancelled || cancelledRef.current) {
        await engine.abortAll();
        throw new CancelledError();
      }

      const uploaded = items.filter((it) => it.status === "uploaded");
      if (uploaded.length === items.length) return uploaded;

      // Có lỗi — quyết định retry
      const failed = items.filter((it) => it.status === "error");
      if (sawRateLimit && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
        rateLimitWaits += 1;
        onWaitNotice(`Chờ hạn mức tải lên (${RATE_LIMIT_WAIT_MS / 1000}s)...`);
        await sleepAbortable(RATE_LIMIT_WAIT_MS, () => cancelledRef.current);
        if (cancelledRef.current) throw new CancelledError();
        onWaitNotice(null);
        items = failed.map((it) => ({ ...it, status: "pending", error: undefined }));
        continue;
      }

      attempt += 1;
      if (attempt < MAX_CHAPTER_ATTEMPTS) {
        await sleepAbortable(5_000, () => cancelledRef.current);
        if (cancelledRef.current) throw new CancelledError();
        items = failed.map((it) => ({ ...it, status: "pending", error: undefined }));
        continue;
      }

      // Hết lượt thử — ném lỗi kèm mô tả
      throw new Error(
        `${failed.length}/${items.length} trang không tải được — ${failed[0]?.error ?? "lỗi không rõ"}`
      );
    }
  };

  // ---------------- Tạo chương (xử lý trùng 409) ----------------

  const createChapterSafe = async (
    mangaId: string,
    chapterNumber: string,
    title: string | null
  ): Promise<{ id: string; skipped: boolean }> => {
    try {
      const created = await api.post<{ id: string }>(`/api/mangas/${mangaId}/chapters`, {
        chapterNumber,
        title,
      });
      return { id: created.id, skipped: false };
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        // Chương đã tồn tại (import lại sau lỗi) — tái dùng nếu rỗng
        const list = await api.get<Paginated<ChapterDto>>(
          `/api/mangas/${mangaId}/chapters?sort=asc&page=1&pageSize=200`
        );
        let existing = list.items.find((c) => c.chapterNumber === chapterNumber);
        // tìm tiếp ở các trang sau nếu chưa thấy
        for (let p = 2; existing === undefined && p <= (list.totalPages ?? 1); p++) {
          const more = await api.get<Paginated<ChapterDto>>(
            `/api/mangas/${mangaId}/chapters?sort=asc&page=${p}&pageSize=200`
          );
          existing = more.items.find((c) => c.chapterNumber === chapterNumber);
        }
        if (!existing) throw err;
        if (existing.pageCount > 0) return { id: existing.id, skipped: true };
        return { id: existing.id, skipped: false };
      }
      throw err;
    }
  };

  // ---------------- Import flow chính ----------------

  const startImport = async () => {
    if (mangas.length === 0 || importing) return;
    setImporting(true);
    setFinished(false);
    cancelledRef.current = false;

    const states: Record<string, MangaImportState> = {};
    for (const m of mangas) {
      // Giữ lại kết quả cũ của truyện đã xong / đã bỏ qua; reset phần còn lại
      const prev = importStates[m.id];
      states[m.id] =
        prev && (prev.status === "done" || prev.status === "skipped")
          ? prev
          : { status: "pending", chaptersDone: 0, chaptersTotal: m.chapters.length };
    }
    setImportStates({ ...states });

    // Danh sách tên truyện đã có — để bỏ qua trùng (trừ truyện đã tạo trong phiên này)
    let existingTitles: Set<string> | null = null;
    if (skipExisting) {
      try {
        existingTitles = await fetchExistingTitles();
      } catch {
        toast.warning("Không lấy được thư viện hiện tại — bỏ qua bước kiểm tra trùng.");
      }
    }

    try {
      for (const manga of mangas) {
        const st = states[manga.id];
        if (st.status === "done" || st.status === "skipped") continue;
        if (cancelledRef.current) {
          patchState(states, manga.id, { status: "cancelled" });
          continue;
        }
        if (existingTitles && !st.mangaId && existingTitles.has(normalizeTitleForMatch(manga.title))) {
          patchState(states, manga.id, { status: "skipped" });
          continue;
        }

        patchState(states, manga.id, { status: "importing", phase: "creating", currentChapter: undefined });
        const notices: string[] = [];

        try {
          // 1. Tạo truyện (hoặc tái dùng nếu đã tạo ở lần thử trước)
          let mangaId = st.mangaId;
          if (!mangaId) {
            const created = await api.post<{ id: string }>("/api/mangas", {
              title: manga.title,
              alternativeTitles: manga.meta.alternativeTitles,
              author: manga.meta.author,
              status: manga.meta.status,
              description: manga.meta.description,
              genres: manga.meta.genres,
            });
            mangaId = created.id;
          }
          patchState(states, manga.id, { mangaId });

          // 2. Ảnh bìa (best-effort — lỗi không chặn chương)
          if (manga.coverFile) {
            patchState(states, manga.id, { phase: "cover" });
            try {
              await uploadCoverToR2(mangaId, manga.coverFile);
            } catch (err) {
              if (cancelledRef.current) throw new CancelledError();
              notices.push(
                `Ảnh bìa lỗi: ${err instanceof Error ? err.message : "không rõ lý do"}`
              );
            }
          }

          // 3. Từng chương
          let chaptersDone = st.chaptersDone ?? 0;
          for (let i = 0; i < manga.chapters.length; i++) {
            if (cancelledRef.current) break;
            const ch = manga.chapters[i];
            const doneKey = `${manga.id}:${ch.number}`;

            if (doneChaptersRef.current.has(doneKey)) {
              // đã xong ở lần thử trước (theo dõi trong phiên)
              continue;
            }

            patchState(states, manga.id, {
              phase: "chapters",
              currentChapter: `Đang upload: ${ch.name} (${chaptersDone}/${manga.chapters.length} chương)`,
            });
            const setWaitNotice = (msg: string | null) =>
              patchState(states, manga.id, {
                phase: msg ? "waiting" : "chapters",
                currentChapter: msg ?? `Đang upload: ${ch.name} (${chaptersDone}/${manga.chapters.length} chương)`,
              });

            // Lọc file hợp lệ
            const valid = ch.files.filter(
              (f) => mimeFromFile(f) !== null && f.size > 0 && f.size <= MAX_FILE_BYTES
            );
            if (valid.length < ch.files.length) {
              notices.push(
                `Chương "${ch.name}": bỏ qua ${ch.files.length - valid.length} ảnh không hợp lệ`
              );
            }
            if (valid.length === 0) {
              notices.push(`Chương "${ch.name}" không có ảnh hợp lệ — bỏ qua`);
              continue;
            }

            const chapterRes = await createChapterSafe(
              mangaId,
              ch.number,
              ch.name !== ch.number ? ch.name : null
            );
            if (chapterRes.skipped) {
              // chương đã có trang (lần import trước) — ghi nhận và đi tiếp
              chaptersDone += 1;
              doneChaptersRef.current.add(doneKey);
              patchState(states, manga.id, { chaptersDone });
              continue;
            }

            const items = toPageItems(valid);
            const uploaded = await uploadChapterPages(
              mangaId,
              chapterRes.id,
              items,
              (up, total) => {
                patchState(states, manga.id, {
                  currentChapter: `Đang upload: ${ch.name} — ${up}/${total} trang`,
                });
              },
              setWaitNotice
            );

            // Finalize — ghi nhận trang vào DB (server HeadObject xác minh)
            let finalized = false;
            for (let fAttempt = 0; fAttempt < 3 && !finalized; fAttempt++) {
              try {
                await api.post(`/api/chapters/${chapterRes.id}/pages`, {
                  chapterId: chapterRes.id,
                  pages: uploaded.map((p) => ({
                    objectKey: p.objectKey as string,
                    pageNumber: p.pageNumber as number,
                    fileName: p.name,
                    mimeType: p.mimeType,
                    fileSize: p.size,
                    width: p.width,
                    height: p.height,
                    lqip: p.lqip ?? null,
                  })),
                });
                finalized = true;
              } catch (err) {
                if (cancelledRef.current) throw new CancelledError();
                if (fAttempt === 2) throw err;
                await sleepAbortable(4_000, () => cancelledRef.current);
              }
            }

            chaptersDone += 1;
            doneChaptersRef.current.add(doneKey);
            patchState(states, manga.id, { chaptersDone });
          }

          if (cancelledRef.current) {
            patchState(states, manga.id, {
              status: "cancelled",
              phase: undefined,
              currentChapter: undefined,
              notices: notices.length ? notices : undefined,
            });
          } else {
            patchState(states, manga.id, {
              status: "done",
              phase: undefined,
              currentChapter: undefined,
              notices: notices.length ? notices : undefined,
            });
          }
        } catch (err) {
          if (err instanceof CancelledError || cancelledRef.current) {
            patchState(states, manga.id, { status: "cancelled", phase: undefined, currentChapter: undefined });
          } else {
            patchState(states, manga.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Lỗi không xác định",
              phase: undefined,
              currentChapter: undefined,
              notices: notices.length ? notices : undefined,
            });
            // Tiếp tục với truyện kế tiếp
          }
        }
      }
    } finally {
      setImporting(false);
      setFinished(true);
      engineRef.current = null;
      // Làm mới dữ liệu liên quan
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["mangas"] }),
        qc.invalidateQueries({ queryKey: ["manga"] }),
        qc.invalidateQueries({ queryKey: ["chapters"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
        qc.invalidateQueries({ queryKey: ["genres"] }),
        qc.invalidateQueries({ queryKey: ["storage-stats"] }),
      ]);
    }
  };

  const cancelImport = () => {
    cancelledRef.current = true;
    engineRef.current?.cancel();
  };

  /** Import lại các truyện lỗi / đã hủy (giữ nguyên truyện đã xong) */
  const retryFailed = () => {
    if (importing) return;
    setImportStates((prev) => {
      const next: Record<string, MangaImportState> = {};
      for (const [id, s] of Object.entries(prev)) {
        next[id] =
          s.status === "error" || s.status === "cancelled"
            ? { ...s, status: "pending", error: undefined, phase: undefined, currentChapter: undefined }
            : s;
      }
      return next;
    });
    setFinished(false);
    // Đợi state commit rồi chạy
    setTimeout(() => void startImport(), 50);
  };

  const pendingCount = mangas.filter((m) => {
    const s = importStates[m.id];
    return !s || s.status === "pending" || s.status === "error" || s.status === "cancelled";
  }).length;
  const importingMangaId = Object.entries(importStates).find(
    ([, s]) => s.status === "importing"
  )?.[0];

  return (
    <div className="space-y-5">
      {/* Hướng dẫn + chọn nguồn */}
      {!importing && !finished && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Dropzone / chọn thư mục */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Kéo thả hoặc chọn thư mục truyện"
            className={cn(
              "flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/40"
            )}
            onClick={() => folderInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") folderInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFolderSelect}
              aria-hidden
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              {parsing ? (
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              ) : (
                <FolderOpen className="h-7 w-7 text-primary" />
              )}
            </div>
            <div>
              <p className="font-semibold">
                {parsing ? "Đang phân tích thư mục..." : "Chọn hoặc kéo thả thư mục truyện"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Chọn 1 bộ truyện hoặc thư mục cha chứa nhiều bộ — mỗi thư mục con là 1 truyện
              </p>
            </div>
            <Button className="mt-1 gap-2" disabled={parsing}>
              <FolderOpen className="h-4 w-4" />
              Chọn thư mục
            </Button>
          </div>

          {/* Mô tả cấu trúc */}
          <div className="rounded-xl border bg-card p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <FileText className="h-4 w-4 text-primary" />
              Cấu trúc thư mục được hỗ trợ
            </h3>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`Roubaitei (Hololive)/     ← tên thư mục = tên truyện
├── info.txt              ← thông tin truyện
├── cover.jpg             ← ảnh bìa (png/webp... đều được)
├── Chương 1/             ← mỗi thư mục con = 1 chương
│   ├── 1.jpg
│   ├── 2.jpg  ...
└── Chương 2/ ...`}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Ảnh được xếp theo thứ tự số (1, 2, ... 10). Trường nào thiếu trong info.txt thì bỏ
              trống; trường web không dùng (Nhóm dịch, Lượt xem, Nguồn...) được bỏ qua.
            </p>
          </div>
        </div>
      )}

      {/* Cảnh báo parse */}
      {parseWarnings.length > 0 && !importing && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Một số mục bị bỏ qua</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              {parseWarnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {parseWarnings.length > 5 && <li>... và {parseWarnings.length - 5} mục khác</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Danh sách truyện đã nhận diện */}
      {mangas.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight">
                <UploadCloud className="h-5 w-5 text-primary" />
                Sẵn sàng nhập
                <span className="text-sm font-normal text-muted-foreground">
                  ({mangas.length} truyện · {totalChapters} chương)
                </span>
              </h2>
              {!importing && !finished && (
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={skipExisting}
                    onCheckedChange={(v) => setSkipExisting(v === true)}
                    aria-label="Bỏ qua truyện đã có trong thư viện"
                  />
                  Bỏ qua truyện đã có trong thư viện (trùng tên)
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {finished ? (
                <>
                  {errorCount > 0 && (
                    <Button size="sm" className="gap-2" onClick={retryFailed}>
                      <RotateCcw className="h-4 w-4" />
                      Nhập lại {errorCount} truyện lỗi
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-2" onClick={reset}>
                    <Plus className="h-4 w-4" />
                    Nhập tiếp
                  </Button>
                  <Button size="sm" className="gap-2" onClick={() => navigate("/library")}>
                    <BookOpen className="h-4 w-4" />
                    Vào thư viện
                  </Button>
                </>
              ) : importing ? (
                <Button variant="destructive" size="sm" className="gap-2" onClick={cancelImport}>
                  <X className="h-4 w-4" />
                  Dừng nhập
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="gap-2" onClick={reset}>
                    <Trash2 className="h-4 w-4" />
                    Xóa hết
                  </Button>
                  <Button
                    size="sm"
                    className="gap-2 font-semibold"
                    onClick={() => void startImport()}
                  >
                    <UploadCloud className="h-4 w-4" />
                    Bắt đầu nhập ({pendingCount} truyện)
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Thanh tiến độ tổng */}
          {(importing || finished) && (
            <div className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {importing
                    ? "Đang nhập truyện..."
                    : finished
                      ? skippedCount > 0
                        ? "Hoàn tất"
                        : "Hoàn tất!"
                      : ""}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {doneCount}/{mangas.length} truyện
                  {skippedCount > 0 && ` · ${skippedCount} bỏ qua`}
                  {errorCount > 0 && ` · ${errorCount} lỗi`}
                </span>
              </div>
              <Progress value={(doneCount / mangas.length) * 100} className="h-2" />
            </div>
          )}

          <ul className="space-y-3">
            {mangas.map((m) => (
              <MangaParseCard
                key={m.id}
                manga={m}
                state={importStates[m.id]}
                disabled={importing}
                onRemove={importing || m.id === importingMangaId ? undefined : () => removeManga(m.id)}
              />
            ))}
          </ul>
        </>
      ) : (
        !importing &&
        !finished && (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Chưa có truyện nào được chọn. Nhấn{" "}
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Plus className="h-3.5 w-3.5" /> Chọn thư mục
            </span>{" "}
            ở trên để bắt đầu.
          </div>
        )
      )}

      {/* Tổng kết */}
      {finished && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Alert variant={errorCount > 0 ? "destructive" : "default"}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>
              {errorCount > 0
                ? `Nhập xong với ${errorCount} truyện lỗi`
                : "Nhập thành công toàn bộ!"}
            </AlertTitle>
            <AlertDescription>
              {doneCount} truyện đã được thêm vào thư viện
              {skippedCount > 0 && `, ${skippedCount} truyện bị bỏ qua do đã có`}
              {errorCount > 0 && `, ${errorCount} truyện lỗi (xem chi tiết trong danh sách)`}
              . Ảnh được lưu trên Cloudflare R2.
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
    </div>
  );
}
