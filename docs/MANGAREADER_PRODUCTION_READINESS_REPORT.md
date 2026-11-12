# MangaReader — Production Readiness Report

- **Ngày audit (lượt 1)**: 2026-11-12 — commit `ce8651ff7d07c101904e0cb9e7f1851016ceb1a4`
- **Ngày rà soát độc lập (lượt 2)**: 2026-11-12 — commit `4346b1aa604052430b1ba3dd210ae07ad5380c9c`
- **Ngày rà soát cuối (lượt 3 — API key & session security)**: 2026-11-12 — commit mới nhất trên `audit/mangareader-production-hardening` (xem §9 cuối báo cáo)
- **Branch**: `audit/mangareader-production-hardening` (tách từ main `18bd3ee3702d82f8f7d83c252603caf71723ba87`)
- **Repository**: `https://github.com/vanhoi04082006-pixel/MangaReader` (giữ nguyên private + history — xem `docs/MANGAREADER_RENAME_REPORT.md`)
- **Phạm vi thay đổi so với main `18bd3ee`**: số liệu `git diff --stat` thực tế được ghi lại ở §9 (lượt 1 ghi 57 file/+1591 là số liệu giữa chừng, đã hiệu chỉnh lượt 2). Lượt 2 thay đổi 21 file, +1629/−141 so với `ce8651f`; lượt 3 thay đổi 14 file so với `4346b1a` (chi tiết §9).
- Không redesign UI, không viết lại module đang chạy đúng, không xóa tính năng, không reset dữ liệu, không xóa object R2 thật nào trong quá trình kiểm thử. `main` không bị thay đổi.

---

## 1. Executive Summary

**Trạng thái tổng thể: SẴN SÀNG VỀ MÃ NGUỒN — CÒN BƯỚC BÊN NGOÀI (BLOCKED) trước khi Production Ready**. Lượt 3 (rà soát cuối, tập trung API key & session security) sửa 4 vấn đề của lượt trước — quan trọng nhất: **hợp đồng header cho key Supabase thế hệ mới** (`sb_publishable_`/`sb_secret_` không phải JWT — không được gửi làm Bearer) và **xác minh session uy quyền** (`auth.sessions`) cho thao tác phá hủy — cùng 2 vấn đề vận hành (đường dẫn SQLite trên Windows, cleanup của script verify-rls). Bộ test nâng lên **114 test (60 unit + 54 integration), tất cả PASS trên môi trường thật** (SQLite + Supabase Auth thật + R2 thật, chạy `bun test tests/` một lần — đã sửa lỗi rò rỉ env giữa các file test).

### Tóm tắt 3 lượt

| Mức | Lượt 1 (đã sửa) | Lượt 2 phát hiện thêm | Lượt 3 phát hiện thêm | Lượt 3 đã sửa |
|---|---|---|---|---|
| CRITICAL | 5 | 1 (ADMIN_USER_ID không bắt buộc) | 1 (key Supabase mới sb_* vẫn gửi làm Bearer — sai hợp đồng tài liệu) | 1 |
| HIGH | 7 | 3 (logout access hết hạn; ADMIN_PASSWORD readiness; proxy stream 100MB) | 2 (session revoked chưa kiểm auth.sessions uy quyền; migration resolve SQLite theo CWD — Windows mở sai file) | 2 |
| MEDIUM | 6 (5 sửa, 1 BLOCKED) | 1 (thiếu tool chuyển dữ liệu) | 1 (verify-rls process.exit bỏ qua cleanup) | 1 |
| LOW | 4 | 1 (verify-rls apikey/bearer lẫn) | 1 (rò rỉ env giữa các file test khi `bun test tests/`) | 1 |

