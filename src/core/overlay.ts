/**
 * 叠加调试图：把「渲染结果」和「抽取出来的几何」画在同一张图上，供人眼快速核对。
 *
 * 用法场景：改了抽取逻辑之后，把真实 PDF 跑一遍叠加图，一眼就能看出
 * 文本外框有没有套准、图形线框有没有偏、漏没漏元素。
 */
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

import type { PDFPageProxy } from "./pdfjs.js";
import { extractPage } from "./extract.js";
import { renderPage } from "./render.js";
import type { BBox } from "./geometry.js";

export type OverlayLayer = "render" | "shapes" | "shapeBoxes" | "text" | "labels" | "images" | "legend";

export const OVERLAY_LAYERS: OverlayLayer[] = ["render", "shapes", "shapeBoxes", "text", "labels", "images", "legend"];

/** 默认开启的图层：底图 + 文本外框 + 图形线框 + 位图 + 图例。 */
export const DEFAULT_LAYERS: OverlayLayer[] = ["render", "shapes", "text", "images", "legend"];

export interface OverlayOptions {
  /** 缩放倍数，默认 2（叠加图通常要放大看）。 */
  scale?: number;
  /** 只画局部区域 [x0,y0,x1,y1]，pt，左上原点。 */
  region?: BBox;
  /** 底图背景色，默认白色。 */
  background?: string;
  /** 要叠加的图层，默认 DEFAULT_LAYERS。 */
  layers?: OverlayLayer[];
  /** 叠加线条宽度（设备像素），默认 1。 */
  lineWidth?: number;
  /** 与 renderPage 一致：像素总量上限。 */
  maxPixels?: number;
}

export interface OverlayResult {
  buffer: Buffer;
  width: number;
  height: number;
  scale: number;
  layers: OverlayLayer[];
  counts: { text: number; shapes: number; images: number };
}

const COLOR = {
  text: "#00a2ff",
  baseline: "#ff2d95",
  label: "#ffd400",
  image: "#ff8c00",
  legendBg: "rgba(18,18,22,0.82)",
  legendFg: "#f2f2f2",
} as const;

// 图例/标签里有中文，@napi-rs/canvas 的默认 sans-serif 没有 CJK 字形（会画成豆腐块）。
const CJK_ALIAS = "AjOverlayCJK";
const FONT_STACK = `"${CJK_ALIAS}", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "WenQuanYi Zen Hei", "Segoe UI", sans-serif`;

const CJK_FONT_PATHS = [
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/arphic/uming.ttc",
];

let fontsEnsured = false;

/** 尽量弄一个带中文的字体家族；找不到也不影响线框和英文。 */
function ensureFonts(): void {
  if (fontsEnsured) return;
  fontsEnsured = true;
  try {
    if (GlobalFonts.has(CJK_ALIAS)) return;
    for (const p of CJK_FONT_PATHS) {
      try {
        if (GlobalFonts.registerFromPath(p, CJK_ALIAS)) return;
      } catch {
        /* 换下一个 */
      }
    }
  } catch {
    /* 拿不到系统字体就算了 */
  }
}

function shapeColor(paint: string): string {
  switch (paint) {
    case "fill":
      return "#ff00ff";
    case "stroke":
      return "#00ff66";
    case "fillStroke":
      return "#ff9a00";
    case "clip":
      return "#9aa0a6";
    case "shading":
      return "#ff5252";
    default:
      return "#ffffff";
  }
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 送进 canvas 之前先洗一遍：PDF 里的文本可能带 NUL/控制字符或落单的代理项，
 * 这些会让 napi 转 CString 直接抛错（真实案例里就遇到 "序。\u0000"）。
 */
function safeText(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) out += " ";
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\uFFFD"; // 落单代理项
    else out += ch;
  }
  return out;
}

/** 标签文本：先消毒，再截断。 */
function labelText(input: string, n: number): string {
  return truncate(safeText(input), n);
}

