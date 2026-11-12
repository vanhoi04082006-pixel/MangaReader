"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileArchive,
  FileImage,
  FolderOpen,
  ImageUp,
  Images,
  Loader2,
  Package,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { MangaFormDialog } from "@/features/manga/manga-form-dialog";
import { uploadEngine, type UploadItem } from "@/features/upload/upload-engine";
import { useChapters, useMangas, useChapter, toastMutationError } from "@/hooks/queries";
import { api } from "@/lib/client/api";
import { navigate, useHashRoute } from "@/lib/client/hash-router";
import { readZipIndex, filterImageEntries, extractZipEntry, ZipParseError } from "@/utils/zip-reader";
import { naturalSortFiles } from "@/utils/natural-sort";
import { formatBytes, formatSpeed, formatDuration } from "@/utils/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

interface PreparedFile {
  name: string;
  sortKey: string;
  size: number;
  mimeType: string;
  getBlob: () => Promise<Blob>;
}

export function UploadView() {
  const route = useHashRoute();
  const prefillMangaId = route.query.get("manga");
  const prefillChapterId = route.query.get("chapter");

  const snapshot = useSyncExternalStore(uploadEngine.subscribe, uploadEngine.getSnapshot);
  const engineBusy =
    snapshot.phase === "running" ||
    snapshot.phase === "paused" ||
    snapshot.phase === "finalizing";

  // ---- Step 1: manga ----
  const [mangaId, setMangaId] = useState<string | null>(prefillMangaId);
  const [mangaSearch, setMangaSearch] = useState("");
  const [mangaPopoverOpen, setMangaPopoverOpen] = useState(false);
  const [createMangaOpen, setCreateMangaOpen] = useState(false);
  const { data: mangaResults } = useMangas({ search: mangaSearch || undefined, pageSize: 10, sort: "title", order: "asc" });
  const selectedManga = mangaResults?.items.find((m) => m.id === mangaId) ?? null;

  // ---- Step 2: chapter ----
  const [chapterMode, setChapterMode] = useState<"new" | "existing">("new");
  const [newChapterNumber, setNewChapterNumber] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [existingChapterId, setExistingChapterId] = useState<string | null>(prefillChapterId);
  const { data: chaptersData } = useChapters(mangaId, "asc", 1, 200);
  const { data: existingChapterDetail } = useChapter(chapterMode === "existing" ? existingChapterId : null);

  const [existingMode, setExistingMode] = useState<"append" | "replace">("append");

  // ---- Step 3: files ----
  const [preparedFiles, setPreparedFiles] = useState<PreparedFile[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // webkitdirectory khong co trong React types — set thuoc tinh bang ref callback
  const setFolderInputRef = (el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  };

  // Prefill chapter khi co ?chapter=
  useEffect(() => {
    if (prefillChapterId && prefillMangaId) {
      setMangaId(prefillMangaId);
      setChapterMode("existing");
      setExistingChapterId(prefillChapterId);
    }
  }, [prefillChapterId, prefillMangaId]);

  // Chan thoat trang khi dang upload
  useEffect(() => {
    if (!engineBusy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [engineBusy]);

  const startPage = useMemo(() => {
    if (chapterMode === "existing" && existingMode === "append" && existingChapterDetail) {
      return existingChapterDetail.chapter.pageCount + 1;
    }
    return 1;
  }, [chapterMode, existingMode, existingChapterDetail]);

  // ---- File preparation ----

  const prepareFiles = useCallback(async (files: File[]) => {
    setPreparing(true);
    try {
      const zips = files.filter((f) => /\.zip$/i.test(f.name));
      const loose = files.filter((f) => !/\.zip$/i.test(f.name) && IMAGE_MIME_BY_EXT[extOf(f.name)]);

      const prepared: PreparedFile[] = [];

      for (const zip of zips) {
        try {
          const entries = await readZipIndex(zip);
          const { valid, skipped } = filterImageEntries(entries);
          if (skipped.length > 0) {
            toast.info(`ZIP "${zip.name}": bỏ qua ${skipped.length} file không phải ảnh.`);
          }
          if (valid.length === 0) {
            toast.error(`ZIP "${zip.name}" không chứa ảnh hợp lệ.`);
            continue;
          }
          const sorted = naturalSortFiles(valid, (e) => e.name);
          for (const entry of sorted) {
            prepared.push({
              name: entry.name.split("/").pop() ?? entry.name,
              sortKey: entry.name,
              size: entry.uncompressedSize,
              mimeType: IMAGE_MIME_BY_EXT[extOf(entry.name)] ?? "image/jpeg",
              getBlob: () => extractZipEntry(zip, entry),
            });
          }
        } catch (err) {
          toast.error(err instanceof ZipParseError ? err.message : `Không đọc được ZIP "${zip.name}".`);
        }
      }

      const sortedLoose = naturalSortFiles(loose, (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      for (const file of sortedLoose) {
        prepared.push({
          name: file.name,
          sortKey: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          size: file.size,
          mimeType: IMAGE_MIME_BY_EXT[extOf(file.name)] ?? file.type ?? "image/jpeg",
          getBlob: () => Promise.resolve(file),
        });
      }

      if (prepared.length === 0) {
        toast.error("Không tìm thấy ảnh hợp lệ nào (JPEG/PNG/WebP/AVIF/GIF).");
        setPreparedFiles(null);
        return;
      }
      if (prepared.length > 3000) {
        toast.error(`Quá nhiều trang (${prepared.length}). Tối đa 3000 trang mỗi lần upload — hãy chia nhỏ.`);
        setPreparedFiles(null);
        return;
      }

      setPreparedFiles(prepared);
      toast.success(`Đã nhận ${prepared.length} ảnh (${formatBytes(prepared.reduce((s, p) => s + p.size, 0))}).`);
    } finally {
      setPreparing(false);
    }
  }, [startPage]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const items = Array.from(e.dataTransfer.files);
      if (items.length > 0) await prepareFiles(items);
    },
    [prepareFiles]
  );

  // ---- Start upload ----

  const canStart = Boolean(
    mangaId &&
      preparedFiles &&
      preparedFiles.length > 0 &&
      (chapterMode === "new" ? newChapterNumber.trim().length > 0 : Boolean(existingChapterId)) &&
      snapshot.phase === "idle"
  );

  const startUpload = async () => {
    if (!mangaId || !preparedFiles) return;
    try {
      let chapterId: string;
      if (chapterMode === "new") {
        const created = await api.post<{ id: string }>(`/api/mangas/${mangaId}/chapters`, {
          chapterNumber: newChapterNumber.trim(),
          title: newChapterTitle.trim() || null,
        });
        chapterId = created.id;
      } else {
        chapterId = existingChapterId as string;
        if (existingMode === "replace" && (existingChapterDetail?.chapter.pageCount ?? 0) > 0) {
          await api.del(`/api/chapters/${chapterId}/pages`);
          toast.info("Đã xóa các trang cũ — bắt đầu thay thế.");
        }
      }

      uploadEngine.prepare(
        preparedFiles.map((f, i) => ({
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          pageNumber: i + 1,
          getBlob: f.getBlob,
        })),
        { mangaId, chapterId }
      );
      await uploadEngine.start();
    } catch (err) {
      toastMutationError(err, "Không bắt đầu được phiên upload.");
    }
  };

  // ---- Render helpers ----

  const uploading = snapshot.items.filter((i) => i.status === "uploading");
  const failed = snapshot.items.filter((i) => i.status === "error");
  const recentDone = snapshot.items.filter((i) => i.status === "done").slice(-6).reverse();
  const overallPercent =
    snapshot.totalBytes > 0 ? Math.min(1, snapshot.uploadedBytes / snapshot.totalBytes) : 0;
  const etaSeconds =
    snapshot.speedBps > 0 ? (snapshot.totalBytes - snapshot.uploadedBytes) / snapshot.speedBps : 0;

  const activeList: UploadItem[] = [...failed, ...uploading, ...recentDone];

  // ================== RENDER ==================

  // Panel tien do khi engine dang chay
  if (snapshot.phase !== "idle" && snapshot.items.length > 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Đang upload chương</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {snapshot.useProxy
              ? "Chế độ chuyển tiếp qua server (bucket chưa mở CORS cho upload trực tiếp)."
              : "Upload trực tiếp lên Cloudflare R2."}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-2xl font-bold tabular-nums">
                {snapshot.uploadedCount + snapshot.failedCount}/{snapshot.items.length}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(snapshot.uploadedBytes)} / {formatBytes(snapshot.totalBytes)}
                {snapshot.speedBps > 0 && ` · ${formatSpeed(snapshot.speedBps)}`}
                {etaSeconds > 0 && snapshot.phase === "running" && ` · còn ~${formatDuration(etaSeconds)}`}
              </p>
            </div>
            <div className="flex gap-2">
              {snapshot.phase === "running" && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => uploadEngine.pause()}>
                  <Pause className="h-4 w-4" />
                  Tạm dừng
                </Button>
              )}
              {snapshot.phase === "paused" && (
                <Button size="sm" className="gap-2" onClick={() => void uploadEngine.resume()}>
                  <Play className="h-4 w-4" />
                  Tiếp tục
                </Button>
              )}
              {(snapshot.phase === "running" || snapshot.phase === "paused") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => setConfirmCancel(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Hủy
                </Button>
              )}
            </div>
          </div>
          <Progress
            value={overallPercent * 100}
            className="mt-4 h-2"
          />
          {snapshot.phase === "paused" && (
            <p className="mt-2 text-xs text-amber-500">
              Đã tạm dừng — các file đang tải sẽ hoàn tất, không khởi tạo file mới.
            </p>
          )}
          {snapshot.phase === "finalizing" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Đang lưu thông tin {snapshot.items.filter((i) => i.status === "done").length} trang vào database...
            </p>
          )}
        </div>

        {/* Danh sach active */}
        {activeList.length > 0 && (
          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">
              {failed.length > 0 ? `Lỗi (${failed.length}) · Đang tải (${uploading.length})` : `Đang tải (${uploading.length})`}
            </div>
            <ul className="scrollbar-thin max-h-72 divide-y overflow-y-auto">
              {activeList.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {item.status === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : item.status === "error" ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{item.pageNumber}</span>
                      {item.name}
                    </p>
                    {item.status === "uploading" && (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${item.progress * 100}%` }} />
                      </div>
                    )}
                    {item.status === "error" && (
                      <p className="truncate text-xs text-destructive">{item.error}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatBytes(item.size)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Hoan tat / loi finalize */}
        {(snapshot.phase === "complete" || snapshot.phase === "finalize-error") && (
          <div
            className={cn(
              "rounded-xl border p-5",
              snapshot.phase === "complete" && snapshot.failedCount === 0
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-amber-500/30 bg-amber-500/5"
            )}
          >
            {snapshot.phase === "complete" ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                  {snapshot.failedCount === 0
                    ? "Upload hoàn tất!"
                    : `Hoàn tất với ${snapshot.failedCount} lỗi.`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{snapshot.finalizeMessage}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {snapshot.chapterId && (
                    <>
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => navigate(`/reader/${mangaId}/${snapshot.chapterId}`)}
                      >
                        <Play className="h-4 w-4" />
                        Đọc ngay
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => navigate(`/manga/${mangaId}`)}
                      >
                        <BookOpen className="h-4 w-4" />
                        Về truyện
                      </Button>
                    </>
                  )}
                  {snapshot.failedCount > 0 && (
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => void uploadEngine.retryFailed()}>
                      <RotateCcw className="h-4 w-4" />
                      Thử lại {snapshot.failedCount} file lỗi
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPreparedFiles(null);
                      setNewChapterNumber("");
                      setNewChapterTitle("");
                      uploadEngine.prepare([], { mangaId: "", chapterId: "" });
                    }}
                  >
                    Upload chương khác
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-5 w-5" />
                  Lưu dữ liệu thất bại
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {snapshot.finalizeMessage} — ảnh đã upload vẫn an toàn trên R2, chỉ cần thử lưu lại.
                </p>
                <Button size="sm" className="mt-4 gap-2" onClick={() => void uploadEngine.retryFinalize()}>
                  <RotateCcw className="h-4 w-4" />
                  Lưu lại
                </Button>
              </>
            )}
          </div>
        )}

        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Hủy phiên upload?"
          description="Các ảnh đã tải lên sẽ bị xóa khỏi R2, chương sẽ giữ nguyên các trang đã lưu trước đó (nếu có)."
          confirmLabel="Hủy upload"
          destructive
          onConfirm={async () => {
            await uploadEngine.cancel();
            toast.info("Đã hủy phiên upload.");
          }}
        />
      </div>
    );
  }

  // ================== Form chuan bi ==================
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Upload chương truyện</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Hỗ trợ file ZIP, thư mục ảnh hoặc chọn từng ảnh — tự động sắp xếp theo thứ tự tự nhiên.
        </p>
      </div>

      {/* Step 1: chon truyen */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">1</span>
          Chọn truyện
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Popover open={mangaPopoverOpen} onOpenChange={setMangaPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-w-56 justify-between gap-2 font-normal">
                {selectedManga ? (
                  <span className="truncate">{selectedManga.title}</span>
                ) : (
                  <span className="text-muted-foreground">Chọn truyện...</span>
                )}
                <BookOpen className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  value={mangaSearch}
                  onValueChange={setMangaSearch}
                  placeholder="Tìm truyện..."
                />
                <CommandList>
                  <CommandEmpty>Không tìm thấy truyện.</CommandEmpty>
                  <CommandGroup>
                    {(mangaResults?.items ?? []).map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={() => {
                          setMangaId(m.id);
                          setExistingChapterId(null);
                          setMangaPopoverOpen(false);
                        }}
                      >
                        <BookOpen className="h-4 w-4 opacity-60" />
                        <span className="truncate">{m.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{m.chapterCount} ch.</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <span className="text-sm text-muted-foreground">hoặc</span>
          <Button variant="outline" className="gap-2" onClick={() => setCreateMangaOpen(true)}>
            <Package className="h-4 w-4" />
            Tạo truyện mới
          </Button>
        </div>
      </section>

      {/* Step 2: chon chuong */}
      {mangaId && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">2</span>
            Chọn chương
          </h2>

          <RadioGroup
            value={chapterMode}
            onValueChange={(v) => setChapterMode(v as "new" | "existing")}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                chapterMode === "new" && "border-primary/50 bg-primary/5"
              )}
            >
              <RadioGroupItem value="new" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Chương mới</p>
                <p className="text-xs text-muted-foreground">Tạo chương rồi upload trang</p>
              </div>
            </label>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                chapterMode === "existing" && "border-primary/50 bg-primary/5"
              )}
            >
              <RadioGroupItem value="existing" className="mt-0.5" />
              <div>
                <p className="text-sm font-medium">Chương hiện có</p>
                <p className="text-xs text-muted-foreground">Bổ sung hoặc thay thế trang</p>
              </div>
            </label>
          </RadioGroup>

          {chapterMode === "new" ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="up-chapter-number">
                  Số chương <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="up-chapter-number"
                  value={newChapterNumber}
                  onChange={(e) => setNewChapterNumber(e.target.value)}
                  placeholder="1"
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="up-chapter-title">Tiêu đề (tùy chọn)</Label>
                <Input
                  id="up-chapter-title"
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  placeholder="Khởi đầu"
                  maxLength={300}
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {chaptersData && chaptersData.items.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                  Truyện này chưa có chương nào — chọn "Chương mới".
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Chương</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="min-w-56 justify-between gap-2 font-normal">
                          {(() => {
                            const ch = chaptersData?.items.find((c) => c.id === existingChapterId);
                            return ch ? (
                              <span className="truncate">
                                Chương {ch.chapterNumber} ({ch.pageCount} trang)
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Chọn chương...</span>
                            );
                          })()}
                          <ArrowRight className="h-4 w-4 rotate-90 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandList>
                            <CommandEmpty>Trống</CommandEmpty>
                            <CommandGroup>
                              {(chaptersData?.items ?? []).map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={c.id}
                                  onSelect={() => setExistingChapterId(c.id)}
                                >
                                  <span className="font-mono font-bold text-primary">{c.chapterNumber}</span>
                                  <span className="truncate">{c.title}</span>
                                  <span className="ml-auto text-xs text-muted-foreground">{c.pageCount} trang</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {existingChapterDetail && existingChapterDetail.chapter.pageCount > 0 && (
                    <RadioGroup
                      value={existingMode}
                      onValueChange={(v) => setExistingMode(v as "append" | "replace")}
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                          existingMode === "append" && "border-primary/50 bg-primary/5"
                        )}
                      >
                        <RadioGroupItem value="append" className="mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Bổ sung vào cuối</p>
                          <p className="text-xs text-muted-foreground">
                            Trang mới bắt đầu từ #{existingChapterDetail.chapter.pageCount + 1}
                          </p>
                        </div>
                      </label>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                          existingMode === "replace" && "border-destructive/50 bg-destructive/5"
                        )}
                      >
                        <RadioGroupItem value="replace" className="mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Thay thế toàn bộ</p>
                          <p className="text-xs text-muted-foreground">Xóa {existingChapterDetail.chapter.pageCount} trang cũ</p>
                        </div>
                      </label>
                    </RadioGroup>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Step 3: chon file */}
      {mangaId && (chapterMode === "new" ? newChapterNumber.trim() : existingChapterId) && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">3</span>
            Chọn ảnh
          </h2>

          {preparedFiles ? (
            <div className="mt-4 rounded-lg border bg-background/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Images className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{preparedFiles.length} ảnh đã sẵn sàng</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(preparedFiles.reduce((s, p) => s + p.size, 0))} · trang #1 → #{preparedFiles.length}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => setPreparedFiles(null)}
                >
                  <X className="h-4 w-4" />
                  Chọn lại
                </Button>
              </div>
              <ul className="scrollbar-thin mt-3 max-h-32 overflow-y-auto rounded-md border bg-card text-xs">
                {preparedFiles.slice(0, 40).map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="truncate">
                      <span className="mr-2 font-mono text-muted-foreground">#{i + 1}</span>
                      {f.name}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">{formatBytes(f.size)}</span>
                  </li>
                ))}
                {preparedFiles.length > 40 && (
                  <li className="px-3 py-1.5 text-center text-muted-foreground">
                    ... và {preparedFiles.length - 40} ảnh khác
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <div
              className={cn(
                "mt-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "hover:border-primary/40"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => void onDrop(e)}
            >
              {preparing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Đang đọc danh sách ảnh...</p>
                </div>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <UploadIcon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Kéo thả file ZIP vào đây</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      hoặc chọn ZIP / thư mục / từng ảnh — hệ thống tự lọc ảnh và sắp xếp thứ tự
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => zipInputRef.current?.click()}>
                      <FileArchive className="h-4 w-4" />
                      Chọn ZIP
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => folderInputRef.current?.click()}>
                      <FolderOpen className="h-4 w-4" />
                      Chọn thư mục
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => imagesInputRef.current?.click()}>
                      <ImageUp className="h-4 w-4" />
                      Chọn ảnh
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void prepareFiles(files);
            }}
          />
          <input
            ref={setFolderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void prepareFiles(files);
            }}
          />
          <input
            ref={imagesInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void prepareFiles(files);
            }}
          />

          <Button
            className="mt-5 w-full gap-2 font-semibold"
            size="lg"
            disabled={!canStart || preparing}
            onClick={() => void startUpload()}
          >
            <UploadIcon className="h-4 w-4" />
            Bắt đầu upload {preparedFiles ? `${preparedFiles.length} trang` : ""}
          </Button>
        </section>
      )}

      <MangaFormDialog
        open={createMangaOpen}
        onOpenChange={setCreateMangaOpen}
        onCreated={(id) => {
          setMangaId(id);
          setExistingChapterId(null);
        }}
      />
    </div>
  );
}
