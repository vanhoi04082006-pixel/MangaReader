# MangaReader — Thư viện truyện tranh cá nhân

Website đọc truyện tranh cá nhân (single-admin) với lưu trữ ảnh trên **Cloudflare R2** (private bucket), xác thực **Supabase Auth**, giao diện dark-mode chuyên nghiệp và trình đọc truyện hai chế độ (cuộn dọc / từng trang).

> Tên dự án: **MangaReader** (repo: `MangaReader`). Cookie session giữ tiền tố `tsundoku_*` như định danh kỹ thuật cũ để không mất phiên đã đăng nhập — xem `docs/MANGAREADER_RENAME_REPORT.md`.

![Stack](https://img.shields.io/badge/Next.js%2016-App%20Router-black) ![DB](https://img.shields.io/badge/Prisma-SQLite%20%2F%20Postgres-green) ![Storage](https://img.shields.io/badge/Cloudflare%20R2-Private%20Bucket-orange) ![Auth](https://img.shields.io/badge/Supabase-Auth-blue)

---

## Mục lục

1. [Tính năng](#1-tính-năng)
2. [Kiến trúc](#2-kiến-trúc)
3. [Cài đặt nhanh](#3-cài-đặt-nhanh)
4. [Cấu hình Supabase](#4-cấu-hình-supabase)
5. [Cấu hình Cloudflare R2](#5-cấu-hình-cloudflare-r2)
6. [Database](#6-database)
7. [Deploy lên Vercel](#7-deploy-lên-vercel)
8. [API Endpoints](#8-api-endpoints)
9. [Bảo mật](#9-bảo-mật)
10. [Kiểm thử](#10-kiểm-thử)
11. [Backup & Khôi phục](#11-backup--khôi-phục)
12. [Xử lý sự cố](#12-xử-lý-sự-cố)

---

## 1. Tính năng

### Xác thực & phân quyền (single-admin)
- Đăng nhập bằng email/mật khẩu qua **Supabase Auth**. Chế độ `AUTH_PROVIDER=local` (JWT tự cấp) **chỉ dùng cho dev** — production tự chối (fail-closed).
- **Không có trang đăng ký** — chỉ duy nhất tài khoản admin (`ADMIN_EMAIL`), bootstrap qua `bun run scripts/bootstrap-admin.ts` (tách khỏi luồng login thường).
- **Ranh giới phân quyền trung tâm `requireAdmin()`**: mọi API bảo vệ kiểm tra server-side (i) session hợp lệ, (ii) email khớp admin, (iii) UUID khớp `ADMIN_USER_ID` — **bắt buộc trong production** (thiếu/malformed → từ chối hoàn toàn, không fallback email-only). Non-admin nhận 403 — kể cả khi có session Supabase hợp lệ.
- Session bằng httpOnly cookie (Secure + SameSite=Lax ở production) + tự động refresh; logout revoke session ở Supabase và xóa cache xác minh ngay.
- **CSRF**: mọi mutation dùng cookie bị kiểm tra Origin/Referer/Sec-Fetch-Site (cross-site → 403).
- **Rate limit** (DB-backed, tương thích Vercel serverless): login 10/15 phút/IP, refresh, presign, upload, cleanup...

### Thư viện
- Grid/List view, ảnh bìa tỉ lệ 2:3, hover effects + stagger animation.
- Tìm kiếm theo tên/tên khác/tác giả (debounce, case-insensitive cả SQLite & PostgreSQL), lọc theo thể loại + trạng thái.
- Sắp xếp: tên, ngày thêm, ngày cập nhật, lần đọc gần nhất. Phân trang.

### Upload (kiến trúc serverless-friendly)
- **ZIP**: parser central-directory tự viết — đọc index trước (không giải nén cả archive vào RAM), lọc file rác (`__MACOSX`, file hệ thống), giới hạn 3000 ảnh/chương + chặn decompression bomb (entry giải nén > 100MB bị bỏ qua), natural sort (**`2.jpg` < `10.jpg`**), giải nén + upload từng trang.
- **Thư mục** (`webkitdirectory`) và chọn từng ảnh.
- Presigned PUT trực tiếp browser → R2 (**ký kèm Content-Length**); fallback qua proxy server **chỉ cho file ≤ 4MB** (giới hạn body của Vercel) — file lớn bắt buộc presigned PUT (cần CORS cho bucket).
- Proxy đếm **byte thực tế** khi streaming, yêu cầu key đang `PENDING`, đúng namespace + MIME, kích thước thực phải khớp khai báo.
- **Finalize có xác minh**: trước khi ghi nhận trang, server HeadObject từng object trên R2 — kiểm tra tồn tại, đúng kích thước, đúng MIME, đúng manga/chapter.
- Concurrency 3, retry (không presign lại — tái dùng key), pause/resume, hủy + dọn file, tiến độ từng file + tổng (tốc độ, ETA), capture kích thước ảnh.
- **Quota 100GB kiểm tra server-side** khi presign (tính cả upload PENDING đang sống).
- Track mọi object đã cấp presign (bảng `storage_objects`) → phát hiện + dọn file mồ côi.

### Đọc truyện
- **Cuộn dọc** (virtualized — chỉ render trang trong viewport, khôi phục vị trí cuộn).
- **Từng trang**: phím mũi tên/Space, click zone, hướng đọc LTR/RTL.
- Cài đặt lưu localStorage: chế độ, fit (width/height/original), khoảng cách trang, nền đọc (tối/đen/sáng), tự ẩn toolbar, số trang preload.
- Tự lưu tiến độ (throttle + khi rời trang/ẩn tab), "Tiếp tục đọc", lịch sử đọc.

### Lưu trữ (toàn vẹn DB ↔ R2)
- Thống kê dung lượng thật từ DB metadata (theo truyện, file lớn nhất), cảnh báo hạn mức.
- **Audit file mồ côi**: quét ListObjectsV2 phân trang so với DB → liệt kê + dọn dẹp an toàn (kiểm tra tham chiếu trước khi xóa).
- **Xóa an toàn (idempotent)**: xóa truyện/chương/trang đánh dấu `DELETE_PENDING` → xóa DB → xóa R2 → **chỉ** xóa metadata khi R2 xác nhận đã xóa. Xóa thất bại → giữ metadata, retry qua cleanup (`mode: "failed"`). Không bao giờ mất tham chiếu tới object thật.
- Abort upload chỉ nhắm vào object `PENDING` (không thể abort object đã CONFIRMED).

### Khác
- Dashboard tổng quan (số liệu thật), yêu thích, lịch sử, cài đặt.
- Health check công khai tối giản (`/api/health`) + readiness chi tiết **chỉ admin** (`/api/health/ready`).
- Dark mode mặc định + light mode, responsive mobile (sidebar → drawer), Framer Motion, tiếng Việt đầy đủ.

---

## 2. Kiến trúc

```
Browser ──login──▶ Next.js API (requireAdmin) ──▶ Supabase Auth (REST)
   │                                        └───▶ Prisma ──▶ SQLite (dev) / Supabase Postgres (prod)
   ├── presigned PUT ──────────────▶ Cloudflare R2 (private bucket)   ← đường chính (file bất kỳ ≤ 100MB)
   └── proxy qua /api/uploads/direct ──▶ R2                            ← fallback (≤ 4MB, Vercel limit)
```

- **Next.js 16 App Router** + React 19 + TypeScript + Tailwind 4 + shadcn/ui.
- **Prisma 6**: SQLite cho dev; PostgreSQL (Supabase) cho production — schema PostgreSQL map đúng bảng `snake_case` (`@@map`/`@map`, `@db.Uuid`, `@db.BigInt`, `@db.Timestamptz`).
- **Zustand** (client state) + **TanStack Query** (server state) + **Framer Motion**.
- Cấu trúc thư mục: `src/app/api/*` (routes), `src/services/*` (business logic), `src/lib/*` (auth/env/r2/rate-limit), `src/features/*` (views), `src/components/*` (UI).

---

## 3. Cài đặt nhanh

Yêu cầu: **Bun** (hoặc Node 20+), Windows/Linux/macOS đều chạy được.

```bash
bun install
cp .env.example .env          # điền giá trị thật (xem mục 4, 5)
bun run db:push               # tạo SQLite dev (KHÔNG dùng --accept-data-loss)
bun run dev                   # http://localhost:3000  (Windows: bun run dev:win)
```

Đăng nhập bằng `ADMIN_EMAIL` + mật khẩu (quản lý bởi Supabase Auth). `ADMIN_PASSWORD` trong `.env` **chỉ dùng bootstrap** (tạo tài khoản lần đầu) — xem mục 4.

### Các lệnh

| Lệnh | Mô tả |
|---|---|
| `bun run dev` | Dev server (ghi `dev.log`; Windows dùng `dev:win`) |
| `bun run build` | Production build + copy standalone (cross-platform) |
| `bun run start` | Chạy standalone server (cross-platform) |
| `bun run lint` / `bun run typecheck` | ESLint / TypeScript |
| `bun test` | Toàn bộ test (unit + integration — cần dev server đang chạy) |
| `bun run db:push` | Áp schema SQLite cho dev (không mất dữ liệu) |
| `bun run db:generate` / `db:generate:pg` | Sinh Prisma client (SQLite / PostgreSQL) |
| `bun run scripts/bootstrap-admin.ts` | Bootstrap tài khoản admin (in UUID cho `ADMIN_USER_ID`) |
| `bun run verify:rls` (`scripts/verify-rls.ts`) | Kiểm tra RLS qua PostgREST (chạy sau migration) — tách apikey/bearer, xác minh session non-admin thật |
| `bun run db:migrate:sqlite-to-postgres` | Chuyển dữ liệu SQLite dev → PostgreSQL (dry-run mặc định; `--apply` để ghi) |
| `bun run scripts/setup-r2.ts` | Kiểm tra bucket + CORS + roundtrip presign |

---

## 4. Cấu hình Supabase

1. Tạo project tại [supabase.com](https://supabase.com) → lấy URL + keys ở **Project Settings > API**:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable)
   - `SUPABASE_SERVICE_SECRET_KEY` (secret — **chỉ server**, không đặt `NEXT_PUBLIC_`)
2. **Vô hiệu hóa đăng ký**: Authentication > Sign In / Up > tắt "Allow new users to sign up" (website single-admin).
3. **Bootstrap admin** (chỉ làm 1 lần khi triển khai lần đầu):
   ```bash
   bun run scripts/bootstrap-admin.ts
   ```
   Script tạo tài khoản admin (email_confirm = true) và in **UUID**. Đặt UUID đó vào `ADMIN_USER_ID` trong `.env` (và biến môi trường Vercel).

   **Vòng đời `ADMIN_PASSWORD` (bootstrap-only)**: biến này chỉ cần lúc tạo tài khoản lần đầu. Sau khi tài khoản đã tồn tại trong Supabase Auth: (1) đổi mật khẩu tại Authentication > Users, (2) **xóa `ADMIN_PASSWORD`** khỏi env production. Login/refresh/logout/readiness hoạt động bình thường không cần nó — mật khẩu do Supabase Auth quản lý. Ứng dụng không bao giờ tạo lại/reset tài khoản admin đã tồn tại.
4. **Chạy migration SQL** (production): mở **SQL Editor**, dán toàn bộ `supabase/migrations/0001_init.sql`, Run. Migration tạo 12 bảng (10 bảng dữ liệu + `app_config` + `rate_limit_hits`), bật RLS **admin-only** và seed `app_config.admin_user_id`.
5. Xác minh RLS: `bun run verify:rls` (anon + non-admin bị từ chối — script tạo user Supabase tạm + dòng test riêng, xóa sạch sau).
6. **Chuyển dữ liệu SQLite dev sang PostgreSQL** (nếu cần giữ dữ liệu cũ): `bun run db:migrate:sqlite-to-postgres` (dry-run trước, `--apply` khi chắc chắn — xem chi tiết trong script).
7. `ADMIN_USER_ID` **bắt buộc trong production**: readiness (`/api/health/ready`) báo degraded nếu thiếu, sai định dạng UUID, hoặc không khớp `app_config.admin_user_id`.

---

## 5. Cấu hình Cloudflare R2

1. Tạo **private bucket** (không bật public access) → lấy Account ID, Access Key, Secret (quyền Object Read & Write là đủ) → điền `R2_*` vào `.env`.
2. Chạy `bun run scripts/setup-r2.ts` — kiểm tra bucket, thử roundtrip presigned PUT/GET.
3. **CORS cho upload trực tiếp** (quan trọng): bucket > Settings > CORS Policy:
   ```json
   [{
     "AllowedOrigins": ["https://<domain-cua-ban>", "http://localhost:3000"],
     "AllowedMethods": ["GET", "PUT", "HEAD"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 3600
   }]
   ```
   (Token chỉ có quyền object thì script sẽ in sẵn JSON để dán vào Dashboard.) **Chưa có CORS** app vẫn chạy: upload tự fallback qua proxy server — nhưng bị giới hạn **4MB/ảnh** (giới hạn body của Vercel). Cấu hình CORS để upload trực tiếp file tới 100MB.

---

## 6. Database

**Dev (mặc định)**: SQLite tại `DATABASE_URL=file:../db/custom.db` (tương đối — chạy được mọi OS). `bun run db:push` để áp schema (additive).

**Production (Supabase PostgreSQL)**: nguồn chân lý là **SQL migrations** trong `supabase/migrations/` — chạy qua SQL Editor, KHÔNG dùng `prisma db push` hay `prisma migrate` cho production. Schema `prisma/schema.postgres.prisma` map 1-1 với SQL (`@@map("mangas")`, `@map("created_at")`, `@db.Uuid`, `@db.BigInt`, `@db.Timestamptz(6)`) và chỉ dùng để **sinh Prisma client** cho production build (`bun run db:generate:pg`).

### Bảng dữ liệu (12)

| Bảng | Vai trò |
|---|---|
| `profiles` | Map user Supabase Auth |
| `mangas`, `chapters`, `pages` | Dữ liệu truyện (UUID, snake_case) |
| `genres`, `manga_genres` | Thể loại + liên kết |
| `favorites`, `reading_progress`, `reading_history` | Yêu thích / tiến độ / lịch sử |
| `storage_objects` | Metadata file R2: `PENDING → CONFIRMED → DELETE_PENDING` |
| `app_config` | Định danh admin (`admin_user_id`) cho RLS |
| `rate_limit_hits` | Rate limit fixed-window (DB-backed) |

### RLS — hiểu đúng ranh giới

- RLS **admin-only** (policy so khớp `auth.uid()` với `app_config.admin_user_id`) bảo vệ bề mặt **PostgREST** (anon key): anon và user Supabase không-admin đều bị từ chối (xác minh bằng `scripts/verify-rls.ts`).
- Ứng dụng truy cập qua **Prisma với role `postgres`** (table owner — không bị RLS ràng buộc). Ranh giới phân quyền thật của ứng dụng là **`requireAdmin()` ở tầng API**, không phải RLS.

---

## 7. Deploy lên Vercel

1. Fork/import repo `MangaReader`, framework tự nhận Next.js.
2. **Environment Variables** (Production): toàn bộ biến trong `.env.example` với:
   - `DATABASE_URL` = connection string **Session pooler** của Supabase (`...pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=1`)
   - `AUTH_PROVIDER=supabase`, `ADMIN_USER_ID=<uuid>`, đã chạy migration SQL + bootstrap admin
   - `NEXT_PUBLIC_APP_URL=https://<domain>`
3. **Build Command**: `bun run db:generate:pg && bun run build` (sinh Prisma client PostgreSQL rồi build).
4. Giới hạn cần nhớ trên Vercel:
   - Body request tới serverless ~4.5MB → **proxy upload chỉ nhận ≤ 4MB**; file lớn đi presigned PUT trực tiếp (cần CORS bucket — mục 5).
   - Giải nén ZIP diễn ra **phía client** — không vướng giới hạn request size.
5. Sau deploy: `/api/health` (công khai) trả `ok`; đăng nhập rồi mở Settings xem Trạng thái hệ thống (DB + R2) hoặc gọi `/api/health/ready`.

---

## 8. API Endpoints

Tất cả API (trừ `/api/health`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`) yêu cầu **admin session** (401 chưa đăng nhập / 403 không phải admin). Mutation có cookie bị kiểm CSRF.

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Health công khai (tối giản) |
| GET | `/api/health/ready` | Readiness chi tiết (admin) |
| POST | `/api/auth/login` / `logout` / `refresh` | Đăng nhập / đăng xuất (revoke) / làm mới |
| GET | `/api/auth/me` | Thông tin user hiện tại + `isAdmin` |
| GET/POST | `/api/mangas` | Danh sách (tìm/loc/sắp xếp) / tạo |
| GET/PATCH/DELETE | `/api/mangas/:id` | Chi tiết / cập nhật / xóa (đồng bộ R2) |
| GET/POST | `/api/mangas/:id/chapters` | Danh sách chương / tạo |
| GET/PATCH/DELETE | `/api/chapters/:id` | Chi tiết chương / cập nhật / xóa |
| GET/POST/DELETE | `/api/chapters/:id/pages` | Trang / finalize (có HeadObject verify) / xóa hết |
| DELETE | `/api/chapters/:id/pages/:pageId` | Xóa 1 trang |
| GET | `/api/chapters/:id/reader` | Payload reader (presigned URLs + tiến độ) |
| POST | `/api/uploads/presign` | Cấp presigned PUT (quota check, ký size) |
| POST | `/api/uploads/direct` | Proxy upload (≤ 4MB, đếm byte, PENDING only) |
| POST | `/api/uploads/abort` | Hủy upload (chỉ PENDING, safe-delete) |
| POST | `/api/mangas/:id/cover` / `cover/from-page` | Finalize bìa (verify R2) / sao chép từ trang |
| POST | `/api/mangas/:id/favorite` | Bật/tắt yêu thích |
| GET | `/api/dashboard`, `/api/genres`, `/api/history`, `/api/progress` (PUT) | Dashboard / thể loại / lịch sử / tiến độ |
| GET | `/api/storage/stats`, `/api/storage/audit` | Thống kê / audit mồ côi |
| POST | `/api/storage/cleanup` | Dọn dẹp: `pending` / `keys` / `failed` (retry DELETE_PENDING) |

---

## 9. Bảo mật

- **Phân quyền**: `requireAdmin()` / `requireAdminMutation()` cho mọi route bảo vệ — email + UUID admin kiểm tra server-side mỗi request. Cookie chỉ là phương tiện vận chuyển token.
- **Cookie**: `httpOnly`, `SameSite=Lax`, `Secure` ở production, refresh token cô lập path `/api/auth`.
- **Fail-closed**: `AUTH_PROVIDER=local` bị từ chối ở production; cấu hình sai → từ chối xác thực (không tự hạ cấp).
- **CSRF**: Origin/Referer + Sec-Fetch-Site cho mọi mutation có cookie; presigned PUT tới R2 không đi qua API nên không bị ảnh hưởng.
- **Upload**: object key sinh server-side theo namespace; presign ký Content-Length; proxy đếm byte thật; finalize HeadObject verify (size + MIME + ownership). Client không thể ghi đè object tùy ý.
- **Secrets**: service key/R2 secret chỉ đọc ở server (`src/lib/env.ts` — không import vào client component); `.env` trong `.gitignore`.
- **Rate limit**: DB-backed (SQLite/Postgres) — hoạt động trên Vercel serverless.
- **RLS**: admin-only cho bề mặt PostgREST (xem mục 6).

Chi tiết đầy đủ mọi kiểm soát + bằng chứng kiểm thử: `docs/MANGAREADER_PRODUCTION_READINESS_REPORT.md`.

---

## 10. Kiểm thử

```bash
bun run dev                    # integration test cần server đang chạy
bun test                       # 59 test: 22 unit + 37 integration
```

- **Unit**: provider fail-closed, ranh giới admin identity, CSRF, JWT expiry, ZIP hardening (bomb/caps).
- **Integration** (chạy với Supabase + R2 thật): login đúng/sai/non-admin, user Supabase thứ 2 bị 403 ở mọi API bảo vệ, CSRF cross-site, upload roundtrip thật (presign → R2 → finalize verify → xóa đồng bộ), giới hạn proxy, abort an toàn, logout revoke, rate limit 429.
- Test không chạm dữ liệu thật: tạo/xóa dữ liệu riêng; user Supabase tạm được xóa sau test; bảng rate limit được reset trước mỗi lần chạy.

---

## 11. Backup & Khôi phục

- **Database (Supabase)**: Dashboard > Database > Backups (daily tự động theo plan) + export SQL thủ công định kỳ (SQL Editor > Download). **Backup database KHÔNG bao gồm ảnh trên R2.**
- **R2**: bật **Object Versioning** hoặc dùng R2 Inventory/export nếu cần khả năng phục hồi ảnh; sao lưu bucket bằng công cụ đồng bộ (vd `rclone`) nếu muốn.
- **Khôi phục**: restore DB → chạy `bun run scripts/setup-r2.ts` (kiểm tra bucket) → Storage UI > Audit để đối chiếu metadata ↔ object (cleanup xóa mồ côi/`failed` retry nếu lệch).
- Quy mô 100GB: cẩn thận hạn mức Cloudflare (Class A/B operations + storage) — quota `STORAGE_QUOTA_GB` của app là hạn mức mềm phía ứng dụng.

---

## 12. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Login báo "Thao tác quá nhanh" | Rate limit 10 lần/15 phút/IP (bảng `rate_limit_hits`) — chờ hoặc xóa row window hiện tại khi dev. |
| Upload file lớn lỗi "vượt quá giới hạn proxy 4MB" | Bucket chưa có CORS → cấu hình CORS (mục 5) để dùng presigned PUT trực tiếp. |
| Finalize báo "Không xác minh được object trên R2" | Object chưa PUT xong / kích thước khai báo sai — upload lại đúng file; kiểm tra `storage_objects.status`. |
| 403 "Tài khoản không có quyền" với session hợp lệ | Email/UUID không khớp `ADMIN_EMAIL`/`ADMIN_USER_ID` — chạy `scripts/bootstrap-admin.ts` để lấy đúng UUID. |
| 403 "Yêu cầu cross-site bị từ chối" | Mutation thiếu/khác Origin — client phải gọi same-origin (trình duyệt hiện đại luôn tự gửi Origin). |
| Storage có object "DELETE_PENDING" | Xóa R2 thất bại trước đó — Storage > Dọn dẹp > retry (`mode: failed`), hoặc chạy lại tới khi sạch. |
| `prisma db push` đòi xóa dữ liệu | Schema drift — KHÔNG chạy với `--accept-data-loss` trên dữ liệu thật; kiểm tra diff trước. |
| Migration SQL lỗi "column does not exist" | Đảm bảo chạy đúng thứ tự `supabase/migrations/*.sql` (hiện chỉ cần `0001_init.sql`). |

---

## Giấy phép & phạm vi

Dự án cá nhân (single-admin), không phân phối công khai. Tên chuẩn: **MangaReader**.
