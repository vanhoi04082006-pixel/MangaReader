// =============================================================
// Sinh icon PWA tu public/logo.svg (bun run scripts/generate-pwa-icons.ts)
// Can: sharp (da co trong dependencies).
// Ket qua xuat vao public/icons/:
// - icon-192.png / icon-512.png      : logo goc (manifest "any")
// - icon-maskable-512.png            : Android adaptive (noi dung trong vung
//                                      an toan 80%, nen toan mau brand)
// - apple-touch-icon.png             : iOS home screen 180px (khong trong
//                                      suot — iOS tu bo tron va nen den)
// =============================================================
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

const logo = "public/logo.svg";
// logo.svg viewBox 64px -> de rasterize sac ro o 512 can density >= 768 dpi
const DENSITY = 1000;

// --- Icon thuong (co bo tron san trong SVG) ---
await sharp(logo, { density: DENSITY }).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(logo, { density: DENSITY }).resize(512, 512).png().toFile("public/icons/icon-512.png");

// --- Maskable (Android adaptive icon): nen full-bleed + logo 75% ---
// Vung an toan maskable la duong tron ban kinh 40% -> noi dung phai nam
// trong tam 80% (512 * 0.8 = 410px; logo 384 + le 64 moi ben = OK).
const bgMaskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1b1512"/></svg>`
);
const logoMaskable = await sharp(logo, { density: DENSITY }).resize(384, 384).png().toBuffer();
await sharp(bgMaskable)
  .composite([{ input: logoMaskable, top: 64, left: 64 }])
  .png()
  .toFile("public/icons/icon-maskable-512.png");

// --- Apple touch icon (180, nen dac — khong duoc trong suot) ---
const bgApple = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#1b1512"/></svg>`
);
const logoApple = await sharp(logo, { density: DENSITY }).resize(144, 144).png().toBuffer();
await sharp(bgApple)
  .composite([{ input: logoApple, top: 18, left: 18 }])
  .png()
  .toFile("public/icons/apple-touch-icon.png");

console.log("[generate-pwa-icons] done: public/icons/*.png");
