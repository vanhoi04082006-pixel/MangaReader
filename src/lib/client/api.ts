// =============================================================
// API client (client-side): fetch + auto refresh session + errors
// =============================================================

export class ApiClientError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

interface FetchOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  skipRefresh?: boolean;
  body?: BodyInit | null;
}

async function rawFetch<T>(path: string, init?: FetchOptions): Promise<T> {
  const { json, skipRefresh, headers, body, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });

  if (res.status === 401 && !skipRefresh) {
    // Thu lam moi session 1 lan roi retry
    const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshRes.ok) {
      return rawFetch<T>(path, { ...init, skipRefresh: true });
    }
    window.dispatchEvent(new CustomEvent("tsundoku:unauthorized"));
    throw new ApiClientError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401, "unauthorized");
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiClientError(data.error ?? `Lỗi máy chủ (${res.status}).`, res.status, data.code);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => rawFetch<T>(path),
  post: <T>(path: string, json?: unknown) => rawFetch<T>(path, { method: "POST", json }),
  put: <T>(path: string, json?: unknown) => rawFetch<T>(path, { method: "PUT", json }),
  patch: <T>(path: string, json?: unknown) => rawFetch<T>(path, { method: "PATCH", json }),
  del: <T>(path: string) => rawFetch<T>(path, { method: "DELETE" }),
};

/** Upload 1 file qua proxy server (fallback khi R2 chua co CORS) */
export function uploadViaProxy(
  key: string,
  blob: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/uploads/direct?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`
    );
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = "Upload thất bại.";
        try {
          msg = JSON.parse(xhr.responseText)?.error ?? msg;
        } catch {
          /* ignore */
        }
        reject(new ApiClientError(msg, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiClientError("Lỗi kết nối khi upload.", 0, "network"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}

/** PUT truc tiep len R2 bang presigned URL (kem progress) */
export function putToR2(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiClientError(`R2 từ chối upload (${xhr.status}).`, xhr.status, "r2_rejected"));
    };
    // onerror = loi mang hoac CORS -> engine se fallback sang proxy
    xhr.onerror = () => reject(new ApiClientError("Không upload trực tiếp được (CORS/mạng).", 0, "network"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}
