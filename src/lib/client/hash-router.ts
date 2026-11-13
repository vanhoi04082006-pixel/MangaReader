// =============================================================
// Hash router nhe cho SPA (user chi thay route "/")
// #/            -> dashboard
// #/library     -> thu vien
// #/manga/<id>  -> chi tiet
// #/reader/<mangaId>/<chapterId>
// =============================================================
//
// 3 SU KIEN LAN NGHE:
// - "hashchange": hash doi qua <a href="#/..."> (anchor thuan) hoac
//   navigate() (location.hash = ...) — browser fire tu dong.
// - "popstate": nut Back/Forward cua browser.
// - "routestate" (event tu lo): browser KHONG fire bat ky event nao khi
//   code goi history.pushState/replaceState — ma <Link> cua Next.js
//   href chi-khac-hash lai dieu huong mem bang pushState (URL doi tren
//   dia chi nhung khong hashchange, khong popstate). Neu khong patch
//   thi bam tab sidebar chi doi URL, phai F5 moi chuyen tab. Patch
//   dispatch "routestate" sau moi pushState/replaceState de router
//   luon dong bo voi URL hien tai.
// =============================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export interface HashRoute {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parseHash(): HashRoute {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, queryString] = raw.split("?");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return {
    path: cleanPath,
    segments: cleanPath.split("/").filter(Boolean),
    query: new URLSearchParams(queryString ?? ""),
  };
}

/** Hai route "bang nhau" — tranh re-render vo nghia khi hash khong doi */
function routeEquals(a: HashRoute, b: HashRoute): boolean {
  return a.path === b.path && a.query.toString() === b.query.toString();
}

// ---- Patch history (idempotent, chi chay o browser) ----
// Dispatch "routestate" sau moi pushState/replaceState (ke ca cua Next.js).
const ROUTE_EVENT = "routestate";

if (typeof window !== "undefined") {
  const h = window.history as History & { __routestatePatched?: boolean };
  if (!h.__routestatePatched) {
    h.__routestatePatched = true;
    const origPush = h.pushState.bind(h);
    const origReplace = h.replaceState.bind(h);
    h.pushState = (...args) => {
      origPush(...args);
      window.dispatchEvent(new Event(ROUTE_EVENT));
    };
    h.replaceState = (...args) => {
      origReplace(...args);
      window.dispatchEvent(new Event(ROUTE_EVENT));
    };
  }
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() =>
    typeof window === "undefined"
      ? { path: "/", segments: [], query: new URLSearchParams() }
      : parseHash()
  );

  useEffect(() => {
    const onChange = () => {
      setRoute((prev) => {
        const next = parseHash();
        return routeEquals(prev, next) ? prev : next;
      });
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);

  return route;
}

/** Dieu huong den route moi (VD: navigate("/manga/abc")) */
export function navigate(to: string, opts?: { replace?: boolean }) {
  const target = `#${to.startsWith("/") ? to : `/${to}`}`;
  if (opts?.replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
}

/** Cap nhat 1 query param giu nguyen path */
export function updateRouteQuery(
  query: URLSearchParams,
  patch: Record<string, string | null>
): string {
  const next = new URLSearchParams(query.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export function goBack() {
  window.history.back();
}

/** Hook tra ve URL hien tai day du (cho dependency) */
export function useRouteKey(): string {
  const route = useHashRoute();
  return useMemo(() => `${route.path}?${route.query.toString()}`, [route]);
}

/** Helper: lay gia tri so tu query */
export function queryInt(query: URLSearchParams, key: string, fallback: number): number {
  const v = parseInt(query.get(key) ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

/** Hook callback khi bam back — dung cho reader */
export function useNavigationBlocker() {
  return useCallback(() => {
    if (window.history.length > 1) goBack();
    else navigate("/");
  }, []);
}