**BLOCKED (ngoài tầm môi trường này — cần chủ sở hữu)**: áp `0001_init.sql` cho Supabase production DB → sau đó chạy `bun run verify:rls` (Phase A kiểm tra key đã PASS thật ngay bây giờ — xem S23; phần RLS cần bảng) và `bun run db:migrate:sqlite-to-postgres --apply` (2 script tự chặn an toàn khi migration chưa áp).

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
| **Tương thích key Supabase (mới sb_* + legacy JWT)** | **PASS** [IT thật] | verify-rls Phase A chạy thật trên project: A1 publishable key được chấp nhận KHÔNG cần Bearer; A2 secret key được chấp nhận KHÔNG cần Bearer; A3 secret key nhận diện đặc quyền (admin API 200, chỉ apikey); A4 key sai → 401 gateway; A5 user JWT rác bị từ chối (GoTrue 403 + PostgREST 401). Toàn bộ 54 integration test chạy qua stack mới (S23) | Không |
| Branding MangaReader | **PASS** [SR] | grep 0 kết quả cũ (trừ định danh cố ý giữ — rename report); browser check | Không |
| Authentication | **PASS** [IT] | Sai mật khẩu 401, non-admin 403, admin 200 + httpOnly cookie; local provider bị từ chối trong production [UT] | Không |
| Authorization (admin-only + UUID pinning) | **PASS** [UT+IT] | User Supabase thật thứ 2 → 403 trên 7 endpoint; Bearer trực tiếp 403; **ADMIN_USER_ID bắt buộc trong production — thiếu/malformed → fail closed (không còn email-only)** [UT: 9 test]; readiness báo cáo thiếu/sai UUID | Không |
| Session security & logout revocation | **PASS** [IT + cross-runtime] | 6 kịch bản logout thật (lượt 2) + **lượt 3: replay access token trong TIỂN TRÌNH BUN RIÊNG (heap/globalThis riêng) sau logout → bị Supabase từ chối (401/403) — chứng minh revocation là SERVER-SIDE, không phải cache local**; token revoked → DELETE manga/cleanup/mutation thường đều 401; JWT rác 401; RT đã tiêu thụ → refresh 400/401; session đang sống → mutation 201 (test 8b.0–8b.6) | auth.sessions runtime check = BLOCKED (cần DATABASE_URL PostgreSQL — xem S24) |
| CSRF | **PASS** [UT+IT] | Origin cross-site 403, thiếu Origin/Referer 403, Referer giả 403, same-origin qua; Sec-Fetch-Site chặn; presigned PUT không ảnh hưởng | Không |
| Rate limiting | **PASS** [IT] | Brute-force → 429; DB-backed (SQLite/PG) — Vercel-compatible; fail-open có log khi DB lỗi | Không |
| RLS | **Phase A PASS / Phase C BLOCKED** [IT thật + BL] | Phase A (không cần bảng) chạy thật: key hợp lệ PASS, key sai 401, JWT rác bị từ chối. Phase C (cần bảng): `mangas` chưa tồn tại (PGRST205) → script thoát 2 (BLOCKED) với hướng dẫn, KHÔNG đánh giá RLS trên bảng không tồn tại, KHÔNG coi lỗi gateway 401 là bằng chứng RLS | **Chủ sở hữu chạy 0001_init.sql rồi chạy verify:rls** |
| Database schema (SQLite) | **PASS** [IT] | `db push` additive; dữ liệu dev cũ nguyên vẹn (One Piece 1 chương/5 trang) | Không |
| **Đường dẫn SQLite (Windows/CWD)** | **PASS** [UT+IT] | 13 unit test (tương đối/tuyệt đối/Windows 2 kiểu/UNC/query param/thiếu file — KHÔNG tự tạo file); dry-run chạy thật từ repo root + từ CWD khác → mở ĐÚNG cùng một file (resolve theo thư mục schema, giống Prisma); file thiếu → lỗi rõ ràng exit 1 (S25) | Kiểm trên Windows thật (không có máy Windows trong môi trường này — logic đã unit-test đầy đủ) |
| PostgreSQL migration (schema) | **PASS** [SR] + **[BL]** áp thật | `schema.postgres.prisma` map 1-1 SQL 0001 (12 bảng); `prisma validate`/generate OK | Áp thật = BLOCKED |
| **Chuyển dữ liệu SQLite→PostgreSQL** | **PASS (tool, dry-run)** [IT-R2] + **[BL]** apply | `bun run db:migrate:sqlite-to-postgres` chạy thật dry-run (từ 2 CWD khác nhau — cùng file nguồn đúng): đọc đủ 10 bảng, validate UUID/timestamp/FK, xác minh bảng Prisma kỳ vọng, kế hoạch in rõ; tự BLOCK khi bảng đích chưa tạo. `--skip-test-data` loại đúng manga `[TEST-AUDIT]` leftover | Apply thật (cần migration + backup + chủ sở hữu) |
| Cloudflare R2 | **PASS** [IT] | Roundtrip presign PUT/GET/delete thật; bucket private; URL ký có hạn | Không |
| Upload proxy (cap 4MB khi stream) | **PASS** [IT] | 8 test thật: đúng bằng cap 4MB → 200; khai báo nhỏ + body vượt cap → **413 proxy_too_large ngay khi vượt 4MB + KHÔNG có object trên R2 (finalize → r2_verify_failed)**; key CONFIRMED → 409 not_pending; stream đứt giữa chừng → không tạo object; không Content-Length → 200 (đếm byte thật); MIME sai 400; key lạ 400 | Không |
| ZIP security | **PASS** [UT] | Chặn entry giải nén >100MB, 3000 entry, lọc file hệ thống | Không |
| Data integrity (DB↔R2) | **PASS** [IT] | Finalize sai kích thước bị chặn (DB + HeadObject); xóa truyện đồng bộ R2; abort không xóa CONFIRMED; DELETE_PENDING retry | Không |
| **Cleanup của script verify-rls** | **PASS** [UT] | 7 unit test với fetch mock: grant fail / RLS assertion fail / cleanup lỗi / thiếu env — cleanup LUÔN chạy, chỉ xóa ID do script tạo, exit code trả sau cleanup (S26) | Chạy thật toàn bộ Phase C cần bảng (BLOCKED) |
| Vercel compatibility | **PASS** [SR+IT] | `bun run build` thành công; proxy giới hạn 4MB < 4.5MB body Vercel; rate limit DB-backed | Deploy thật do chủ sở hữu |
| Performance | **PASS** [SR + đo nhẹ] | Index/phân trang/lazy-load (xem lượt 1 §6) | Benchmark 100k trang chưa chạy |
| Testing | **PASS** | **114/114 test** (60 unit + 54 integration) chạy `bun test tests/` MỘT LẦN trên môi trường thật (đã sửa rò rỉ env giữa file test — S27); `bun run lint` sạch; `bun run typecheck` 0 lỗi; `bun run build` OK | Không |
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
- **Lượt 3**: hoàn thiện tiếp theo hướng S23 (header contract theo key mới) + S26 (cleanup không bao giờ bị process.exit bỏ qua).

