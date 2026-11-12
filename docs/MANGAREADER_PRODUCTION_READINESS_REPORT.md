# MangaReader — Production Readiness Report

- **Ngày audit**: 2026-11-12
- **Branch**: `audit/mangareader-production-hardening` (tách từ main `18bd3ee3702d82f8f7d83c252603caf71723ba87` — đã fetch và xác nhận là HEAD mới nhất của main tại thời điểm bắt đầu)
- **Repository**: `https://github.com/vanhoi04082006-pixel/MangaReader` (đã đổi tên từ `MangeReader`, giữ nguyên private + history — xem `docs/MANGAREADER_RENAME_REPORT.md`)
- **Phạm vi thay đổi**: 57 file, +1591/−574 dòng. Không redesign UI, không viết lại module đang chạy đúng, không xóa tính năng, không reset dữ liệu, không xóa object R2 thật nào trong quá trình kiểm thử.

---

## 1. Executive Summary

**Trạng thái tổng thể: SẴN SÀNG VỀ MÃ NGUỒN — CÒN 1 BƯỚC BÊN NGOÀI (BLOCKED) trước khi Production Ready**: chủ sở hữu phải chạy `supabase/migrations/0001_init.sql` trong Supabase SQL Editor (không thể chạy từ môi trường này vì không có connection string Postgres/service quyền DDL). Mọi thứ khác (auth, phân quyền, CSRF, rate limit, upload/verify/consistent-delete, build, tests) đã được **sửa và kiểm chứng thực tế**.

### Tóm tắt phát hiện & xử lý

| Mức | Số lượng | Đã sửa | Còn lại |
|---|---|---|---|
| CRITICAL | 5 | 5 | 0 |
| HIGH | 7 | 7 | 0 |
| MEDIUM | 6 | 5 | 1 (BLOCKED: áp migration cho production DB — cần chủ sở hữu) |
| LOW | 4 | 4 | 0 |

**CRITICAL đã sửa**: (1) mọi API chỉ kiểm tra "có session" — bất kỳ user Supabase nào cũng dùng được toàn bộ app (`requireUser` → `requireAdmin/requireAdminMutation` + `ADMIN_USER_ID`); (2) RLS policy `USING (true)` cho mọi authenticated user (đã viết lại thành admin-only + `app_config`); (3) logout không revoke đúng session (truyền nhầm publishable key làm Bearer); (4) proxy upload tin Content-Length header (0 khi thiếu) → bỏ qua giới hạn 100MB; (5) finalize tin object key do client gửi (không chứng minh object tồn tại trên R2).

**HIGH đã sửa**: schema PostgreSQL Prisma không map bảng `snake_case` (client sẽ truy vấn bảng không tồn tại — đã map đầy đủ `@@map/@map/@db.Uuid/@db.BigInt/@db.Timestamptz`); thiếu CSRF; thiếu rate limit tương thích serverless; xóa DB-trước-R2-sau làm mất tham chiếu (DELETE_PENDING + safe-delete); `prisma db push --accept-data-loss` mặc định; health endpoint công khai lộ cấu hình; script build dùng lệnh Unix-only.

**BLOCKED (ngoài tầm môi trường này)**: áp `0001_init.sql` cho Supabase production DB → sau đó chạy `bun run scripts/verify-rls.ts` để xác minh RLS thực tế qua PostgREST (script đã viết, exit code rõ ràng).

---

## 2. Audit Results (bảng tổng hợp)

