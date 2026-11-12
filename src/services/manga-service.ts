// =============================================================
// Manga service: CRUD, tim kiem/loc/sap xep/phan trang,
// yeu thich, bia, xoa cascade (DB + R2 dong bo)
// =============================================================

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { deleteObjects } from "@/lib/r2";
import { ensureGenres } from "@/services/genre-service";
import { ensureProfile } from "@/services/profile-service";
import type { MangaCreateInput, MangaUpdateInput, MangaStatus } from "@/schemas";
import type { MangaSummaryDto, MangaDetailDto, Paginated } from "@/types";
import { naturalCompare } from "@/utils/natural-sort";

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

/** Assemble thong tin summary cho tap id cho truoc (counts + progress + favorite) */
export async function getMangaSummaries(ids: string[], userId: string): Promise<MangaSummaryDto[]> {
  if (ids.length === 0) return [];
  const [mangas, chapterAgg] = await Promise.all([
    db.manga.findMany({
      where: { id: { in: ids } },
      include: {
        genres: { include: { genre: true } },
        favorites: { where: { userId }, select: { createdAt: true } },
        readingProgress: {
          where: { userId },
          take: 1,
          include: { chapter: { select: { id: true, chapterNumber: true, pageCount: true } } },
        },
      },
    }),
    db.chapter.groupBy({
      by: ["mangaId"],
      where: { mangaId: { in: ids } },
      _count: { _all: true },
      _sum: { pageCount: true },
    }),
  ]);

  const chapterMap = new Map(chapterAgg.map((c) => [c.mangaId, c]));

  // giu thu tu theo ids dau vao
  const byId = new Map(mangas.map((m) => [m.id, m]));
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => {
      const agg = chapterMap.get(m.id);
      const progress = m.readingProgress[0];
      return {
        id: m.id,
        title: m.title,
        author: m.author,
        status: m.status as MangaStatus,
        coverImageKey: m.coverImageKey,
        genres: m.genres.map((g) => g.genre.name).sort((a, b) => a.localeCompare(b)),
        chapterCount: agg?._count._all ?? 0,
        pageCount: agg?._sum.pageCount ?? 0,
        isFavorite: m.favorites.length > 0,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        lastReadAt: progress ? progress.updatedAt.toISOString() : null,
        progress: progress
          ? {
              chapterId: progress.chapter.id,
              chapterNumber: progress.chapter.chapterNumber,
              pageNumber: progress.pageNumber,
              pageCount: progress.chapter.pageCount,
              updatedAt: progress.updatedAt.toISOString(),
            }
          : null,
      } satisfies MangaSummaryDto;
    });
}

export async function listMangas(params: ListParams): Promise<Paginated<MangaSummaryDto>> {
  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.favorites ? { favorites: { some: { userId: params.userId } } } : {}),
    ...(params.genre ? { genres: { some: { genre: { name: params.genre } } } } : {}),
    ...(params.search
      ? {
          OR: [
            // SQLite LIKE da case-insensitive cho ASCII
            { title: { contains: params.search } },
            { alternativeTitles: { contains: params.search } },
            { author: { contains: params.search } },
          ],
        }
      : {}),
  };

  const total = await db.manga.count({ where });

  let pageIds: string[];

  if (params.sort === "lastRead") {
    // Sap xep theo lan doc gan nhat: lay ids + progress map, sort trong JS
    // (phu hop quy mo thu vien ca nhan; never-read luon xep cuoi)
    const [allMangas, progressRows] = await Promise.all([
      db.manga.findMany({ where, select: { id: true, title: true } }),
      db.readingProgress.findMany({
        where: { userId, mangaId: { in: (await db.manga.findMany({ where, select: { id: true } })).map((m) => m.id) } },
        select: { mangaId: true, updatedAt: true },
      }),
    ]);
    const lastReadMap = new Map(progressRows.map((p) => [p.mangaId, p.updatedAt.getTime()]));
    const dir = params.order === "asc" ? 1 : -1;
    allMangas.sort((a, b) => {
      const ta = lastReadMap.get(a.id);
      const tb = lastReadMap.get(b.id);
      if (ta === undefined && tb === undefined) return a.title.localeCompare(b.title);
      if (ta === undefined) return 1; // chua doc -> cuoi
      if (tb === undefined) return -1;
      if (ta !== tb) return (ta - tb) * dir;
      return a.title.localeCompare(b.title);
    });
    pageIds = allMangas
      .slice((params.page - 1) * params.pageSize, params.page * params.pageSize)
      .map((m) => m.id);
  } else {
    const orderBy =
      params.sort === "title"
        ? { title: params.order }
        : params.sort === "updatedAt"
          ? { updatedAt: params.order }
          : { createdAt: params.order };
    const rows = await db.manga.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: { id: true },
    });
    pageIds = rows.map((r) => r.id);
  }

  const items = await getMangaSummaries(pageIds, params.userId);
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
  const manga = await db.manga.findUnique({
    where: { id: mangaId },
    select: {
      alternativeTitles: true,
      description: true,
      artist: true,
      publicationYear: true,
    },
  });
  if (!manga) return null;
  const sizeAgg = await db.storageObject.aggregate({
    where: { mangaId, status: "CONFIRMED" },
    _sum: { fileSize: true },
  });
  return {
    ...summaries[0],
    alternativeTitles: manga.alternativeTitles,
    description: manga.description,
    artist: manga.artist,
    publicationYear: manga.publicationYear,
    sizeBytes: sizeAgg._sum.fileSize ?? 0,
  };
}

