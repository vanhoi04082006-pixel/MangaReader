# MangaReader — Production Readiness Report

- **Ngày audit (lượt 1)**: 2026-11-12 — commit `ce8651ff7d07c101904e0cb9e7f1851016ceb1a4`
- **Ngày rà soát độc lập (lượt 2)**: 2026-11-12 — commit mới nhất trên `audit/mangareader-production-hardening` (xem "Kết quả" cuối báo cáo)
- **Branch**: `audit/mangareader-production-hardening` (tách từ main `18bd3ee3702d82f8f7d83c252603caf71723ba87`)
- **Repository**: `https://github.com/vanhoi04082006-pixel/MangaReader` (giữ nguyên private + history — xem `docs/MANGAREADER_RENAME_REPORT.md`)
- **Phạm vi thay đổi so với main `18bd3ee`**: 69 file, +4798/−588 dòng (số liệu `git diff --stat` thực tế — lượt 1 ghi 57 file/+1591 là số liệu giữa chừng, đã hiệu chỉnh). Lượt 2 thay đổi 21 file, +1629/−141 so với `ce8651f`.
- Không redesign UI, không viết lại module đang chạy đúng, không xóa tính năng, không reset dữ liệu, không xóa object R2 thật nào trong quá trình kiểm thử. `main` không bị thay đổi.

---

## 1. Executive Summary

**Trạng thái tổng thể: SẴN SÀNG VỀ MÃ NGUỒN — CÒN BƯỚC BÊN NGOÀI (BLOCKED) trước khi Production Ready**. Rà soát độc lập lượt 2 đã xác nhận các sửa của lượt 1, phát hiện và sửa thêm 5 vấn đề còn sót (chi tiết §3B), nâng bộ test từ 59 lên **82 test (35 unit + 47 integration), tất cả PASS trên môi trường thật** (SQLite + Supabase Auth thật + R2 thật).

### Tóm tắt 2 lượt

| Mức | Lượt 1 (đã sửa) | Lượt 2 phát hiện thêm | Lượt 2 đã sửa |
|---|---|---|---|
| CRITICAL | 5 | 1 (ADMIN_USER_ID không bắt buộc → email-only vẫn chạy được trong production) | 1 |
| HIGH | 7 | 3 (logout không revoke khi access hết han; ADMIN_PASSWORD bị readiness đòi hỏi sau bootstrap; proxy cho phép stream tới 100MB trước khi chặn) | 3 |
| MEDIUM | 6 (5 sửa, 1 BLOCKED) | 1 (thiếu công cụ chuyển dữ liệu SQLite→PostgreSQL trước khi đổi DATABASE_URL) | 1 (tool hoàn chỉnh; chạy thật = BLOCKED theo chủ đích) |
| LOW | 4 | 1 (verify-rls.ts dùng access token làm apikey → có thể PASS giả) | 1 |

**BLOCKED (ngoài tầm môi trường này — cần chủ sở hữu)**: áp `0001_init.sql` cho Supabase production DB → sau đó chạy `bun run verify:rls` và `bun run db:migrate:sqlite-to-postgres --apply` (2 script đã sẵn sàng, tự chặn an toàn khi migration chưa áp).

---

## 2. Audit Results (bảng tổng hợp — bằng chứng phân loại rõ)

**Phân loại bằng chứng** (không trộn lẫn):
- **[SR]** Static review (đọc mã nguồn, không chạy).
- **[UT]** Unit test chạy thật (bun test, không cần server).
- **[IT]** Integration test chạy thật trên dev server (SQLite + Supabase Auth thật + R2 thật).
- **[BL]** BLOCKED — không thể chạy thật trong môi trường này (cần chủ sở hữu).

