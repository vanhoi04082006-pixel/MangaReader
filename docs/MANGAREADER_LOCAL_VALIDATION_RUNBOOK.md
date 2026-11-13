# Runbook — Clone, CI/CD & Validation trước/sau deploy Vercel

> Tài liệu này là **danh sách việc của owner** sau khi audit branch được merge vào `main`
> (pass 1–5 đã xử lý xong trong repo). Mọi mục "needs validation" từ
> `docs/MANGAREADER_PREVERCEL_AUDIT_NEEDS_VALIDATION.md` được quy về lệnh cụ thể tại đây.
>
> Thứ tự khuyến nghị: §1 (clone + CI) → §2 (blocker ngoài: migration PG) → §3 (integration
> suite) → §4 (5 leads) → §5 (deploy Vercel) → §6 (backlog theo dõi).

---

## 1. Clone repo + hiểu CI/CD đã có

```bash
git clone https://github.com/vanhoi04082006-pixel/MangaReader.git
cd MangaReader
bun install
cp .env.example .env        # điền Supabase + R2 THẬT (xem README mục 4, 5)
bun run db:push             # tạo SQLite dev DB
bun run dev                 # http://localhost:3000
```

### CI đã được cấu hình (`.github/workflows/ci.yml`)

| Job | Nội dung | Bắt buộc? |
|---|---|---|
| `Lint & Typecheck & Unit tests` | ESLint, `tsc --noEmit` (SQLite client), 69 unit test | **Có** (required check) |
| `bun audit (production, critical)` | `bun audit --production --audit-level=critical` — 0 critical mới được merge | **Có** (required check) |
| `Production build (PG client)` | Đúng Build Command Vercel: `db:generate:pg` + typecheck PG + `next build` | **Có** (required check) |
| `Integration (real stack)` | 55 integration test với Supabase + R2 thật | Tùy chọn (mặc định bỏ qua) |

### Quy trình làm việc với branch (branch protection đang bật trên `main`)

1. **Không bao giờ push thẳng vào `main`** — protection chặn (require PR + required checks xanh).
2. Luồng chuẩn:
   ```bash
   git checkout -b feature/ten-tinh-nang
   # ... sửa code ...
   git push -u origin feature/ten-tinh-nang
   # Mở PR trên GitHub -> CI tự chạy
   # CI XANH (3 job bắt buộc) -> mới được bấm Merge
   ```
3. Sau merge, Vercel tự deploy Production từ `main` (cấu hình ở §5).

### Bật integration test trong CI (tùy chọn, làm khi có staging project)

> Test tạo/xóa **user Supabase tạm**, upload object thật lên R2, reset bảng
> `rate_limit_hits` → **tạo riêng STAGING project** (Supabase + R2 bucket riêng),
> tuyệt đối không trỏ vào production.

1. GitHub repo → **Settings → Secrets and variables → Actions**:
   - Tab **Variables** → thêm `ENABLE_INTEGRATION_TESTS` = `true`
   - Tab **Secrets** → thêm 11 secrets (giá trị lấy từ staging project):
     `STG_SUPABASE_URL`, `STG_SUPABASE_PUBLISHABLE_KEY`, `STG_SUPABASE_SERVICE_SECRET_KEY`,
     `STG_ADMIN_EMAIL`, `STG_ADMIN_PASSWORD`, `STG_ADMIN_USER_ID`,
     `STG_R2_ACCOUNT_ID`, `STG_R2_ACCESS_KEY_ID`, `STG_R2_SECRET_ACCESS_KEY`,
     `STG_R2_BUCKET_NAME`, `STG_R2_ENDPOINT`
2. Trên staging (giống production): đã chạy migration SQL (§2) + bootstrap admin.

---

## 2. BLOCKER NGOÀI — áp SQL migration vào PostgreSQL production (làm ĐẦU TIÊN)

Audit các pass trước xác nhận: **`supabase/migrations/0001_init.sql` chưa được chạy trên
PostgreSQL production** — không có bảng thì RLS chưa tồn tại, app (DATABASE_URL trỏ PG)
sẽ không chạy được trên Vercel.

### Bước 2.1 — Backup

Supabase Dashboard → **Database → Backups** (xác nhận có backup daily) hoặc
SQL Editor → Download backup. *(Nếu project mới chưa có dữ liệu: bỏ qua, ghi chú lại.)*

### Bước 2.2 — Chạy migration

Supabase Dashboard → **SQL Editor** → dán toàn bộ nội dung `supabase/migrations/0001_init.sql` → **Run**.

