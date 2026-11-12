# TSUNDOKU — Thư viện truyện tranh cá nhân

Website đọc truyện tranh cá nhân (single-user) với lưu trữ ảnh trên **Cloudflare R2** (private bucket), xác thực **Supabase Auth**, giao diện dark-mode chuyên nghiệp và trình đọc truyện hai chế độ (cuộn dọc / từng trang).

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
10. [Xử lý sự cố](#10-xử-lý-sự-cố)

---

## 1. Tính năng

### Xác thực
- Đăng nhập bằng email/mật khẩu qua **Supabase Auth** (hoặc chế độ local JWT tự cấp — không phụ thuộc ngoài).
- **Không có trang đăng ký** — chỉ duy nhất tài khoản admin (env `ADMIN_EMAIL`), tự động bootstrap vào Supabase Auth khi đăng nhập lần đầu.
- Session bằng httpOnly cookie + tự động refresh — không lộ token ra localStorage.

### Thư viện
- Grid/List view, ảnh bìa tỉ lệ 2:3, hover effects + stagger animation.
- Tìm kiếm theo tên/tên khác/tác giả (debounce), lọc theo thể loại + trạng thái.
- Sắp xếp: tên, ngày thêm, ngày cập nhật, lần đọc gần nhất. Phân trang.

### Upload (kiến trúc serverless-friendly)
- **ZIP**: parser central-directory tự viết — đọc index trước (không giải nén cả archive vào RAM), lọc file rác (`__MACOSX`, file hệ thống), natural sort (**`2.jpg` < `10.jpg`**), giải nén + upload từng trang.
- **Thư mục** (`webkitdirectory`) và chọn từng ảnh.
- Presigned PUT trực tiếp browser → R2; **tự fallback qua proxy server** khi bucket chưa cấu hình CORS (hoặc lỗi mạng).
- Concurrency 3, retry 3 lần với backoff, pause/resume, hủy + dọn file, tiến độ từng file + tổng (tốc độ, ETA), capture kích thước ảnh (width/height).
- Track mọi object đã cấp presign (bảng `storage_objects`) → phát hiện + dọn file mồ côi.

### Đọc truyện
- **Cuộn dọc** (virtualized — chỉ render trang trong viewport, khôi phục vị trí cuộn).
- **Từng trang**: phím mũi tên/Space, click zone, hướng đọc LTR/RTL.
- Cài đặt lưu localStorage: chế độ, fit (width/height/original), khoảng cách trang, nền đọc (tối/đen/sáng), tự ẩn toolbar, số trang preload.
- Tự lưu tiến độ (throttle 3.5s + khi rời trang/ẩn tab), "Tiếp tục đọc", lịch sử đọc.

### Lưu trữ
- Thống kê dung lượng thật từ R2 (theo truyện, file lớn nhất), cảnh báo 80%/95% hạn mức 100GB.
- **Audit file mồ côi**: quét ListObjectsV2 phân trang so với DB → liệt kê + dọn dẹp an toàn (kiểm tra tham chiếu trước khi xóa).

### Khác
- Dashboard tổng quan (số liệu thật), yêu thích, lịch sử, settings, health check.
- Dark mode mặc định + light mode, responsive mobile (sidebar → drawer), Framer Motion, tiếng Việt đầy đủ.

---

## 2. Kiến trúc

```
Browser (SPA tại route "/", hash-router)
   │  cookies (httpOnly session)
   ▼
Next.js Route Handlers (/api/*)  ──auth──►  Supabase Auth (REST)
   │                                        (password grant / refresh / verify)
   ├── Prisma ◄── SQLite (dev)  hoặc  Supabase Postgres (prod)
   │
   └── AWS SDK (S3-compatible) ──►  Cloudflare R2 (private bucket)
          presign PUT (browser → R2 trực tiếp)
          presign GET (URL tạm thời 1h — KHÔNG lưu vào DB)
          delete / copy / list (server-side)
```

**Vì sao SPA hash-router?** Toàn bộ UI chạy tại một route duy nhất (`/`) — các "trang" là `#/library`, `#/manga/<id>`, `#/reader/...`. Điều này giúp deploy ở bất kỳ đâu (kể cả môi trường preview hạn chế route) mà vẫn có deep-link + nút back.

**Vì sao Prisma + SQLite mặc định?**
- Giới hạn thực tế: API key Supabase (kể cả service secret) **không thể chạy DDL** (tạo bảng) — cần DB password hoặc platform token.
- SQLite = zero-config, chạy ngay, backup = copy file. Với 1 người dùng + hàng trăm nghìn trang, SQLite nhanh hơn Postgres từ xa.
- **Đường lên Supabase Postgres**: cùng một mã nguồn service — đổi `DATABASE_URL` + provider (xem mục 6). Migration SQL đầy đủ kèm RLS nằm tại `supabase/migrations/0001_init.sql`.

**Cấu trúc source code:**

```
prisma/                  schema SQLite (dev) + schema.postgres.prisma (prod)
supabase/migrations/     SQL migration Postgres + RLS policies
scripts/                 setup-r2.ts, make-test-manga.ts (tiện ích)
src/
  app/
    page.tsx             SPA root
    api/                 Route Handlers (auth, mangas, chapters, uploads, ...)
  components/
    layout/              AppShell, Sidebar, Header
    manga/               MangaCard, CoverImage
    common/              StatCard, EmptyState, ConfirmDialog...
  features/
    auth/ library/ dashboard/ manga/ upload/ reader/ history/ favorites/ storage/ settings/
  services/              Business logic + data access (manga, chapter, progress, storage...)
  lib/                   env, session, supabase-auth, r2, api helpers, client (api, hash-router)
  schemas/               Zod validation
  store/                 Zustand (auth, reader settings, upload engine state)
  types/ utils/ hooks/
```

---

## 3. Cài đặt nhanh

```bash
# 1. Cài dependencies
bun install   # hoặc npm install

# 2. Copy + điền environment
cp .env.example .env
#    → sửa các giá trị Supabase / R2 / ADMIN_*  (xem mục 4, 5)

# 3. Khởi tạo database (SQLite)
bun run db:push

# 4. (Khuyến nghị) Kiểm tra bucket R2 + CORS + roundtrip
bun run scripts/setup-r2.ts

# 5. Chạy
bun run dev   # http://localhost:3000
```

Đăng nhập bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD` trong `.env`. Ở lần đăng nhập đầu tiên, tài khoản được tự tạo trong Supabase Auth (đã confirm email).

> **Lưu ý**: `AUTH_SECRET` tạo bằng `openssl rand -hex 32`.

---

## 4. Cấu hình Supabase

1. Tạo project tại [supabase.com](https://supabase.com) (miễn phí là đủ).
2. Lấy credentials: **Project Settings → API**:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key (`sb_publishable_...`)
   - `SUPABASE_SERVICE_SECRET_KEY` = secret key (`sb_secret_...`) — **chỉ dùng server-side, không đưa vào client**
3. Đổi mật khẩu admin (tùy chọn): **Authentication → Users** → chọn user → Reset password.
4. **(Tùy chọn — dùng Postgres thay SQLite)**: chạy `supabase/migrations/0001_init.sql` trong **SQL Editor**, rồi cập nhật `.env`:
   ```
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=1
   ```
   và generate client với schema Postgres (xem mục 6).

---

## 5. Cấu hình Cloudflare R2

1. Tạo bucket (ví dụ `manga-storage`), **không** bật public access.
2. Tạo API token: **R2 → Manage API Tokens → Create API token** → Object Read & Write cho bucket đó. Lấy:
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - `R2_ACCOUNT_ID` (từ URL dashboard), `R2_ENDPOINT` = `https://<account_id>.r2.cloudflarestorage.com`
3. **CORS (quan trọng cho upload trực tiếp)**: bucket → Settings → CORS Policy, dán:
   ```json
   [
     {
       "AllowedOrigins": ["https://your-domain.com", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   > Token chỉ cấp quyền object-level sẽ **không** đặt được CORS qua API — hãy cấu hình qua Dashboard.
   > **Nếu chưa có CORS, ứng dụng vẫn hoạt động**: upload tự động chuyển qua chế độ proxy qua server (chậm hơn một chút; Vercel giới hạn body ~4.5MB/file ở chế độ này).
4. Chạy kiểm tra: `bun run scripts/setup-r2.ts` — verify bucket, CORS, presign PUT/GET roundtrip.

---

## 6. Database

### Hai chế độ

| | SQLite (mặc định) | Supabase Postgres |
|---|---|---|
| Schema | `prisma/schema.prisma` | `prisma/schema.postgres.prisma` |
| Ưu điểm | Zero-config, nhanh, backup = copy file | Chạy được Vercel serverless, RLS |
| Cách đổi | — | Đặt `DATABASE_URL` Postgres, rồi: `bunx prisma generate --schema prisma/schema.postgres.prisma && bunx prisma db push --schema prisma/schema.postgres.prisma` |

Hai schema có **cùng model** — toàn bộ `src/services/*` dùng chung, không sửa code.

### Mô hình dữ liệu (9 bảng)

- `profiles` — map 1-1 user Supabase Auth
- `mangas` — truyện (title, alt, author, artist, status, year, cover key)
- `chapters` — chương (`chapter_number` dạng text hỗ trợ "5.5", "extra"; unique `(manga_id, chapter_number)`)
- `pages` — trang (object key R2, kích thước, w/h; unique `(chapter_id, page_number)`)
- `genres`, `manga_genres` — thể loại nhiều-nhiều
- `favorites` — yêu thích (PK user+manga)
- `reading_progress` — vị trí đọc mới nhất (1 row/user/manga: chapter, page, scroll %)
- `reading_history` — lịch sử (1 row/user/chapter, upsert `read_at`)
- `storage_objects` — metadata mọi file R2 (`PENDING` → `CONFIRMED`) để track upload + dọn file mồ côi

Không lưu binary ảnh, không lưu presigned URL (sinh tại thời điểm trả response, hết hạn sau 1h), không lưu secret.

---

## 7. Deploy lên Vercel

1. **Chuẩn bị**: Supabase Postgres đã migrate (mục 4.4 + 6), R2 CORS đã cấu hình với domain production (mục 5.3).
2. Push code lên GitHub, import project vào Vercel.
3. Thêm Environment Variables (tất cả biến trong `.env.example`, riêng `DATABASE_URL` là connection string Postgres pooler).
4. Generate Prisma client với schema Postgres — thêm vào `build` command của Vercel:
   ```bash
   bunx prisma generate --schema prisma/schema.postgres.prisma && next build
   ```
   (Vercel → Settings → Build Command)
5. Deploy. Kiểm tra `https://<domain>/api/health` → `{"status":"ok"}`.

> Lưu ý: SQLite **không bền vững** trên Vercel (filesystem tạm) — dùng Postgres khi deploy serverless. Với self-host (VPS/Docker), SQLite hoàn toàn ổn.

---

## 8. API Endpoints

Tất cả (trừ `/api/health`) yêu cầu session hợp lệ — trả 401 JSON khi chưa đăng nhập.

| Method | Endpoint | Chức năng |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập (bootstrap admin user lần đầu) |
| POST | `/api/auth/refresh` | Làm mới session |
| POST | `/api/auth/logout` | Đăng xuất + revoke |
| GET | `/api/auth/me` | Thông tin user hiện tại |
| GET/POST | `/api/mangas` | Danh sách (search/genre/status/sort/phân trang) / Tạo |
| GET/PATCH/DELETE | `/api/mangas/:id` | Chi tiết / Sửa / Xóa (cascade + R2) |
| POST | `/api/mangas/:id/favorite` | Bật/tắt yêu thích |
| GET/POST | `/api/mangas/:id/chapters` | Danh sách chương (sort asc/desc) / Tạo |
| POST | `/api/mangas/:id/cover` | Finalize ảnh bìa sau upload |
| POST | `/api/mangas/:id/cover/from-page` | Đặt bìa từ 1 trang (copy trong R2) |
| GET/PATCH/DELETE | `/api/chapters/:id` | Chi tiết + pages / Sửa / Xóa (cascade + R2) |
| GET/POST/DELETE | `/api/chapters/:id/pages` | Danh sách / Finalize upload / Xóa tất cả trang |
| DELETE | `/api/chapters/:id/pages/:pageId` | Xóa 1 trang (R2 + DB) |
| GET | `/api/chapters/:id/reader` | Payload Reader (presigned URLs + prev/next + progress) |
| POST | `/api/uploads/presign` | Cấp presigned PUT (track storage_objects) |
| POST | `/api/uploads/direct` | Proxy upload qua server (fallback CORS) |
| POST | `/api/uploads/abort` | Hủy upload + dọn object |
| PUT | `/api/progress` | Lưu tiến độ đọc |
| GET/DELETE | `/api/history` | Lịch sử / Xóa (1 truyện hoặc tất cả) |
| GET/POST | `/api/genres` | Danh sách (seed mặc định) / Tạo |
| GET | `/api/dashboard` | Số liệu tổng quan |
| GET | `/api/storage/stats` | Thống kê dung lượng chi tiết |
| GET | `/api/storage/audit` | Quét R2 tìm file mồ côi (phân trang) |
| POST | `/api/storage/cleanup` | Dọn file mồ côi / upload gián đoạn |
| GET | `/api/health` | Trạng thái hệ thống (public) |

---

## 9. Bảo mật

- **Không đăng ký công khai** — chỉ `ADMIN_EMAIL` được phép đăng nhập (kiểm tra server-side, 403 với tài khoản khác).
- Session trong **httpOnly cookie** (access ~1h + refresh 30 ngày, path giới hạn), auto-refresh trong API client.
- Service key Supabase + R2 secret **chỉ tồn tại server-side** (route handlers); client bundle chỉ chứa publishable key (không dùng — auth chạy qua server).
- Bucket R2 **private** — ảnh chỉ truy cập qua **presigned GET hết hạn 1 giờ**, URL không bao giờ lưu DB.
- Mọi API validate input bằng Zod, lỗi Prisma map ra thông báo thân thiện (409 trùng số chương...).
- Xóa truyện/chương/trang → **đồng bộ DB + R2** (không để file rác); audit + cleanup file mồ côi có xác minh tham chiếu.
- RLS bật trên toàn bộ bảng khi dùng Supabase Postgres (defense-in-depth).
- `.env` đã trong `.gitignore`.

---

## 10. Xử lý sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| Upload hiện "Chế độ chuyển tiếp qua server" | Bucket chưa có CORS cho upload trực tiếp — thêm CORS (mục 5.3) để bật đường truyền thẳng (nhanh hơn, không giới hạn 4.5MB). |
| "Chưa đăng nhập hoặc phiên đã hết hạn" | Session hết hạn và refresh thất bại — đăng nhập lại. Nếu Supabase bảo trì, chờ vài phút. |
| Ảnh truyện không tải, hiện "Lấy URL mới" | Presigned URL hết hạn giữa phiên đọc — bấm nút, hệ thống tự cấp URL mới (hoặc refetch tự động). |
| Đăng nhập báo "Tài khoản không được phép" | Email ≠ `ADMIN_EMAIL` trong `.env`. |
| `/api/health` trả `r2: false` | Sai `R2_*` trong env, bucket bị xóa, hoặc mất kết nối mạng tới Cloudflare. |
| `missingEnv` liệt kê biến | Thiếu biến bắt buộc — điền đủ `.env` theo `.env.example`. |
| Presign trả 400 "Định dạng không hỗ trợ" | Chỉ chấp nhận JPEG/PNG/WebP/AVIF/GIF, tối đa 100MB/ảnh. |

---

## Phát triển

```bash
bun run dev        # dev server (port 3000)
bun run lint       # ESLint (đạt chuẩn: 0 lỗi, 0 cảnh báo)
bun run db:push    # đồng bộ schema SQLite
bun run scripts/setup-r2.ts          # kiểm tra R2
bun run scripts/make-test-manga.ts   # sinh ZIP test (ảnh đánh số)
```

## Giấy phép

Sử dụng cá nhân. Vui lòng tôn trọng bản quyền của các tác phẩm bạn tải lên.