| Hạng mục | Kết quả | Bằng chứng | Còn lại |
|---|---|---|---|
| Repository rename | **PASS** [SR] | API 301 redirect + `git ls-remote` qua URL cũ OK | Không |
| Branding MangaReader | **PASS** [SR] | grep 0 kết quả cũ (trừ định danh cố ý giữ — rename report); browser check | Không |
| Authentication | **PASS** [IT] | Sai mật khẩu 401, non-admin 403, admin 200 + httpOnly cookie; local provider bị từ chối trong production [UT] | Không |
| Authorization (admin-only + UUID pinning) | **PASS** [UT+IT] | User Supabase thật thứ 2 → 403 trên 7 endpoint; Bearer trực tiếp 403; **ADMIN_USER_ID bắt buộc trong production — thiếu/malformed → fail closed (không còn email-only)** [UT: 9 test mới]; readiness báo cáo thiếu/sai UUID | Không |
| Session security & logout revocation | **PASS** [IT] | 6 kịch bản logout thật: access+refresh, **chỉ refresh (access thiếu) → refresh-then-revoke: refresh token cũ CHẾT (dùng lại → 400/401)**, access rác + refresh hợp lệ, không token (idempotent), refresh sai, logout lặp; trạng thái revocation thật ghi server-side (`revoked`/`already-invalid`/`nothing-to-revoke` — khớp 7/7 log) | Không |
| CSRF | **PASS** [UT+IT] | Origin cross-site 403, thiếu Origin/Referer 403, Referer giả 403, same-origin qua; Sec-Fetch-Site chặn; presigned PUT không ảnh hưởng | Không |
| Rate limiting | **PASS** [IT] | Brute-force → 429; DB-backed (SQLite/PG) — Vercel-compatible; fail-open có log khi DB lỗi | Không |
| RLS | **BLOCKED** [BL] | `bun run verify:rls` đã chạy thật: **PASS** (publishable key hợp lệ — PostgREST phản hồi, không bị Kong 401) rồi **BLOCKED đúng**: `mangas` chưa tồn tại (PGRST205) → script thoát với hướng dẫn, KHÔNG đánh giá RLS trên bảng không tồn tại. Script lượt 2: tách apikey/bearer, xác minh session non-admin thật (GET /auth/v1/user 200), UPDATE/DELETE vào dòng test + kiểm tra dòng nguyên vẹn, dọn sạch sau test | **Chủ sở hữu chạy 0001_init.sql rồi chạy verify:rls** |
| Database schema (SQLite) | **PASS** [IT] | `db push` additive; dữ liệu dev cũ nguyên vẹn (One Piece 1 chương/5 trang) | Không |
| PostgreSQL migration (schema) | **PASS** [SR] + **[BL]** áp thật | `schema.postgres.prisma` map 1-1 SQL 0001 (12 bảng); `prisma validate`/generate OK | Áp thật = BLOCKED |
| **Chuyển dữ liệu SQLite→PostgreSQL** | **PASS (tool, dry-run)** [IT-R2] + **[BL]** apply | `bun run db:migrate:sqlite-to-postgres` chạy thật dry-run: đọc đủ 10 bảng, validate UUID/timestamp/FK, **HeadObject xác minh 7/7 object CONFIRMED tồn tại trên R2 thật**, kế hoạch in rõ; tự BLOCK khi bảng đích chưa tạo. `--skip-test-data` loại đúng 2 manga `[TEST-AUDIT]` leftover | Apply thật (cần migration + backup + chủ sở hữu) |
| Cloudflare R2 | **PASS** [IT] | Roundtrip presign PUT/GET/delete thật; bucket private; URL ký có hạn | Không |
| Upload proxy (cap 4MB khi stream) | **PASS** [IT] | 8 test thật: đúng bằng cap 4MB → 200; khai báo nhỏ + body vượt cap → **413 proxy_too_large ngay khi vượt 4MB + KHÔNG có object trên R2 (finalize → r2_verify_failed)**; key CONFIRMED → 409 not_pending; stream đứt giữa chừng → không tạo object; không Content-Length → 200 (đếm byte thật); MIME sai 400; key lạ 400 | Không |
| ZIP security | **PASS** [UT] | Chặn entry giải nén >100MB, 3000 entry, lọc file hệ thống | Không |
| Data integrity (DB↔R2) | **PASS** [IT] | Finalize sai kích thước bị chặn (DB + HeadObject); xóa truyện đồng bộ R2; abort không xóa CONFIRMED; DELETE_PENDING retry | Không |
| Vercel compatibility | **PASS** [SR+IT] | `bun run build` thành công; proxy giới hạn 4MB < 4.5MB body Vercel; rate limit DB-backed | Deploy thật do chủ sở hữu |
| Performance | **PASS** [SR + đo nhẹ] | Index/phân trang/lazy-load (xem lượt 1 §6) | Benchmark 100k trang chưa chạy |
| Testing | **PASS** | **82/82 test** (35 unit + 47 integration) chạy qua trên môi trường thật; `bun run lint` sạch; `bun run typecheck` 0 lỗi; `bun run build` OK | Không |
| Secrets | **PASS** [SR] | Không secret trong diff; `.env` ignored; tool artifact đã loại khỏi commit | Chủ sở hữu xoay vòng token đã lộ (khuyến nghị) |

