// POST /api/auth/logout — xoa cookie + revoke session Supabase + xoa cache xac minh
//
// REVOKE DUNG SEMANTICS + XU LY DAY DU CAC TRUONG HOP:
// 1. Access token con han + refresh token  -> revoke session bang access token (204).
// 2. Access token HET HAN + refresh token  -> refresh-then-revoke: doi refresh token
//    lay session moi (rotation — refresh token cu bi tieu thu), revoke NGAY session
//    moi bang access token moi, xoa cache. KHONG de lai session moi song.
// 3. Access token THIEU + refresh token    -> nhu (2).
// 4. Ca hai thieu                           -> chi xoa cookie (idempotent).
// 5. Refresh token sai (invalid_grant)      -> session family da chet — ghi nhan
//    "already_invalid", khong loi.
// 6. Supabase tam thoi khong lien lac duoc  -> cookie van xoa (an toan phia client),
//    nhang trang thai that ("unreachable") duoc GHI LAI SERVER-SIDE — khong bao
//    cao gia revocation thanh cong.
// 7. Logout lap lai (khong token)           -> 200 nhu thuong (idempotent).
//
// LUU Y VE CUA SO HIEU LUC (chan thuc — chi tiet trong bao cao audit):
// - Supabase /auth/v1/logout revoke session family (kem refresh tokens):
//   GoTrue XOA row session trong auth.sessions. Chung minh thuc tren du an
//   nay: replay access token sau logout -> 403 session_not_found; replay
//   refresh token cu -> 400 refresh_token_not_found.
// - Access token JWT la stateless: theo tai lieu Supabase, tren mot so
//   phien ban/cau hinh GoTrue no co the VAN CON HIEU LUC den khi het han.
//   Vi vay cac thao tac PHA HOAI (xoa truyen/chapter/trang, cleanup) dung
//   requireAdminDestructive = /auth/v1/user truc tiep + kiem tra UY QUYEN
//   bang auth.sessions (Prisma postgres role — xem src/lib/session-verify.ts),
//   khong phu thuoc cache instance nao.
// - Cache xac minh 90s (globalThis) chi ton tai tren instance xu ly logout —
//   CAC INSTANCE KHAC khong bi xoa cache; cua so 90s chi anh huong cac route
//   dung cache (doc thuong/mutation thong thuong), KHONG anh huong route
//   destructive.
import { NextRequest, NextResponse } from "next/server";
import { ok, withErrorHandling, assertSameOrigin } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  clearAuthCookies,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  LOCAL_COOKIE,
  invalidateSessionCache,
} from "@/lib/session";
import {
  sbRevokeSessionStatus,
  sbRefreshGrant,
  SupabaseAuthError,
  type RevokeStatus,
} from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trang thai revocation ghi lai server-side (khong tiep ve client — respone van an toan). */
type LogoutOutcome =
  | "revoked" // revoke thanh cong (truc tiep hoac qua refresh-then-revoke)
  | "already-invalid" // token da chet tu truoc (session family da revoke/het han)
  | "nothing-to-revoke" // khong co token nao de xu ly
  | "unreachable" // Supabase khong lien lac duoc — KHONG xac nhan duoc trang thai that
  | "failed"; // Supabase tu choi / loi khac — revoke KHONG duoc xac nhan

/**
 * Doi refresh token lay session moi roi revoke NGAY session do.
 * - Rotation: refresh token cu bi Supabase tieu thu khi doi (khong dung lai duoc).
 * - Session moi chi ton tai trong RAM server (cookie khong bao gio duoc gui lai
 *   client) — revoke ngay sau do; neu revoke fail thi ghi nhan trung thuc
 *   (session tam con song phia Supabase nhung khong ai so huu token cua no).
 */
async function refreshThenRevoke(refreshToken: string): Promise<LogoutOutcome> {
  let newAccessToken: string | null = null;
  try {
    const session = await sbRefreshGrant(refreshToken); // tieu thu refresh token cu
    newAccessToken = session.access_token;
    invalidateSessionCache(session.access_token);
    const status: RevokeStatus = await sbRevokeSessionStatus(session.access_token);
    if (status === "revoked") return "revoked";
    // Session vua rotation con song phia Supabase — ghi nhan trung thuc, khong an noi.
    console.error(
      `[auth/logout] refresh-then-revoke: KHONG revoke duoc session da rotation (status=${status}). Session tam con song phia Supabase nhung token chi ton tai trong RAM server nay.`
    );
    return status === "unreachable" ? "unreachable" : "failed";
  } catch (err) {
    if (err instanceof SupabaseAuthError) {
      // 400 = invalid_grant: refresh token da chet (da revoke / da tieu thu / sai)
      // -> session family da ket thuc, khong con gi de revoke.
      if (err.status === 400) return "already-invalid";
      if (err.status === 503) return "unreachable";
      console.error("[auth/logout] refresh-then-revoke that bai:", err.status, err.message);
      return "failed";
    }
    console.error("[auth/logout] refresh-then-revoke ngoai le:", err);
    return "failed";
  } finally {
    if (newAccessToken) invalidateSessionCache(newAccessToken);
  }
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  assertSameOrigin(req);
  const env = getEnv();
  let outcome: LogoutOutcome = "nothing-to-revoke";

  if (env.authProvider === "supabase") {
    const accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

    if (accessToken) {
      // Xoa cache xac minh cua token nay tren instance hien tai ngay lap tuc.
      invalidateSessionCache(accessToken);
      const status = await sbRevokeSessionStatus(accessToken);
      if (status === "revoked") {
        outcome = "revoked";
      } else if (status === "rejected" && refreshToken) {
        // Access token het han/da revoke NHUNG refresh token co the van song
        // -> phai thu revoke ca session family qua refresh-then-revoke.
        outcome = await refreshThenRevoke(refreshToken);
      } else if (status === "rejected") {
        // Khong con refresh token de roi — session family se tu chet theo
        // refresh token (khong ai so huu) — ghi nhan trung thuc.
        outcome = "already-invalid";
      } else {
        // unreachable / error — khong xac nhan duoc; khong bao cao gia thanh cong.
        console.error(`[auth/logout] revoke truc tiep that bai (status=${status}).`);
        outcome = status === "unreachable" ? "unreachable" : "failed";
      }
    } else if (refreshToken) {
      // Chi co refresh token (access da het han/thieu) — van phai revoke session.
      outcome = await refreshThenRevoke(refreshToken);
    }
  } else if (env.authProvider === "local") {
    const localToken = req.cookies.get(LOCAL_COOKIE)?.value;
    if (localToken) {
      invalidateSessionCache(localToken);
      outcome = "revoked";
    }
  }

  // Ghi nhan trang thai that SERVER-SIDE (log) — response tra ve van an toan,
  // khong phan biet ket qua de khong roi thong tin trang thai backend cho ke tan cong.
  console.log(`[auth/logout] ket qua revocation: ${outcome}`);

  const res = ok({ loggedOut: true }) as NextResponse;
  return clearAuthCookies(res);
}) as unknown as (req: NextRequest) => Promise<NextResponse>;
