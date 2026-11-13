/** Phân tích alpha bbox của từng crop hiện tại để tinh chỉnh box crop */
import sharp from "sharp";
import path from "path";
import fs from "fs";

const DIR = path.resolve("public/mascots");
const names = fs.readdirSync(DIR).filter((f) => f.endsWith(".png") && !["contact.png", "badge-full.png"].includes(f));

async function main() {
  for (const n of names) {
    const { data, info } = await sharp(path.join(DIR, n)).raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = info;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * C + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    console.log(
      `${n.padEnd(16)} img ${W}x${H}  content x:${minX}-${maxX} (${((minX / W) * 100).toFixed(0)}%-${((maxX / W) * 100).toFixed(0)}%)  y:${minY}-${maxY} (${((minY / H) * 100).toFixed(0)}%-${((maxY / H) * 100).toFixed(0)}%)`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