---

## 3. Security Findings lượt 1 (tóm tắt — chi tiết giữ nguyên bên dưới)

### S1 — CRITICAL · Authorization bypass (fixed lượt 1)
`requireUser` → `requireAdmin/requireAdminMutation` trên mọi route bảo vệ + `isAdminUser()` kiểm email + UUID.

### S2 — CRITICAL · RLS quá rộng (fixed — chờ áp dụng)
Policy `USING(true)` → viết lại admin-only (`is_admin()` + `app_config`). Prisma nối bằng owner role không bị RLS ràng buộc — RLS là lớp 2 cho PostgREST; ranh giới thật là `requireAdmin()` (S1).

### S3 — CRITICAL · Logout không revoke session (fixed lượt 1, HOÀN THIỆN lượt 2 — xem S18)

### S4 — CRITICAL · Upload proxy tin Content-Length (fixed lượt 1, HOÀN THIỆN lượt 2 — xem S19)

### S5 — CRITICAL · Finalize không xác minh object (fixed lượt 1)
HeadObject từng key trước khi CONFIRMED.

### S6–S16 — HIGH/MEDIUM/LOW (fixed lượt 1)
PG schema map, CSRF, safe-delete, db push flag, health tách public/internal, script cross-platform, typecheck lỗi có sẵn, ZIP hardening, quota presign, benchmark (còn), branding/README.

---

## 3B. Security Findings lượt 2 (rà soát độc lập)

### S17 — CRITICAL · ADMIN_USER_ID không bắt buộc trong production (fixed)
- **File**: `src/lib/env.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/health/ready/route.ts`, `scripts/bootstrap-admin.ts`, `.env.example`
- **Root cause (lượt 1 sót)**: `isAdminUser()` chỉ kiểm UUID **khi ADMIN_USER_ID được cấu hình** — biến vắng mặt thì khớp email là đủ. Mâu thuẫn với tuyên bố "UUID đã ghim" của báo cáo lượt 1: production có thể chạy email-only mà không ai biết.
- **Fix**:
  - `isAdminUser()`: trong production (NODE_ENV=production + supabase) — ADMIN_USER_ID **phải** tồn tại + là UUID hợp lệ + khớp `user.id`; thiếu/malformed → **từ chối hoàn toàn** (fail closed, không fallback email-only). Dev: tùy chọn (workflow bootstrap) nhưng malformed vẫn bị báo cáo.
  - `adminIdentityConfigIssue()` + `missingEnvVars()`: readiness báo degraded khi thiếu/sai định dạng (production) hoặc malformed (cả dev).
  - Login route: chặn sớm (500 config_invalid) trong production khi cấu hình sai, trước khi gọi Supabase.
  - Readiness: thêm kiểm tra **nhất quán** `ADMIN_USER_ID` ↔ `app_config.admin_user_id` (chỉ PostgreSQL — SQLite dev bỏ qua, báo "skipped").
  - Bootstrap script: in UUID, từ chối thoát code 1 nếu production thiếu UUID / UUID malformed / UUID không khớp Supabase.
  - UUID quản trị đã xác minh `7228d6e8-3f7b-4443-bdb6-1543b7afb4d6` được xử lý **chỉ như cấu hình môi trường** (.env/biến Vercel + seed SQL) — không hardcode trong mã nguồn.
