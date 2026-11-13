/**
 * Loại bỏ "bleed" — mảnh sticker láng giềng bị cắt tại mép crop.
 * Nguyên tắc: mọi crop đã được extend 6px trong suốt quanh mép,
 * nên bất kỳ thành phần opaque nào CHẠM mép ảnh = bleed (bị cắt bởi
 * ranh giới crop). Giữ lại thành phần chính + các đảo trang trí
 * không chạm mép.
 * Run: bun scripts/debleed.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const DIR = path.resolve("public/mascots");
const names = fs.readdirSync(DIR).filter(
  (f) => f.endsWith(".png") && !["contact.png", "badge-full.png"].includes(f)
);

function label(data: Uint8Array, W: number, H: number, C: number) {
  const labels = new Int32Array(W * H).fill(0);
  let next = 0;
  const equiv = [0, 1]; // label → root (index 0 unused, label 1 mặc định trỏ chính nó)
  const find = (l: number): number => {
    while (equiv[l] !== l) { equiv[l] = equiv[equiv[l]]; l = equiv[l]; }
    return l;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (data[i * C + 3] <= 24) continue;
      let root = 0;
      // hàng trên + trái (8-connectivity)
      for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W) continue;
        const nl = labels[ny * W + nx];
        if (!nl) continue;
        const r = find(nl);
        if (!root) root = r;
        else if (r !== root) { equiv[Math.max(root, r)] = Math.min(root, r); root = Math.min(root, r); }
      }
      if (!root) { equiv.push(++next); root = next; }
      labels[i] = root;
    }
  }
  return { labels, next, find };
}

async function process(name: string) {
  const file = path.join(DIR, name);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const buf = Buffer.from(data); // writable copy
  const { labels, next, find } = label(data, W, H, C);

  // thống kê từng component
  const area = new Map<number, number>();
  const touchesEdge = new Map<number, boolean>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = labels[i];
      if (!l) continue;
      const root = find(l);
      area.set(root, (area.get(root) ?? 0) + 1);
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (edge) touchesEdge.set(root, true);
    }
  }

  let mainRoot = 0, mainArea = 0;
  for (const [root, a] of area) if (a > mainArea) { mainArea = a; mainRoot = root; }
  if (!mainRoot) return console.log(`${name}: trống?`);

  // xóa component chạm mép (bleed) — giữ main + đảo không chạm mép
  let removed = 0, removedPx = 0;
  for (const [root, a] of area) {
    if (root !== mainRoot && touchesEdge.get(root)) {
      removed++;
      removedPx += a;
    }
  }
  if (!removed) return console.log(`${name}: sạch, bỏ qua`);

  for (let i = 0; i < W * H; i++) {
    const l = labels[i];
    if (!l) continue;
    const root = find(l);
    if (root !== mainRoot && touchesEdge.get(root)) {
      buf[i * C + 3] = 0;
    }
  }
  await sharp(buf, { raw: { width: W, height: H, channels: C } })
    .png()
    .toFile(file);
  console.log(`${name}: đã xóa ${removed} mảnh bleed (${removedPx}px)`);
}

(async () => {
  for (const n of names) await process(n);
})();
