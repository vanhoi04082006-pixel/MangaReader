// =============================================================
// Manga service: CRUD, tim kiem/loc/sap xep/phan trang,
// yeu thich, bia, xoa cascade (DB + R2 dong bo) — Supabase REST
// =============================================================

import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";
import { deleteObjects } from "@/lib/r2";
import { ensureGenres } from "@/services/genre-service";
import { ensureProfile } from "@/services/profile-service";
import { safeDeleteObjects, removeMetadataIfDeleted } from "@/services/storage-service";
import type { MangaCreateInput, MangaUpdateInput, MangaStatus } from "@/schemas";
import type { MangaSummaryDto, MangaDetailDto, DuplicateMatchDto, Paginated } from "@/types";
import { naturalCompare } from "@/utils/natural-sort";

function textContains(value: string): string {
  return value; // PostgREST: use ilike for case-insensitive
}

// -------------------------------------------------------------
// Cot mangas.source_url (migration 0002) — TU KIEM TRA ton tai.
// Vercel co the deploy truoc khi migration chay tren Supabase;
// probe 1 lan va cache ket qua de deploy theo bat ky thu tu nao.
// -------------------------------------------------------------
let sourceUrlColumnCache: boolean | null = null;

export async function mangaSupportsSourceUrl(): Promise<boolean> {
  if (sourceUrlColumnCache !== null) return sourceUrlColumnCache;
  try {
    const { error } = await supabase.from("mangas").select("source_url").limit(1);
    sourceUrlColumnCache = !error; // PGRST204 (column khong ton tai) -> false
  } catch {
    sourceUrlColumnCache = false;
  }
  return sourceUrlColumnCache;
}

// Cot mangas.cover_lqip / cover_color (migration 0003) — cung tu kiem tra
// ton tai (deploy truoc/khi migration deu an toan; UI fallback shimmer).
let lqipColumnCache: boolean | null = null;

export async function mangaSupportsLqip(): Promise<boolean> {
  if (lqipColumnCache !== null) return lqipColumnCache;
  try {
    const { error } = await supabase.from("mangas").select("cover_lqip").limit(1);
    lqipColumnCache = !error;
  } catch {
    lqipColumnCache = false;
  }
  return lqipColumnCache;
}

/**
 * Chuẩn hóa tên để so khớp truyện trùng: bỏ dấu tiếng Việt, lowercase,
 * chỉ giữ chữ+số ("Roubaitei (Hololive)" ≈ "roubaitei hololive").
 */
export function normalizeTitleForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ListParams {
  userId: string;
  search?: string;
  genre?: string;
  status?: MangaStatus;
  sort: "title" | "createdAt" | "updatedAt" | "lastRead";
  order: "asc" | "desc";
  favorites: boolean;
  page: number;
  pageSize: number;
}

export async function getMangaSummaries(ids: string[], userId: string): Promise<MangaSummaryDto[]> {
  if (ids.length === 0) return [];
  const { data: mangas } = await supabase
    .from("mangas")
    .select("*, genres:manga_genres(genre:genres(name)), favorites:favorites(created_at), reading_progress:reading_progress(page_number, updated_at, chapter:chapters(id, chapter_number, page_count))")
    .in("id", ids);

  // chapter counts
  const { data: chapterAgg } = await supabase
    .from("chapters")
    .select("manga_id")
    .in("manga_id", ids);

  const chapterMap = new Map<string, { count: number; pages: number }>();
  // Need page counts per chapter
  const { data: chapters } = await supabase
    .from("chapters")
    .select("manga_id, page_count")
    .in("manga_id", ids);
  for (const c of chapters ?? []) {
    const agg = chapterMap.get(c.manga_id) ?? { count: 0, pages: 0 };
    agg.count++;
    agg.pages += c.page_count ?? 0;
    chapterMap.set(c.manga_id, agg);
  }

  const byId = new Map((mangas ?? []).map((m: any) => [m.id, m]));
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is any => Boolean(m))
    .map((m: any) => {
      const agg = chapterMap.get(m.id) ?? { count: 0, pages: 0 };
      const progress = (m.reading_progress ?? [])[0];
      return {
        id: m.id,
        title: m.title,
        author: m.author,
        status: m.status as MangaStatus,
        coverImageKey: m.cover_image_key,
        coverLqip: m.cover_lqip ?? null,
        coverColor: m.cover_color ?? null,
        genres: (m.genres ?? []).map((g: any) => g.genre?.name).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b)),
        chapterCount: agg.count,
        pageCount: agg.pages,
        isFavorite: (m.favorites ?? []).length > 0,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        lastReadAt: progress ? progress.updated_at : null,
        progress: progress
          ? {
              chapterId: progress.chapter?.id,
              chapterNumber: progress.chapter?.chapter_number,
              pageNumber: progress.page_number,
              pageCount: progress.chapter?.page_count,
              updatedAt: progress.updated_at,
            }
          : null,
      } satisfies MangaSummaryDto;
    });
}

