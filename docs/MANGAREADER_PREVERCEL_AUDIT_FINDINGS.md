# FINDINGS DETAIL — Confirmed records (medium+)

## finalizePages B4 destroys still-referenced R2 page objects when a finalize batch moves an existing page key to a new page number

**Fingerprint**: src/services/chapter-service.ts/finalizePages.B4.replacedOldKeys-without-reference-recheck
**Severity**: medium (likelihood low — admin-only, never emitted by the bundled UI; impact high — irreversible destruction of live data)
**Confidence**: high — deterministic sequential control flow, independently re-verified line-by-line at c603367 with no preventing layer found.

### Ordered source path

1. **entrypoint** `src/app/api/chapters/[id]/pages/route.ts:29` — POST /api/chapters/:id/pages. requireAdminDestructive passes for the single admin; pagesFinalizeSchema validates 1..3000 pages (objectKey ≤500 chars, pageNumber 1..100000, mime enum, fileSize ≤100MB); route param chapterId overrides any body value.
2. **propagation** `src/services/chapter-service.ts:247` — B1 admits an already-CONFIRMED PAGE StorageObject row bound to this exact manga+chapter (kind :259, binding :263, only DELETE_PENDING rejected :267, fileSize :271 / mime :274 must echo the registered row, namespace prefix :277). An existing live page key is therefore a legal finalize input.
3. **propagation** `src/services/chapter-service.ts:303` — pre-transaction snapshot: existing page rows for the batch's pageNumbers are read; :309-313 build `replacedOldKeys` = for each submitted page, the old objectKey at that page number when it differs from the submitted key — **no exclusion of keys re-referenced elsewhere in the same batch**.
4. **propagation** `src/services/chapter-service.ts:316` — B3 transaction: in input order, upsert page 1 to new key K (releasing old key J), then create page 2 with objectKey J (Page.objectKey @unique satisfied because J was just released), re-confirm J's storage row; commit — the chapter legitimately references J at page 2.
5. **sink** `src/services/chapter-service.ts:373` — B4: replacedOldKeys=[J] — still referenced by the just-committed page 2 — is marked DELETE_PENDING (:374-377), deleted from R2 via safeDeleteObjects (:378), and its storage_objects row removed via removeMetadataIfDeleted (:379). Handler returns 201 with pageCount.

### Dummy principals and resources

- Principal: the authenticated single admin (the only mutation principal; or any holder of a live admin session).
- Affected dummy resource: manga M / chapter C with one finalized page (chapter C, pageNumber 1, objectKey J, StorageObject row J CONFIRMED, object present on R2) plus a second presigned+uploaded key K for chapter C.

### Native input and exact bounded reproduction (source-level; this run is source-only)

```
POST /api/chapters/<C>/pages
{"chapterId":"<C>","pages":[
  {"objectKey":"mangas/<M>/chapters/<C>/p0001-newkey01.jpg","pageNumber":1,"fileName":"replace.jpg","mimeType":"image/jpeg","fileSize":123456},
  {"objectKey":"mangas/<M>/chapters/<C>/p0001-oldkey01.jpg","pageNumber":2,"fileName":"moved.jpg","mimeType":"image/jpeg","fileSize":234567}
]}
```
where `p0001-oldkey01.jpg` is the EXISTING page-1 object (fileSize/mimeType copied from GET /api/chapters/<C>/pages) and `p0001-newkey01.jpg` is a freshly presigned+uploaded key. Renumber/shift amplification: `[{K_new,1},{J1,2},{J2,3},{J3,4}]` inserts a new page at the front and destroys every shifted old key J1..J3 while pages 2..4 reference them.

### Observed result and the invariant it violates

The request returns 201 Created with the new page count; the committed page row references objectKey J; safeDeleteObjects reports J in deletedKeys so the R2 object is destroyed and removeMetadataIfDeleted deletes the storage_objects row. The reader payload presigns J and R2 answers 404 — the page is permanently broken with no error surfaced at finalize time. If the R2 delete transiently fails, J is left DELETE_PENDING while referenced and POST /api/storage/cleanup mode=failed (retryFailedDeletions — no reference check) later completes the destruction; the orphan audit does not flag it while referenced. Invariant violated: the module's own DB<->R2 integrity contract ("the old object only becomes an orphan when nothing references it") — every sibling deletion path (setMangaCover re-checks db.page; cleanupOrphanKeys re-checks db.page + db.manga.coverImageKey) enforces the reference re-check that B4 lacks.

### Conditions and containment

Admin-only (requireAdminDestructive; anonymous 401, non-admin 403); requires an existing CONFIRMED/PENDING chapter-bound PAGE key re-referenced at a new page number in ascending order; R2 deletion irreversible in-app. Not reachable by any lower-trust principal; the bundled UI (upload-view.tsx:518) submits only freshly presigned keys, so the pattern is API-reachable but never UI-emitted.