---

## 3C. Security Findings lượt 3 (rà soát cuối — API key & session security)

### S23 — CRITICAL · Key Supabase thế hệ mới (sb_*) vẫn được gửi làm `Authorization: Bearer` (fixed)
- **File**: `src/lib/supabase-keys.ts` (**MỚI** — hợp đồng header chuẩn), `src/lib/supabase-auth.ts`, `scripts/verify-rls.ts`, `scripts/migrate-sqlite-to-postgres.ts`, `tests/integration.test.ts`, `.env.example`
- **Root cause (lượt 1–2 sót)**: mọi chỗ gọi Supabase (app + cả 2 script) gửi `Authorization: Bearer <API key>`. Hợp đồng tài liệu Supabase (API keys) cho thế hệ key mới:
  - `sb_publishable_...` / `sb_secret_...` là **opaque token, KHÔNG phải JWT** → chỉ gửi ở header `apikey`; **không** gửi làm Bearer (Bearer dành cho access token JWT của user).
  - Key legacy (`anon`/`service_role` JWT, `eyJ...`) → gửi **cả hai** header (semantics cũ).
  - Request user đã xác thực: `apikey` = publishable key + `Authorization: Bearer` = access token JWT **thật**.
  Gateway hiện tại vẫn khoan dung khi nhận sb_* làm Bearer (đó là lý do 82 test lượt 2 vẫn PASS) — nhưng đó không phải hợp đồng đã tài liệu hóa; phụ thuộc hành vi chưa-tài-liệu là rủi ro tương thích.
