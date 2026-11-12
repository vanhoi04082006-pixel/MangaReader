-- =============================================================
-- MangaReader — Personal Manga Reader
-- Supabase PostgreSQL migration (production path) — BẢN CHỈNH SỬA
--
-- Cach dung:
--   1. Mo Supabase Dashboard > SQL Editor
--   2. Dan toan bo noi dung file nay vao va Run
--   3. Cap nhat DATABASE_URL trong .env (xem README)
--
-- GHI CHÚ BẢO MẬT (đã chỉnh sửa so với bản đầu):
-- Bản đầu dùng policy "authenticated full access" USING (true) —
-- BẤT KỲ user Supabase nào đã xác thực cũng đọc/ghi được toàn bộ dữ
-- liệu qua PostgREST. Bản này giới hạn mọi bảng về DUY NHẤT admin
-- (xác định qua app_config.admin_user_id = auth.uid()).
--
-- Đã kiểm chứng ngày 2026-11-12: production DB CHƯA áp dụng bản gốc
-- (không có bảng nào tồn tại) nên việc chỉnh sửa tại chỗ là an toàn,
-- không ảnh hưởng dữ liệu.
--
-- Chu y ve RLS: Ung dung truy cap DB truc tiep qua Prisma
-- (role postgres — table owner, KHÔNG bị RLS ràng buộc). RLS là
-- lop phong thu thu hai (defense-in-depth) cho phuong thuc truy cap
-- PostgREST (anon/publishable key). Ranh gioi phan quyen THẬT sự
-- của ứng dụng nằm ở tầng API (requireAdmin — xem src/lib/api.ts).
-- =============================================================

-- extensions
create extension if not exists "uuid-ossp";

-- ============ APP_CONFIG (danh tinh admin) ============
-- Luu UUID cua admin duy nhat. Khong co policy nao cho anon/
-- authenticated tren bang nay -> tu choi moi truy cap qua PostgREST
-- (chi postgres owner / service_role truy cap duoc).
create table if not exists app_config (
  key       text primary key,
  value     text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;

-- UUID admin hien tai (admin@manga.vn) — kiểm chứng tại
-- Supabase Dashboard > Authentication > Users trước khi chạy.
insert into app_config (key, value) values
  ('admin_user_id', '7228d6e8-3f7b-4443-bdb6-1543b7afb4d6')
on conflict (key) do nothing;

-- Ham kiem tra admin: so khao auth.uid() voi app_config.admin_user_id
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from app_config
    where key = 'admin_user_id'
      and value = (auth.uid())::text
  )
$$;

-- ============ PROFILES (map auth.users) ============
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============ GENRES ============
create table if not exists genres (
  id   uuid primary key default uuid_generate_v4(),
  name text unique not null
);

