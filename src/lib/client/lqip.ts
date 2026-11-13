// =============================================================
// LQIP client-side — sinh placeholder mờ (~16px JPEG base64) +
// màu chủ đạo ngay trên trình duyệt bằng canvas, KHÔNG cần server
// (server không bao giờ thấy bytes ảnh — upload trực tiếp R2).
//
// Lưu ý: giá trị lưu DB là base64 THÔ (không prefix "data:").
// =============================================================

export interface LqipResult {
  /** base64 JPEG ~16px, ~0.3-0.5KB — null nếu không vẽ được */
  lqip: string | null;
  /** màu chủ đạo "#rrggbb" — null nếu không đọc được */
  color: string | null;
}

const LQIP_WIDTH = 16;
const JPEG_QUALITY = 0.45;

/** Vẽ source (Bitmap/Image) lên canvas nhỏ — trả về canvas + ctx */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

/** Sinh LQIP + màu chủ đạo từ Blob ảnh — best effort, không ném lỗi */
export async function generateLqip(blob: Blob): Promise<LqipResult> {
  const empty: LqipResult = { lqip: null, color: null };
  try {
    const bmp = await createImageBitmap(blob);
    try {
      // --- LQIP: co về ~16px rộng, giữ tỉ lệ ---
      const scale = LQIP_WIDTH / bmp.width;
      const small = makeCanvas(LQIP_WIDTH, Math.max(1, bmp.height * scale));
      if (!small) return empty;
      small.ctx.drawImage(bmp, 0, 0, small.canvas.width, small.canvas.height);
      const dataUrl = small.canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const lqip = dataUrl.startsWith("data:image/jpeg;base64,")
        ? dataUrl.slice("data:image/jpeg;base64,".length)
        : null;

      // --- Màu chủ đạo: co về 1x1 (browser tự trung bình màu) ---
      const one = makeCanvas(1, 1);
      let color: string | null = null;
      if (one) {
        one.ctx.drawImage(bmp, 0, 0, 1, 1);
        const [r, g, b] = one.ctx.getImageData(0, 0, 1, 1).data;
        const hex = (n: number) => n.toString(16).padStart(2, "0");
        color = `#${hex(r)}${hex(g)}${hex(b)}`;
      }
      return { lqip, color };
    } finally {
      bmp.close();
    }
  } catch {
    return empty;
  }
}