export async function listMangas(params: ListParams): Promise<Paginated<MangaSummaryDto>> {
  // Helper to apply common filters to a query builder
  function applyFilters(q: any): any {
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.or(`title.ilike.%${params.search}%,alternative_titles.ilike.%${params.search}%,author.ilike.%${params.search}%`);
    return q;
  }

  // Favorites filter ids
  let favIds: string[] | null = null;
  if (params.favorites) {
    const { data: favs } = await supabase.from("favorites").select("manga_id").eq("user_id", params.userId);
    favIds = (favs ?? []).map((f: any) => f.manga_id);
    if (favIds.length === 0) {
      return { items: [], total: 0, page: params.page, pageSize: params.pageSize, totalPages: 1 };
    }
  }

  // Genre filter ids
  let genreIds: string[] | null = null;
  if (params.genre) {
    const { data: genre } = await supabase.from("genres").select("id").eq("name", params.genre).maybeSingle();
    if (genre) {
      const { data: mg } = await supabase.from("manga_genres").select("manga_id").eq("genre_id", genre.id);
      genreIds = (mg ?? []).map((m: any) => m.manga_id);
      if (genreIds.length === 0) {
        return { items: [], total: 0, page: params.page, pageSize: params.pageSize, totalPages: 1 };
      }
    }
  }

  let pageIds: string[];
  let total = 0;

  if (params.sort === "lastRead") {
    let q = supabase.from("mangas").select("id, title");
    q = applyFilters(q);
    if (favIds) q = q.in("id", favIds);
    if (genreIds) q = q.in("id", genreIds);
    const { data: allRows } = await q;
    const allIds = (allRows ?? []).map((m: any) => m.id);
    total = allIds.length;

    const { data: progressRows } = allIds.length > 0
      ? await supabase.from("reading_progress").select("manga_id, updated_at").eq("user_id", params.userId).in("manga_id", allIds)
      : { data: [] };

    const lastReadMap = new Map((progressRows ?? []).map((p: any) => [p.manga_id, new Date(p.updated_at).getTime()]));
    const dir = params.order === "asc" ? 1 : -1;
    const sorted = [...(allRows ?? [])].sort((a: any, b: any) => {
      const ta = lastReadMap.get(a.id);
      const tb = lastReadMap.get(b.id);
      if (ta === undefined && tb === undefined) return a.title.localeCompare(b.title);
      if (ta === undefined) return 1;
      if (tb === undefined) return -1;
      if (ta !== tb) return (ta - tb) * dir;
      return a.title.localeCompare(b.title);
    });
    pageIds = sorted.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map((m: any) => m.id);
  } else {
    const sortCol = params.sort === "title" ? "title" : params.sort === "updatedAt" ? "updated_at" : "created_at";
    let q = supabase.from("mangas").select("id").order(sortCol, { ascending: params.order === "asc" });
    q = applyFilters(q);
    if (favIds) q = q.in("id", favIds);
    if (genreIds) q = q.in("id", genreIds);
    q = q.range((params.page - 1) * params.pageSize, params.page * params.pageSize - 1);
    const { data: rows } = await q;
    pageIds = (rows ?? []).map((r: any) => r.id);

    // Count
    let countQ = supabase.from("mangas").select("*", { count: "exact", head: true });
    countQ = applyFilters(countQ);
    if (favIds) countQ = countQ.in("id", favIds);
    if (genreIds) countQ = countQ.in("id", genreIds);
    const { count } = await countQ;
    total = count ?? 0;
  }

  const items = await getMangaSummaries(pageIds ?? [], params.userId);
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

export async function getMangaDetail(mangaId: string, userId: string): Promise<MangaDetailDto | null> {
  const summaries = await getMangaSummaries([mangaId], userId);
  if (summaries.length === 0) return null;
  const hasSourceUrl = await mangaSupportsSourceUrl();
  const { data } = await supabase
    .from("mangas")
    .select(`alternative_titles, description, artist, publication_year${hasSourceUrl ? ", source_url" : ""}`)
    .eq("id", mangaId)
    .maybeSingle();
  // Select động (cột source_url tuy theo migration) -> mat inference, cast ro ràng
  const manga = data as {
    alternative_titles: string | null;
    description: string | null;
    artist: string | null;
    publication_year: number | null;
    source_url?: string | null;
  } | null;
  if (!manga) return null;
  const { data: storageAgg } = await supabase
    .from("storage_objects")
    .select("file_size")
    .eq("manga_id", mangaId)
    .eq("status", "CONFIRMED");
  const sizeBytes = (storageAgg ?? []).reduce((sum: number, r: any) => sum + Number(r.file_size ?? 0), 0);
  return {
    ...summaries[0],
    alternativeTitles: manga.alternative_titles,
    description: manga.description,
    artist: manga.artist,
    publicationYear: manga.publication_year,
    sourceUrl: manga.source_url ?? null,
    sizeBytes,
  };
}

export async function createManga(input: MangaCreateInput) {
  const genreMap = await ensureGenres(input.genres ?? []);
  const withSourceUrl = input.sourceUrl && (await mangaSupportsSourceUrl());
  const { data: manga, error } = await supabase
    .from("mangas")
    .insert({
      title: input.title,
      alternative_titles: input.alternativeTitles ?? null,
      description: input.description ?? null,
      author: input.author ?? null,
      artist: input.artist ?? null,
      status: input.status ?? "ONGOING",
      publication_year: input.publicationYear ?? null,
      ...(withSourceUrl ? { source_url: input.sourceUrl ?? null } : {}),
    })
    .select()
    .single();
  if (error) throw new ApiError(`Tạo truyện thất bại: ${error.message}`, 500);

  if (genreMap.size > 0) {
    const rows = Array.from(genreMap.values()).map((genreId) => ({ manga_id: manga.id, genre_id: genreId }));
    await supabase.from("manga_genres").insert(rows);
  }
  return manga;
}

export async function updateManga(mangaId: string, input: MangaUpdateInput) {
  const { data: existing } = await supabase.from("mangas").select("id").eq("id", mangaId).maybeSingle();
  if (!existing) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.alternativeTitles !== undefined) data.alternative_titles = input.alternativeTitles ?? null;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.author !== undefined) data.author = input.author ?? null;
  if (input.artist !== undefined) data.artist = input.artist ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.publicationYear !== undefined) data.publication_year = input.publicationYear ?? null;
  if (input.sourceUrl !== undefined && (await mangaSupportsSourceUrl())) {
    data.source_url = input.sourceUrl ?? null;
  }

  if (Object.keys(data).length > 0) {
    await supabase.from("mangas").update(data).eq("id", mangaId);
  }

  if (input.genres !== undefined) {
    const genreMap = await ensureGenres(input.genres ?? []);
    await supabase.from("manga_genres").delete().eq("manga_id", mangaId);
    if (genreMap.size > 0) {
      const rows = Array.from(genreMap.values()).map((genreId) => ({ manga_id: mangaId, genre_id: genreId }));
      await supabase.from("manga_genres").insert(rows);
    }
  }

  const { data: updated } = await supabase.from("mangas").select("*").eq("id", mangaId).single();
  return updated;
}

