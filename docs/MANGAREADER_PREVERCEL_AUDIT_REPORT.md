# MangaReader — Pre-Deployment Security Audit Report (Run 1)

- **Run ID**: mangareader-prevercel-deploy-run-1
- **Profile**: standard (full audit, all six phases)
- **Skill**: cloudflare/security-audit-skill (security-audit), executed via 13 hunters (2 waves), 11 candidate verifiers, 9 record verifiers, 3 coverage critics
- **Target**: /home/z/audit-work — branch `audit/mangareader-production-hardening` @ `c603367fdeed0f40767aa361222ec345bfae7476` (worktree clean)
- **Scope**: src/, scripts/, prisma/, supabase/, tests/, next.config.ts, package.json, .env.example (sandbox scaffolding Caddyfile/.zscripts included as deployment-config units)
- **Execution policy**: sandboxed-source-and-local-only. This platform lacks the packaged OS-sandbox control set (no docker/podman/bwrap/nsjail), so ALL checks in this run are source-only (method "source", artifact null); behavioral questions beyond source are recorded as needs_validation with exact owner-observed/local plans.
- **Budget**: none set. Agents spent: 4 recon + 12 wave-1 hunters + 1 wave-2 hunter + 2 post-wave critics + 1 final-clean critic + 11 candidate verifiers + 9 record verifiers = 40 agents.
- **Prior runs**: no skill-format prior ledger exists. The four prior manual audit passes (docs/MANGAREADER_PRODUCTION_READINESS_REPORT.md, S1–S31) were consulted as context; nothing was suppressed or carried as same-source confirmation.
- **Deployment intent**: owner deploys this branch to Vercel after this audit.

## Coverage statement

