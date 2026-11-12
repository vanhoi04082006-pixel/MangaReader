// =============================================================
// Tao du lieu test E2E: 8 trang truyện đánh số (màu khác nhau)
// + pack thanh ZIP (kèm file rác để test filter) + ZIP thứ 2
// Chay: bun run scripts/make-test-manga.ts
// =============================================================

import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT_DIR = "/tmp/manga-e2e";
const PAGE_COUNT = 8;

// Màu nền mỗi trang (theo hue xoay vòng) — giúp xác minh THỨ TỰ trang khi đọc
const COLORS: Array<[number, number, number]> = [
  [229, 72, 77], // red
  [230, 126, 34], // orange
  [241, 196, 15], // yellow
  [76, 175, 80], // green
  [26, 188, 156], // teal
  [149, 117, 205], // purple
  [236, 100, 167], // pink
  [120, 120, 130], // gray
];

async function makePage(index: number): Promise<Buffer> {
  const n = index + 1;
  const [r, g, b] = COLORS[index % COLORS.length];
  const num = String(n).padStart(2, "0");
  const svg = `<svg width="800" height="1150" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="1150" fill="rgb(${r},${g},${b})"/>
  <rect x="30" y="30" width="740" height="1090" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="4" rx="16"/>
  <text x="400" y="540" font-family="Arial, sans-serif" font-size="200" font-weight="bold" fill="rgba(255,255,255,0.92)" text-anchor="middle">${num}</text>
  <text x="400" y="640" font-family="Arial, sans-serif" font-size="44" fill="rgba(255,255,255,0.75)" text-anchor="middle">TRANG ${num}</text>
  <text x="400" y="1060" font-family="Arial, sans-serif" font-size="24" fill="rgba(255,255,255,0.55)" text-anchor="middle">TSUNDOKU E2E TEST</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // ===== ZIP 1: chapter01.zip — anh danh so 001..008 + file rac =====
  const files1: Record<string, Uint8Array> = {
    "__MACOSX/._001.jpg": strToU8("junk"),
    "info.txt": strToU8("file khong phai anh - phai bi bo qua"),
    "001.jpg": await makePage(0),
    "002.jpg": await makePage(1),
    "003.jpg": await makePage(2),
    "004.jpg": await makePage(3),
    "005.jpg": await makePage(4),
    "006.jpg": await makePage(5),
    "007.jpg": await makePage(6),
    "008.jpg": await makePage(7),
  };
  const zip1 = zipSync(files1, { level: 6 });
  writeFileSync(`${OUT_DIR}/chapter01.zip`, zip1);
  console.log(`chapter01.zip: ${(zip1.length / 1024).toFixed(1)} KB (8 trang + 2 file rac)`);

  // ===== ZIP 2: chapter02.zip — thu muc con, ten khong danh so deuu =====
  const files2: Record<string, Uint8Array> = {
    "Chapter 02/10.jpg": await makePage(0),
    "Chapter 02/11.jpg": await makePage(1),
    "Chapter 02/12.jpg": await makePage(2),
    "Chapter 02/2.jpg": await makePage(3), // thu tu tu nhien: 2 < 10
    "Chapter 02/1.jpg": await makePage(4),
  };
  const zip2 = zipSync(files2, { level: 6 });
  writeFileSync(`${OUT_DIR}/chapter02.zip`, zip2);
  console.log(`chapter02.zip: ${(zip2.length / 1024).toFixed(1)} KB (5 trang trong thu muc con, kiem tra natural sort)`);

  // ===== Cover =====
  const coverSvg = `<svg width="600" height="900" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="900" fill="#16130f"/>
  <circle cx="300" cy="330" r="150" fill="none" stroke="#e5484d" stroke-width="12"/>
  <text x="300" y="350" font-family="Arial, sans-serif" font-size="90" font-weight="bold" fill="#e5484d" text-anchor="middle">1</text>
  <text x="300" y="620" font-family="Arial, sans-serif" font-size="52" font-weight="bold" fill="#f5f0e8" text-anchor="middle">TEST MANGA</text>
  <text x="300" y="680" font-family="Arial, sans-serif" font-size="28" fill="#8a8177" text-anchor="middle">E2E COVER</text>
</svg>`;
  const cover = await sharp(Buffer.from(coverSvg)).png().toBuffer();
  writeFileSync(`${OUT_DIR}/cover.png`, cover);
  console.log(`cover.png: ${(cover.length / 1024).toFixed(1)} KB`);

  console.log("\n=> Du lieu test san sang tai /tmp/manga-e2e/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
