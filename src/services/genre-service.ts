// =============================================================
// Genre service: danh sach the loai, upsert theo ten, seed mac dinh
// =============================================================

import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/postgrest-chunk";

// Danh muc the loai mac dinh (223 muc — dong bo voi seed trong
// supabase/migrations/0001_init.sql). Thu tu la thu tu danh muc goc;
// listGenres() sap xep lai theo name khi tra ve.
export const DEFAULT_GENRES = [
  "3D Hentai",
  "AI Generated",
  "Action",
  "Adult",
  "Adventure",
  "Ahegao",
  "Anal",
  "Angel",
  "Animal",
  "Animal Girl",
  "Apron",
  "Artist CG",
  "Aunt",
  "Áo dài",
  "Ảnh động",
  "BBM",
  "BBW",
  "BDSM",
  "Based Game",
  "Beach",
  "Bestiality",
  "Big Ass",
  "Big Boobs",
  "Big Penis",
  "Bikini",
  "Bisexual",
  "Black Skin",
  "Blackmail",
  "Blindfold",
  "Bloomers",
  "BlowJobs",
  "Body Swap",
  "Body Writing",
  "Bodysuit",
  "Bondage",
  "Breast Sucking",
  "BreastJobs",
  "Brocon",
  "Brother",
  "Bukkake",
  "Bunny Girl",
  "Business Suit",
  "Chastity belt",
  "Che nhiều",
  "Che ít",
  "Cheating",
  "Cheerleader",
  "Chikan",
  "Chinese Dress",
  "Collar",
  "Comedy",
  "Comic",
  "Condom",
  "Cosplay",
  "Cousin",
  "Creampie",
  "Cross-dressing",
  "Crotch Tattoo",
  "Cuckold",
  "Cum swap",
  "Cunnilingus",
  "Có che",
  "Dark Skin",
  "Daughter",
  "Deepthroat",
  "Demon",
  "DemonGirl",
  "Devil",
  "DevilGirl",
  "Dirty",
  "DirtyOldMan",
  "Double Penetration",
  "Doujinshi",
  "Drama",
  "Drug",
  "Drunk",
  "Ecchi",
  "Elder Sister",
  "Elf",
  "Exhibitionism",
  "Facesitting",
  "Fantasy",
  "Father",
  "Females only",
  "Femdom",
  "Feminization",
  "Filming",
  "Fingering",
  "Footjob",
  "Full Color",
  "Furry",
  "Futanari",
  "Gag",
  "Gangbang",
  "Garter Belts",
  "Gender Bender",
  "Ghost",
  "Glasses",
  "Glory hole",
  "Group",
  "Guro",
  "Gyaru",
  "Góc Nhìn Nữ",
  "Hairjob",
  "Hairy",
  "Handjob",
  "Harem",
  "Hell No",
  "Hentaivn",
  "Hidden sex",
  "Historical",
  "Horror",
  "Housewife",
  "Humiliation",
  "Idol",
  "Imouto",
  "Incest",
  "Insect",
  "Invisible",
  "Isekai",
  "Không che",
  "Kimono",
  "Kissing",
  "Kuudere",
  "Lactation",
  "Lingerie",
  "Lolicon",
  "Maids",
  "Males only",
  "Manhua",
  "Manhwa",
  "Masturbation",
  "Mature",
  "Mermaid",
  "Miko",
  "Milf",
  "Mind Break",
  "Mind Control",
  "Monster",
  "Monstergirl",
  "Mother",
  "NTR",
  "Nakadashi",
  "Netori",
  "Ngọt",
  "Nipple Play",
  "Non-hen",
  "Nun",
  "Nurse",
  "Office Lady",
  "Old Man",
  "Oneshot",
  "Oral",
  "Osananajimi",
  "Paizuri",
  "Pantyhose",
  "Pegging",
  "Piercing",
  "Police",
  "Ponytail",
  "Pregnant",
  "Princess",
  "Prostitution",
  "Rape",
  "Rimjob",
  "Romance",
  "Ryona",
  "Scat",
  "School uniform",
  "SchoolGirl",
  "See-through",
  "Series",
  "Sex Toys",
  "Shimapan",
  "Short",
  "Shota",
  "Shoujo",
  "Siscon",
  "Sister",
  "Sixty-Nine",
  "Slave",
  "Sleeping",
  "Small Boobs",
  "Soft Incest",
  "Son",
  "Spanking",
  "Sport",
  "Squirting",
  "Stockings",
  "Strap-on",
  "Succubus",
  "Supernatural",
  "Sweating",
  "Swimsuit",
  "Tail plug",
  "Tall Girl",
  "Teacher",
  "Tentacles",
  "Threesome",
  "Time Stop",
  "Tomboy",
  "Tracksuit",
  "Transformation",
  "Trap",
  "Truyện Việt",
  "Tsundere",
  "Tu Tiên",
  "Twins",
  "Twintails",
  "Underwater",
  "Vampire",
  "Vanilla",
  "Virgin",
  "Voyeurism",
  "Vtuber",
  "Watersports",
  "Webtoon",
  "Wormhole",
  "X-ray",
  "Yandere",
  "Yaoi",
  "Yuri",
  "Zombie",
];

