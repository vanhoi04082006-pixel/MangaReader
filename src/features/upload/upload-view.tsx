"use client";

// =============================================================
// Upload View — man hinh tai len chuong moi
//
// 3 buoc: (1) Chon truyen + chuong  (2) Chon nguon anh
//         (3) Tai len engine + finalize
//
// Nguon anh: file ZIP (doc index phia client, giai nen tung trang),
//            thu muc (web directory), hoac nhieu file anh le.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  FileArchive,
  FolderOpen,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MangaFormDialog } from "@/features/manga/manga-form-dialog";
import {
  useChapters,
  useCreateChapter,
  useManga,
  useMangas,
  toastMutationError,
} from "@/hooks/queries";
import { navigate, useHashRoute } from "@/lib/client/hash-router";
import { api } from "@/lib/client/api";
import { formatBytes, formatDuration, formatSpeed } from "@/utils/format";
import { naturalSortFiles } from "@/utils/natural-sort";
import {
  extractZipEntry,
  filterImageEntries,
  readZipIndex,
  type ZipEntryInfo,
} from "@/utils/zip-reader";
import { UploadEngine, type PageItem, type UploadProgress } from "@/features/upload/upload-engine";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------------- constants & helpers ----------------

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};
const MAX_PAGES = 3000;
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB / anh (khop schema)
const NEW_CHAPTER = "__new__";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function mimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

function mimeFromFile(file: File): string | null {
  const t = file.type.toLowerCase();
  if (ACCEPTED_MIME.includes(t)) return t;
  return mimeFromName(file.name);
}

function relativePathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** Keo tha: lay toan bo file (ke ca thu muc con — de quy) */
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind !== "file") continue;
    const entry = it.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return Array.from(dt.files ?? []);

  const out: File[] = [];
  const walkFile = (entry: FileSystemFileEntry): Promise<void> =>
    new Promise((resolve) =>
      entry.file(
        (f) => {
          out.push(f);
          resolve();
        },
        () => resolve()
      )
    );
  const walkDir = async (dir: FileSystemDirectoryEntry): Promise<void> => {
    const reader = dir.createReader();
    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve) => reader.readEntries((b) => resolve(b), () => resolve([])));
    let batch = await readBatch();
    while (batch.length > 0) {
      for (const e of batch) await walk(e);
      batch = await readBatch();
    }
  };
  const walk = (entry: FileSystemEntry): Promise<void> =>
    entry.isFile
      ? walkFile(entry as FileSystemFileEntry)
      : entry.isDirectory
        ? walkDir(entry as FileSystemDirectoryEntry)
        : Promise.resolve();

  for (const e of entries) await walk(e);
  return out.length > 0 ? out : Array.from(dt.files ?? []);
}

/** Goi y so chuong tiep theo tu danh sach chuong hien co */
function suggestNextChapterNumber(chapterNumbers: string[]): string {
  let max = 0;
  for (const raw of chapterNumbers) {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = Math.floor(max) + 1;
  return String(next);
}

// ---------------- small UI pieces ----------------

function StepHeading({
  step,
  title,
  description,
  done,
}: {
  step: number;
  title: string;
  description?: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/15 text-primary"
        )}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : step}
      </span>
      <div>
        <h2 className="text-sm font-semibold leading-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

// ---------------- main view ----------------

type Phase = "idle" | "uploading" | "ready" | "finalizing" | "done";