Kết quả kỳ vọng: 12 bảng (`profiles`, `mangas`, `chapters`, `pages`, `genres`,
`manga_genres`, `favorites`, `reading_progress`, `reading_history`, `storage_objects`,
`app_config`, `rate_limit_hits`), RLS enabled admin-only, `app_config.admin_user_id` seeded.

### Bước 2.3 — Bootstrap admin + điền UUID

```bash
bun run scripts/bootstrap-admin.ts
# In ra UUID -> điền ADMIN_USER_ID vào .env (và env Vercel ở §5)
```

### Bước 2.4 — Xác minh RLS (kể cả seed-based storage_objects)

```bash
bun run verify:rls
```

Kỳ vọng: **exit 0, PASS toàn bộ** — anon/non-admin bị từ chối, service key đọc/ghi được,
`storage_objects` được kiểm với dòng seed tạm (script tự dọn). Nếu FAIL: **KHÔNG deploy**,
xem chi tiết lỗi trong output + `docs/MANGAREADER_PREVERCEL_AUDIT_REPORT.md`.

### Bước 2.5 — (Nếu cần giữ dữ liệu dev cũ) Migrate SQLite → PostgreSQL

```bash
# Dry-run: xem kế hoạch, KHÔNG ghi gì
bun run db:migrate:sqlite-to-postgres

# Chỉ khi dry-run sạch + đã backup (2.1):
bun run db:migrate:sqlite-to-postgres --apply
```

> Lưu ý: biến `DATABASE_URL` trong `.env` lúc này phải là connection string PG
> (session pooler) — script đọc từ đó. Sau khi xong, đổi lại `file:../db/custom.db`
> nếu muốn tiếp tục dev với SQLite.

---

## 3. Integration suite trên real stack (55 test)

Sandbox audit không có credential Supabase/R2 thật nên 55 test này **chưa từng chạy
thật** (login test đã cập nhật sang contract 401 mới). Chạy tại máy bạn:

```bash
# Terminal 1 — dev server (SQLite local + Supabase Auth thật + R2 thật trong .env)
bun run dev

# Terminal 2
bun test tests/integration.test.ts
```

Kỳ vọng: **55/55 pass**. Test tự tạo/xóa dữ liệu riêng (manga `__test__` prefix, user
Supabase tạm bị xóa sau test, object R2 test bị xóa đồng bộ) — không chạm dữ liệu thật.

Vấn đề hay gặp:
- **429 "Thao tác quá nhanh"**: bảng rate limit reset trước mỗi lần chạy — nếu vẫn dính,
  xóa row window: `DELETE FROM rate_limit_hits;` (SQLite dev).
- **Thiếu ADMIN_PASSWORD trong .env**: test login cần nó (đây là lần duy nhất biến này
  cần tồn tại ngoài bootstrap).
- **CORS bucket chưa có**: upload presign test vẫn pass (dùng presigned PUT không cần
  CORS cho server-side test), nhưng trình duyệt upload trực tiếp cần CORS (README mục 5).

---

## 4. 5 leads "needs validation" — quy trình từng mục

> Đây là các lead **chưa xác nhận** từ audit (không phải vulnerability đã chứng minh).
> Chi tiết bằng chứng đầy đủ: `docs/MANGAREADER_PREVERCEL_AUDIT_NEEDS_VALIDATION.md`.

### 4.1 refresh CSRF — sibling subdomain

**Câu hỏi**: subdomain anh em cùng registrable domain (cross-origin, cùng site) có dùng
được cookie `SameSite=Lax` để gọi POST `/api/auth/refresh` (rotation cưỡng bức) không?

**Làm tại local** (theo doc):
```
# /etc/hosts (Windows: C:\Windows\System32\drivers\etc\hosts)
127.0.0.1  app.local.test attacker.local.test
```
1. Mở `http://app.local.test:3000` → login admin.
2. Lưu `attacker.html` vào bất kỳ đâu, chạy qua `http://attacker.local.test:3000`*
   hoặc một static server khác cổng:
   ```html
   <script>
     fetch('http://app.local.test:3000/api/auth/refresh', {
       method: 'POST', credentials: 'include'
     }).then(r => r.text()).then(t => console.log('KET QUA:', t));
   </script>
   ```
3. Quan sát: request có mang cookie? (DevTools → Network). Rotation có xảy ra liên tục
   không? Session family có bị GoTrue revoke không (bị đá ra ngoài)?

