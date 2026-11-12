// =============================================================
// Cover URL helper: sinh presigned GET cho anh bia
// (URL co han — luon sinh moi tai thoi diem tra ve response)
// =============================================================

import { presignGetMany } from "@/lib/r2";

export async function attachCoverUrls<T extends { coverImageKey: string | null }>(
  items: T[]
): Promise<Array<T & { coverUrl: string | null }>> {
  const keys = Array.from(
    new Set(items.map((i) => i.coverImageKey).filter((k): k is string => Boolean(k)))
  );
  if (keys.length === 0) {
    return items.map((i) => ({ ...i, coverUrl: null }));
  }
  const urls = await presignGetMany(keys);
  const urlMap = new Map(keys.map((k, i) => [k, urls[i]]));
  return items.map((i) => ({ ...i, coverUrl: i.coverImageKey ? urlMap.get(i.coverImageKey) ?? null : null }));
}

export async function attachCoverUrl<T extends { coverImageKey: string | null }>(
  item: T
): Promise<T & { coverUrl: string | null }> {
  const [result] = await attachCoverUrls([item]);
  return result;
}
