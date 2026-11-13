"use client";

// =============================================================
// Upload View — màn hình "Thêm truyện" với 2 chế độ:
//  - Nhập nhiều truyện từ thư mục (batch import — mặc định)
//  - Upload từng chương (single — ZIP/thư mục/ảnh rời)
//
// Deep-link: #/upload?manga=<id>&chapter=<id> → mở thẳng tab đơn
// (dùng từ trang chi tiết truyện: "Upload thêm / thay trang").
// =============================================================

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchImportTab } from "@/features/upload/batch-import-tab";
import { SingleUploadTab } from "@/features/upload/single-upload-tab";
import { FolderTree, Images } from "lucide-react";
import { useHashRoute } from "@/lib/client/hash-router";

export function UploadView() {
  const route = useHashRoute();
  // Hỗ trợ deep-link: #/upload?manga=<id>&chapter=<id> → mở tab upload đơn lẻ
  const queryManga = route.query.get("manga");
  const queryChapter = route.query.get("chapter");
  const defaultTab = queryManga ? "single" : "batch";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Thêm truyện</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Nhập hàng loạt từ thư mục hoặc upload lẻ từng chương.
          </p>
        </div>
        <img
          src="/mascots/happy-hug.png"
          alt=""
          aria-hidden
          className="h-16 w-auto shrink-0 select-none sm:h-20"
        />
      </div>

      <Tabs defaultValue={defaultTab} className="gap-5">
        <TabsList className="h-auto w-full gap-1 rounded-xl bg-muted/60 p-1 sm:w-fit">
          <TabsTrigger
            value="batch"
            className="gap-2 rounded-lg px-3 py-2 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
          >
            <FolderTree className="h-4 w-4" />
            Nhập nhiều truyện từ thư mục
          </TabsTrigger>
          <TabsTrigger
            value="single"
            className="gap-2 rounded-lg px-3 py-2 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
          >
            <Images className="h-4 w-4" />
            Upload từng chương
          </TabsTrigger>
        </TabsList>

        <TabsContent value="batch" className="mt-0">
          <BatchImportTab />
        </TabsContent>
        <TabsContent value="single" className="mt-0">
          <SingleUploadTab initialMangaId={queryManga} initialChapterId={queryChapter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