**Quyết định**: nếu xác nhận được vector → thêm `assertSameOrigin` vào dòng đầu handler
`src/app/api/auth/refresh/route.ts` (đã có sẵn ở login/logout). Trên `*.vercel.app`
(PSL-protected) vector vô hiệu — chỉ bật mức ưu tiên nếu dùng **custom domain** có
subdomain khác chứa nội dung không tin cậy.

### 4.2 assertSameOrigin bỏ qua scheme

**Câu hỏi**: `Origin: http://host` có qua được check khi app chạy `https://host`?

**Kiểm tra DEPLOYMENT (sau khi có domain)**:
```bash
curl -sI http://<ten-mien-cua-ban>/          # kỳ vọng: 301/308 -> https, KHÔNG trả content
curl -sI https://<ten-mien-cua-ban>/ | grep -i strict-transport   # kỳ vọng: có HSTS
```
Vercel mặc định redirect HTTP→HTTPS + repo đã set HSTS header (next.config.ts) →
thường đã thoả. Nếu cả 2 đều đúng + admin dùng trình duyệt hiện đại → ghi nhận "void",
không cần sửa. Nếu tự host: bắt buộc TLS redirect trước khi mở cửa.

### 4.3 abort-vs-finalize race (xóa object R2 vừa confirm)

**Câu hỏi**: abort (xóa R2 object PENDING) đua với finalize (confirm object) có tạo
trạng thái lệch (page trỏ object đã bị xóa) không?

**Làm tại local**: dựng kịch bản concurrent — instrument delay vào R2 DeleteObjects
(`src/lib/r2.ts`, chỉ tạm thời) rồi fire finalize + abort đồng thời cho cùng presigned
key; kiểm tra sau: `finalize 201` nhưng HeadObject(key) 404 / storage row biến mất.

**Fix hai phía khi xác nhận** (thiết kế đã trong doc): (1) abort claim atomically
`PENDING → DELETE_PENDING` bằng `updateMany` trước khi xóa R2; (2) finalize B3 đổi
blind-upsert thành conditional confirm (throw khi row là DELETE_PENDING/thiếu).
**Sau khi fix: chạy lại §3 (55 test) + thêm test interleaving.**

**Kiểm tra nhanh trên production (read-only)**: Storage UI > Audit — đối chiếu mồ côi;
SQL: page rows mà `object_key` không có storage row tương ứng.

### 4.4 profiles RLS — self-insert policy không pin email

**Câu hỏi**: user Supabase thứ 2 (đã xác thực) chèn trước hàng `{uuid_cua_ho, ADMIN_EMAIL}`
vào `profiles` có khóa được admin lần đầu login (P2002 → 409 vĩnh viễn)?

**Điều kiện tiên quyết (làm ngay, giảm rủi ro về 0 trước khi validate)**:
1. **Tắt signup** (nếu chưa): Supabase → Authentication → Sign In / Up → off
   "Allow new users to sign up" — chỉ cần 1 admin duy nhất.
2. **Login admin 1 lần ngay sau khi bootstrap** (§2.3) → ensureProfile upsert nhánh
   update → window chèn tranh bị đóng (hàng profiles của admin đã tồn tại).
3. Kiểm tra Authentication → Users: **không có user lạ** nào ngoài admin
   (dọn các user tạm từ verify-rls/integration nếu còn sót).

**Validate trên STAGING** (làm sau khi có staging project — mô tả đầy đủ trong doc):
tạo user thường → POST `/rest/v1/profiles` với `{id: uuid_cua_ho, email: ADMIN_EMAIL}`
+ Bearer user → kỳ vọng **201** (= lỗ hổng tái hiện được) → sau đó fix policy:

```sql
-- Pin email theo JWT (thay policy self-insert hiện tại)
create policy "profiles self insert" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and email = auth.jwt() ->> 'email');
```
Chạy trên **staging trước**, verify-rls lại (§2.4), rồi mới áp production.

### 4.5 Caddyfile XTransformPort (chỉ ảnh hưởng self-host, KHÔNG ảnh hưởng Vercel)

Đây là scaffolding của sandbox preview (Caddyfile + `.zscripts/`). Vercel deploy
không bao giờ chạy các file này → **không làm gì cho deployment Vercel**.

**Ghi nhớ**: nếu sau này tự host branch này → **xóa Caddyfile + `.zscripts/`** khỏi
bản deploy hoặc đổi matcher `XTransformPort` thành allowlist cổng tường minh.
Kiểm chứng local (nếu tò mò): chạy 2 dummy server loopback + copy Caddyfile sang cổng
thử → `curl 'http://127.0.0.1:8081/?XTransformPort=9999'` → thấy marker của server 9999
chứng minh ranh giới loopback bị vượt.

