/**
 * Crop mascot stickers from uploaded sticker sheets into public/mascots/
 * Source: /upload/*.png (1536x1024 sheets, 1254x1254 square badge)
 * Run: bun scripts/crop-mascots.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const UP = path.resolve("upload");
const OUT = path.resolve("public/mascots");
fs.mkdirSync(OUT, { recursive: true });

type Box = { l: number; t: number; r: number; b: number }; // percent
type Item = { src: string; name: string; box: Box; pad?: number };

// Bounding boxes từ VLM (percent) — pad thêm % để không cắt sát sticker
const sheet1 = "Bộ sticker mascot mèo Tsundoku tím neon-2.png";
const sheet2 = "Bộ sticker thương hiệu Tsundoku phong cách chibi-1.png";

const items: Item[] = [
  // Sheet 1 (neon)
  { src: sheet1, name: "sitting", box: { l: 57, t: 8, r: 85, b: 64 }, pad: 1.5 },   // mèo ngồi ôm sách
  { src: sheet1, name: "happy", box: { l: 83, t: 3, r: 99, b: 20 }, pad: 1.5 },     // mặt cười
  { src: sheet1, name: "angry", box: { l: 83, t: 22, r: 99, b: 38 }, pad: 1.5 },    // mặt giận
  { src: sheet1, name: "dizzy", box: { l: 85, t: 39, r: 99, b: 56 }, pad: 1.5 },    // mặt choáng
  { src: sheet1, name: "crying", box: { l: 83, t: 56, r: 99, b: 72 }, pad: 1.5 },   // mặt khóc
  { src: sheet1, name: "back", box: { l: 39, t: 68, r: 55, b: 95 }, pad: 1.5 },     // lưng mèo "..."
  { src: sheet1, name: "paw", box: { l: 54, t: 80, r: 63, b: 90 }, pad: 1.2 },      // dấu chân
  { src: sheet1, name: "book", box: { l: 87, t: 77, r: 97, b: 88 }, pad: 1.2 },     // quyển sách
  { src: sheet1, name: "app-squircle", box: { l: 20, t: 68, r: 37, b: 95 }, pad: 0.8 }, // icon vuông bo
  // Sheet 2 (chibi)
  { src: sheet2, name: "shocked", box: { l: 36, t: 55, r: 52, b: 74 }, pad: 1.5 },   // !! sốc
  { src: sheet2, name: "sleeping", box: { l: 51, t: 57, r: 70, b: 73 }, pad: 1.5 },  // ngủ zzz
  { src: sheet2, name: "shy", box: { l: 71, t: 55, r: 84, b: 75 }, pad: 1.5 },      // xấu hổ
  { src: sheet2, name: "curious", box: { l: 85, t: 55, r: 99, b: 76 }, pad: 1.5 },  // tò mò ???
];

async function crop(item: Item) {
  const img = sharp(path.join(UP, item.src));
  const meta = await img.metadata();
  const W = meta.width ?? 1536;
  const H = meta.height ?? 1024;
  const p = item.pad ?? 1.5;
  const left = Math.max(0, Math.round((item.box.l / 100) * W - (p / 100) * W));
  const top = Math.max(0, Math.round((item.box.t / 100) * H - (p / 100) * H));
  const width = Math.min(W - left, Math.round(((item.box.r - item.box.l) / 100) * W + (2 * p / 100) * W));
  const height = Math.min(H - top, Math.round(((item.box.b - item.box.t) / 100) * H + (2 * p / 100) * H));
  await img
    .extract({ left, top, width, height })
    .png()
    .toFile(path.join(OUT, `${item.name}.png`));
  console.log(`${item.name}: ${width}x${height} @ ${left},${top}`);
}

async function main() {
  for (const item of items) await crop(item);
  // Copy ảnh badge vuông (nguồn icon app) — giữ nguyên
  await sharp(path.join(UP, "Mèo đen Tsundoku đọc manga neon.png")).png().toFile(path.join(OUT, "badge-full.png"));
  console.log("badge-full done");
}
main().catch((e) => { console.error(e); process.exit(1); });
