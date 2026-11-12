// =============================================================
// Genre service: danh sach the loai, upsert theo ten, seed mac dinh
// =============================================================

import { db } from "@/lib/db";

export const DEFAULT_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery",
  "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural",
  "Psychological", "Seinen", "Shounen", "Josei", "Shoujo", "Isekai",
  "Martial Arts", "Mecha", "Historical", "School Life", "Tragedy", "Thriller",
];

export async function listGenres() {
  const genres = await db.genre.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { mangas: true } } },
  });
  return genres.map((g) => ({ id: g.id, name: g.name, mangaCount: g._count.mangas }));
}

/** Seed cac the loai mac dinh (idempotent) */
export async function seedDefaultGenres() {
  const existing = await db.genre.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((g) => g.name.toLowerCase()));
  for (const name of DEFAULT_GENRES) {
    if (!existingNames.has(name.toLowerCase())) {
      await db.genre.create({ data: { name } }).catch(() => undefined);
    }
  }
}

/**
 * Dam bao cac the loai theo ten ton tai (case-insensitive).
 * Tra ve map ten (da chuan hoa) -> genreId.
 */
export async function ensureGenres(names: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))
  );
  if (wanted.length === 0) return result;

  const lowered = wanted.map((n) => n.toLowerCase());
  const existing = await db.genre.findMany({
    where: { name: { in: [...wanted, ...lowered] } },
  });
  const byLower = new Map(existing.map((g) => [g.name.toLowerCase(), g]));

  for (const name of wanted) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      result.set(name, found.id);
    } else {
      const created = await db.genre.create({ data: { name } });
      byLower.set(name.toLowerCase(), created);
      result.set(name, created.id);
    }
  }
  return result;
}