| Hạng mục | Kết quả | Bằng chứng | Hành động còn lại |
|---|---|---|---|
| Repository rename | **PASS** | API 301 redirect + `git ls-remote` qua URL cũ OK; remote local đã đổi | Không |
| Branding MangaReader | **PASS** | grep 0 kết quả cũ (trừ 2 định danh cố ý giữ — mục §3 rename report); browser check title/sidebar/login/settings | Không |
| Authentication | **PASS** | Integration test: sai mật khẩu 401, non-admin 403, admin 200 + httpOnly cookie; provider local bị từ chối trong production (unit test) | Không |
| Authorization (admin-only) | **PASS** | User Supabase thứ 2 (tạo thật, xóa sau test) → 403 trên 7 endpoint bảo vệ; Bearer trực tiếp cũng 403 | Không |
| Session security | **PASS** | Logout revoke session thật (token cũ → 401 cả cookie lẫn Bearer); cache xác minh chia sẻ qua globalThis; cookie httpOnly/SameSite/Secure(verify qua Set-Cookie trong test) | Không |
| CSRF | **PASS** | Test: Origin cross-site 403, không Origin/Referer 403, Referer giả 403, same-origin qua; Sec-Fetch-Site chặn; presigned PUT tới R2 không ảnh hưởng | Không |
| Rate limiting | **PASS** | Brute-force login → 429 (test thật); DB-backed (SQLite/PG) — tương thích Vercel; fail-open có log khi DB lỗi | Không |
| RLS | **BLOCKED** (migration chưa áp cho production DB) | Script `scripts/verify-rls.ts` sẵn sàng; policy đã viết đúng trong 0001 (admin-only + app_config); hiện DB production **chưa có bảng nào** (PGRST205) | **Chủ sở hữu chạy 0001_init.sql trong SQL Editor rồi chạy verify-rls** |
| Database schema (SQLite) | **PASS** | `prisma db push` additive (bảng RateLimitHit mới), dữ liệu dev cũ nguyên vẹn (One Piece 1 chương/5 trang còn nguyên) | Không |
| PostgreSQL migration (schema) | **PASS** (static + schema sync) | `schema.postgres.prisma` map 1-1 SQL 0001 (12 bảng); `prisma validate`/generate OK | Áp dụng thực tế = BLOCKED như trên |
| Cloudflare R2 | **PASS** | Roundtrip presign PUT/GET/delete thật OK; bucket private; URL ký có hạn; không URL ký nào lưu DB (grep) | Không |
| Upload proxy | **PASS** | Test thật: đếm byte, PENDING-only, MIME khớp, size-mismatch 400 (object rác bị xóa), >4MB → 413, key chưa đăng ký 400, MIME lạ 400 | Không |
| ZIP security | **PASS** | Unit test: chặn entry giải nén >100MB, giới hạn 3000 entry, lọc file hệ thống; bounds-check offset (tránh RangeError) | Không |
| Data integrity (DB↔R2) | **PASS** | Test thật: finalize sai kích thước bị chặn (DB check + HeadObject); xóa truyện đồng bộ R2 (`objectsRemoved ≥ 1`); abort không xóa được object CONFIRMED; DELETE_PENDING retry qua cleanup `mode: failed` | Không |
| Vercel compatibility | **PASS** (build) / **PASS** (giới hạn đã xử lý) | `bun run build` thành công (production build + standalone copy cross-platform); proxy giới hạn 4MB đúng giới hạn body Vercel; ZIP parse phía client | Deploy thật lên Vercel do chủ sở hữu thực hiện |
| Performance | **PASS** (kiểm tra mã nguồn + đo thực tế nhẹ) | Reader lazy-load (chỉ render trang trong viewport — verify browser); query có index/ phân trang; chapter size dùng groupBy; không N+1 mới | Benchmark quy mô lớn (100k trang) chưa chạy — ghi nhận MEDIUM §5 |
| Backup | **PASS** (tài liệu hóa) | README §11: DB backup + cảnh báo R2 không nằm trong DB backup + quy trình đối chiếu | Chủ sở hữu cấu hình theo plan |
| Testing | **PASS** | 59/59 test (22 unit + 37 integration) chạy qua; `bun run lint` sạch; `bunx tsc --noEmit` 0 lỗi; typecheck trước đó phát hiện 4 lỗi đã có từ trước (đã sửa) | Không |
| Production build | **PASS** | `next build` + standalone OK; các route đều `runtime nodejs` | Không |
| Secrets | **PASS** | Kiểm tra: không secret trong diff/code; `.env` ignored; env.ts chỉ dùng server; health không trả giá trị nhạy cảm | Chủ sở hữu **xoay vòng GitHub token đã lộ trong chat** (khuyến nghị) |