export async function deleteManga(mangaId: string) {
  const { data: manga } = await supabase
    .from("mangas")
    .select("id, cover_image_key, chapters(id)")
    .eq("id", mangaId)
    .maybeSingle();
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");

  const chapterIds = (manga.chapters ?? []).map((c: any) => c.id);
  const { data: pageObjects } = chapterIds.length > 0
    ? await supabase.from("pages").select("object_key").in("chapter_id", chapterIds)
    : { data: [] };
  const { data: storageRows } = await supabase.from("storage_objects").select("object_key").eq("manga_id", mangaId);

  const keys = new Set<string>([
    ...(pageObjects ?? []).map((p: any) => p.object_key),
    ...(storageRows ?? []).map((s: any) => s.object_key),
  ]);
  if (manga.cover_image_key) keys.add(manga.cover_image_key);
  const keyList = Array.from(keys);

  if (keyList.length > 0) {
    await supabase
      .from("storage_objects")
      .update({ status: "DELETE_PENDING" })
      .in("object_key", keyList)
      .in("status", ["PENDING", "CONFIRMED"]);
  }

  await supabase.from("mangas").delete().eq("id", mangaId);

  let removedCount = 0;
  let retryNeeded = 0;
  if (keyList.length > 0) {
    const result = await safeDeleteObjects(keyList);
    removedCount = await removeMetadataIfDeleted(result.removed);
    retryNeeded = result.pending.length;
    if (retryNeeded > 0) {
      console.warn(`[manga-service] ${retryNeeded} object xoa R2 that bai — giu DELETE_PENDING, cleanup se retry.`);
    }
  }

  return { deleted: true, objectsRemoved: removedCount, objectsPendingRetry: retryNeeded };
}