- **Fix**:
  - Module chuẩn `src/lib/supabase-keys.ts`: `detectSupabaseKeyFormat()` (prefix `sb_publishable_`/`sb_secret_` vs JWT `eyJ`+3 đoạn — **không in giá trị key khi detect**); `supabaseAnonHeaders(PK)` (key mới → chỉ apikey; legacy → apikey + Bearer); `supabaseServiceHeaders(SK)` (như vậy với secret key); `supabaseUserHeaders(PK, AT)` (apikey PK + Bearer access token).
  - `src/lib/supabase-auth.ts`: password/refresh grant → anon headers; admin API (tìm/tạo user) → service headers; `/auth/v1/user` + logout revoke → user headers. Sửa lỗi ngược dấu tham số `post(..., privileged)` phát hiện khi refactor (mỗi endpoint được review lại đúng hướng).
  - `scripts/verify-rls.ts`: Phase A kiểm tra **chính hợp đồng này** (A1–A5); Phase B/C dùng header helpers; non-admin = PK + access token thật.
  - `scripts/migrate-sqlite-to-postgres.ts`: `pg()`, `pgCount()`, xác minh profile (admin API) — tất cả qua service headers.
  - `tests/integration.test.ts`: các lời gọi Supabase trực tiếp dùng header helpers.
  - `.env.example`: tài liệu hóa 2 thế hệ key.
- **Test [IT thật]** (verify-rls Phase A, chạy trên project thật trước cả khi có bảng): **A1** publishable key được chấp nhận KHÔNG Bearer; **A2** secret key được chấp nhận KHÔNG Bearer; **A3** secret key được nhận diện đặc quyền (`GET /auth/v1/admin/users?per_page=1` → 200 chỉ với apikey); **A4** key sai → 401 "Invalid API key" (gateway có xác thực key); **A5a/b** user JWT rác bị GoTrue (403 `bad_jwt`) và PostgREST (401) từ chối. **[UT]** 6 test header contract (key mới không Bearer; legacy đủ 2 header; user = PK + Bearer AT cho cả 2 thế hệ). Toàn bộ 54 integration test (login/logout/upload thật) chạy qua stack mới.

### S24 — HIGH · Xác minh session sau logout chưa kiểm tra uy quyền `auth.sessions` (fixed — runtime check = BLOCKED theo chủ đích)
- **File**: `src/lib/session-verify.ts` (**MỚI**), `src/lib/session.ts`, `src/lib/api.ts`, `src/app/api/auth/logout/route.ts` (bình luận trung thực), `tests/integration.test.ts` (section 8b)
- **Root cause (lượt 2 sót)**: lượt 2 dựa vào `GET /auth/v1/user` cho xác minh strict. Trên project này GoTrue hiện đại **có** kiểm tra claim `session_id` (bằng chứng thật: replay sau logout → 403 `session_not_found`), nhưng theo tài liệu Supabase access-token JWT **có thể vẫn còn hiệu lực đến khi hết hạn sau sign-out trên một số deployment** — không nên giả định cho mọi deployment. Tài liệu khuyến nghị kiểm tra `session_id` của token against bảng `auth.sessions` cho đảm bảo mạnh hơn.
- **Fix** (`src/lib/session-verify.ts` + `getSessionUserStrict`):
  1. Trích claim `session_id` từ JWT payload (chỉ trích — **identity vẫn đến từ /auth/v1/user đã xác thực**, không tin payload tự khai).
  2. Truy vấn `auth.sessions` qua **Prisma postgres role** (tagged template `$queryRaw` — tham số hóa, không ghép chuỗi), **KHÔNG qua PostgREST công khai** (không expose `auth.sessions`).
  3. Đánh giá: row bị xóa (GoTrue xóa khi logout) / `user_id` không khớp / `not_after` hết hạn → **inactive** → từ chối. Lỗi truy vấn / thiếu claim → **unavailable** → **TỪ CHỐI (fail closed)**.
  4. Dev trên SQLite: không có schema `auth` → bỏ lớp 2 (tài liệu hóa rõ); production + SQLite (cấu hình sai) → fail closed.
  5. Áp dụng cho thao tác **high-impact** qua `requireAdminDestructive` (DELETE manga/chapter/page, POST cleanup) — nhất quán, không áp cho mọi request (tải không cần thiết).
  6. **Không tuyên bố** xóa cache globalThis = revoke trên mọi instance Vercel — comment mã nguồn + báo cáo này ghi rõ giới hạn (cache 90s chỉ trên instance xử lý logout; route destructive không dùng cache).
- **Cửa sổ hiệu lực còn lại (ghi trung thực)**: các route KHÔNG strict (đọc thường, mutation thường — có cache xác minh 90s theo instance): access token đã revoke nhưng chưa hết hạn có thể được chấp nhận **tối đa 90s** trên instance khác instance xử lý logout. Ranh giới thật do Supabase quản lý (hết hạn JWT ~1h). Route destructive không có cửa sổ này.
- **Test [IT]** (section 8b mới, 7 test chạy thật): baseline — token hợp lệ ở **tiến trình bun RIÊNG** (heap/globalThis riêng) → 200; logout → replay ở tiến trình riêng → 401/403 (**chứng minh revocation là server-side tại Supabase — không thể là cache local**); token revoked → DELETE manga 401 (auth trước 404), cleanup 401, mutation thường 401; JWT rác 401; RT đã tiêu thụ (logout refresh-then-revoke) → refresh 400/401; session đang sống → tạo + xóa truyện 201/200.
- **Phát hiện phụ (thăm dò thật trên project)**: replay refresh token **đã qua rotation** mà KHÔNG logout vẫn được cấp session mới sau >12s — Supabase không bật phát-hiện-tái-sử-dụng nghiêm ngặt trên project này (reuse interval/mỗi cấu hình). Enforcement boundary thực tế là **logout revocation** (đã chứng minh). Ghi nhận để chủ sở hữu biết; không thay đổi mã nguồn (hành vi phía dịch vụ Supabase).
- **Trạng thái runtime auth.sessions**: **BLOCKED** — cần `DATABASE_URL` PostgreSQL (sau khi chủ sở hữu áp migration + cấu hình production) mới xác minh chạy thật được. Logic đã unit-test; khi chạy production, mọi lỗi truy vấn → fail closed (không phải fail-open).

### S25 — HIGH · Migration tool resolve đường dẫn SQLite theo CWD — Windows có thể mở SAI file (fixed)
- **File**: `src/lib/sqlite-url.ts` (**MỚI**), `scripts/migrate-sqlite-to-postgres.ts`, `tests/integration.test.ts` (beforeAll), `.env.example`
- **Root cause (lượt 2 sót)**: `DATABASE_URL=file:../db/custom.db` bị strip `file:` rồi đưa thẳng cho `bun:sqlite` — resolve theo **CWD**, trong khi Prisma client resolve tương đối theo **thư mục chứa schema** (`prisma/`). Chạy tool từ thư mục khác → mở sai file (hoặc file rỗng mới — bun:sqlite mặc định tạo file). Trên Windows đường dẫn tương đối/ổ đĩa dễ lệch nữa.
- **Fix**:
  - `resolveSqliteFile()` (pure + unit-test được): hỗ trợ **tuyệt đối POSIX** (`file:/abs/...`), **ổ đĩa Windows** (`file:C:\...` | `file:C:/...`), **UNC** (`file:\\server\share` | `file://srv/sh`), **tương đối** (resolve theo thư mục schema — cùng gốc với Prisma), **query parameter tách an toàn** (`?connection_limit=1` không lẫn vào path); URL rỗng/thiếu `file:`/thiếu path → **lỗi rõ ràng**.
  - **Không bao giờ tự tạo file mới**: kiểm tra tồn tại trước khi mở (readonly) — thiếu → lỗi kèm đường dẫn đã resolve + hướng dẫn.
  - Script còn **xác minh 10 bảng Prisma kỳ vọng** tồn tại (sqlite_master) trước khi đọc — file SQLite lạ/rỗng → dừng với danh sách bảng thiếu (chống migrate từ DB sai).
  - `loadEnv` đọc `.env` ở **gốc repo** (qua `import.meta.dir`) — chạy từ CWD nào cũng đúng; in rõ đường dẫn nguồn đã resolve.
