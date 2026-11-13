"use client";

import { useEffect } from "react";

/**
 * Dang ky service worker (PWA).
 *
 * - CHI chay o production: dev server khong phat file theo cach on dinh
 *   (chunk hash doi lien tuc), cache gay chunk cu -> khong dang ky khi dev.
 * - That bai khong bao loi: PWA la nang cap, mat SW khong anh huong
 *   chuc nang chinh (tat ca van chay nhu web thong thuong).
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Bo qua — xem comment tren
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