/** 把一页的「渲染 + 抽取几何」叠加成一张 PNG。 */
export async function renderOverlay(page: PDFPageProxy, options: OverlayOptions = {}): Promise<OverlayResult> {
  const layers = options.layers?.length ? options.layers : DEFAULT_LAYERS;
  const has = (l: OverlayLayer) => layers.includes(l);
  const px = Number.isFinite(options.lineWidth) && (options.lineWidth as number) > 0 ? (options.lineWidth as number) : 1;
  ensureFonts();

  const rendered = await renderPage(page, {
    scale: options.scale ?? 2,
    region: options.region,
    background: options.background ?? "#ffffff",
    maxPixels: options.maxPixels,
  });
  const s = rendered.scale;

  const canvas = createCanvas(rendered.width, rendered.height);
  const ctx = canvas.getContext("2d");

  if (has("render")) {
    ctx.drawImage(await loadImage(rendered.buffer), 0, 0, rendered.width, rendered.height);
  } else if ((options.background ?? "#ffffff") !== "transparent") {
    ctx.fillStyle = options.background ?? "#ffffff";
    ctx.fillRect(0, 0, rendered.width, rendered.height);
  }

  const content = await extractPage(page, { precision: 2 });
  const region = options.region;
  const ox = region ? Math.min(region[0], region[2]) : 0;
  const oy = region ? Math.min(region[1], region[3]) : 0;

  // 之后一律用「pt 坐标」作图，由变换负责换算成像素
  ctx.save();
  ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
  const unit = 1 / s; // 一个设备像素
  const lineWidth = px * unit;

  if (has("shapes")) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    for (const shape of content.shapes) {
      if (!shape.subpaths.length) continue;
      ctx.beginPath();
      for (const sp of shape.subpaths) {
        for (const seg of sp.segments) {
          if (seg.t === "M") ctx.moveTo(seg.x, seg.y);
          else if (seg.t === "L") ctx.lineTo(seg.x, seg.y);
          else if (seg.t === "C") ctx.bezierCurveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y);
          else if (seg.t === "Q") ctx.quadraticCurveTo(seg.x1, seg.y1, seg.x, seg.y);
          else if (seg.t === "Z") ctx.closePath();
        }
      }
      ctx.strokeStyle = shapeColor(shape.paint);
      ctx.globalAlpha = shape.paint === "clip" ? 0.55 : 0.9;
      if (shape.paint === "clip") ctx.setLineDash([4 * unit, 3 * unit]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  if (has("shapeBoxes")) {
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([3 * unit, 3 * unit]);
    ctx.globalAlpha = 0.6;
    for (const shape of content.shapes) {
      ctx.strokeStyle = shapeColor(shape.paint);
      const [x0, y0, x1, y1] = shape.bbox;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  if (has("text")) {
    ctx.lineWidth = lineWidth;
    for (const t of content.text) {
      const [x0, y0, x1, y1] = t.bbox;
      ctx.strokeStyle = COLOR.text;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      // 基线：起点方块 + 一条细线，用来核对基线与宽度
      ctx.strokeStyle = COLOR.baseline;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(t.x + t.width, t.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLOR.baseline;
      ctx.fillRect(t.x - 1.5 * unit, t.y - 1.5 * unit, 3 * unit, 3 * unit);
    }
  }

  if (has("labels")) {
    const size = 9 / s;
    ctx.font = `${size}px ${FONT_STACK}`;
    ctx.fillStyle = COLOR.label;
    ctx.textBaseline = "bottom";
    for (const t of content.text) {
      if (!t.text.trim()) continue;
      ctx.fillText(labelText(t.text, 24), t.bbox[0], t.bbox[1] - unit);
    }
    ctx.textBaseline = "alphabetic";
  }

  if (has("images")) {
    ctx.lineWidth = lineWidth;
    for (const img of content.images) {
      const [x0, y0, x1, y1] = img.bbox;
      ctx.strokeStyle = COLOR.image;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.font = `${9 / s}px ${FONT_STACK}`;
    ctx.fillStyle = COLOR.image;
    for (const img of content.images) {
      const size = img.intrinsicWidth && img.intrinsicHeight ? ` ${img.intrinsicWidth}×${img.intrinsicHeight}` : "";
      // 来自平铺图案的位图单独特标记，免得跟普通贴图混起来看不出门道
      const tag = img.pattern ? " pattern" : "";
      ctx.fillText(`img${size}${tag}`, img.bbox[0], img.bbox[1] - unit);
    }
  }
  ctx.restore();

  if (has("legend")) {
    const paintCounts = new Map<string, number>();
    for (const shape of content.shapes) paintCounts.set(shape.paint, (paintCounts.get(shape.paint) ?? 0) + 1);
    drawLegend(ctx, {
      layers,
      width: rendered.width,
      text: content.text.length,
      images: content.images.length,
      patterns: content.images.filter((i) => i.pattern).length,
      paintCounts,
    });
  }

  return {
    buffer: canvas.toBuffer("image/png"),
    width: rendered.width,
    height: rendered.height,
    scale: s,
    layers,
    counts: { text: content.text.length, shapes: content.shapes.length, images: content.images.length },
  };
}

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

interface LegendInput {
  layers: OverlayLayer[];
  width: number;
  text: number;
  images: number;
  /** 其中来自平铺图案（TilingPattern）的位图数量。 */
  patterns: number;
  paintCounts: Map<string, number>;
}

const PAINT_LABEL: Record<string, string> = {
  fill: "fill 填充",
  stroke: "stroke 描边",
  fillStroke: "fillStroke 填充+描边",
  shading: "shading 渐变",
  clip: "clip 裁剪区",
};

function drawLegend(ctx: Ctx, input: LegendInput): void {
  const rows: [string, string][] = [];

  if (input.layers.includes("text")) {
    rows.push([COLOR.text, `文本外框 ×${input.text}`]);
    rows.push([COLOR.baseline, "基线起点 / 宽度"]);
  }
  if (input.layers.includes("labels")) rows.push([COLOR.label, "文本内容"]);
  if (input.layers.includes("shapes")) {
    for (const [paint, label] of Object.entries(PAINT_LABEL)) {
      const n = input.paintCounts.get(paint);
      if (n) rows.push([shapeColor(paint), `${label} ×${n}`]);
    }
  }
  if (input.layers.includes("shapeBoxes")) rows.push(["#9aa0a6", "图形外框（虚线）"]);
  if (input.layers.includes("images")) {
    rows.push([COLOR.image, `位图外框 ×${input.images}`]);
    if (input.patterns) rows.push([COLOR.image, `（含图案单元位图 ×${input.patterns}）`]);
  }
  if (!input.layers.includes("render")) rows.push(["#ffffff", "（未叠加渲染底图）"]);

  const pad = 8;
  const fs = 12;
  const lh = fs + 5;
  ctx.font = `${fs}px ${FONT_STACK}`;
  let w = 0;
  for (const [, label] of rows) w = Math.max(w, ctx.measureText(label).width);
  const boxW = Math.round(w + pad * 2 + 22);
  const boxH = Math.round(rows.length * lh + pad * 2 + 2);
  const x = Math.max(pad, input.width - boxW - pad);
  const y = pad;

  ctx.fillStyle = COLOR.legendBg;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

  ctx.font = `${fs}px ${FONT_STACK}`;
  ctx.textBaseline = "middle";
  rows.forEach(([color, label], i) => {
    const cy = y + pad + lh * i + lh / 2;
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, cy - 4, 12, 8);
    ctx.fillStyle = COLOR.legendFg;
    ctx.fillText(label, x + pad + 18, cy);
  });
  ctx.textBaseline = "alphabetic";
}
