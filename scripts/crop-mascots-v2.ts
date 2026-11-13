/**
 * Crop mascot stickers (v2) — dùng toạ độ đọc từ lưới % chính xác
 * + trim biên trong suốt, output public/mascots/
 * Run: bun scripts/crop-mascots-v2.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const UP = path.resolve("upload");
const OUT = path.resolve("public/mascots");
fs.mkdirSync(OUT, { recursive: true });

type Box = { l: number; t: number; r: number; b: number };
type Item = { src: string; name: string; box: Box; pad?: number };

const sheet1 = "Bộ sticker mascot mèo Tsundoku tím neon-2.png";
const sheet2 = "Bộ sticker thương hiệu Tsundoku phong cách chibi-1.png";

const items: Item[] = [
  // Sheet 1 (neon tím)
  { src: sheet1, name: "sitting", box: { l: 56, t: 9, r: 79, b: 63 }, pad: 0.6 },
  { src: sheet1, name: "happy", box: { l: 72, t: 3, r: 98, b: 19 }, pad: 0.6 },
  { src: sheet1, name: "angry", box: { l: 83, t: 22, r: 98, b: 35 }, pad: 0.6 },
  { src: sheet1, name: "dizzy", box: { l: 85, t: 37, r: 99, b: 53 }, pad: 0.6 },
  { src: sheet1, name: "crying", box: { l: 84, t: 55, r: 99, b: 72 }, pad: 0.6 },
  { src: sheet1, name: "back", box: { l: 38, t: 68, r: 54, b: 97 }, pad: 0.6 },
  { src: sheet1, name: "paw", box: { l: 54, t: 79, r: 62, b: 91 }, pad: 0.6 },
  { src: sheet1, name: "book", box: { l: 87, t: 76, r: 98, b: 89 }, pad: 0.6 },
  { src: sheet1, name: "app-squircle", box: { l: 20, t: 70, r: 37, b: 96 }, pad: 0.4 },
  // Sheet 2 (chibi)
  { src: sheet2, name: "shocked", box: { l: 36, t: 55, r: 52, b: 76 }, pad: 0.6 },
  { src: sheet2, name: "sleeping", box: { l: 51, t: 54, r: 68, b: 76 }, pad: 0.6 },
  { src: sheet2, name: "shy", box: { l: 69, t: 54, r: 84, b: 76 }, pad: 0.6 },
  { src: sheet2, name: "curious", box: { l: 85, t: 54, r: 98, b: 78 }, pad: 0.6 },
  { src: sheet2, name: "happy-hug", box: { l: 2, t: 54, r: 18, b: 79 }, pad: 0.6 },
  { src: sheet2, name: "grumpy", box: { l: 19, t: 54, r: 34, b: 75 }, pad: 0.6 },
];

async function crop(item: Item) {
  const img = sharp(path.join(UP, item.src));
  const meta = await img.metadata();
  const W = meta.width ?? 1536;
  const H = meta.height ?? 1024;
  const p = item.pad ?? 0.6;
  const left = Math.max(0, Math.round((item.box.l / 100) * W - (p / 100) * W));
  const top = Math.max(0, Math.round((item.box.t / 100) * H - (p / 100) * H));
  const width = Math.min(W - left, Math.round(((item.box.r - item.box.l) / 100) * W + (2 * p / 100) * W));
  const height = Math.min(H - top, Math.round(((item.box.b - item.box.t) / 100) * H + (2 * p / 100) * H));
  // Tách pipeline thành nhiều pass — sharp không hỗ trợ extract→trim→extend
  // trong cùng một pipeline (trim tính lại toạ độ extract gây xung đột)
  const cropped = await img
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const trimmed = await sharp(cropped)
    .trim({ threshold: 12 })
    .png()
    .toBuffer();
  await sharp(trimmed)
    .extend({ top: 6, bottom: 6, left: 6, right: 6, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, `${item.name}.png`));
  const out = await sharp(path.join(OUT, `${item.name}.png`)).metadata();
  console.log(`${item.name}: ${out.width}x${out.height}`);
}

async function main() {
  for (const item of items) await crop(item);
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });
