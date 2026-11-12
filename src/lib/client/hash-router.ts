// =============================================================
// Hash router nhe cho SPA (user chi thay route "/")
// #/            -> dashboard
// #/library     -> thu vien
// #/manga/<id>  -> chi tiet
// #/reader/<mangaId>/<chapterId>
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

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() =>
    typeof window === "undefined"
      ? { path: "/", segments: [], query: new URLSearchParams() }
      : parseHash()
  );

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
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
