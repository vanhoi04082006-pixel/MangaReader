"use client";

import {
  AlignHorizontalJustifyCenter,
  ArrowLeftRight,
  BookOpen,
  Columns3,
  Eye,
  Maximize2,
  MoveHorizontal,
  Ruler,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useReaderStore, type ReaderFit, type ReaderMode } from "@/store/reader-store";
import { cn } from "@/lib/utils";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function OptionRow<P extends string>({
  icon: Icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: P;
  options: Array<{ value: P; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  onChange: (v: P) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </Label>
      <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors",
              value === opt.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={value === opt.value}
          >
            {opt.icon && <opt.icon className="h-4 w-4" />}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReaderSettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const settings = useReaderStore();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cài đặt đọc truyện</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          <OptionRow<ReaderMode>
            icon={Columns3}
            label="Chế độ đọc"
            value={settings.mode}
            onChange={(v) => settings.update({ mode: v })}
            options={[
              { value: "vertical", label: "Cuộn dọc", icon: AlignHorizontalJustifyCenter },
              { value: "paged", label: "Từng trang", icon: BookOpen },
            ]}
          />

          <OptionRow<ReaderFit>
            icon={Ruler}
            label="Kích thước ảnh"
            value={settings.fit}
            onChange={(v) => settings.update({ fit: v })}
            options={[
              { value: "width", label: "Vừa rộng", icon: MoveHorizontal },
              { value: "height", label: "Vừa cao", icon: Maximize2 },
              { value: "original", label: "Gốc", icon: Eye },
            ]}
          />
          {settings.mode === "vertical" && settings.fit !== "width" && (
            <p className="-mt-3 text-xs text-muted-foreground">
              Lưu ý: "Vừa cao" và "Gốc" chỉ áp dụng đầy đủ ở chế độ từng trang.
            </p>
          )}

          <OptionRow
            icon={ArrowLeftRight}
            label="Hướng đọc"
            value={settings.direction}
            onChange={(v) => settings.update({ direction: v })}
            options={[
              { value: "ltr", label: "Trái → Phải" },
              { value: "rtl", label: "Phải → Trái" },
            ]}
          />

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Khoảng cách giữa trang</Label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {settings.pageGap}px
              </span>
            </div>
            <Slider
              value={[settings.pageGap]}
              min={0}
              max={48}
              step={4}
              onValueChange={([v]) => settings.update({ pageGap: v })}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Số trang tải trước</Label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {settings.preloadCount}
              </span>
            </div>
            <Slider
              value={[settings.preloadCount]}
              min={1}
              max={6}
              step={1}
              onValueChange={([v]) => settings.update({ preloadCount: v })}
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <Label className="text-sm font-medium">Màu nền đọc</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-1">
              {(
                [
                  { value: "dark", label: "Tối", className: "bg-[oklch(0.21_0.03_300)]" },
                  { value: "black", label: "Đen", className: "bg-black" },
                  { value: "light", label: "Sáng", className: "bg-[oklch(0.96_0.006_310)]" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => settings.update({ background: opt.value })}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors",
                    settings.background === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  aria-pressed={settings.background === opt.value}
                >
                  <span className={cn("h-5 w-8 rounded border", opt.className)} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Tự động ẩn thanh công cụ</Label>
              <p className="text-xs text-muted-foreground">Ẩn khi không di chuột</p>
            </div>
            <Switch
              checked={settings.autoHideToolbar}
              onCheckedChange={(v) => settings.update({ autoHideToolbar: v })}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