export async function listGenres() {
  // Dem so manga theo the loai trong MOT truy van nho quan he FK nhung
  // (manga_genres(count)). Truoc day la N+1: moi the loai 1 round-trip —
  // voi 223 the loai thi moi GET /api/genres ton ~223 truy van.
  // Phan trang phong ve (PostgREST cat 1000 row moi response).
  const rows = await fetchAllRows<any>(
    (from, to) =>
      supabase
        .from("genres")
        .select("id, name, manga_genres(count)")
        .order("name", { ascending: true })
        .range(from, to),
    "đọc genres"
  );

  return rows.map((g: any) => ({
    id: g.id as string,
    name: g.name as string,
    mangaCount: Number(g.manga_genres?.[0]?.count ?? 0),
  }));
}

/** Seed 223 the loai mac dinh CHI khi bang genres rong (lan dau chay).
 * Cu: GET /api/genres goi seedDefaultGenres() MOI lan — upsert 223 row
 * cho moi request + khong the xoa genre vi seed lai ngay. */
export async function seedDefaultGenresIfEmpty() {
  const { count, error } = await supabase.from("genres").select("*", { count: "exact", head: true });
  if (error) throw new Error(`seedDefaultGenresIfEmpty failed: ${error.message}`);
  if ((count ?? 0) === 0) {
    await seedDefaultGenres();
    return true; // da seed lan dau
  }
  return false; // da co du lieu — khong re-seed
}

/** Xoa the loai — CHI cho phep khi khong manga nao dung. Tra ve inUse
 * de route tra 409 kem so manga (canh bao ro rang cho UI). */
export async function deleteGenreIfUnused(genreId: string): Promise<{ deleted: boolean; inUse: number }> {
  const { data: genre, error: gErr } = await supabase
    .from("genres")
    .select("id, name")
    .eq("id", genreId)
    .maybeSingle();
  if (gErr) throw new Error(`deleteGenre failed: ${gErr.message}`);
  if (!genre) return { deleted: false, inUse: 0 };

  const { count, error: cErr } = await supabase
    .from("manga_genres")
    .select("*", { count: "exact", head: true })
    .eq("genre_id", genreId);
  if (cErr) throw new Error(`deleteGenre count failed: ${cErr.message}`);
  const inUse = count ?? 0;
  if (inUse > 0) return { deleted: false, inUse };

  const { error: dErr } = await supabase.from("genres").delete().eq("id", genreId);
  if (dErr) throw new Error(`deleteGenre failed: ${dErr.message}`);
  return { deleted: true, inUse: 0 };
}

export async function seedDefaultGenres() {
  // Upsert loat trong MOT truy van: the loai da ton tai duoc bo qua
  // (on_conflict=name + resolution=ignore-duplicates — name la unique).
  // Truoc day: 1 select + tung ten 1 insert rieng.
  const { error } = await supabase
    .from("genres")
    .upsert(DEFAULT_GENRES.map((name) => ({ name })), {
      onConflict: "name",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`seedDefaultGenres failed: ${error.message}`);
}

export async function ensureGenres(names: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))
  );
  if (wanted.length === 0) return result;

  // FIX case-insensitive DAY DU: lay TAT CA ten genre (phan trang) va khop
  // theo lower-case. Cu chi truy van .in("name", [name, name.toLowerCase()])
  // nen "ACTION" khong khop "Action" trong DB -> insert "ACTION" nhu genre
  // moi (unique case-sensitive) -> tao the loai TRUNG TEN chi khac hoa/thuong.
  const allRows = await fetchAllRows<{ id: string; name: string }>(
    (from, to) =>
      supabase
        .from("genres")
        .select("id, name")
        .order("name", { ascending: true })
        .range(from, to),
    "đọc genres để khớp tên"
  );
  const byLower = new Map(allRows.map((g) => [g.name.toLowerCase(), g]));

  for (const name of wanted) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      result.set(name, found.id);
      continue;
    }
    // Chua co — insert (race thi doc lai bang ilike)
    const { data: created, error } = await supabase
      .from("genres")
      .insert({ name })
      .select("id, name")
      .single();
    if (error) {
      // Race: another request created it (ke ca khac hoa/thuong) -> read again
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
  return result;
}