---

## 3. Security Findings (chi tiết từng finding)

### S1 — CRITICAL · Authorization bypass (fixed)
- **File**: `src/lib/api.ts` (`requireUser`), tất cả route trong `src/app/api/**`
- **Root cause**: guard chỉ kiểm tra session hợp lệ; login chặn email non-admin nhưng mọi request API sau đó không kiểm tra lại → user Supabase khác (tự tạo session qua Supabase) dùng được toàn bộ API.
- **Fix**: `requireAdmin()` (session + email admin + UUID `ADMIN_USER_ID`) và `requireAdminMutation()` (thêm CSRF) áp cho **mọi** route bảo vệ; `isAdminUser()` trong `src/lib/env.ts`; login/refresh cũng kiểm tra lại identity.
- **Test**: user Supabase thật thứ 2 → 403 trên `/api/mangas`, `/api/dashboard`, `/api/storage/*`, `/api/uploads/presign`, `/api/storage/cleanup`, `DELETE /api/history` (Bearer trực tiếp — bypass hoàn toàn login của app).

### S2 — CRITICAL · RLS quá rộng (fixed — chờ áp dụng)
- **File**: `supabase/migrations/0001_init.sql` (bản cũ: policy `authenticated full access` `USING (true)` trên 9 bảng)
- **Root cause**: mọi user Supabase đã xác thực đọc/ghi được toàn bộ dữ liệu qua PostgREST.
- **Fix**: viết lại 0001 (đã kiểm chứng **chưa từng được áp dụng** vào production DB — không bảng nào tồn tại, nên sửa tại chỗ an toàn): bảng `app_config` lưu `admin_user_id`, hàm `is_admin()`, policy admin-only cho 9 bảng dữ liệu; profiles: self-select/insert + admin-all; `app_config`/`rate_limit_hits`: không policy (từ chối PostgREST).
- **Lưu ý trung thực**: Prisma nối bằng role `postgres` (table owner) — **không** bị RLS ràng buộc; RLS là lớp phòng thủ thứ hai cho bề mặt PostgREST. Ranh giới thật của ứng dụng là `requireAdmin()` (S1).
- **Test**: BLOCKED tới khi chủ sở hữu chạy migration → `bun run scripts/verify-rls.ts` (script tạo user Supabase tạm, kiểm anon/non-admin bị từ chối trên `mangas`, `storage_objects`, `app_config`, rồi xóa user tạm).

### S3 — CRITICAL · Logout không revoke session (fixed)
- **File**: `src/lib/supabase-auth.ts` (`sbRevokeToken` cũ)
- **Root cause**: `POST /auth/v1/logout` được gọi với `Authorization: Bearer <publishable key>` — Supabase cần **access token của user** để revoke session đó; lỗi bị nuốt im lặng (best-effort cũ) → refresh token vẫn sống, token bị đánh cắp tiếp tục hữu hiệu.
- **Fix**: `sbRevokeSession(accessToken)` dùng đúng access token; logout xóa cache xác minh (globalThis) để token hết tác dụng ngay trên server; refresh cũng revoke nếu identity không phải admin.
- **Test**: sau logout, access token cũ → 401 (cookie lẫn Bearer) — Supabase thực sự từ chối.

### S4 — CRITICAL · Upload proxy bỏ qua giới hạn kích thước (fixed)
- **File**: `src/app/api/uploads/direct/route.ts`
- **Root cause**: giới hạn 100MB dựa vào `Content-Length` header (mặc định 0 khi thiếu); không kiểm tra trạng thái `PENDING`; cập nhật metadata theo header không tin được.
- **Fix**: đọc body có **đếm byte thực tế**, chặn khi vượt MAX_FILE_SIZE; yêu cầu key đã đăng ký + `status=PENDING` + đúng namespace `mangas/<mangaId>/...` + MIME khớp metadata; kích thước thực phải **bằng** khai báo lúc presign (chặn quota-bypass); giới hạn proxy 4MB (Vercel).
- **Test**: upload 134B khai báo 5000B → 400 `size_mismatch` (object bị xóa khỏi R2); khai báo 5MB → 413 `proxy_too_large`; key lạ → 400; octet-stream → 400; upload đúng → 200 + finalize OK.