- **Test [UT]** (13 test): tương đối (3 dạng), tuyệt đối POSIX, Windows 2 kiểu, UNC 2 kiểu, query param, rỗng/thiếu prefix/thiếu path, file thiếu (KHÔNG tạo + lỗi rõ), file tồn tại. **[IT]**: dry-run chạy thật **từ repo root** và **từ CWD khác** (`/home/z/probe`) → mở đúng cùng một file `db/custom.db` (resolve theo `prisma/`, không theo CWD); file thiếu → exit 1 + không tạo file mới trong CWD.

### S26 — MEDIUM · verify-rls: `process.exit()` trong khối try/finally bỏ qua cleanup (fixed)
- **File**: `scripts/verify-rls.ts` (viết lại luồng điều khiển)
- **Root cause (lượt 2 sót)**: `process.exit()` chấm dứt tiến trình **ngay lập tức không unwinding** — khối `finally` không chạy. Các nhánh exit(1) nằm TRONG try sau khi đã tạo user tạm/dòng manga test (password grant fail, `/auth/v1/user` fail, PostgREST không phản hồi, assertion RLS fail, request treo) → có thể bỏ lại tài nguyên tạm.
- **Fix**:
  - Toàn bộ luồng dùng `throw VerifyError` (mã 1 FAIL / 2 BLOCKED); **cleanup trong `finally`** luôn chạy; **exit code chỉ trả SAU khi cleanup xong** (0 PASS / 1 FAIL hoặc cleanup lỗi / 2 BLOCKED).
  - Mọi request có timeout 30s (treo → throw → cleanup). Mỗi bước cleanup bọc try/catch riêng, lỗi được in rõ (`CLEANUP FAILED` + cách xóa tay) và ép exit code 1.
  - Cleanup chỉ xóa **ID cụ thể do script tạo**: user Supabase tạm, dòng manga seed, các manga/app_config **thử** insert (kể cả khi RLS hỏng và dòng thật sự được tạo — xóa phòng thủ); không đụng dữ liệu ứng dụng thật.
  - Script chỉ tự chạy khi `import.meta.main` — import an toàn cho unit test (`runVerification({ env, fetchImpl })` inject được).
- **Test [UT]** (7 test với fetch mock — bao phủ đúng các kịch bản yêu cầu): happy path exit 0 + cleanup xóa user/manga; **header contract** (không request nào gửi key mới làm Bearer; request user có Bearer access token); PK sai → exit 2 + **không tạo tài nguyên nào**; bảng thiếu → exit 2 + không tạo user; **password grant fail (sau khi tạo user) → exit 1 + cleanup VẪN xóa user tạm**; RLS assertion fail → exit 1 + cleanup xóa đủ (user + seed + attempted IDs, chỉ xóa ID dài do script sinh); cleanup lỗi (DELETE 500) → exit 1; thiếu env → exit 2 + không gọi mạng.

