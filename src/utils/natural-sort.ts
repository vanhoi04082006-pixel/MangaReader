// =============================================================
// Natural sort: "2" < "10", "p2" < "p10" (khong phai alphabet)
// Dung cho thu tu anh trong zip/folder va so chuong.
// =============================================================

function chunkify(str: string): Array<{ num: bigint | null; text: string }> {
  const chunks: Array<{ num: bigint | null; text: string }> = [];
  const re = /(\d+)|(\D+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    if (m[1] !== undefined) {
      chunks.push({ num: BigInt(m[1]), text: m[1] });
    } else {
      chunks.push({ num: null, text: m[2].toLowerCase() });
    }
  }
  return chunks;
}

/** So sanh 2 chuoi theo thu tu tu nhien. Tra ve am/0/duong. */
export function naturalCompare(a: string, b: string): number {
  const ca = chunkify(a);
  const cb = chunkify(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const xa = ca[i];
    const xb = cb[i];
    if (xa.num !== null && xb.num !== null) {
      if (xa.num < xb.num) return -1;
      if (xa.num > xb.num) return 1;
    } else if (xa.num !== null) {
      return -1; // so truoc chu (001.jpg vs "a.jpg")
    } else if (xb.num !== null) {
      return 1;
    } else {
      const cmp = xa.text.localeCompare(xb.text, "en", { sensitivity: "base" });
      if (cmp !== 0) return cmp;
    }
  }
  return ca.length - cb.length;
}

/** Sap xep mang theo thu tu tu nhien (immutable) */
export function naturalSortFiles<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => naturalCompare(nameOf(a), nameOf(b)));
}