export async function createManga(input: MangaCreateInput) {
  const genreMap = await ensureGenres(input.genres ?? []);
  const manga = await db.manga.create({
    data: {
      title: input.title,
      alternativeTitles: input.alternativeTitles ?? null,
      description: input.description ?? null,
      author: input.author ?? null,
      artist: input.artist ?? null,
      status: input.status ?? "ONGOING",
      publicationYear: input.publicationYear ?? null,
      genres: {
        create: Array.from(genreMap.values()).map((genreId) => ({ genreId })),
      },
    },
  });
  return manga;
}

export async function updateManga(mangaId: string, input: MangaUpdateInput) {
  const existing = await db.manga.findUnique({ where: { id: mangaId } });
  if (!existing) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.alternativeTitles !== undefined) data.alternativeTitles = input.alternativeTitles ?? null;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.author !== undefined) data.author = input.author ?? null;
  if (input.artist !== undefined) data.artist = input.artist ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.publicationYear !== undefined) data.publicationYear = input.publicationYear ?? null;

  if (input.genres !== undefined) {
    const genreMap = await ensureGenres(input.genres ?? []);
    data.genres = {
      deleteMany: {},
      create: Array.from(genreMap.values()).map((genreId) => ({ genreId })),
    };
  }

  return db.manga.update({ where: { id: mangaId }, data });
}

/** Xoa truyen + toan bo chuong/trang + object tren R2 (dong bo) */
export async function deleteManga(mangaId: string) {
  const manga = await db.manga.findUnique({
    where: { id: mangaId },
    include: { chapters: { select: { id: true } } },
  });
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");

  // thu thap tat ca object keys lien quan truoc khi cascade
  const chapterIds = manga.chapters.map((c) => c.id);
  const pageObjects = await db.page.findMany({
    where: { chapterId: { in: chapterIds } },
    select: { objectKey: true },
  });
  const storageRows = await db.storageObject.findMany({
    where: { mangaId },
    select: { objectKey: true },
  });
  const keys = new Set<string>([
    ...pageObjects.map((p) => p.objectKey),
    ...storageRows.map((s) => s.objectKey),
  ]);
  if (manga.coverImageKey) keys.add(manga.coverImageKey);

  // 1) Xoa DB truoc (cascade chapters/pages/progress/history/favorites/genres)
  await db.manga.delete({ where: { id: mangaId } });

  // 2) Xoa object tren R2 (best-effort; neu loi se con lai orphan -> audit phat hien)
  const keyList = Array.from(keys);
  try {
    await deleteObjects(keyList);
  } catch (err) {
    console.error("[manga-service] R2 delete failed, objects remain as orphans:", err);
  }

  // 3) Xoa metadata StorageObject
  await db.storageObject.deleteMany({ where: { objectKey: { in: keyList } } }).catch(() => undefined);

  return { deleted: true, objectsRemoved: keyList.length };
}

export async function toggleFavorite(userId: string, mangaId: string) {
  const manga = await db.manga.findUnique({ where: { id: mangaId }, select: { id: true } });
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");
  await ensureProfile({ id: userId, email: "" });

  const existing = await db.favorite.findUnique({
    where: { userId_mangaId: { userId, mangaId } },
  });
  if (existing) {
    await db.favorite.delete({ where: { userId_mangaId: { userId, mangaId } } });
    return { favorited: false };
  }
  await db.favorite.create({ data: { userId, mangaId } });
  return { favorited: true };
}

/** Cap nhat coverImageKey + doi che do bia cu sang object moi */
export async function setMangaCover(mangaId: string, newKey: string | null) {
  const manga = await db.manga.findUnique({ where: { id: mangaId }, select: { coverImageKey: true } });
  if (!manga) throw new ApiError("Không tìm thấy truyện.", 404, "not_found");
  const oldKey = manga.coverImageKey;

  await db.manga.update({ where: { id: mangaId }, data: { coverImageKey: newKey } });

  if (oldKey && oldKey !== newKey) {
    // kiem tra key cu con duoc tham chieu boi trang nao khong
    const stillUsed = await db.page.findFirst({ where: { objectKey: oldKey }, select: { id: true } });
    if (!stillUsed) {
      try {
        await deleteObjects([oldKey]);
        await db.storageObject.deleteMany({ where: { objectKey: oldKey } }).catch(() => undefined);
      } catch (err) {
        console.error("[manga-service] old cover cleanup failed:", err);
      }
    }
  }
  return { coverImageKey: newKey };
}

/** Lay danh sach chuong cua 1 truyen theo thu tu tu nhien (dung cho reader + sap xep) */
export async function getChapterOrder(mangaId: string): Promise<Array<{ id: string; chapterNumber: string }>> {
  const chapters = await db.chapter.findMany({
    where: { mangaId },
    select: { id: true, chapterNumber: true },
  });
  return chapters.sort((a, b) => naturalCompare(a.chapterNumber, b.chapterNumber));
}