### S27 — LOW · Rò rỉ biến env giữa các file test khi chạy `bun test tests/` (fixed)
- **File**: `tests/unit.test.ts`
- **Root cause**: bun chạy nhiều file test trong **cùng một process** (load file → chạy → load file kế tiếp). Các unit test lượt 1–2 chỉnh `process.env` (đặt `ADMIN_EMAIL`, xóa `ADMIN_PASSWORD`, đổi `NODE_ENV`...) và **không hoàn nguyên** — file integration load sau nhận env bẩn. Triệu chứng thật: chạy `bun test tests/` → toàn bộ integration fail giả (403 forbidden_account vì ADMIN_EMAIL bị unit test ghi đè); chạy riêng từng file thì PASS — lỗi tiềm ẩn từ lượt 2 không ai để ý.
- **Fix**: snapshot `process.env` khi load file unit + `afterAll` hoàn nguyên nguyên trạng. Bằng chứng: `bun test tests/` một lệnh → **114/114 PASS**.


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
| 2 | Sau (1): chạy `bun run verify:rls` — **Phase A (key Supabase) đã chạy thật PASS ngay bây giờ** (S23); phần RLS (Phase C) sẽ chạy sau khi có bảng | Phần RLS phụ thuộc (1). Script tự chặn an toàn (exit 2 BLOCKED) khi bảng chưa có |
| 3 | Sau (1): quyết định dữ liệu SQLite (S21): giữ hết, hay bỏ manga `[TEST-AUDIT]` leftover (xóa qua app hoặc `--skip-test-data`), rồi `bun run db:migrate:sqlite-to-postgres --apply` (sau khi backup) | Apply thật cần backup + xác nhận của chủ sở hữu |
| 4 | Cấu hình **CORS bucket R2** qua Cloudflare Dashboard | Token chỉ có quyền object |
| 5 | Deploy Vercel (Build `bun run db:generate:pg && bun run build`); sau deploy xác minh `auth.sessions` runtime (S24) hoạt động — mọi lỗi truy vấn sẽ fail closed (ghi log `[session-verify]`) | Không có quyền Vercel project / DATABASE_URL production |
| 6 | **Xoay vòng GitHub token** đã dán trong chat + rà soát Supabase/R2 keys | Bảo mật hygiene |
| 7 | Sau bootstrap: đổi mật khẩu admin tại Supabase + xóa `ADMIN_PASSWORD` khỏi env production (readiness KHÔNG đòi hỏi — S20) | Vận hành |

## 8. Kết quả lượt 2

- 5 phát hiện mới (1 CRITICAL, 3 HIGH, 1 MEDIUM + 1 LOW) — **tất cả đã sửa và kiểm chứng**.
- Bộ test: **59 → 82** (+13 unit, +10 integration), **82/82 PASS** trên môi trường thật; lint sạch; typecheck 0 lỗi; production build OK.
- Số liệu diff đã hiệu chỉnh từ Git (không sao chép số cũ): 69 file / +4798/−588 so với main.
- Trạng thái cuối: **NOT YET PRODUCTION READY — EXTERNAL BLOCKERS REMAIN** (§7: mục 1–5). Mã nguồn đã sẵn sàng; khi chủ sở hữu hoàn thành (1)+(2) và verify-rls PASS thật, (3) nếu cần giữ dữ liệu, (4)–(5) triển khai → PRODUCTION READY.

## 9. Kết quả lượt 3 (rà soát cuối — API key & session security)

### 9.1 Nhận diện & sửa

4 vấn đề chính (theo nhiệm vụ) + 1 phát hiện phụ, **tất cả đã sửa**:

| # | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| S23 | CRITICAL | Key Supabase mới (sb_*) được gửi làm Bearer — sai hợp đồng tài liệu | **FIXED** — module chuẩn `supabase-keys.ts`, toàn bộ app + script + test dùng đúng hợp đồng; Phase A verify-rls chạy thật PASS |
| S24 | HIGH | Session revoked chưa được kiểm tra uy quyền `auth.sessions` | **FIXED** (logic + unit test + 7 integration test cross-runtime) — **runtime trên PostgreSQL = BLOCKED** chờ chủ sở hữu (S24) |
| S25 | HIGH | Migration resolve SQLite theo CWD (Windows mở sai file / tự tạo file rỗng) | **FIXED** — resolve theo thư mục schema Prisma + đủ loại đường dẫn + không tự tạo file + xác minh bảng |
| S26 | MEDIUM | verify-rls: process.exit bỏ qua cleanup | **FIXED** — throw + finally + exit code sau cleanup + 7 unit test mock |
| S27 | LOW | Rò rỉ env giữa file test khi `bun test tests/` (phát hiện phụ) | **FIXED** — snapshot/hoàn nguyên env |

