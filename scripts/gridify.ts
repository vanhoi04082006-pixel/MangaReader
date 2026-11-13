/** Vẽ lưới % lên 2 sticker sheet để VLM đọc toạ độ chính xác hơn */
import sharp from "sharp";
import path from "path";

async function gridify(src: string, out: string) {
  const img = sharp(path.resolve("upload", src));
  const meta = await img.metadata();
  const W = meta.width ?? 1536;
  const H = meta.height ?? 1024;
  const lines: string[] = [];
  for (let p = 0; p <= 100; p += 5) {
    const x = Math.round((p / 100) * W);
    const y = Math.round((p / 100) * H);
    const major = p % 25 === 0;
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${major ? "#ff2d78" : "#ffffff"}" stroke-opacity="${major ? 0.9 : 0.35}" stroke-width="${major ? 3 : 1.5}"/>`,
      `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? "#ff2d78" : "#ffffff"}" stroke-opacity="${major ? 0.9 : 0.35}" stroke-width="${major ? 3 : 1.5}"/>`
    );
    if (p % 10 === 0) {
      lines.push(`<text x="${Math.min(x + 5, W - 40)}" y="24" font-size="20" fill="#ffe14d" font-family="monospace">${p}</text>`);
      lines.push(`<text x="6" y="${Math.min(y + 22, H - 6)}" font-size="20" fill="#ffe14d" font-family="monospace">${p}</text>`);
    }
  }
  const overlay = Buffer.from(`<svg width="${W}" height="${H}">${lines.join("")}</svg>`);
  await img.composite([{ input: overlay }]).png().toFile(path.resolve("tool-results", out));
  console.log(out, `${W}x${H}`);
}

(async () => {
  await gridify("Bộ sticker mascot mèo Tsundoku tím neon-2.png", "grid-sheet1.png");
  await gridify("Bộ sticker thương hiệu Tsundoku phong cách chibi-1.png", "grid-sheet2.png");
})();