30 deterministic coverage units (surface × boundary × subsystem × attack class) — 20 covered, 10 candidate (units owning the 11 candidate fingerprints; the direct-proxy unit's candidate was rejected at validation). Two hunter waves ran; the post-wave-1 critic found 4 real gaps (chapters list/create/update — missed by all wave-1 units — plus auth/me, favorite, genres) which wave 2 closed; the final-clean critic returned stop=true with no missing units and no reassignments. All 37 exported API handlers across 26 route files, all scripts, both Prisma schemas, the RLS migration, client code, and deployment config are covered by unit evidence. Excluded (with reasons, in the ledger): AI/LLM, memory-safety, desktop/mobile/IPC, and RPC/messaging companion domains (no such surfaces in the target); federated-identity, MFA, container, and CI classes (no such code).

## Security posture summary

The four prior hardening passes hold up under independent re-review: the admin boundary (guards, UUID pinning, fail-closed config), CSRF discipline, strict destructive guards on all 9 R2-deleting handlers, rate limiting, presign capability scoping, and parameterized data access all verified clean at source level across 30 units. This run found no authentication bypass, no injection, no cross-principal data access, and no privilege escalation. The confirmed findings are: one medium data-destruction logic flaw in the page-finalize lifecycle (admin-API-reachable, never emitted by the bundled UI), and three low findings (admin-email enumeration oracle at login, a fail-open quota config parse, missing baseline security headers). Five further leads need owner-observed or locally-runnable validation before they can be dismissed or confirmed. Separately — and most important for the deployment plan — the rejected BigInt candidate surfaced a hard fact: **the documented Vercel build command (`bun run db:generate:pg && bun run build`) fails at compile time on this branch** (TS2365/TS2367 in src/app/api/uploads/direct/route.ts:94/153/180), because the pg-generated Prisma client types `fileSize` as BigInt while that route compares it raw against Numbers. This is a deployment blocker, not a runtime vulnerability, and must be fixed before deploying.

## Confirmed findings

| Severity | Fingerprint | Boundary | One-line observed result |
|---|---|---|---|
| **medium** | src/services/chapter-service.ts/finalizePages.B4.replacedOldKeys-without-reference-recheck | finalize lifecycle → R2 objects | An API-legal finalize batch that moves/renumbers existing page keys silently and irreversibly destroys the still-referenced R2 page objects (renumber variant destroys every shifted image of a chapter in one request). |
| low | auth/login.admin-email-enumeration.differential-response | anonymous → login | 403 forbidden_account (non-admin email, no Supabase call) vs 401 invalid_credentials (admin email + wrong password, two Supabase round-trips) — deterministic admin-email enumeration oracle. |
| low | src/lib/env.ts:STORAGE_QUOTA_GB-parseInt-NaN-fail-open-quota | operator config → presign quota gate | A non-numeric STORAGE_QUOTA_GB parses to NaN; every quota comparison is false, silently removing the only aggregate storage cap (dashboard shows 0%). |
| low | next.config.ts:missing-security-header-policy | browser → authenticated SPA | No security headers on any deployment path; the admin SPA is framable and assertSameOrigin accepts the same-origin requests a framed document produces (clickjacking of destructive actions). |

### Medium finding detail (see FINDINGS-DETAIL.md)

**finalizePages B4 (medium)** — POST /api/chapters/:id/pages computes `replacedOldKeys` from a pre-transaction snapshot keyed by page number, without excluding keys the same batch re-references and without re-checking page references after the B3 transaction. B1 deliberately accepts already-CONFIRMED chapter-bound PAGE keys, so a batch like `[{newKey, page 1}, {oldKey, page 2}]` (or an insert-at-front renumber) releases the old key, re-acquires it at a new page number, commits — and then B4 marks it DELETE_PENDING, deletes it from R2, and removes its storage row, leaving committed page rows pointing at deleted objects. Silent 201; reader pages permanently broken; a transient R2 failure leaves a poisoned DELETE_PENDING state that cleanup mode=failed later finishes destroying. Only the admin can trigger it and the bundled UI never emits the pattern, but every sibling deletion path (setMangaCover, cleanupOrphanKeys) enforces exactly the reference re-check B4 lacks — this is the single outlier. Fix: exclude batch-reused keys + re-check db.page references after B3 before any R2 deletion (remediation code in the findings record and FINDINGS-DETAIL.md).

## Deployment blocker (from a rejected finding — fix required before Vercel)

`uploads/direct/route.ts:fileSize-bigint-strict-equality` was **rejected as a vulnerability** (the claimed runtime 400-every-upload is unreachable — the same type divergence is a compile-time error under the pg client), but the refutation established the operationally decisive fact: with the pg-generated client, `bun run db:generate:pg && bun run build` (README §7, the documented Vercel build command) **fails to compile** at route.ts:94 (TS2365) and :153/:180 (TS2367). The prior passes never caught this because dev machines and CI type-check against the SQLite-generated client. Fix: `Number(row.fileSize)` normalization (exactly what every sibling consumer already does; the schema header mandates it) — this both fixes the latent runtime defect and unblocks the production build.

## NEEDS VALIDATION (5 leads — no severity assigned; do not treat as vulnerabilities)

| Fingerprint | Exact blocker | Next step |
|---|---|---|
| auth/refresh.no-origin-check.samesite-sibling-subdomain | Production registrable domain + existence of an untrusted sibling-subdomain origin; GoTrue reuse-interval config | Dummy-project hosts-file experiment (app.local.test / attacker.local.test); owner checks dashboard config + custom-domain subdomains |
| src/lib/api.ts:assertSameOrigin-origin-scheme-ignored | Plain-HTTP non-redirecting content on the production hostname; admin browser lacking schemeful same-site | Unit fixture proves source-level acceptance; owner: `curl -sI http://<host>/` must 301/308 to https; browser matrix |
| src/app/api/uploads/abort/route.ts/PENDING-filter-non-atomic-with-R2-delete | The harmful abort-vs-finalize interleaving needs runtime observation (source-only run) | Dev harness + instrumented R2 delay; two-sided fix (atomic claim in abort, conditional confirm in finalize B3) |
| migrations.profiles-self-insert-policy-email-not-pinned | Existence of a second authenticated Supabase user; RLS applied in prod; PostgREST grants; admin-profile-row timing | Staging Supabase: non-admin inserts {own uuid, ADMIN_EMAIL} → admin first login 409 lockout; verify signup disabled in prod |
| Caddyfile:XTransformPort-localhost-port-proxy | Whether the sandbox :81 listener is reachable beyond the owner (platform fact) | Local caddy fixture with dummy loopback services; owner-observed reachability check; remove/restrict before any self-host reuse |

Full traces, evidence, and plans: NEEDS-VALIDATION.md.

## Hardening notes (selected; full list in the ledger and FINDINGS-DETAIL.md)

1. **Pre-deploy doc fix**: README §7 step 2 instructs setting ALL .env.example variables in Vercel Production — that keeps ADMIN_PASSWORD (a working credential) in prod env, contradicting the documented removal lifecycle. Set only required vars; remove ADMIN_PASSWORD after bootstrap.
2. Storage-audit route: cap maxAgeHours (parity with cleanup's 720), wire the already-defined storageAuditQuerySchema for continuationToken, and apply the defined-but-unused RATE_LIMITS.audit.
3. Nine unused production dependencies (next-auth, next-intl, z-ai-web-dev-sdk, @mdxeditor/editor, react-markdown, react-syntax-highlighter, @reactuses/core, @tanstack/react-table, @hookform/resolvers) — installed into every build environment for zero product functionality; remove or move to dev. Run `bun audit` before promoting (advisory status not verifiable source-only).
4. setup-r2: roundtrip test object cleanup is happy-path-only (no try/finally; delete failures still exit 0) — apply the verify-rls cleanup contract (fix included in this remediation pass).
5. Math.random key suffixes (r2.ts rand()) — not a capability boundary today (private bucket, presign-gated); crypto.randomBytes is free defense-in-depth.
6. Rate limiter: key rows store raw first-XFF-hop strings (header-sized) for 24h — hash/truncate; RATE_LIMITS.write is dead policy; the login per-email bucket lets an attacker who knows ADMIN_EMAIL lock the admin out 15min at a time (count failed attempts only, or reset on success).
7. Verify-cache entries are not bounded by the token exp claim (a token verified just before expiry passes up to ~90s past exp) — same accepted-staleness family as the documented 90s window; cheap fix via decodeJwtPayload.
8. robots.txt says Allow: / while layout sets noindex — change to Disallow: / for a private app.
9. GET /api/chapters/:id/reader performs a write side effect (history upsert); POST /api/progress duplicates PUT (undocumented handler); README API table lists only PUT.
10. Committed seed constants: real admin email + UUID in 0001_init.sql/.env.example pre-position the ADMIN_EMAIL value (identifiers, not credentials); parameterize if the repo is ever shared.
11. Supabase self-hosted signup-disable and RLS-apply remain owner checklist items; verify-rls never tests the profiles self-insert policy (add it to Phase C).

## Positive source patterns

Strict-guard matrix unit-locked to the 9 R2-destructive handlers; fail-closed posture throughout (provider, UUID pinning, strict-verify unavailability, R2 config); safe-delete metadata-only-after-R2-confirm; server-generated object keys on every path; parameterized queries everywhere incl. all 3 raw-SQL sites; zod bounds at every body/query surface; per-request minted presigned GETs never persisted; httpOnly/path-scoped cookies; uniform logout response; comprehensive .env.example parity with env.ts reads.

## Run status

**complete** — all six phases executed; both validators pass (11 findings, 30 coverage units); the final-clean critic accepted coverage. This report is a partial pass only in the sense that the five needs_validation leads await owner-observed facts; no unvalidated candidate is presented as a finding.