### 9.2 Bằng chứng kiểm thử (tách rõ static vs chạy thật)

| Loại | Kết quả | Chi tiết |
|---|---|---|
| `bun run lint` | **PASS** | ESLint sạch |
| `bun run typecheck` | **PASS** | tsc --noEmit 0 lỗi |
| `bun test tests/` (một lệnh, 2 file) | **114/114 PASS** | 60 unit + 54 integration (47 lượt 2 + **7 mới section 8b**); chạy trên dev server audit (port 3001) + **Supabase Auth thật + R2 thật + SQLite thật** |
| `bun run build` | **PASS** | Next build + standalone OK |
| `bun run scripts/verify-rls.ts` (chạy thật) | **Phase A PASS / Phase C BLOCKED (exit 2)** | A1–A5 PASS trên project thật (hợp đồng key mới); Phase C tự chặn đúng vì bảng chưa tồn tại — KHÔNG PASS giả |
| `bun run db:migrate:sqlite-to-postgres` (dry-run thật) | **PASS tới bước BLOCKED (exit 2)** | Từ repo root + từ CWD khác → cùng đúng 1 file SQLite (10/10 bảng Prisma); bảng đích chưa có → chặn đúng |
| Unit test mới lượt 3 | **25 test PASS** | 6 header contract + 13 sqlite-url + 3 session-verify decode + 1 usesPostgresDatabase + 7 verify-rls control flow (trùng bộ đếm ở trên) |
| auth.sessions runtime | **BLOCKED** | Cần DATABASE_URL PostgreSQL (sau migration + deploy) — không có trong môi trường này; logic fail-closed đã unit-test |

**Ghi chú về môi trường test**: integration test lượt 3 chạy với **tài khoản admin tạm** (`mangareader-itest-admin+…`, tạo + xóa qua Admin API trong phiên test) vì sandbox không có mật khẩu admin thật và **tuyệt đối không reset mật khẩu chủ sở hữu**. Toàn bộ cơ chế pinning (ADMIN_EMAIL + ADMIN_USER_ID khớp UUID user tạm) được exercise đúng như production. Tài khoản thật `admin@manga.vn` (UUID `7228d6e8-…`) **không bị ảnh hưởng** — đã kiểm kê Auth sau test: chỉ còn đúng 1 user thật. Test data do suite tự tạo đã tự dọn (manga/chapter/page/R2 object test).

### 9.3 Số liệu Git (tính lại từ `git diff --stat`, không sao chép số cũ)

- So với main `18bd3ee`: **72 file, +6221/−607** (lượt 2: 69 file, +4809/−588).
- Riêng lượt 3 (so với `4346b1a`): **14 file (+3 mới: supabase-keys.ts, session-verify.ts, sqlite-url.ts), +1743/−350** (phần lớn là viết lại verify-rls.ts theo luồng throw/finally + 25 unit test + 7 integration test mới).

### 9.4 Trạng thái cuối

**NOT YET PRODUCTION READY — EXTERNAL BLOCKERS REMAIN** (giữ nguyên kết luận của lượt 2, không tuyên bố PRODUCTION READY khi migration PostgreSQL, verify RLS (Phase C) và deploy Vercel còn blocked — §7).

Mã nguồn giờ **tuân thủ hợp đồng API key Supabase hiện hành** (cả 2 thế hệ key), revocation session có **định nghĩa enforcement chính xác + bằng chứng cross-runtime**, migration tool đọc **đúng DB nguồn trên mọi nền tảng/CWD**, và verify-rls **luôn dọn tài nguyên test của chính nó**.

*Không có dữ liệu thật nào bị reset; không object R2 nào của dữ liệu thật bị xóa; tài khoản admin thật không bị thay đổi; `main` vẫn ở `18bd3ee`.*
