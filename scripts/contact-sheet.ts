/** Tạo contact sheet các mascot đã crop để verify bằng VLM */
import sharp, { type OverlayOptions } from "sharp";
import path from "path";
import fs from "fs";

const DIR = path.resolve("public/mascots");
const names = fs.readdirSync(DIR).filter((f) => f.endsWith(".png") && f !== "contact.png" && f !== "badge-full.png");

const CELL = 240;
const cols = 4;
const rows = Math.ceil(names.length / cols);

async function main() {
  const composites: OverlayOptions[] = [];
  for (let i = 0; i < names.length; i++) {
    const buf = await sharp(path.join(DIR, names[i]))
      .resize(CELL - 20, CELL - 50, { fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(buf).metadata();
    const x = (i % cols) * CELL + (CELL - (meta.width ?? 0)) / 2;
    const y = Math.floor(i / cols) * CELL + 10;
    composites.push({ input: buf, left: Math.round(x), top: Math.round(y) });
    // label
    const label = Buffer.from(
      `<svg width="${CELL}" height="40"><text x="50%" y="28" text-anchor="middle" font-size="22" font-family="sans-serif" fill="#fff">${names[i].replace(".png", "")}</text></svg>`
    );
    composites.push({ input: label, left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL + CELL - 42 });
  }
  await sharp({
    create: { width: cols * CELL, height: rows * CELL, channels: 4, background: { r: 40, g: 20, b: 60, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(path.join(DIR, "contact.png"));
  console.log("contact sheet:", names.join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