-- ============ MANGAS ============
create table if not exists mangas (
  id                uuid primary key default uuid_generate_v4(),
  title             text not null,
  alternative_titles text,
  description       text,
  author            text,
  artist            text,
  status            text not null default 'ONGOING'
                    check (status in ('ONGOING','COMPLETED','HIATUS','DROPPED')),
  publication_year  int check (publication_year between 1900 and 2100),
  cover_image_key   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_mangas_title on mangas (title);
create index if not exists idx_mangas_status on mangas (status);
create index if not exists idx_mangas_created_at on mangas (created_at desc);
create index if not exists idx_mangas_updated_at on mangas (updated_at desc);

-- ============ CHAPTERS ============
create table if not exists chapters (
  id            uuid primary key default uuid_generate_v4(),
  manga_id      uuid not null references mangas(id) on delete cascade,
  chapter_number text not null, -- text de ho tro "5.5", "extra"
  title         text,
  volume        text,
  page_count    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (manga_id, chapter_number)
);
create index if not exists idx_chapters_manga on chapters (manga_id);

-- ============ PAGES ============
create table if not exists pages (
  id          uuid primary key default uuid_generate_v4(),
  chapter_id  uuid not null references chapters(id) on delete cascade,
  page_number int not null check (page_number > 0),
  object_key  text unique not null, -- object key tren Cloudflare R2
  file_name   text not null,
  mime_type   text not null,
  file_size   bigint not null,      -- bytes
  width       int,
  height      int,
  created_at  timestamptz not null default now(),
  unique (chapter_id, page_number)
);
create index if not exists idx_pages_chapter on pages (chapter_id);
create index if not exists idx_pages_object_key on pages (object_key);

-- ============ MANGA_GENRES ============
create table if not exists manga_genres (
  manga_id uuid not null references mangas(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (manga_id, genre_id)
);
create index if not exists idx_manga_genres_genre on manga_genres (genre_id);

-- ============ FAVORITES ============
create table if not exists favorites (
  user_id    uuid not null references profiles(id) on delete cascade,
  manga_id   uuid not null references mangas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, manga_id)
);

-- ============ READING_PROGRESS ============
-- 1 row / user / manga
create table if not exists reading_progress (
  user_id         uuid not null references profiles(id) on delete cascade,
  manga_id        uuid not null references mangas(id) on delete cascade,
  chapter_id      uuid not null references chapters(id) on delete cascade,
  page_number     int not null default 1,
  scroll_position double precision not null default 0 check (scroll_position between 0 and 1),
  updated_at      timestamptz not null default now(),
  primary key (user_id, manga_id)
);
create index if not exists idx_progress_updated on reading_progress (updated_at desc);

-- ============ READING_HISTORY ============
-- 1 row / user / chapter (upsert read_at)
create table if not exists reading_history (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  manga_id    uuid not null references mangas(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,
  page_number int not null default 1,
  read_at     timestamptz not null default now(),
  unique (user_id, chapter_id)
);
create index if not exists idx_history_user_read on reading_history (user_id, read_at desc);

-- ============ STORAGE_OBJECTS ============
-- metadata moi file tren R2 (track upload + orphan cleanup)
-- status: PENDING (cho upload) | CONFIRMED (da finalize) | DELETE_PENDING (cho xoa R2, retry duoc)
create table if not exists storage_objects (
  id           uuid primary key default uuid_generate_v4(),
  object_key   text unique not null,
  kind         text not null check (kind in ('PAGE','COVER')),
  status       text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','DELETE_PENDING')),
  file_name    text,
  file_size    bigint not null default 0,
  mime_type    text,
  manga_id     uuid references mangas(id) on delete set null,
  chapter_id   uuid references chapters(id) on delete set null,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists idx_storage_status_created on storage_objects (status, created_at);
create index if not exists idx_storage_manga on storage_objects (manga_id);
create index if not exists idx_storage_chapter on storage_objects (chapter_id);

-- ============ RATE_LIMIT_HITS ============
-- DB-backed rate limiter (fixed window). Khong co policy -> anon/
-- authenticated bi tu choi qua PostgREST; chi app (Prisma) ghi.
create table if not exists rate_limit_hits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);
create index if not exists idx_rate_limit_window on rate_limit_hits (window_start);

-- =============================================================
-- ROW LEVEL SECURITY
-- Moi bang du lieu: CHI admin (theo app_config.admin_user_id)
-- duoc truy cap qua PostgREST. profiles: user chi doc/tao dong
-- cua chinh minh (phong thu), admin toan quyen.
-- =============================================================

alter table profiles         enable row level security;
alter table genres           enable row level security;
alter table mangas           enable row level security;
alter table chapters         enable row level security;
alter table pages            enable row level security;
alter table manga_genres     enable row level security;
alter table favorites        enable row level security;
alter table reading_progress enable row level security;
alter table reading_history  enable row level security;
alter table storage_objects  enable row level security;
alter table rate_limit_hits  enable row level security;

-- profiles: moi user chi thay chinh minh (phong thu); admin toan quyen
drop policy if exists "profiles self access" on profiles;
create policy "profiles self select"
  on profiles for select
  to authenticated
  using (auth.uid() = id);
create policy "profiles self insert"
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);
create policy "profiles admin all"
  on profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- cac bang du lieu: admin-only (thay the "authenticated full access" USING(true) cu)
do $$
declare t text;
begin
  foreach t in array array[
    'genres','mangas','chapters','pages','manga_genres',
    'favorites','reading_progress','reading_history','storage_objects'
  ] loop
    -- xoa policy cu (ban dau) neu ton tai
    execute format('drop policy if exists "authenticated full access" on %I', t);
    -- chinh sach admin-only cho moi hanh dong
    execute format('drop policy if exists "%s admin all" on %I', t, t);
    execute format(
      'create policy "%s admin all" on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t, t
    );
  end loop;
end $$;

-- =============================================================
-- SEED the loai mac dinh
-- =============================================================
insert into genres (name) values
  ('Action'),('Adventure'),('Comedy'),('Drama'),('Fantasy'),('Horror'),('Mystery'),
  ('Romance'),('Sci-Fi'),('Slice of Life'),('Sports'),('Supernatural'),
  ('Psychological'),('Seinen'),('Shounen'),('Josei'),('Shoujo'),('Isekai'),
  ('Martial Arts'),('Mecha'),('Historical'),('School Life'),('Tragedy'),('Thriller')
on conflict (name) do nothing;
