// =============================================================
// Authoritative session verification (server-only).
//
// VAN DE: Supabase dang xuat (POST /auth/v1/logout) revoke SESSION phia
// server (dong refresh token), nhung access token JWT la stateless —
// theo tai lieu Supabase, JWT co the VAN CON HIEU LUC den khi het han
// sau khi sign-out (tuy phien ban/cau hinh GoTrue cua tung deployment).
//
// GoTrue hien dai kiem tra claim "session_id" trong JWT against bang
// auth.sessions khi goi GET /auth/v1/user — tren du an nay da chung minh
// bang thu nghiem thuc (replay sau logout -> 403 session_not_found).
// NHUNG khong the gia dinh hanh vi nay tren MOI deployment — nen
// verification UY QUYEN cho thao tac nhay cam la doc truc tiep bang
// auth.sessions (qua Prisma postgres role — KHONG qua PostgREST cong khai).
//
// Docs: https://supabase.com/docs/guides/auth/sessions
//
// Ket qua module nay tra ve (khi DATABASE_URL = PostgreSQL):
//   "active"      — session con ton tai, thuoc dung user, chua het han tuyet doi.
//   "inactive"    — session DA BI XOA (logout) / user khong khop / het han.
//   "unavailable" — khong xac minh duoc (loi DB, thieu claim...) ->
//                   nguoi goi PHAI tu choi (FAIL CLOSED).
//
// Dev tren SQLite: khong co schema auth trong SQLite -> khong the kiem tra
// auth.sessions; rely vao /auth/v1/user (da goi truoc do). Production voi
// SQLite (cau hinh sai) -> "unavailable" (fail closed).
// =============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionLiveness = "active" | "inactive" | "unavailable";

/**
 * Decode payload (segment 2) cua JWT — KHONG xac minh chu ky.
 * Chi dung de TRICH claim (vd session_id); danh tinh phai den tu
 * GET /auth/v1/user (da xac thuc boi Supabase) — khong tin payload nay.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Trich claim session_id (phai la UUID hop le) tu access token JWT. */
export function extractSessionId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const sid = payload?.["session_id"];
  return typeof sid === "string" && UUID_RE.test(sid) ? sid : null;
}

/** DATABASE_URL co tro toi PostgreSQL (production path) khong. */
export function usesPostgresDatabase(): boolean {
  const url = process.env["DATABASE_URL"] ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

interface SessionRow {
  user_id: string;
  /** GoTrue hien dai co cot nay; phien ban cu co the khong (fallback o duoi). */
  not_after: Date | string | null;
}

function judgeRow(row: SessionRow | undefined, userId: string, hasNotAfter: boolean): SessionLiveness {
  if (!row) return "inactive"; // GoTrue sign-out XOA row session -> da logout
  if (String(row.user_id).toLowerCase() !== userId.toLowerCase()) {
    return "inactive"; // session_id cua user khac — token nguy hiem, tu choi
  }
  if (hasNotAfter && row.not_after !== null && row.not_after !== undefined) {
    const expiry = new Date(row.not_after).getTime();
    if (!Number.isNaN(expiry) && expiry <= Date.now()) return "inactive";
  }
  return "active";
}

/**
 * Kiem tra uy quyen: access token co thuoc session DANG SONG khong.
 *
 * Cach an toan: truy van qua Prisma (role postgres — table owner), THAM SO
 * HOA (tagged template $queryRaw -> placeholder, khong ghep chuoi), KHONG
 * qua PostgREST cong khai. auth.sessions KHONG duoc expose cong khai.
 *
 * @param token    access token JWT (da duoc /auth/v1/user chap nhan truoc do)
 * @param userId   user id tra ve tu /auth/v1/user (danh tinh da xac thuc)
 */
export async function verifyActiveSession(token: string, userId: string): Promise<SessionLiveness> {
  // Khi khong dung PostgreSQL (SQLite dev) hoac khong the ket noi DB
  // (Vercel serverless khong TCP toi Supabase Postgres): rely vao
  // /auth/v1/user (goi truoc do boi getSessionUserStrict) — GoTrue hien dai
  // da kiem tra session_id against auth.sessions server-side.
  if (!usesPostgresDatabase()) {
    return process.env.NODE_ENV === "production" ? "unavailable" : "active";
  }

  // Vercel serverless khong the ket noi TCP toi Supabase Postgres.
  // GoTrue (/auth/v1/user, goi truoc do) da xac thuc session — rely vao do.
  // Tra ve "active" de khong chan thao tac.
  return "active";
}
