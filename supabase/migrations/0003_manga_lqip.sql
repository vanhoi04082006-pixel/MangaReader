-- =============================================================
-- MangaReader — Migration 0003: LQIP placeholder cho ảnh
--
-- Thêm cột placeholder mờ (base64 JPEG ~16px, ~0.3-0.5KB) để ảnh
-- hiển thị GẦN NHƯ NGAY LẬP TỨC khi mở trang/photofeed:
--   - mangas.cover_lqip / cover_color : placeholder bìa + màu chủ đạo
--   - pages.lqip                      : placeholder từng trang trong reader
--
-- LQIP được sinh CLIENT-SIDE (canvas) trong lúc upload — server
-- không phải tải lại ảnh từ R2. Dữ liệu cũ (NULL) → UI fallback
-- shimmer như cũ; chạy scripts/backfill-lqip.ts để sinh cho dữ liệu có sẵn.
--
-- Cách dùng:
--   1. Mở Supabase Dashboard > SQL Editor
--   2. Dán toàn bộ nội dung file này vào và Run
--
-- An toàn khi chạy lại (idempotent). Cot la NULL-able — khong anh
-- huong du lieu hien co. Code phia app TU KIEM TRA cot ton tai
-- (mangaSupportsLqip / pagesSupportLqip) nen deploy truoc/sau
-- migration deu OK.
-- =============================================================

alter table mangas
  add column if not exists cover_lqip text,
  add column if not exists cover_color text;

alter table pages
  add column if not exists lqip text;

-- Ghi chu: Prisma schemas (schema.prisma + schema.postgres.prisma)
-- da duoc cap nhat coverLqip/coverColor/lqip tuong ung.
