"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateChapter, useUpdateChapter, toastMutationError } from "@/hooks/queries";
import type { ChapterDto } from "@/types";
import { toast } from "sonner";

interface ChapterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mangaId: string;
  editing?: ChapterDto | null;
  onSaved?: (chapterId: string) => void;
}

export function ChapterFormDialog({ open, onOpenChange, mangaId, editing, onSaved }: ChapterFormDialogProps) {
  const createChapter = useCreateChapter();
  const updateChapter = useUpdateChapter();
  const [chapterNumber, setChapterNumber] = useState("");
  const [title, setTitle] = useState("");
  const [volume, setVolume] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setChapterNumber(editing?.chapterNumber ?? "");
      setTitle(editing?.title ?? "");
      setVolume(editing?.volume ?? "");
    }
  }, [open, editing]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chapterNumber.trim()) return;
    setSaving(true);
    try {
      const input = {
        chapterNumber: chapterNumber.trim(),
        title: title.trim() || null,
        volume: volume.trim() || null,
      };
      if (editing) {
        await updateChapter.mutateAsync({ id: editing.id, input, mangaId });
        toast.success("Đã cập nhật chương.");
        onSaved?.(editing.id);
      } else {
        const created = await createChapter.mutateAsync({ mangaId, input });
        toast.success(`Đã tạo chương ${chapterNumber.trim()}.`);
        onSaved?.(created.id);
      }
      onOpenChange(false);
    } catch (err) {
      toastMutationError(err, "Lưu chương thất bại.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Sửa chương ${editing.chapterNumber}` : "Thêm chương mới"}</DialogTitle>
          <DialogDescription>
            Số chương chấp nhận cả dạng "5.5", "extra"... — sắp xếp tự động theo thứ tự tự nhiên.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="chapter-number">
                Số chương <span className="text-destructive">*</span>
              </Label>
              <Input
                id="chapter-number"
                value={chapterNumber}
                onChange={(e) => setChapterNumber(e.target.value)}
                placeholder="1"
                required
                maxLength={50}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chapter-volume">Tập (volume)</Label>
              <Input
                id="chapter-volume"
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                placeholder="1"
                maxLength={50}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="chapter-title">Tiêu đề chương</Label>
            <Input
              id="chapter-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Khởi đầu"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Hủy
            </Button>
            <Button type="submit" disabled={saving || !chapterNumber.trim()} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Lưu" : "Tạo chương"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