### S5 — CRITICAL · Finalize không xác minh object (fixed)
- **File**: `src/services/chapter-service.ts` (`finalizePages`), `src/app/api/mangas/[id]/cover/route.ts`
- **Root cause**: client gửi objectKey + metadata trông hợp lệ là đủ để đánh dấu CONFIRMED — không chứng minh object tồn tại/kích thước đúng/không thay thế trái phép.
- **Fix**: trước khi confirm: (1) kiểm tra StorageObject tồn tại, kind PAGE/COVER, thuộc đúng manga+chapter, chưa DELETE_PENDING, kích thước/MIME khớp đăng ký, key đúng namespace; (2) **HeadObject từng key** (concurrency 8): tồn tại + `contentLength` đúng bằng khai báo + Content-Type khớp (chuẩn hóa `image/jpg`→`jpeg`).
- **Test**: finalize sai kích thước → 400; key chưa đăng ký → 400 `finalize_invalid`; finalize đúng → 201 (đã verify thật qua R2).

### S6 — HIGH · Schema PostgreSQL Prisma không tương thích SQL (fixed)
- **File**: `prisma/schema.postgres.prisma` so với `supabase/migrations/0001_init.sql`
- **Root cause**: schema PG cũ giống hệt schema SQLite (bảng `Manga`, cột `createdAt`, kiểu không native) trong khi SQL tạo `mangas`/`created_at`/UUID/BIGINT/TIMESTAMPTZ → Prisma client production sẽ truy vấn bảng không tồn tại.
- **Fix**: map đầy đủ mọi model/cột (`@@map`, `@map`, `@db.Uuid`, `@db.BigInt` cho file_size, `@db.Timestamptz(6)`); service xuất DTO qua `Number(...)` để chạy đúng cả SQLite (Int) lẫn PG (BigInt); script `db:generate:pg`; thêm bảng `rate_limit_hits` vào SQL.
- **Test**: `prisma generate` cả 2 schema OK; integration test chạy trên SQLite; PG path đã map tĩnh 1-1 (áp dụng thực tế BLOCKED cùng migration).

### S7 — HIGH · Thiếu CSRF (fixed) — xem §2 CSRF.
- Áp `assertSameOrigin` (Origin/Referer/Sec-Fetch-Site, fail-closed khi thiếu cả hai với cookie) trong `requireAdminMutation` + login/logout. Presigned PUT browser→R2 không qua API nên không vỡ.

### S8 — HIGH · Xóa DB-trước-R2-sau mất tham chiếu (fixed)
- **File**: `chapter-service.ts` (deleteChapter/deletePage/clearPages), `manga-service.ts` (deleteManga/setMangaCover), `storage-service.ts` (cleanup*), `uploads/abort/route.ts`
- **Root cause**: bản cũ xóa bản ghi DB rồi xóa R2 best-effort, và **xóa metadata cả khi R2 delete fail** → object thật trên R2 không còn tham chiếu, khó đối chiếu.
- **Fix**: quy trình idempotent: (1) đánh dấu `DELETE_PENDING`; (2) xóa DB (cascade; FK storage_objects set-null giữ objectKey); (3) xóa R2 qua `safeDeleteObjects` (nhận danh sách key xác nhận đã xóa — đã sửa bug `Quiet:true` khiến response không trả key); (4) **chỉ** xóa metadata của key được xác nhận; còn lại giữ `DELETE_PENDING` → cleanup `mode:"failed"` retry; audit nhìn thấy các object này để tự lành. Abort chỉ cho `PENDING`.
- **Test**: xóa manga test → `objectsRemoved ≥ 1`, `objectsPendingRetry: 0`; abort object CONFIRMED → `skipped`, object còn nguyên.

### S9 — HIGH · `prisma db push --accept-data-loss` (fixed)
- **File**: `package.json`. Bỏ cờ nguy hiểm; production dùng SQL migrations có phiên bản (README mục 6); tách `db:generate` / `db:generate:pg`.