- **Test [UT] (9 test mới)**: email+UUID đúng → PASS; email đúng + UUID sai → 403; email đúng + thiếu UUID trong production → fail closed; malformed → fail closed + readiness báo; user Supabase khác → 403; local provider trong production → từ chối; dev thiếu UUID vẫn qua; readiness báo/không báo đúng trường hợp.

### S18 — HIGH · Logout không revoke khi access token hết hạn (fixed)
- **File**: `src/app/api/auth/logout/route.ts`, `src/lib/supabase-auth.ts`, `src/lib/session.ts`, `src/lib/api.ts`
- **Root cause (lượt 1 sót)**: khi cookie access thiếu, lượt 1 chỉ log cảnh báo + xóa cookie — refresh token **vẫn còn sống phía Supabase**. Xóa cookie ≠ revoke session. Ngoài ra `sbRevokeSession` cũ trả `true` cho 401/403 (coi "token đã chết" là "đã revoke" — không trung thực: session family có thể còn sống qua refresh token).
- **Fix**:
  - `sbRevokeSessionStatus()` trả 4 trạng thái phân biệt: `revoked` (204) / `rejected` (401/403 — token bị từ chối, session có thể còn sống) / `unreachable` (mạng) / `error` (5xx...).
  - Logout xử lý đủ 7 trường hợp: (1) access hợp lệ → revoke trực tiếp; (2) access bị từ chối + có refresh → **refresh-then-revoke**: đổi refresh token lấy session mới (rotation tiêu thụ refresh cũ — không ai còn giữ nó), revoke NGAY session mới, xóa cache; (3) access thiếu + có refresh → như (2); (4) không token → chỉ xóa cookie (idempotent); (5) refresh sai (invalid_grant 400) → ghi nhận `already-invalid`; (6) Supabase không liên lạc được → cookie vẫn xóa (an toàn client) nhưng ghi `unreachable` server-side — **không báo cáo thành công giả**; (7) logout lặp → 200.
  - Session mới từ rotation chỉ tồn tại trong RAM server (cookie không bao giờ gửi lại client); nếu revoke nó fail → log trung thực "session tạm còn sống phía Supabase nhưng không ai sở hữu token".
  - **Ghi nhận trung thực về cửa sổ hiệu lực** (theo yêu cầu): (a) Supabase access JWT chứa `session_id`; `/auth/v1/user` từ chối token của session đã revoke → xác minh từng request phát hiện revoke ngay (test 8.1 chứng minh: token cũ → 401). (b) Cache xác minh 90s chỉ tồn tại trên runtime instance hiện tại (globalThis) — **trên Vercel mỗi serverless instance có cache riêng, logout chỉ xóa được cache của instance xử lý logout; KHÔNG tuyên bố xóa được cache mọi instance**. (c) Do đó thêm `requireAdminDestructive()` (CSRF + admin + **xác minh trực tiếp Supabase, bỏ qua cache**) cho 4 thao tác phá hối: DELETE manga, DELETE chapter, DELETE page, POST cleanup — token đã logout không thể xóa dữ liệu trên bất kỳ instance nào.
- **Test [IT] (5 test mới + 1 tồn tại)**: 8.2 (chỉ refresh cookie → RT cũ chết, dùng lại → 400/401), 8.3 (access rác + refresh hợp lệ → RT cũ chết), 8.4 (idempotent), 8.5 (refresh sai → 200 an toàn); log server khớp 7/7 kết quả (`revoked`×4, `nothing-to-revoke`, `already-invalid`×2).