### Source-level remediation and regression case

```ts
// ---- B4: Cleanup object bi thay the (ngoai transaction — safe) ----
// CHI xoa key khong con duoc tham chieu SAU B3:
// (a) loai key duoc dung lai trong chinh batch nay (move/renumber);
// (b) re-check tham chieu page sau transaction (siblings: setMangaCover,
//     cleanupOrphanKeys deu re-check truoc khi safe-delete).
const batchKeys = new Set(input.pages.map((p) => p.objectKey));
const candidates = [...new Set(replacedOldKeys)].filter((k) => !batchKeys.has(k));
if (candidates.length > 0) {
  const stillReferenced = await db.page.findMany({
    where: { objectKey: { in: candidates } },
    select: { objectKey: true },
  });
  const refSet = new Set(stillReferenced.map((r) => r.objectKey));
  const toDelete = candidates.filter((k) => !refSet.has(k));
  if (toDelete.length > 0) {
    await db.storageObject.updateMany({
      where: { objectKey: { in: toDelete }, status: { in: ["PENDING", "CONFIRMED"] } },
      data: { status: "DELETE_PENDING" },
    }).catch(() => undefined);
    const result = await safeDeleteObjects(toDelete);
    await removeMetadataIfDeleted(result.removed).catch(() => undefined);
    if (result.pending.length > 0) {
      console.warn(`[chapter-service] ${result.pending.length} object thay the xoa that bai — DELETE_PENDING retry.`);
    }
  }
}
```

Regression case: with the dummy state above, the move payload must leave J intact (page 2 readable, storage row CONFIRMED) while the classic replace payload (`[{K,1}]` only) must still delete the orphaned old key J. The integration suite's existing finalize tests (upload → finalize → re-finalize with fresh keys) must stay green.

---

# Lower-severity confirmed records (summary; full records in findings.json)

## auth/login.admin-email-enumeration.differential-response (low)

Anonymous POST /api/auth/login: non-admin email → immediate 403 {code:'forbidden_account'} (no Supabase call); admin email + wrong password → 401 {code:'invalid_credentials'} after two Supabase round-trips. Status/code/message/latency all differ → deterministic admin-email enumeration oracle (OWASP WSTG-ATHN-02). The repo's own integration tests assert both arms. Fix: return the identical 401 invalid_credentials response from the early branch (keep the early return — it also keeps non-admin emails out of the bootstrap block); update integration tests :205-212 and :324-329. Direct password brute-force remains capped by the email-keyed bucket.

## src/lib/env.ts:STORAGE_QUOTA_GB-parseInt-NaN-fail-open-quota (low)

parseInt without a NaN guard: STORAGE_QUOTA_GB='unlimited' (or ' ', 'n/a') → storageQuotaBytes NaN → the sole quota gate (presign/route.ts:74, `used + size > NaN` = false for everything) is silently disabled; missingEnvVars ignores the var; dashboard renders 0% (NaN serializes null; `null > 0` false). Fix: positiveIntFromEnv helper (throw on invalid — fail closed like required()), same treatment for SIGNED_URL_EXPIRY_SECONDS (clamp 1..604800; its NaN already fails closed visibly via X-Amz-Expires=NaN rejected at use time). Regression: unit tests for 'unlimited' (throws), '1' (gate reachable), unset (100GB default).

## next.config.ts:missing-security-header-policy (low)

Zero security headers on any path (no headers() in next.config.ts, no middleware, no vercel.json, Caddy adds none). The authenticated admin SPA is framable; assertSameOrigin accepts same-origin requests (which framed documents produce: same Origin host, Sec-Fetch-Site same-origin), so requireAdminMutation/requireAdminDestructive authorize redressed clicks on destructive controls incl. the confirm-dialog step. No frame-busting JS exists. Fix: headers() in next.config.ts — CSP frame-ancestors (scoped: 'self' + the z.ai preview origins so the owner's preview panel keeps working; not unconditional DENY), X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Strict-Transport-Security. Regression: assert headers present on the HTML route after build+start.

## Deployment blocker surfaced by a rejected record

uploads/direct/route.ts:fileSize-bigint-strict-equality was rejected as a vulnerability (the runtime 400-every-upload scenario is unreachable), but the refutation established: under the pg-generated Prisma client (fileSize: bigint), route.ts:94 is TS2365 and :153/:180 are TS2367, so `bun run db:generate:pg && bun run build` (the documented Vercel build command) FAILS at compile time on this branch. Prior passes never saw it because dev type-checks against the SQLite client. Fix: `const declared = Number(row.fileSize)` (+ isSafeInteger guard; delete/repair the dead update block at :180-185) — exactly the normalization every sibling consumer already applies and the schema header mandates.
