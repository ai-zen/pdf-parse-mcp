/** 页面渲染：把一页 PDF 画成位图（PNG/JPEG）。 */
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "./pdfjs.js";
import type { BBox } from "./geometry.js";

export interface RenderOptions {
  /** 缩放倍数（相对 72dpi）。与 dpi 二选一，dpi 优先。 */
  scale?: number;
  /** 目标分辨率，scale = dpi / 72。 */
  dpi?: number;
  /** 只渲染页面局部，[x0, y0, x1, y1]，pt，左上原点。 */
  region?: BBox;
  /** 背景色，默认白色；传 "transparent" 保持透明。 */
  background?: string;
  /** 输出格式，默认 png。 */
  format?: "png" | "jpeg";
  /** 像素总量上限，超出会自动降采样。默认 40_000_000。 */
  maxPixels?: number;
}

export interface RenderResult {
  buffer: Buffer;
  width: number;
  height: number;
  /** 实际使用的缩放倍数（可能因 maxPixels 而降低）。 */
  scale: number;
  format: "png" | "jpeg";
}

export async function renderPage(page: PDFPageProxy, options: RenderOptions = {}): Promise<RenderResult> {
  const format = options.format ?? "png";
  let scale = options.scale ?? (options.dpi ? options.dpi / 72 : 1);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const viewport = page.getViewport({ scale: 1 });
  const region = options.region;

  let widthPt = viewport.width;
  let heightPt = viewport.height;
  let offsetX = 0;
  let offsetY = 0;
  if (region) {
    const [x0, y0, x1, y1] = region;
    offsetX = Math.min(x0, x1);
    offsetY = Math.min(y0, y1);
    widthPt = Math.abs(x1 - x0);
    heightPt = Math.abs(y1 - y0);
    if (!(widthPt > 0) || !(heightPt > 0)) throw new Error("region 面积必须大于 0");
  }

  const maxPixels = options.maxPixels ?? 40_000_000;
  const requested = widthPt * scale * heightPt * scale;
  if (requested > maxPixels) {
    scale *= Math.sqrt(maxPixels / requested);
  }

  const pixelW = Math.max(1, Math.ceil(widthPt * scale));
  const pixelH = Math.max(1, Math.ceil(heightPt * scale));

  const canvas: Canvas = createCanvas(pixelW, pixelH);
  const ctx = canvas.getContext("2d");

  const background = options.background ?? "#ffffff";
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, pixelW, pixelH);
  }

  const scaled = page.getViewport({ scale });
  if (region) {
    ctx.setTransform(1, 0, 0, 1, -offsetX * scale, -offsetY * scale);
  }

  // @napi-rs/canvas 的上下文与 DOM 类型不同，但运行时兼容（pdfjs 在 Node 下内部也是用它建 canvas 的）
  const params = { canvasContext: ctx, viewport: scaled } as unknown as Parameters<PDFPageProxy["render"]>[0];
  await page.render(params).promise;

  const buffer = format === "jpeg" ? canvas.toBuffer("image/jpeg", 92) : canvas.toBuffer("image/png");
  return { buffer, width: pixelW, height: pixelH, scale, format };
}