### S19 — HIGH · Proxy cho phép ngâm body tới 100MB trước khi chặn (fixed)
- **File**: `src/app/api/uploads/direct/route.ts`
- **Root cause (lượt 1 sót)**: route chặn khai báo > 4MB trước khi stream, nhưng vòng đọc body chỉ dừng khi `actualBytes > MAX_FILE_SIZE` (100MB) — client khai báo 134B rồi stream 90MB sẽ được ngâm vào bộ nhớ trước khi bị `size_mismatch` từ chối → vượt mục đích giới hạn proxy 4MB.
- **Fix**: vòng stream kiểm tra `MAX_PROXY_FILE_SIZE` (4MB): vượt → hủy reader NGAY, không giữ chunk tràn, 413 `proxy_too_large`, PUT không bao giờ thực hiện (S3 PUT chỉ chạy sau khi đọc hết body). Giữ nguyên các kiểm tra MIME/PENDING/namespace/metadata-khớp.
- **Test [IT] (5 test mới 7b.1–7b.5)**: đúng bằng cap 4MB → 200; khai báo nhỏ + body vượt cap → 413 + KHÔNG object trên R2 (chứng minh qua finalize → `r2_verify_failed`); key CONFIRMED → 409 not_pending; stream đứt giữa chừng → không tạo object; không Content-Length (chunked stream) → 200 (đếm byte thật, không phụ thuộc header).

### S20 — HIGH · ADMIN_PASSWORD bị readiness đòi hỏi vĩnh viễn (fixed)
- **File**: `src/lib/env.ts` (`missingEnvVars`), `src/app/api/health/ready/route.ts`, `.env.example`, `README.md`, `scripts/bootstrap-admin.ts`
- **Root cause (lượt 1 sót)**: bàn giao cuối hướng dẫn xóa `ADMIN_PASSWORD` sau bootstrap, nhưng `missingEnvVars()` báo thiếu biến này bất cứ khi nào Supabase bật → readiness degraded vô ích dù tài khoản đã tồn tại.
- **Fix**: `ADMIN_PASSWORD` chính thức là **secret bootstrap-only**: (a) không còn nằm trong biến bắt buộc; (b) login/refresh/logout/readiness không cần; (c) không bao giờ expose/log; (d) ứng dụng không tạo lại/reset admin đã tồn tại (login chỉ tạo khi **chưa tồn tại** + có password); (e) bootstrap script yêu cầu rõ ràng chỉ khi tạo mới, in hướng dẫn xóa sau khi xong. `.env.example` + README giải thích khi nào cần/khi nào phải xóa.
- **Test [UT] (3 test mới)**: production + supabase + không ADMIN_PASSWORD → readiness KHÔNG báo; dev tương tự; isAdminUser không đọc password.

### S21 — MEDIUM · Thiếu kế hoạch chuyển dữ liệu SQLite→PostgreSQL (fixed — tool hoàn chỉnh, apply BLOCKED theo chủ đích)
- **File mới**: `scripts/migrate-sqlite-to-postgres.ts` + script `db:migrate:sqlite-to-postgres`
- **Root cause (lượt 1 sót)**: tạo bảng PostgreSQL không chuyển dữ liệu SQLite; báo cáo lượt 1 không có phương án. Môi trường dev SQLite có dữ liệu thật (One Piece) cần giữ.
- **Kiểm kê dữ liệu SQLite hiện có** (readonly):
  - **Dữ liệu thật**: 1 profile (admin UUID `7228d6e8-…`, khớp Auth), 1 manga "One Piece" (`aeefe898-…`, tạo 2026-11-12), 1 chapter, 5 trang (5 object CONFIRMED ~175KB, đã HeadObject xác minh tồn tại trên R2), 1 reading_progress (tiến độ đọc), 1 reading_history.
  - **Dữ liệu test leftover** (từ các lần chạy integration test trước khi lượt 2 thêm dọn dẹp trước rate-limit): 2 manga `[TEST-AUDIT]` (`3415659d-…`, `228dc09c-…`), 2 chapter, 2 trang (2 object CONFIRMED 188B + 2 object PENDING), 2 reading_history. **Không tự ý xóa — chủ sở hữu quyết định**: xóa qua app (Storage > Audit/Cleanup) hoặc giữ và migrate hết.
  - 24 genre (seed), 2 manga_genres, 0 favorites.