export async function toggleFavorite(userId: string, mangaId: string) {
  const { data: manga } = await supabase.from("mangas").select("id").eq("id", mangaId).maybeSingle();
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");
  await ensureProfile({ id: userId, email: "" });

  const { data: existing } = await supabase
    .from("favorites")
    .select("user_id")
    .eq("user_id", userId)
    .eq("manga_id", mangaId)
    .maybeSingle();

  if (existing) {
    await supabase.from("favorites").delete().eq("user_id", userId).eq("manga_id", mangaId);
    return { favorited: false };
  }
  await supabase.from("favorites").insert({ user_id: userId, manga_id: mangaId });
  return { favorited: true };
}

export async function setMangaCover(
  mangaId: string,
  newKey: string | null,
  lqip?: { lqip: string | null; color: string | null }
) {
  const { data: manga } = await supabase.from("mangas").select("cover_image_key").eq("id", mangaId).maybeSingle();
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");
  const oldKey = manga.cover_image_key;

  const update: Record<string, unknown> = { cover_image_key: newKey };
  if (lqip && (await mangaSupportsLqip())) {
    update.cover_lqip = lqip.lqip ?? null;
    update.cover_color = lqip.color ?? null;
  }
  await supabase.from("mangas").update(update).eq("id", mangaId);

  if (oldKey && oldKey !== newKey) {
    const { data: stillUsed } = await supabase.from("pages").select("id").eq("object_key", oldKey).limit(1).maybeSingle();
    if (!stillUsed) {
      await supabase
        .from("storage_objects")
        .update({ status: "DELETE_PENDING" })
        .eq("object_key", oldKey)
        .in("status", ["PENDING", "CONFIRMED"]);
      const result = await safeDeleteObjects([oldKey]);
      await removeMetadataIfDeleted(result.removed).catch(() => undefined);
    }
  }
  return { coverImageKey: newKey };
}

export async function getChapterOrder(mangaId: string): Promise<Array<{ id: string; chapterNumber: string }>> {
  const { data: chapters } = await supabase
    .from("chapters")
    .select("id, chapter_number")
    .eq("manga_id", mangaId);
  return (chapters ?? [])
    .map((c: any) => ({ id: c.id, chapterNumber: c.chapter_number }))
    .sort((a, b) => naturalCompare(a.chapterNumber, b.chapterNumber));
}

// -------------------------------------------------------------
// CHECK TRÙNG TRUYỆN (batch import / thêm thủ công)
// So khớp: tên chuẩn hóa (bỏ dấu, chỉ chữ+số) với title + từng tên
// khác, HOẶC URL nguồn trùng nhau. Chỉ chọn vài cột nhỏ nên nhẹ dù
// thư viện lớn (phân trang 1000 dòng/lần theo giới hạn PostgREST).
// -------------------------------------------------------------

const DUP_PAGE_SIZE = 1000;

export async function findMangaDuplicates(params: {
  title: string;
  sourceUrl?: string;
}): Promise<DuplicateMatchDto[]> {
  const hasSourceUrl = await mangaSupportsSourceUrl();
  const cols = `id, title, alternative_titles${hasSourceUrl ? ", source_url" : ""}`;

  const rows: any[] = [];
  for (let offset = 0; offset < 100_000; offset += DUP_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mangas")
      .select(cols)
      .range(offset, offset + DUP_PAGE_SIZE - 1);
    if (error) throw new ApiError(`Không lấy được thư viện để kiểm tra trùng: ${error.message}`, 500);
    rows.push(...(data ?? []));
    if (!data || data.length < DUP_PAGE_SIZE) break;
  }

  const normTitle = normalizeTitleForMatch(params.title);
  if (!normTitle) return [];
  const sourceUrl = params.sourceUrl?.trim() || null;

  const matches: DuplicateMatchDto[] = [];
  for (const m of rows) {
    let by: DuplicateMatchDto["by"] | null = null;

    if (sourceUrl && hasSourceUrl && m.source_url && String(m.source_url).trim() === sourceUrl) {
      by = "sourceUrl";
    } else if (normalizeTitleForMatch(m.title ?? "") === normTitle) {
      by = "title";
    } else {
      // Tách tên khác theo ; , / | — so khớp từng tên
      const alts = String(m.alternative_titles ?? "").split(/[;,/|]+/);
      if (alts.some((a) => normalizeTitleForMatch(a) === normTitle)) by = "altTitle";
    }

    if (by) {
      matches.push({
        id: m.id,
        title: m.title,
        alternativeTitles: m.alternative_titles ?? null,
        sourceUrl: m.source_url ?? null,
        by,
      });
    }
  }
  return matches;
}