export function UploadView() {
  const qc = useQueryClient();
  const route = useHashRoute();

  // ---- buoc 1: dich den ----
  const [mangaId, setMangaId] = useState<string | null>(null);
  const [mangaDialogOpen, setMangaDialogOpen] = useState(false);
  const [chapterSelect, setChapterSelect] = useState<string>(NEW_CHAPTER);
  const [newChapterNumber, setNewChapterNumber] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");

  // combobox manga search
  const [mangaSearch, setMangaSearch] = useState("");
  const [mangaComboOpen, setMangaComboOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(mangaSearch), 300);
    return () => clearTimeout(t);
  }, [mangaSearch]);

  const mangasQuery = useMangas({
    search: debouncedSearch,
    pageSize: 20,
    sort: "title",
    order: "asc",
  });
  const selectedMangaQuery = useManga(mangaId);
  const chaptersQuery = useChapters(mangaId, "desc", 1, 200);
  const createChapter = useCreateChapter();

  const chapters = chaptersQuery.data?.items ?? [];
  const existingChapter = useMemo(
    () => chapters.find((c) => c.id === chapterSelect) ?? null,
    [chapters, chapterSelect]
  );

  // Khoi tao tu query param: #/upload?manga=<id>&chapter=<id>
  const queryManga = route.query.get("manga");
  const queryChapter = route.query.get("chapter");
  useEffect(() => {
    if (queryManga) setMangaId(queryManga);
    if (queryChapter) setChapterSelect(queryChapter);
  }, [queryManga, queryChapter]);

  // Doi manga -> reset lua chon chuong + goi y so chuong moi
  useEffect(() => {
    setChapterSelect(NEW_CHAPTER);
    setNewChapterNumber(suggestNextChapterNumber((chaptersQuery.data?.items ?? []).map((c) => c.chapterNumber)));
    setNewChapterTitle("");
     
  }, [mangaId, chaptersQuery.data]);

  // ---- buoc 2: nguon anh ----
  const [sourceTab, setSourceTab] = useState<"zip" | "folder" | "files">("zip");
  const [items, setItems] = useState<PageItem[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previews, setPreviews] = useState<{ id: string; url: string }[]>([]);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory khong co trong TS types — set bang DOM API
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const itemsRef = useRef<PageItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patchItem = useCallback((id: string, patch: Partial<PageItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
      itemsRef.current = next;
      return next;
    });
  }, []);

  // ---- buoc 3: engine ----
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<{ chapterId: string; pageCount: number } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [starting, setStarting] = useState(false);

  const engineRef = useRef<UploadEngine | null>(null);
  const chapterIdRef = useRef<string | null>(null);
  /** true khi finalize thanh cong — luc do objects da la chinh thuc, KHONG duoc abort khi unmount */
  const settledRef = useRef(false);

  // Huy engine khi roi man hinh GIUA CHUNG (upload dang chay / chua finalize).
  // Neu da settled (finalize OK) thi bo qua — tranh xoa nhac anh da luu.
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (engine && !engine.isCancelled && !settledRef.current) {
        engine.cancel();
        void engine.abortAll();
      }
    };
  }, []);

  const totalBytes = useMemo(() => items.reduce((s, it) => s + it.size, 0), [items]);
  const uploadedCount = items.filter((it) => it.status === "uploaded").length;
  const failedItems = useMemo(() => items.filter((it) => it.status === "error"), [items]);

  // ---------------- build items tu nguon ----------------

  const applyItems = useCallback((next: PageItem[], label: string, skipped: number) => {
    setItems(next);
    itemsRef.current = next;
    setSourceLabel(label);
    setSkippedCount(skipped);
    setParseError(null);
    setPhase("idle");
    setProgress(null);
    setFinalizeError(null);
    setResultInfo(null);
    settledRef.current = false;
    chapterIdRef.current = null;
    setPreviewNonce((n) => n + 1);
  }, []);

  const buildFromZip = useCallback(
    async (file: File) => {
      setParsing(true);
      try {
        const entries = await readZipIndex(file);
        const { valid, skipped: skippedNames, overflowed } = filterImageEntries(entries);
        const sorted = naturalSortFiles(valid, (e: ZipEntryInfo) => e.name);
        const next: PageItem[] = [];
        let skipped = skippedNames.length;
        for (const e of sorted) {
          const mime = mimeFromName(e.name);
          if (!mime || e.uncompressedSize <= 0 || e.uncompressedSize > MAX_FILE_BYTES) {
            skipped += 1;
            continue;
          }
          next.push({
            id: uid(),
            name: baseName(e.name).slice(0, 255) || e.name.slice(0, 255),
            size: e.uncompressedSize,
            mimeType: mime,
            status: "pending",
            width: null,
            height: null,
            loadBlob: () => extractZipEntry(file, e),
          });
        }
        if (next.length === 0) {
          setParseError(
            "File ZIP không chứa ảnh hợp lệ (jpg/png/webp/avif/gif, mỗi ảnh tối đa 100MB)."
          );
          applyItems([], file.name, skipped);
          return;
        }
        if (next.length > MAX_PAGES) {
          setParseError(`Quá nhiều trang (${next.length}). Tối đa ${MAX_PAGES} trang mỗi chương.`);
          applyItems([], file.name, skipped);
          return;
        }
        if (overflowed) {
          setParseError(
            `ZIP chứa quá ${MAX_PAGES} ảnh hợp lệ — chỉ giữ ${MAX_PAGES} trang đầu, phần còn lại bị bỏ qua.`
          );
        }
        applyItems(next, file.name, skipped);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Không đọc được file ZIP.");
        applyItems([], file.name, 0);
      } finally {
        setParsing(false);
      }
    },
    [applyItems]
  );

  const buildFromFiles = useCallback(
    (files: File[], label: string) => {
      const imgs = files.filter((f) => mimeFromFile(f) !== null && f.size > 0 && f.size <= MAX_FILE_BYTES);
      const skipped = files.length - imgs.length;
      const sorted = naturalSortFiles(imgs, (f: File) => relativePathOf(f));
      const next: PageItem[] = sorted.map((f) => ({
        id: uid(),
        name: baseName(f.name).slice(0, 255) || f.name.slice(0, 255),
        size: f.size,
        mimeType: mimeFromFile(f) as string,
        status: "pending" as const,
        width: null,
        height: null,
        loadBlob: () => Promise.resolve(f),
      }));
      if (next.length === 0) {
        setParseError("Không có ảnh hợp lệ nào (jpg/png/webp/avif/gif, mỗi ảnh tối đa 100MB).");
        applyItems([], label, skipped);
        return;
      }
      if (next.length > MAX_PAGES) {
        setParseError(`Quá nhiều trang (${next.length}). Tối đa ${MAX_PAGES} trang mỗi chương.`);
        applyItems([], label, skipped);
        return;
      }
      applyItems(next, label, skipped);
    },
    [applyItems]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (phase === "uploading") return;
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;
      const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
      if (zips.length === 1 && files.length === 1) {
        await buildFromZip(zips[0]);
      } else {
        const label =
          files.length > 1 ? `${files.length} file` : baseName(relativePathOf(files[0]));
        buildFromFiles(files, label);
      }
    },
    [phase, buildFromZip, buildFromFiles]
  );

  const removeItem = (id: string) => {
    if (phase === "uploading" || phase === "finalizing") return;
    const next = itemsRef.current.filter((it) => it.id !== id);
    setItems(next);
    itemsRef.current = next;
    setPreviewNonce((n) => n + 1);
  };

  const clearAll = () => {
    if (phase === "uploading" || phase === "finalizing") return;
    if (engineRef.current) void engineRef.current.abortAll();
    applyItems([], "", 0);
    setSourceLabel(null);
  };

  // Thumbnail preview cho 6 trang dau (re-build khi danh sach doi)
  useEffect(() => {
    if (items.length === 0) {
      setPreviews([]);
      return;
    }
    let stopped = false;
    const created: string[] = [];
    (async () => {
      for (const it of items.slice(0, 6)) {
        if (stopped) return;
        try {
          const blob = await it.loadBlob();
          if (stopped) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          setPreviews((prev) => [...prev, { id: it.id, url }]);
        } catch {
          /* bo qua */
        }
      }
    })();
    return () => {
      stopped = true;
      created.forEach((u) => URL.revokeObjectURL(u));
      setPreviews([]);
    };
     
  }, [previewNonce]);

  // ---------------- finalize ----------------

  const invalidateAfterFinalize = useCallback(
    async (mid: string, chapterId: string) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["chapters", mid] }),
        qc.invalidateQueries({ queryKey: ["manga", mid] }),
        qc.invalidateQueries({ queryKey: ["mangas"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
        qc.invalidateQueries({ queryKey: ["storage-stats"] }),
        qc.invalidateQueries({ queryKey: ["chapter", chapterId] }),
      ]);
    },
    [qc]
  );

  const finalize = useCallback(
    async (pages: PageItem[]) => {
      const chapterId = chapterIdRef.current;
      if (!chapterId || !mangaId || pages.length === 0) return;
      setPhase("finalizing");
      setFinalizeError(null);
      try {
        const res = await api.post<{ chapterId: string; pageCount: number }>(
          `/api/chapters/${chapterId}/pages`,
          {
            chapterId,
            pages: pages.map((p) => ({
              objectKey: p.objectKey as string,
              pageNumber: p.pageNumber as number,
              fileName: p.name,
              mimeType: p.mimeType,
              fileSize: p.size,
              width: p.width,
              height: p.height,
            })),
          }
        );
        await invalidateAfterFinalize(mangaId, chapterId);
        settledRef.current = true;
        setResultInfo({ chapterId, pageCount: res.pageCount });
        setPhase("done");
        toast.success(`Đã lưu ${res.pageCount} trang cho chương.`);
      } catch (err) {
        setFinalizeError(
          err instanceof Error ? err.message : "Lưu chương thất bại. Vui lòng thử lại."
        );
        setPhase("ready");
      }
    },
    [mangaId, invalidateAfterFinalize]
  );

  // ---------------- engine chay ----------------

  const runEngine = useCallback(
    async (engine: UploadEngine, runItems: PageItem[], autoFinalize: boolean) => {
      engineRef.current = engine;
      setPhase("uploading");
      setFinalizeError(null);
      const res = await engine.run(runItems);

      if (res.cancelled || engine.isCancelled) {
        await engine.abortAll();
        // Reset items ve pending — objectKey da bi xoa khoi DB
        setItems((prev) =>
          prev.map((it) => ({
            ...it,
            status: "pending",
            error: undefined,
            objectKey: undefined,
            uploadUrl: undefined,
          }))
        );
        setPhase("idle");
        toast.info("Đã hủy tải lên. Các ảnh chưa hoàn tất được dọn khỏi bộ nhớ.");
        return;
      }

      if (res.failed > 0) {
        setPhase("ready");
        toast.warning(`${res.failed} trang tải lên lỗi — có thể thử lại hoặc hoàn tất một phần.`);
        return;
      }

      if (autoFinalize && res.uploaded > 0) {
        const uploaded = itemsRef.current.filter((it) => it.status === "uploaded");
        await finalize(uploaded);
      } else {
        setPhase("ready");
      }
    },
    [finalize]
  );

  const doStartUpload = useCallback(async () => {
    if (!mangaId) return;
    setStarting(true);
    try {
      let chapterId: string | undefined;
      if (chapterSelect === NEW_CHAPTER) {
        const num = newChapterNumber.trim();
        if (!num) {
          toast.error("Nhập số chương (ví dụ: 5 hoặc 5.5).");
          return;
        }
        try {
          const created = await createChapter.mutateAsync({
            mangaId,
            input: { chapterNumber: num, title: newChapterTitle.trim() || null },
          });
          chapterId = created.id;
        } catch (err) {
          toastMutationError(err, "Tạo chương thất bại.");
          return;
        }
      } else {
        chapterId = chapterSelect;
        if (!chapterId) {
          toast.error("Hãy chọn chương đích.");
          return;
        }
      }

      chapterIdRef.current = chapterId;
      const runItems = itemsRef.current.map((it, idx) => ({ ...it, pageNumber: idx + 1 }));
      setItems(runItems);
      itemsRef.current = runItems;

      const engine = new UploadEngine({
        mangaId,
        chapterId,
        onItemChange: patchItem,
        onProgress: setProgress,
      });
      await runEngine(engine, runItems, true);
    } finally {
      setStarting(false);
    }
  }, [
    mangaId,
    chapterSelect,
    newChapterNumber,
    newChapterTitle,
    createChapter,
    patchItem,
    runEngine,
  ]);

  const startUpload = useCallback(async () => {
    if (!mangaId) {
      toast.error("Hãy chọn truyện đích.");
      return;
    }
    if (items.length === 0) {
      toast.error("Chưa chọn ảnh để tải lên.");
      return;
    }

    // Chuong da co trang -> xac nhan thay the
    if (existingChapter && existingChapter.pageCount > 0) {
      setConfirmReplace(true);
      return;
    }

    await doStartUpload();
  }, [mangaId, items, existingChapter, doStartUpload]);

  const retryFailed = useCallback(async () => {
    if (!mangaId || !chapterIdRef.current) return;
    const failed = itemsRef.current.filter((it) => it.status === "error");
    if (failed.length === 0) return;
    const engine = new UploadEngine({
      mangaId,
      chapterId: chapterIdRef.current,
      onItemChange: patchItem,
      onProgress: setProgress,
    });
    await runEngine(engine, failed, false);
    // Sau retry: neu khong con loi -> cho phep finalize
  }, [mangaId, patchItem, runEngine]);

  const finishNow = useCallback(async () => {
    const uploaded = itemsRef.current.filter((it) => it.status === "uploaded");
    if (uploaded.length === 0) {
      toast.error("Chưa có trang nào tải thành công.");
      return;
    }
    await finalize(uploaded);
  }, [finalize]);

  const abortEverything = useCallback(async () => {
    const engine = engineRef.current;
    if (engine) await engine.abortAll();
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        status: "pending",
        error: undefined,
        objectKey: undefined,
        uploadUrl: undefined,
      }))
    );
    setPhase("idle");
    toast.info("Đã dọn dẹp các ảnh chưa hoàn tất.");
  }, []);

  // ---------------- render ----------------

  const busy = phase === "uploading" || phase === "finalizing" || starting;
  const mangaTitle = selectedMangaQuery.data?.title;
  const canStart =
    Boolean(mangaId) &&
    items.length > 0 &&
    !busy &&
    (chapterSelect === NEW_CHAPTER ? newChapterNumber.trim().length > 0 : true);

  const visibleRows = items.slice(0, 200);

  return (
    <div className="space-y-4 pb-8">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tải lên chương</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Thêm trang mới từ file ZIP, thư mục hoặc ảnh rời — tải thẳng lên Cloudflare R2.
          </p>
        </div>
        {phase === "done" && resultInfo ? (
          <div className="flex gap-2">
            <Button
              className="gap-2"
              onClick={() => navigate(`/reader/${mangaId}/${resultInfo.chapterId}`)}
            >
              <BookOpen className="h-4 w-4" />
              Đọc ngay
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => navigate(`/manga/${mangaId}`)}>
              Về trang truyện
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {/* ===================== STEP 1 ===================== */}
      <Card>
        <CardHeader className="pb-4">
          <StepHeading
            step={1}
            title="Chọn truyện và chương"
            description="Ảnh sẽ được gắn vào chương này. Chương mới được tạo khi bắt đầu tải lên."
            done={Boolean(mangaId && (chapterSelect !== NEW_CHAPTER || newChapterNumber.trim()))}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manga combobox */}
          <div className="space-y-2">
            <Label>Truyện</Label>
            <div className="flex gap-2">
              <Popover open={mangaComboOpen} onOpenChange={setMangaComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={mangaComboOpen}
                    className="h-10 flex-1 justify-between font-normal"
                    disabled={busy}
                  >
                    {mangaTitle ? (
                      <span className="truncate">{mangaTitle}</span>
                    ) : (
                      <span className="text-muted-foreground">Chọn truyện...</span>
                    )}
                    <Images className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(480px,90vw)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Tìm theo tên truyện..."
                      value={mangaSearch}
                      onValueChange={setMangaSearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {mangasQuery.isLoading ? "Đang tải..." : "Không tìm thấy truyện."}
                      </CommandEmpty>
                      <CommandGroup>
                        {mangasQuery.data?.items.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.id}
                            onSelect={() => {
                              setMangaId(m.id);
                              setMangaComboOpen(false);
                            }}
                          >
                            <CheckCircle2
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                mangaId === m.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">{m.title}</span>
                            {m.author ? (
                              <span className="ml-auto text-xs text-muted-foreground truncate max-w-32">
                                {m.author}
                              </span>
                            ) : null}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Button
                variant="outline"
                className="gap-2"
                disabled={busy}
                onClick={() => setMangaDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Truyện mới
              </Button>
            </div>
          </div>

          {/* Chapter */}
          <div className="space-y-2">
            <Label>Chương</Label>
            {mangaId ? (
              <>
                <Select
                  value={chapterSelect}
                  onValueChange={setChapterSelect}
                  disabled={busy}
                >
                  <SelectTrigger className="h-10 w-full sm:w-80" aria-label="Chọn chương">
                    <SelectValue placeholder="Chọn chương..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_CHAPTER}>
                      <span className="font-medium text-primary">Tạo chương mới...</span>
                    </SelectItem>
                    {chapters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        Chương {c.chapterNumber}
                        {c.title ? ` — ${c.title}` : ""}
                        {c.pageCount > 0 ? ` (${c.pageCount} trang)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {chapterSelect === NEW_CHAPTER ? (
                  <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                    <Input
                      placeholder="Số chương (5, 5.5...)"
                      value={newChapterNumber}
                      onChange={(e) => setNewChapterNumber(e.target.value)}
                      disabled={busy}
                      maxLength={50}
                      aria-label="Số chương"
                    />
                    <Input
                      placeholder="Tên chương (tùy chọn)"
                      value={newChapterTitle}
                      onChange={(e) => setNewChapterTitle(e.target.value)}
                      disabled={busy}
                      maxLength={300}
                      aria-label="Tên chương"
                    />
                  </div>
                ) : existingChapter && existingChapter.pageCount > 0 ? (
                  <Alert variant="destructive" className="border-amber-500/40 bg-amber-500/10 text-foreground">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <AlertTitle className="text-sm">Chương này đã có {existingChapter.pageCount} trang</AlertTitle>
                    <AlertDescription className="text-xs">
                      Trang cùng số thứ tự sẽ bị thay thế — ảnh cũ tự động dọn khỏi lưu trữ. Trang mới
                      sẽ được nối tiếp vào cuối.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Chọn truyện trước để tạo chương mới hoặc chọn chương có sẵn.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===================== STEP 2 ===================== */}
      <Card>
        <CardHeader className="pb-4">
          <StepHeading
            step={2}
            title="Chọn nguồn ảnh"
            description="ZIP được giải nén từng trang ngay trên máy — hỗ trợ file lớn mà không tốn RAM."
            done={items.length > 0}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as typeof sourceTab)}>
            <TabsList className="grid w-full grid-cols-3 sm:w-auto">
              <TabsTrigger value="zip" className="gap-2" disabled={busy}>
                <FileArchive className="h-4 w-4" />
                File ZIP
              </TabsTrigger>
              <TabsTrigger value="folder" className="gap-2" disabled={busy}>
                <FolderOpen className="h-4 w-4" />
                Thư mục
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-2" disabled={busy}>
                <Images className="h-4 w-4" />
                Ảnh rời
              </TabsTrigger>
            </TabsList>

            <TabsContent value="zip" className="mt-3">
              <SourceDropzone
                dragOver={dragOver}
                onDragStateChange={setDragOver}
                onDrop={onDrop}
                disabled={busy}
                icon={FileArchive}
                title="Kéo thả file ZIP vào đây"
                hint="Hoặc bấm để chọn file .zip — ảnh bên trong được tự động sắp xếp theo thứ tự tự nhiên."
                onClick={() => zipInputRef.current?.click()}
                parsing={parsing}
              />
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void buildFromZip(f);
                  e.target.value = "";
                }}
              />
            </TabsContent>

            <TabsContent value="folder" className="mt-3">
              <SourceDropzone
                dragOver={dragOver}
                onDragStateChange={setDragOver}
                onDrop={onDrop}
                disabled={busy}
                icon={FolderOpen}
                title="Kéo thả thư mục vào đây"
                hint="Hoặc bấm để chọn thư mục — toàn bộ ảnh trong các thư mục con được duyệt đệ quy."
                onClick={() => folderInputRef.current?.click()}
                parsing={parsing}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) {
                    const label = baseName(relativePathOf(files[0])) || "Thư mục";
                    buildFromFiles(files, `${label} (${files.length} file)`);
                  }
                  e.target.value = "";
                }}
              />
            </TabsContent>

            <TabsContent value="files" className="mt-3">
              <SourceDropzone
                dragOver={dragOver}
                onDragStateChange={setDragOver}
                onDrop={onDrop}
                disabled={busy}
                icon={Images}
                title="Kéo thả ảnh vào đây"
                hint="Hoặc bấm để chọn nhiều file ảnh (jpg, png, webp, avif, gif)."
                onClick={() => filesInputRef.current?.click()}
                parsing={parsing}
              />
              <input
                ref={filesInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) buildFromFiles(files, `${files.length} ảnh`);
                  e.target.value = "";
                }}
              />
            </TabsContent>
          </Tabs>

          {parseError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">Không đọc được nguồn ảnh</AlertTitle>
              <AlertDescription className="text-xs">{parseError}</AlertDescription>
            </Alert>
          ) : null}

          {/* Danh sach trang */}
          <AnimatePresence initial={false}>
            {items.length > 0 ? (
              <motion.div
                key="items"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary" className="gap-1">
                      <Images className="h-3 w-3" />
                      {items.length} trang
                    </Badge>
                    <Badge variant="secondary">{formatBytes(totalBytes)}</Badge>
                    {sourceLabel ? (
                      <span className="max-w-48 truncate text-xs text-muted-foreground">
                        {sourceLabel}
                      </span>
                    ) : null}
                    {skippedCount > 0 ? (
                      <span className="text-xs text-amber-500">
                        Đã bỏ qua {skippedCount} file không hợp lệ
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    onClick={clearAll}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Bỏ tất cả
                  </Button>
                </div>

                {/* Thumbnails */}
                {previews.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {previews.map((p, i) => (
                      <div
                        key={p.id}
                        className="relative h-24 shrink-0 overflow-hidden rounded-md border bg-muted"
                      >
                        <img src={p.url} alt={`Xem trước trang ${i + 1}`} className="h-full w-auto" />
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 font-mono text-[9px] font-bold text-white">
                          {i + 1}
                        </span>
                      </div>
                    ))}
                    {items.length > previews.length ? (
                      <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        +{items.length - previews.length}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Bang trang */}
                <div className="overflow-hidden rounded-lg border">
                  {/* Scroll thuần 2 chiều: Radix ScrollArea không scroll được
                      với max-h (viewport không bị chặn chiều cao); trên
                      màn hẹp bảng cuộn NGANG thay vì bóp cột chữ méo. */}
                  <div className="max-h-72 overflow-auto overscroll-contain scrollbar-thin">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                        <tr className="text-left text-muted-foreground">
                          <th className="w-10 px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">Tệp</th>
                          <th className="w-20 px-3 py-2 text-right font-medium">Dung lượng</th>
                          <th className="w-24 px-3 py-2 font-medium">Trạng thái</th>
                          <th className="w-10 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((it, idx) => (
                          <tr key={it.id} className="border-t hover:bg-muted/40">
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">
                              {it.pageNumber ?? idx + 1}
                            </td>
                            <td className="max-w-56 truncate px-3 py-1.5" title={it.name}>
                              {it.name}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                              {formatBytes(it.size)}
                            </td>
                            <td className="px-3 py-1.5">
                              <StatusCell item={it} />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {!busy ? (
                                // Touch target >= 32px (ngan hon 44 but OK cho
                                // o phu; cac o chinh deu >= 36px)
                                <button
                                  className="rounded p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => removeItem(it.id)}
                                  aria-label={`Bỏ trang ${it.pageNumber ?? idx + 1}`}
                                  title="Bỏ trang này"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {items.length > visibleRows.length ? (
                    <p className="border-t bg-muted/40 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                      và {items.length - visibleRows.length} trang nữa...
                    </p>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* ===================== STEP 3 ===================== */}
      <Card>
        <CardHeader className="pb-4">
          <StepHeading
            step={3}
            title="Tải lên và lưu chương"
            description="3 ảnh được tải song song; tự động thử lại qua máy chủ nếu kết nối tới R2 bị chặn."
            done={phase === "done"}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "idle" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button className="gap-2" size="lg" disabled={!canStart} onClick={() => void startUpload()}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {starting ? "Đang chuẩn bị..." : "Bắt đầu tải lên"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {canStart
                  ? `${items.length} trang · ${formatBytes(totalBytes)} → ${
                      chapterSelect === NEW_CHAPTER ? `chương ${newChapterNumber.trim()}` : `chương ${existingChapter?.chapterNumber ?? ""}`
                    }`
                  : "Hoàn tất bước 1 và 2 để bắt đầu."}
              </p>
            </div>
          ) : null}

          {phase === "uploading" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Đang tải lên... {progress ? `${progress.uploaded}/${progress.total} trang` : ""}
                </span>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => engineRef.current?.cancel()}>
                  <X className="h-3.5 w-3.5" />
                  Hủy
                </Button>
              </div>
              <Progress value={progress ? (progress.uploaded / Math.max(1, progress.total)) * 100 : 0} />
              {progress ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {formatBytes(progress.bytesUploaded)} / {formatBytes(progress.bytesTotal)}
                  </span>
                  <span>Tốc độ: {formatSpeed(progress.speed)}</span>
                  <span>Còn lại: {formatDuration(progress.etaSeconds ?? 0)}</span>
                  {progress.failed > 0 ? (
                    <span className="text-destructive">{progress.failed} lỗi</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === "finalizing" ? (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Đang ghi nhận {uploadedCount} trang vào cơ sở dữ liệu...
            </div>
          ) : null}

          {phase === "ready" ? (
            <div className="space-y-3">
              {failedItems.length > 0 ? (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm">
                    {failedItems.length} trang tải lên không thành công
                  </AlertTitle>
                  <AlertDescription className="space-y-1 text-xs">
                    <p>Lý do phổ biến: mất mạng giữa chừng hoặc ảnh hỏng. Thử lại các trang lỗi, hoặc hoàn tất với {uploadedCount} trang đã tải.</p>
                    <p className="text-destructive/80">
                      Lỗi gần nhất: {failedItems[0].error ?? "không rõ"}
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null}
              {finalizeError ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Lưu chương thất bại</AlertTitle>
                  <AlertDescription className="text-xs">{finalizeError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {failedItems.length > 0 ? (
                  <Button className="gap-2" onClick={() => void retryFailed()}>
                    <RefreshCw className="h-4 w-4" />
                    Thử lại {failedItems.length} trang lỗi
                  </Button>
                ) : null}
                {uploadedCount > 0 ? (
                  <Button
                    variant={failedItems.length > 0 ? "outline" : "default"}
                    className="gap-2"
                    onClick={() => void finishNow()}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Hoàn tất với {uploadedCount} trang
                  </Button>
                ) : null}
                <Button variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => void abortEverything()}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Dọn dẹp &amp; bắt đầu lại
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "done" && resultInfo ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <AlertTitle className="text-sm">Tải lên hoàn tất</AlertTitle>
              <AlertDescription className="text-xs">
                Chương đã sẵn sàng đọc với {resultInfo.pageCount} trang. Ảnh được lưu trên Cloudflare R2
                và tự động dọn các bản trùng lặp.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <MangaFormDialog
        open={mangaDialogOpen}
        onOpenChange={setMangaDialogOpen}
        onCreated={(id) => {
          setMangaId(id);
          toast.success("Đã tạo truyện — chọn chương và tải ảnh ngay bây giờ.");
        }}
      />

      <ConfirmDialog
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={`Thay thế ${existingChapter?.pageCount ?? 0} trang hiện có?`}
        description="Các trang cùng số thứ tự sẽ bị ghi đè (ảnh cũ tự xóa khỏi lưu trữ). Hành động này không thể hoàn tác."
        confirmLabel="Tải lên"
        destructive
        onConfirm={async () => {
          setConfirmReplace(false);
          await doStartUpload();
        }}
      />
    </div>
  );
}

// ---------------- helpers UI ----------------

function StatusCell({ item }: { item: PageItem }) {
  if (item.status === "pending")
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Circle className="h-3 w-3" /> Chờ
      </span>
    );
  if (item.status === "uploading")
    return (
      <span className="flex items-center gap-1.5 text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Đang tải
      </span>
    );
  if (item.status === "uploaded")
    return (
      <span className="flex items-center gap-1.5 text-emerald-500">
        <CheckCircle2 className="h-3 w-3" /> Xong
      </span>
    );
  return (
    <span
      className="flex items-center gap-1.5 text-destructive"
      title={item.error ?? "Lỗi"}
    >
      <XCircle className="h-3 w-3 shrink-0" />
      <span className="truncate">Lỗi</span>
    </span>
  );
}

function SourceDropzone({
  dragOver,
  onDragStateChange,
  onDrop,
  disabled,
  icon: Icon,
  title,
  hint,
  onClick,
  parsing,
}: {
  dragOver: boolean;
  onDragStateChange: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick: () => void;
  parsing?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) onDragStateChange(true);
      }}
      onDragLeave={() => onDragStateChange(false)}
      onDrop={onDrop}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/50 hover:bg-muted/40",
        dragOver && !disabled && "border-primary bg-primary/5"
      )}
    >
      {parsing ? (
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{parsing ? "Đang đọc danh sách trang..." : title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
      {!disabled ? (
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <UploadCloud className="h-3.5 w-3.5" />
          Chọn từ máy
        </span>
      ) : null}
    </button>
  );
}