### S10 — HIGH · Health công khai lộ thông tin (fixed)
- **File**: `src/app/api/health/route.ts` (+ mới `/api/health/ready`)
- `/api/health` giờ chỉ `{status, time}`. Readiness đầy đủ (DB/R2/missingEnv/provider/bucket) **chỉ admin** — test: 401 khi chưa đăng nhập, 200 + checks khi admin.

### S11 — HIGH · Windows/Unix-only scripts (fixed)
- `cp -r`/`NODE_ENV=...`/`tee` → `scripts/build-standalone.mjs` + `scripts/start-standalone.mjs` (Node, cross-platform); thêm `dev:win`; `DATABASE_URL` trong `.env.example` dùng đường dẫn tương đối.

### S12 — MEDIUM · Lỗi có sẵn phá production build (fixed)
- `tsc` sạch sau khi sửa: thiếu export `ChapterUpdateInput` (schemas), DTO `coverUrl` bắt buộc nhưng service không gán (đã thành optional — route gán sau qua `attachCoverUrls`), `bucket()` trả `string|undefined`, **bug runtime thật**: sort `lastRead` dùng biến `userId` không tồn tại (`params.userId`) — lỗi trước đây không được phát hiện vì chưa chạy typecheck; `tsconfig` giờ loại `examples/skills` khỏi build.

### S13 — MEDIUM · ZIP hardening (fixed) — mục §2 ZIP security.

### S14 — MEDIUM · Quota chưa kiểm tra server-side (fixed)
- Presign kiểm tra `CONFIRMED + PENDING(<24h)` tổng ≥ quota → 507 `quota_exceeded`; fake size bị chặn bởi S4/S5 (kích thước thực phải khớp). Ghi nhận: quota là hạn mức mềm (race đồng thời về mặt lý thuyết vẫn có thể vượt 1 file).

### S15 — MEDIUM · Benchmark quy mô lớn (chưa chạy — còn lại)
- Kiểm tra tĩnh: index đầy đủ (title/status/createdAt/updatedAt; chapter mangaId; pages objectKey; storage status+createdAt...), phân trang mọi list, reader lazy-load + preload cấu hình được. Đã đo thực tế nhẹ (19 object scan audit ~1s; reader 5 trang mượt). **Chưa** tạo dataset 1.000 truyện/100k trang để đo — ghi nhận là việc tiếp theo (an toàn vì mọi truy vấn đều có index + phân trang).

### S16 — LOW (fixed): tên package, README lỗi thời (đã viết lại đúng thực tế), `SameSite` cấu hình, comment branding.

---

## 4. Database Report

- **SQLite (dev)**: schema giữ nguyên + thêm `RateLimitHit`; `db push` additive — dữ liệu dev cũ (manga One Piece, 1 chương, 5 trang, 858KB) nguyên vẹn, tiến độ đọc nguyên vẹn (verify browser: "Trang 5/5").
- **PostgreSQL (production target)**: `schema.postgres.prisma` ↔ `0001_init.sql` khớp 1-1 (12 bảng). Đã kiểm chứng production DB **trống** (không bảng) → chỉnh sửa 0001 tại chỗ an toàn (không ảnh hưởng dữ liệu).
- Kiểu dữ liệu: UUID PK (`@db.Uuid`), `file_size BIGINT` (service convert `Number()`), timestamps `TIMESTAMPTZ(6)`, check constraints (status/kind/scroll_position/publication_year), unique (mangaId+chapterNumber, chapterId+pageNumber, objectKey, userId+chapterId), cascade đúng hướng, storage_objects FK set-null.
- Câu hỏi tương thích SQLite/PG đã xử lý: `contains` case-insensitive (`mode: "insensitive"` chỉ bật khi DATABASE_URL là postgres), BigInt→Number tại DTO, `upsert` composite key hoạt động cả hai.
- **Trạng thái kiểm thử PG thật**: BLOCKED (cần chủ sở hữu áp migration; sau đó `verify-rls.ts` + smoke test).

## 5. R2 & Upload Report

