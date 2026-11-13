"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateManga, useUpdateManga, useGenres, toastMutationError } from "@/hooks/queries";
import { uploadCoverToR2 } from "@/features/upload/cover-upload";
import { MANGA_STATUSES, type MangaStatus } from "@/schemas";
import type { MangaDetailDto } from "@/types";
import { STATUS_LABELS } from "@/components/manga/manga-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

interface MangaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Co se chuyen den trang upload sau khi tao */
  goToUploadAfterCreate?: boolean;
  editing?: MangaDetailDto | null;
  onCreated?: (mangaId: string) => void;
}

export function MangaFormDialog({
  open,
  onOpenChange,
  editing = null,
  onCreated,
}: MangaFormDialogProps) {
  const { data: genresData } = useGenres();
  const createManga = useCreateManga();
  const updateManga = useUpdateManga();

  const [title, setTitle] = useState("");
  const [altTitles, setAltTitles] = useState("");
  const [author, setAuthor] = useState("");
  const [artist, setArtist] = useState("");
  const [status, setStatus] = useState<MangaStatus>("ONGOING");
  const [year, setYear] = useState("");
  const [description, setDescription] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [newGenre, setNewGenre] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form khi mo dialog
  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setAltTitles(editing?.alternativeTitles ?? "");
      setAuthor(editing?.author ?? "");
      setArtist(editing?.artist ?? "");
      setStatus((editing?.status as MangaStatus) ?? "ONGOING");
      setYear(editing?.publicationYear ? String(editing.publicationYear) : "");
      setDescription(editing?.description ?? "");
      setSelectedGenres(editing?.genres ?? []);
      setCoverFile(null);
      setCoverPreview(null);
      setNewGenre("");
    }
  }, [open, editing]);

  const allGenres = useMemo(() => genresData?.genres.map((g) => g.name) ?? [], [genresData]);
  const [genreSearch, setGenreSearch] = useState("");
  const filteredGenres = useMemo(
    () =>
      allGenres.filter(
        (g) =>
          g.toLowerCase().includes(genreSearch.toLowerCase()) &&
          !selectedGenres.includes(g)
      ),
    [allGenres, genreSearch, selectedGenres]
  );

  const toggleGenre = (name: string) => {
    setSelectedGenres((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    );
  };

  const addNewGenre = () => {
    const name = newGenre.trim();
    if (name && !selectedGenres.includes(name)) {
      setSelectedGenres((prev) => [...prev, name]);
    }
    setNewGenre("");
  };

  const onCoverChange = (file: File | null) => {
    setCoverFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setCoverPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setCoverPreview(null);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        alternativeTitles: altTitles.trim() || null,
        author: author.trim() || null,
        artist: artist.trim() || null,
        status,
        publicationYear: year ? parseInt(year, 10) : null,
        description: description.trim() || null,
        genres: selectedGenres,
      };

      if (editing) {
        await updateManga.mutateAsync({ id: editing.id, input: payload });
        if (coverFile) {
          await uploadCoverToR2(editing.id, coverFile);
        }
        toast.success("Đã cập nhật thông tin truyện.");
      } else {
        const created = await createManga.mutateAsync(payload);
        if (coverFile) {
          try {
            await uploadCoverToR2(created.id, coverFile);
          } catch {
            toast.warning("Đã tạo truyện nhưng upload ảnh bìa thất bại — thử lại ở trang chi tiết.");
          }
        }
        toast.success("Đã thêm truyện mới.");
        onCreated?.(created.id);
      }
      onOpenChange(false);
    } catch (err) {
      toastMutationError(err, "Lưu truyện thất bại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-thin max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Sửa thông tin truyện" : "Thêm truyện mới"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Cập nhật thông tin metadata của truyện."
              : "Điền thông tin cơ bản — có thể upload ảnh và chương ngay sau đó."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            {/* Cover */}
            <div className="space-y-2">
              <Label>Ảnh bìa</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-48 w-32 overflow-hidden rounded-lg border-2 border-dashed bg-muted/50 transition-colors hover:border-primary/50"
              >
                {coverPreview || editing?.coverUrl ? (
                  <img
                    src={coverPreview ?? editing?.coverUrl ?? ""}
                    alt="Xem trước bìa"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Chọn ảnh
                  </span>
                )}
              </button>
              {coverFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full gap-1 text-xs text-muted-foreground"
                  onClick={() => onCoverChange(null)}
                >
                  <X className="h-3 w-3" /> Bỏ ảnh
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => onCoverChange(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manga-title">
                  Tên truyện <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="manga-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: One Piece"
                  required
                  maxLength={300}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manga-alt">Tên khác</Label>
                <Input
                  id="manga-alt"
                  value={altTitles}
                  onChange={(e) => setAltTitles(e.target.value)}
                  placeholder="Đội thủy quân mũ rơm, Vua hải tặc..."
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="manga-author">Tác giả</Label>
                  <Input
                    id="manga-author"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Eiichiro Oda"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manga-artist">Họa sĩ</Label>
                  <Input
                    id="manga-artist"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="manga-status">Trạng thái</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as MangaStatus)}>
                    <SelectTrigger id="manga-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MANGA_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manga-year">Năm xuất bản</Label>
                  <Input
                    id="manga-year"
                    type="number"
                    min={1900}
                    max={2100}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="1997"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* The loai */}
          <div className="space-y-2">
            <Label>Thể loại</Label>
            {selectedGenres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedGenres.map((g) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                  >
                    {g}
                    <button
                      type="button"
                      onClick={() => toggleGenre(g)}
                      aria-label={`Bỏ ${g}`}
                      className="rounded-full hover:bg-primary/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
                placeholder="Tìm thể loại..."
                className="h-9 min-w-0 flex-1 sm:max-w-40"
              />
              <Input
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNewGenre();
                  }
                }}
                placeholder="Thể loại mới..."
                className="h-9 min-w-0 flex-1 sm:max-w-40"
              />
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={addNewGenre}>
                <Plus className="h-3.5 w-3.5" />
                Thêm
              </Button>
            </div>
            <div className="scrollbar-thin max-h-28 overflow-y-auto rounded-lg border p-1.5">
              {filteredGenres.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">Không có kết quả.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filteredGenres.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGenre(g)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs transition-colors hover:border-primary/50 hover:text-primary"
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manga-desc">Mô tả</Label>
            <Textarea
              id="manga-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Giới thiệu ngắn về truyện..."
              rows={4}
              maxLength={8000}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Hủy
            </Button>
            <Button type="submit" disabled={saving || !title.trim()} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Lưu thay đổi" : "Tạo truyện"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