---

## 5. Deploy Vercel — checklist

**Trước khi bấm deploy (đã xong trong repo này):**
- [x] CI xanh trên PR merge vào `main` (3 required checks)
- [x] `bun audit --production --audit-level=critical` = 0 critical (job CI)
- [x] README §7 sửa: env production **KHÔNG chứa `ADMIN_PASSWORD`**; chạy `bun audit`
      trước khi promote (đã là job CI bắt buộc)

**Bạn làm:**
1. Vercel → Add New Project → import `vanhoi04082006-pixel/MangaReader`
   - Framework: Next.js (tự nhận)
   - **Build Command**: `bun run db:generate:pg && bun run build`
   - Production branch: `main` (mặc định)
2. **Environment Variables (Production)** — đúng danh sách, **KHÔNG có `ADMIN_PASSWORD`**
   (chi tiết từng biến: README §7.2): `DATABASE_URL` (session pooler), 3 biến
   `*_SUPABASE_*`, `AUTH_PROVIDER=supabase`, `ADMIN_EMAIL`, `ADMIN_USER_ID`,
   `AUTH_SECRET`, 5 biến `R2_*`, `NEXT_PUBLIC_APP_URL=https://<domain>`
   (+ tùy chọn `R2_ALLOWED_ORIGINS`, `STORAGE_QUOTA_GB`, `SIGNED_URL_EXPIRY_SECONDS`).
3. Điều kiện tiên quyết: §2 đã xong (migration SQL + bootstrap admin + verify-rls PASS).
4. R2 bucket → Settings → CORS Policy: thêm `https://<domain>` (README mục 5) để upload
   trực tiếp file lớn.
5. Deploy xong:
   ```bash
   curl -s https://<domain>/api/health        # {"status":"ok",...}
   # Đăng nhập bằng ADMIN_EMAIL + mật khẩu (Supabase Auth quản lý)
   # Settings > Trạng thái hệ thống: DB + R2 xanh (hoặc GET /api/health/ready)
   ```
6. **Sau login lần đầu thành công**: Supabase Dashboard → Authentication → đổi mật khẩu
   admin (nếu mật khẩu bootstrap yếu) → đảm bảo `ADMIN_PASSWORD` không tồn tại ở bất kỳ
   env nào.

**Rollback**: Vercel → Deployments → bản trước → ... → Promote to Production.
DB/R2 là dữ liệu thật — deploy mới không phá schema (nguồn chân lý là SQL migrations,
chỉ chạy thủ động qua SQL Editor).

---

## 6. Backlog kỹ thuật (không chặn deploy — theo dõi)

| Mục | Chi tiết | Đường xử lý |
|---|---|---|
| `bun audit` 9 high (transitive) | prisma internals (`deepmerge-ts`, `defu`), `postcss`/`nanoid`/`source-map-js` qua next+tailwind (build-time), `lodash` qua recharts (client chart) | Chờ next/tailwind/prisma bump; recharts 3 là major upgrade; chạy `bun audit --production` định kỳ |
| `react-hooks/set-state-in-effect` (7 chỗ) | Rule mới từ eslint-config-next 16.4; đang tắt trong `eslint.config.mjs` | Refactor form dialog theo pattern `key`-reset / state khởi tạo từ props, kèm QA UI thủ công |
| abort-vs-finalize race fix | Lead 4.3 xác nhận thì sửa 2 phía | §4.3 |
| profiles RLS email pin | Lead 4.4 — staging tái hiện thì áp policy mới | §4.4 |
| `next-auth`/`next-intl`/`@mdxeditor`/`react-syntax-highlighter`/`uuid`/`@reactuses/core` | Đã XÓA khỏi dependencies (pass này — không dùng, giảm attack surface + 1 critical next-auth) | — |
| Caddyfile/`.zscripts` | Chỉ dùng cho sandbox preview | Xóa trước khi tự host |

---

## 7. Tóm tắt "hiện trạng sau pass CI/CD"

- `main` = audit branch đã merge, CI xanh (lint/typecheck/69 unit/build/bun-audit-critical).
- Dependencies đã nâng `next` 16.1.3 → **16.4.6** (vá 4 critical RCE trong Image
  Optimization/`use cache`), `zod` → 4.6.7, `sharp` → 0.35.5, `prisma` → 6.19.3;
  xóa 6 dependency không dùng.
- 55 integration test + verify-rls + migration PG: **owner chạy theo §2, §3**.
- 5 leads: **owner validate theo §4** (4.1/4.3/4.4 có thể dẫn tới code fix tiếp theo).
