-- =============================================================
-- MangaReader — Migration 0002: mangas.source_url
--
-- Them cot "Nguồn" (từ info.txt khi import) để:
--   - Nhận diện truyện trùng khi import (check-duplicate theo URL nguồn)
--   - Hiển thị nguồn truyện ở trang chi tiết
--
-- Cách dùng:
--   1. Mở Supabase Dashboard > SQL Editor
--   2. Dán toàn bộ nội dung file này vào và Run
--
-- An toàn khi chạy lại (idempotent). Cot la NULL-able — khong anh
-- huong du lieu hien co. Code phia app TU KIEM TRA cot ton tai
-- (mangaSupportsSourceUrl) nen deploy truoc/sau migration deu OK.
-- =============================================================

alter table mangas
  add column if not exists source_url text;

-- Ghi chu: Prisma schema (schema.postgres.prisma) da duoc cap nhat
-- sourceUrl String? @map("source_url") tuong ung.
