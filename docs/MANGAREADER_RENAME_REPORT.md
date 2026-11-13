# MangaReader — Rename Report

Ngày: 2026-11-12 · Branch: `audit/mangareader-production-hardening` (từ main `18bd3ee`)

## 1. GitHub Repository Rename

| Mục | Kết quả |
|---|---|
| Repository cũ | `vanhoi04082006-pixel/MangeReader` |
| Repository mới | `vanhoi04082006-pixel/MangaReader` ✅ |
| Thao tác | GitHub API `PATCH /repos/.../MangeReader` với `{"name":"MangaReader"}` (token có quyền admin) |
| Tên đích khả dụng? | Có (404 trước khi đổi — đã kiểm tra) |
| Giữ nguyên | Private ✅ · Git history ✅ · Commits ✅ · Default branch `main` ✅ |
| KHÔNG tạo repo riêng / xóa / sao chép | Đúng — dùng tính năng rename của GitHub |
| Redirect tên cũ | API: `301` ✅ · Git operations qua URL cũ hoạt động ✅ (đã `git ls-remote` kiểm chứng) |
| Remote local | Đã cập nhật `origin` → `https://github.com/vanhoi04082006-pixel/MangaReader.git`, `git fetch` OK ✅ |

Ghi chú: URL web `https://github.com/.../MangeReader` trả 404 cho khách **không đăng nhập** — đúng dự kiến vì repo là **private** (GitHub chỉ redirect repo private cho người có quyền). Redirect hoạt động đầy đủ khi đăng nhập/qua git với token.

## 2. Bảng đổi định danh (Old → New)

### 2.1 Đã đổi (user-facing + metadata dự án)

| Cũ | Mới | Vị trí | Lý do | Cần compatibility? |
|---|---|---|---|---|
| `TSUNDOKU` (sidebar, login, settings) | `MangaReader` | `src/components/layout/app-shell.tsx`, `src/features/auth/login-view.tsx`, `src/features/settings/settings-view.tsx` | Tên sản phẩm hiển thị | Không |
| `Tsundoku — Thư viện truyện cá nhân` | `MangaReader — ...` | `src/app/layout.tsx` (title/template metadata) | SEO/tab title | Không |
| `alt="Logo Tsundoku"` / `alt="Tsundoku"` | `alt="Logo MangaReader"` / `alt="MangaReader"` | `app-shell.tsx`, `login-view.tsx`, `manga-app.tsx` | Alt text | Không |
| `TSUNDOKU` (header Prisma schema) | `MangaReader` | `prisma/schema.prisma`, `prisma/schema.postgres.prisma`, `supabase/migrations/0001_init.sql` | Comment tài liệu | Không |
| `# TSUNDOKU` header | `# MangaReader` | `.env.example` | Tài liệu | Không |
| `TSUNDOKU R2 Setup` / `tsundoku-r2-roundtrip` | `MangaReader R2 Setup` / `mangareader-r2-roundtrip` | `scripts/setup-r2.ts` | Log/test marker nội bộ | Không |
| `TSUNDOKU E2E TEST` | `MANGAREADER E2E TEST` | `scripts/make-test-manga.ts` (SVG test data) | Nội dung test | Không |
| `DESIGN TOKENS — Tsundoku` | `DESIGN TOKENS — MangaReader` | `src/app/globals.css` (comment) | Comment | Không |
| `nextjs_tailwind_shadcn_ts` | `mangareader` (v0.3.0) | `package.json` | Tên package chuẩn hóa lowercase | Không (bun install không phụ thuộc) |
| `tsundoku:unauthorized` | `mangareader:unauthorized` | `src/lib/client/api.ts` + `src/components/providers.tsx` (đổi đồng thời 2 phía) | Custom event nội bộ, không persistent | Không |
| `TSUNDOKU` tiêu đề README | `MangaReader` | `README.md` (viết lại toàn bộ) | Tài liệu chính | Không |

### 2.2 GIỮ NGUYÊN (định danh persistent/kỹ thuật — đổi sẽ hỏng dữ liệu/phiên)

| Định danh | Vị trí | Lý do giữ | Ảnh hưởng nếu đổi |
|---|---|---|---|
| Cookie `tsundoku_at`, `tsundoku_rt`, `tsundoku_session` | `src/lib/session.ts` | Session cookie của người dùng đã đăng nhập | Mất phiên (phải login lại); không có lợi ích chức năng |
| localStorage key `tsundoku-reader-settings` | `src/store/reader-store.ts` | Cài đặt reader đang lưu phía client | Mất toàn bộ cài đặt đọc của người dùng |
| R2 bucket `manga-storage` | `.env` / R2 | Tên bucket thật đang chứa object | Mất tham chiếu 100GB object |
| R2 prefix `mangas/` | `src/lib/r2.ts` (object key layout) | Cấu trúc key của mọi object hiện tại | Không đọc/ghi được object cũ |
| Tên bảng/cột DB (`mangas`, `created_at`...) | Prisma + SQL migrations | Lược đồ dữ liệu thật | Mất dữ liệu |
| `profiles.id` = Supabase auth UUID | DB | Định danh người dùng | Mất quan hệ auth ↔ data |
| Tên biến môi trường (`R2_*`, `SUPABASE_*`...) | `.env`/`env.ts` | Cấu hình hạ tầng đã deploy | Cấu hình sai runtime |

**Kết luận compatibility**: không có định danh persistent nào bị đổi — không cần chiến lược di chuyển; phiên đăng nhập, cài đặt reader và toàn bộ dữ liệu/objects giữ nguyên.

## 3. Kiểm chứng sau đổi tên

- `grep -r "MangeReader"` trong source: 0 kết quả (chỉ còn trong `upload/Pasted Content...txt` — file task tạm, KHÔNG commit).
- `grep -r "TSUNDOKU\|Tsundoku"` trong source: chỉ còn `tsundoku_*` (cookie), `tsundoku-reader-settings` (localStorage) — 2 định danh cố ý giữ (mục 2.2).
- Title trình duyệt: "MangaReader — Thư viện truyện cá nhân" ✅ (kiểm chứng bằng agent-browser).
- UI hiển thị "MangaReader" ở sidebar/login/settings ✅ (kiểm chứng browser).
- `git remote -v` → `.../MangaReader.git` ✅; fetch/push hoạt động ✅.

## 4. Rà soát lại lượt 2 (2026-11-12, sau hardening pass 2)

- Branding vẫn là **MangaReader** trên toàn bộ diff lượt 2 (không tái xuất `MangeReader`/`TSUNDOKU` user-facing; các định danh cố ý giữ ở mục 2.2 không đổi).
- Các file mới của lượt 2 (`scripts/migrate-sqlite-to-postgres.ts`, `scripts/verify-rls.ts` viết lại, report cập nhật) đều dùng tên `MangaReader`.
- `upload/Pasted Content…txt` (file task tạm chứa văn bản task, có local commit rác trên main cục bộ `48a321d` — **chỉ tồn tại local, chưa bao giờ push**; không nằm trên audit branch) — không ảnh hưởng branding repo.
- Số liệu diff thực tế từ Git (hiệu chỉnh lượt 2): so với main `18bd3ee` là **69 file, +4798/−588** (lượt 1 ghi 57 file/+1591 là số liệu giữa chừng).