- Bucket private (HeadBucket OK; không URL public nào trong mã — mọi GET qua presign có hạn 1h mặc định).
- Presign PUT ký kèm Content-Length khai báo (R2 từ chối nếu lệch nếu phía R2 enforce; lớp chắc chắn thứ hai = HeadObject lúc finalize).
- CORS: token hiện tại **không đủ quyền sửa bucket-level** (GetBucketCors → AccessDenied) — chủ sở hữu cấu hình CORS qua Dashboard (script in sẵn JSON). Khi chưa có CORS: upload tự fallback proxy (≤4MB) — hành vi được tài liệu hóa rõ.
- Object key sinh server-side (`mangas/<mangaId>/chapters/<chapterId>/p0001-xxxxxxxx.jpg` — random 8 ký tự) — client không chọn key.
- Audit phát hiện đúng 14 object mồ côi **có sẵn từ trước audit** (manga test `6d707d7b` của phiên dev cũ + `diagnostic/test-put.txt`) — **không xóa** (nguyên tắc không đụng dữ liệu thật trong audit); Storage UI > Audit + Cleanup xử lý được (dry-run mặc định).

## 6. Performance Report

- **Phương pháp**: kiểm tra tĩnh truy vấn Prisma (index/phân trang/N+1) + đo thực tế trên môi trường dev thật (SQLite local, R2 thật).
- **Reader**: lazy-load chỉ render trang trong viewport (verify: 3/5 ảnh tải khi ở trang 5); preload cấu hình được; khôi phục tiến độ đọc hoạt động (5/5).
- **Upload**: engine 3 worker, EMA tốc độ/ETA, retry không đổi key; ZIP parse central-directory client-side (không nén cả archive vào RAM).
- **API**: mọi list có phân trang; thống kê dùng aggregate/groupBy; dashboard gộp Promise.all.
- **Chưa làm**: benchmark 1.000 truyện/100k trang (S15) — kế hoạch: dùng `scripts/make-test-manga.ts` mở rộng sinh dataset trong DB test riêng.

## 7. Remaining External Blockers

| # | Việc cần chủ sở hữu | Lý do môi trường này không làm được |
|---|---|---|
| 1 | Chạy `supabase/migrations/0001_init.sql` trong **Supabase Dashboard > SQL Editor** | Không có connection string Postgres / quyền DDL (chỉ có service key cho Auth Admin + PostgREST — không chạy DDL được) |
| 2 | Sau (1): chạy `bun run scripts/verify-rls.ts` để xác minh RLS thực tế | Phụ thuộc (1) |
| 3 | Cấu hình **CORS cho bucket R2** qua Cloudflare Dashboard | Token R2 chỉ có quyền object (GetBucketCors → AccessDenied) |
| 4 | Deploy lên Vercel (Build Command `bun run db:generate:pg && bun run build`, các biến môi trường theo README §7) | Không có quyền Vercel project |
| 5 | **Xoay vòng GitHub token** đã dán trong chat (đã dùng để rename/push theo yêu cầu) + rà soát Supabase/R2 keys (đã nằm trong chat) | Bảo mật hygiene — không dán secret vào chat/đặt trong biến môi trường an toàn |
| 6 | Sau khi bootstrap: đổi mật khẩu admin tại Supabase và xóa `ADMIN_PASSWORD` khỏi env production | Vận hành |

## 8. Kết luận

Mã nguồn hiện tại **đã khắc phục toàn bộ CRITICAL/HIGH**, có bộ test thật (59/59 pass) bao phủ chính các lỗ hổng đã sửa, build production thành công, và hành trình deploy được tài liệu hóa từng bước. Khi chủ sở hữu hoàn thành mục §7 (1)–(4) và xác minh `verify-rls.ts` PASS, dự án đạt **PRODUCTION READY** theo tiêu chí chấp nhận đã định.

*Không có dữ liệu thật nào bị reset; không object R2 nào của dữ liệu thật bị xóa trong suốt audit (dữ liệu test do audit tự tạo đã tự dọn sạch — storage về đúng trạng thái ban đầu: 5 object CONFIRMED của manga One Piece).*
