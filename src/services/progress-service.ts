// =============================================================
// Reading progress + history service (Supabase REST)
// =============================================================

import { supabase } from "@/lib/supabase";
import type { ProgressInput } from "@/schemas";
import type { ContinueReadingItemDto, HistoryEntryDto, Paginated } from "@/types";

export async function saveProgress(userId: string, input: ProgressInput) {
  const { data: chapter } = await supabase
    .from("chapters")
    .select("id, manga_id, page_count")
    .eq("id", input.chapterId)
    .maybeSingle();
  if (!chapter || chapter.manga_id !== input.mangaId) return null;

  const pageNumber = Math.min(Math.max(1, input.pageNumber), Math.max(1, chapter.page_count));

  // Upsert reading progress
  await supabase
    .from("reading_progress")
    .upsert(
      {
        user_id: userId,
        manga_id: input.mangaId,
        chapter_id: input.chapterId,
        page_number: pageNumber,
        scroll_position: input.scrollPosition ?? 0,
      },
      { onConflict: "user_id,manga_id" }
    );

  // Upsert reading history
  await supabase
    .from("reading_history")
    .upsert(
      {
        user_id: userId,
        manga_id: input.mangaId,
        chapter_id: input.chapterId,
        page_number: pageNumber,
        read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,chapter_id" }
    );

  const { data: progress } = await supabase
    .from("reading_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("manga_id", input.mangaId)
    .maybeSingle();

  return progress;
}

export async function continueReading(userId: string, limit = 10): Promise<ContinueReadingItemDto[]> {
  const { data: rows } = await supabase
    .from("reading_progress")
    .select("*, manga:mangas(id,title,cover_image_key), chapter:chapters(id,chapter_number,title,page_count)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return (rows ?? []).map((r: any) => ({
    mangaId: r.manga.id,
    mangaTitle: r.manga.title,
    coverImageKey: r.manga.cover_image_key,
    chapterId: r.chapter.id,
    chapterNumber: r.chapter.chapter_number,
    chapterTitle: r.chapter.title,
    pageNumber: r.page_number,
    pageCount: r.chapter.page_count,
    updatedAt: r.updated_at,
  }));
}

export async function listHistory(
  userId: string,
  page: number,
  pageSize: number
): Promise<Paginated<HistoryEntryDto>> {
  const { count: total } = await supabase
    .from("reading_history")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data: rows } = await supabase
    .from("reading_history")
    .select("*, manga:mangas(id,title,cover_image_key), chapter:chapters(id,chapter_number,title,page_count)")
    .eq("user_id", userId)
    .order("read_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  const items = (rows ?? []).map((r: any) => ({
    id: r.id,
    mangaId: r.manga.id,
    mangaTitle: r.manga.title,
    coverImageKey: r.manga.cover_image_key,
    chapterId: r.chapter.id,
    chapterNumber: r.chapter.chapter_number,
    chapterTitle: r.chapter.title,
    pageNumber: r.page_number,
    pageCount: r.chapter.page_count,
    readAt: r.read_at,
  }));

  return {
    items,
    total: total ?? 0,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
  };
}

export async function deleteHistoryForManga(userId: string, mangaId: string) {
  await supabase.from("reading_history").delete().eq("user_id", userId).eq("manga_id", mangaId);
}

export async function clearHistory(userId: string) {
  await supabase.from("reading_history").delete().eq("user_id", userId);
}