- **Tool**: đọc SQLite **readonly**; ghi qua PostgREST (service key) theo thứ tự FK; **giữ nguyên UUID/timestamp/FK/số trang/R2 key**; Int→BIGINT (JSON number); `Prefer: resolution=ignore-duplicates` → **idempotent/resumable** (chạy lại chỉ thêm dòng còn thiếu); **dry-run mặc định** — `--apply` + gõ `migrate` xác nhận (hoặc `--yes`); `--skip-test-data` bỏ manga `[TEST-AUDIT]*`; xác minh: UUID hợp lệ, timestamp, FK chéo, profile tồn tại trong Supabase Auth (FK auth.users), **HeadObject từng object CONFIRMED/Page trên R2** (thiếu → liệt kê cảnh báo, không chặn); xác minh số dòng sau ghi; **không bao giờ** xóa/sửa SQLite nguồn, không upload/xóa/đổi key R2.
- **Bằng chứng chạy thật**: dry-run PASS (đọc đủ 10 bảng, 7/7 object R2 tồn tại, kế hoạch in rõ, tự BLOCKED vì bảng đích chưa tạo — đúng); `--skip-test-data` đúng (3→1 manga, 9→5 storage objects).
- **Trạng thái apply thật**: **BLOCKED theo chủ đích** — cần (1) chủ sở hữu áp 0001_init.sql, (2) backup, (3) xác nhận rõ ràng. Tool tự chặn an toàn khi migration chưa áp.

