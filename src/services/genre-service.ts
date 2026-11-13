// =============================================================
// Genre service: danh sach the loai, upsert theo ten, seed mac dinh
// =============================================================

import { supabase } from "@/lib/supabase";

export const DEFAULT_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery",
  "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural",
  "Psychological", "Seinen", "Shounen", "Josei", "Shoujo", "Isekai",
  "Martial Arts", "Mecha", "Historical", "School Life", "Tragedy", "Thriller",
];

export async function listGenres() {
  const { data: genres, error } = await supabase
    .from("genres")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(`listGenres failed: ${error.message}`);

  // Count mangas per genre
  const result: Array<{ id: string; name: string; mangaCount: number }> = [];
  for (const g of genres ?? []) {
    const { count } = await supabase
      .from("manga_genres")
      .select("*", { count: "exact", head: true })
      .eq("genre_id", g.id);
    result.push({ id: g.id, name: g.name, mangaCount: count ?? 0 });
  }
  return result;
}

export async function seedDefaultGenres() {
  const { data: existing } = await supabase.from("genres").select("name");
  const existingNames = new Set((existing ?? []).map((g: any) => g.name.toLowerCase()));
  for (const name of DEFAULT_GENRES) {
    if (!existingNames.has(name.toLowerCase())) {
      await supabase.from("genres").insert({ name }).then(() => undefined, () => undefined);
    }
  }
}

export async function ensureGenres(names: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))
  );
  if (wanted.length === 0) return result;

  const lowered = wanted.map((n) => n.toLowerCase());
  const { data: existing } = await supabase
    .from("genres")
    .select("id, name")
    .in("name", [...wanted, ...lowered]);

  const byLower = new Map((existing ?? []).map((g: any) => [g.name.toLowerCase(), g]));

  for (const name of wanted) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      result.set(name, found.id);
    } else {
      const { data: created, error } = await supabase
        .from("genres")
        .insert({ name })
        .select("id, name")
        .single();
      if (error) {
        // Race: another request created it -> read again
        const { data: retry } = await supabase
          .from("genres")
          .select("id, name")
          .ilike("name", name)
          .maybeSingle();
        if (retry) {
          byLower.set(name.toLowerCase(), retry);
          result.set(name, retry.id);
        }
      } else if (created) {
        byLower.set(name.toLowerCase(), created);
        result.set(name, created.id);
      }
    }
  }
  return result;
}