// =============================================================
// Genre service: danh sach the loai, upsert theo ten, seed mac dinh
// =============================================================

import { supabase } from "@/lib/supabase";

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
  const { data, error } = await supabase
    .from("genres")
    .select("id, name, manga_genres(count)")
    .order("name", { ascending: true });
  if (error) throw new Error(`listGenres failed: ${error.message}`);

  return (data ?? []).map((g: any) => ({
    id: g.id as string,
    name: g.name as string,
    mangaCount: Number(g.manga_genres?.[0]?.count ?? 0),
  }));
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