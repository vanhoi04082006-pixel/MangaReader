/**
 * Sinh toàn bộ bộ icon web/app từ badge mascot TSUNDOKU:
 * - favicon.ico (16/32/48, PNG-in-ICO)
 * - icon-192.png, icon-512.png (PWA)
 * - icon-maskable-*.png (safe-zone 80% trên nền tím đậm)
 * - apple-touch-icon.png (180)
 * - og-image.png (1200x630)
 * Run: bun scripts/gen-icons.ts
 */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const SRC = path.resolve("upload/Mèo đen Tsundoku đọc manga neon.png");
const OUT = path.resolve("public");
const MASK_BG = { r: 21, g: 12, b: 34, alpha: 1 }; // #150c22

/** Gói PNG buffer thành entry ICO (PNG-in-ICO, chuẩn Vista+) */
function pngToIco(entries: { width: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dirLen = 16 * entries.length;
  let offset = 6 + dirLen;
  const dirs: Buffer[] = [];
  const pngs: Buffer[] = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.width >= 256 ? 0 : e.width;
    d[1] = e.width >= 256 ? 0 : e.width;
    d[2] = 0; d[3] = 0;
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    dirs.push(d);
    pngs.push(e.png);
    offset += e.png.length;
  }
  return Buffer.concat([header, ...dirs, ...pngs]);
}

async function main() {
  const badge = sharp(SRC);

  // ---- favicon.ico ----
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map((s) => badge.clone().resize(s, s).png().toBuffer()));
  fs.writeFileSync(path.join(OUT, "favicon.ico"), pngToIco(pngs.map((p, i) => ({ width: sizes[i], png: p }))));
  console.log("favicon.ico");

  // ---- PWA icons ----
  for (const s of [192, 512]) {
    await badge.clone().resize(s, s).png({ compressionLevel: 9 }).toFile(path.join(OUT, `icon-${s}.png`));
    console.log(`icon-${s}.png`);
  }

  // ---- Maskable icons: badge thu 78% giữa nền tím đậm full-bleed ----
  for (const s of [192, 512]) {
    const inner = Math.round(s * 0.78);
    const buf = await badge.clone().resize(inner, inner).png().toBuffer();
    await sharp({ create: { width: s, height: s, channels: 4, background: MASK_BG } })
      .composite([{ input: buf, left: Math.round((s - inner) / 2), top: Math.round((s - inner) / 2) }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `icon-maskable-${s}.png`));
    console.log(`icon-maskable-${s}.png`);
  }

  // ---- Apple touch icon (180, nền đặc — iOS không hỗ trợ transparency) ----
  await badge.clone().resize(180, 180).png().toFile(path.join(OUT, "apple-touch-icon.png"));
  console.log("apple-touch-icon.png");

  // ---- OG image 1200x630 ----
  const ogBadge = await badge.clone().resize(560, 560).png().toBuffer();
  // glow quanh badge
  const ogSvg = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="0.28" cy="0.5" r="1.1">
        <stop offset="0" stop-color="#3b1f5c"/>
        <stop offset="0.55" stop-color="#1a0e2e"/>
        <stop offset="1" stop-color="#0d0716"/>
      </radialGradient>
      <linearGradient id="txt" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5ebff"/>
        <stop offset="1" stop-color="#d8b4fe"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <g opacity="0.13" fill="#c9a0e8">
      ${Array.from({ length: 26 }, (_, i) => {
        const x = (i * 137 + 40) % 1180, y = (i * 271 + 90) % 600;
        const r = 2 + ((i * 7) % 4);
        return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
      }).join("")}
    </g>
    <text x="650" y="300" font-family="Arial, sans-serif" font-weight="800" font-size="78" letter-spacing="1" fill="url(#txt)">TSUNDOKU</text>
    <text x="653" y="358" font-family="Arial, sans-serif" font-weight="500" font-size="29" letter-spacing="5" fill="#c9a0e8">PERSONAL MANGA READER</text>
    <rect x="653" y="390" width="150" height="6" rx="3" fill="#f04fc4"/>
  </svg>`);
  await sharp(ogSvg)
    .composite([{ input: ogBadge, left: 60, top: 35 }])
    .png()
    .toFile(path.join(OUT, "og-image.png"));
  console.log("og-image.png");

  // ---- Hero mascot (badge bo góc cho sidebar/empty states) ----
  await sharp(SRC)
    .resize(512, 512)
    .composite([{
      // mask trắng bo góc + dest-in = giữ pixel trong góc bo, ngoài = trong suốt
      input: Buffer.from(`<svg width="512" height="512"><rect x="0" y="0" width="512" height="512" rx="104" fill="#fff"/></svg>`),
      blend: "dest-in",
    }])
    .png()
    .toFile(path.join(OUT, "mascots", "badge.png"));
  console.log("mascots/badge.png (bo góc)");
}
main().catch((e) => { console.error(e); process.exit(1); });