### S22 — LOW · verify-rls.ts dùng access token làm apikey → có thể PASS giả (fixed)
- **File**: `scripts/verify-rls.ts`
- **Root cause (lượt 1 sót)**: `rest()` dùng cùng một giá trị cho `apikey` và `Authorization` — request non-admin bị 401 từ API key **trước khi tới chính sách RLS**; script cũ chấp nhận 401 là "bị chặn hợp lệ" → PASS giả.
- **Fix**: tách `rest(method, path, apiKey, bearerToken, body)`; anon = publishable key cả hai header; non-admin = `apikey` publishable key + `Bearer <access token thật>`. Tăng cường: (1) xác minh publishable key hợp lệ (phân biệt 401 Kong "Invalid API key" với 404 PGRST205 — đã chạy thật: key PASS); (2) xác minh bảng tồn tại bằng service key (thiếu → BLOCKED, không đánh giá RLS trên bảng không tồn tại — đã chạy thật: BLOCKED đúng); (3) **chứng minh session non-admin hợp lệ** (GET /auth/v1/user → 200 + email khớp) trước khi kết luận 401/403 là do RLS; (4) kiểm anonymous SELECT/INSERT; non-admin SELECT/INSERT/**UPDATE/DELETE vào dòng test thật** (tạo qua service key, kiểm tra dòng nguyên vẹn sau mỗi thử — phát hiện cả trường hợp RLS tắt); storage_objects + app_config đọc/ghi; (5) dọn sạch manga test + user tạm trong `finally` — **không đụng dữ liệu ứng dụng thật**.
- **Bằng chứng chạy thật**: script chạy trên project thật — key hợp lệ PASS, bảng chưa tồn tại → BLOCKED với hướng dẫn (kết quả trung thực, không PASS giả).

---

## 4. Database Report

- **SQLite (dev)**: schema giữ nguyên + `RateLimitHit`; dữ liệu dev cũ nguyên vẹn. Kiểm kê chi tiết xem S21.
- **PostgreSQL (production target)**: `schema.postgres.prisma` ↔ `0001_init.sql` khớp 1-1 (12 bảng). **Đã kiểm chứng production DB trống** (không bảng — PGRST205 trên mọi bảng qua PostgREST, 2026-11-12).
- **Chuyển dữ liệu**: tool sẵn sàng (S21); chạy thật = BLOCKED (cần migration + backup + xác nhận).
- Kiểu dữ liệu: UUID PK, `file_size BIGINT` (convert Number ở DTO), TIMESTAMPTZ(6), check constraints, unique, cascade đúng hướng, storage FK set-null. Tương thích SQLite/PG (contains insensitive, upsert composite) — lượt 1 đã xử lý.

## 5. R2 & Upload Report

- Bucket private; mọi GET qua presign có hạn; key sinh server-side.
- Proxy: cap 4MB ép **trong khi stream** (S19) — test thật 7b.1–7b.5.
- CORS bucket: token không đủ quyền sửa bucket-level — chủ sở hữu cấu hình qua Dashboard (script in sẵn JSON). Chưa có CORS → fallback proxy ≤4MB (đã tài liệu hóa).
- 14 object mồ côi có sẵn từ trước audit (lượt 1 phát hiện) — không xóa; Storage UI > Audit/Cleanup xử lý (dry-run mặc định).
- Migration tool chỉ HeadObject (đọc) — không ghi/xóa R2.

## 6. Performance Report

(không đổi so với lượt 1): reader lazy-load + phân trang mọi list + index đầy đủ; upload 3 worker + ZIP parse client-side. Benchmark 1.000 truyện/100k trang chưa chạy (S15 lượt 1). Lượt 2 thêm: `requireAdminDestructive` bỏ cache xác minh cho 4 thao tác xóa — đổi 1 round-trip Supabase/request cho bảo mật (thao tác xóa hiếm, chi phí chấp nhận được).

## 7. Remaining External Blockers

| # | Việc cần chủ sở hữu | Lý do môi trường này không làm được |
|---|---|---|
| 1 | Chạy `supabase/migrations/0001_init.sql` trong **Supabase Dashboard > SQL Editor** | Không có connection string Postgres / quyền DDL (chỉ có Auth Admin + PostgREST service key) |
| 2 | Sau (1): chạy `bun run verify:rls` | Phụ thuộc (1). Script đã được sửa (S22) — sẽ chạy thật toàn bộ kiểm tra anon/non-admin |
| 3 | Sau (1): quyết định dữ liệu SQLite (S21): giữ hết, hay bỏ 2 manga `[TEST-AUDIT]` leftover (xóa qua app hoặc `--skip-test-data`), rồi `bun run db:migrate:sqlite-to-postgres --apply` (sau khi backup) | Apply thật cần backup + xác nhận của chủ sở hữu |
| 4 | Cấu hình **CORS bucket R2** qua Cloudflare Dashboard | Token chỉ có quyền object |
| 5 | Deploy Vercel (Build `bun run db:generate:pg && bun run build`) | Không có quyền Vercel project |
| 6 | **Xoay vòng GitHub token** đã dán trong chat + rà soát Supabase/R2 keys | Bảo mật hygiene |
| 7 | Sau bootstrap: đổi mật khẩu admin tại Supabase + xóa `ADMIN_PASSWORD` khỏi env production (giờ readiness KHÔNG còn đòi hỏi — S20) | Vận hành |

## 8. Kết quả lượt 2

- 5 phát hiện mới (1 CRITICAL, 3 HIGH, 1 MEDIUM + 1 LOW) — **tất cả đã sửa và kiểm chứng**.
- Bộ test: **59 → 82** (+13 unit, +10 integration), **82/82 PASS** trên môi trường thật; lint sạch; typecheck 0 lỗi; production build OK.
- Số liệu diff đã hiệu chỉnh từ Git (không sao chép số cũ): 69 file / +4798/−588 so với main.
- Trạng thái cuối: **NOT YET PRODUCTION READY — EXTERNAL BLOCKERS REMAIN** (§7: mục 1–5). Mã nguồn đã sẵn sàng; khi chủ sở hữu hoàn thành (1)+(2) và verify-rls PASS thật, (3) nếu cần giữ dữ liệu, (4)–(5) triển khai → PRODUCTION READY.

*Không có dữ liệu thật nào bị reset; không object R2 nào của dữ liệu thật bị xóa (dữ liệu test do integration test tự tạo đã tự dọn sạch — kể từ lượt 2, dọn trước cả rate-limit burn).*
