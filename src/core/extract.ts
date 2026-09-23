/**
 * 页面内容抽取：把一页 PDF 还原成
 *   - 文本：每个片段的字符串、基线坐标、字号、旋转、颜色、外框
 *   - 矢量图形：每条路径的几何（子路径/线段/贝塞尔）、填充/描边色、线宽、外框
 *   - 位图：贴图位置与外框
 * 全部坐标统一为「左上原点、y 向下、单位 pt（1/72 英寸）」。
 *
 * 做法：用 pdfjs 的 operator list 做一个小型解释器，自己维护 CTM 与图形状态栈，
 * 把用户空间坐标换算到设备空间；文本字符串/度量则取自 getTextContent（更准），
 * 再用 operator list 里的绘图顺序给文本补上颜色。
 */
import { OPS, type PDFPageProxy } from "./pdfjs.js";
import {
  applyPoint,
  boxOfPoints,
  boxOfRect,
  cmykToHex,
  expandBox,
  grayToHex,
  IDENTITY,
  intersectBox,
  invertMatrix,
  mul,
  roundBox,
  roundTo,
  rotationOf,
  scaleOf,
  type BBox,
  type Matrix,
} from "./geometry.js";

export type PathSegment =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: "Q"; x1: number; y1: number; x: number; y: number }
  | { t: "Z" };

export interface SubPath {
  closed: boolean;
  bbox: BBox;
  segments: PathSegment[];
}

export type PaintKind = "fill" | "stroke" | "fillStroke" | "clip" | "shading";

export interface Shape {
  paint: PaintKind;
  bbox: BBox;
  evenOdd?: boolean;
  fill?: string | null;
  stroke?: string | null;
  fillAlpha?: number;
  strokeAlpha?: number;
  strokeWidth?: number;
  lineCap?: number;
  lineJoin?: number;
  miterLimit?: number;
  dash?: number[];
  subpaths: SubPath[];
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  rotation: number;
  bbox: BBox;
  fontName?: string;
  fontFamily?: string;
  /** 可见颜色。若该文本被后绘制的不透明图形盖住（隐藏文本层），则不给颜色。 */
  color?: string;
  alpha?: number;
  dir?: string;
  eol?: boolean;
  /** 该文本被后绘制的不透明图形完全覆盖 —— 通常是「隐藏文本层」，其颜色/位置来自不可见图层，别当可见内容用。 */
  covered?: boolean;
  /** color 的来源：`outline` 表示取自已把文字转成轮廓的可见图形（隐藏文本层的反推）。 */
  colorFrom?: "outline";
}

export interface ImageItem {
  kind: "image" | "inline" | "mask" | "repeat";
  name?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  bbox: BBox;
  /**
   * 该位图来自平铺图案（TilingPattern）的图案单元。图案单元在页面上会按
   * XStep/YStep 平铺，这里只给出「图案单元这一份」中可见（即与填充区域相交）的那部分，
   * bbox 只是那一份的外框，不代表整片平铺范围。
   */
  pattern?: true;
}

export interface PageContent {
  page: number;
  width: number;
  height: number;
  rotation: number;
  unit: "pt";
  coord: "top-left origin, y down";
  text: TextItem[];
  shapes: Shape[];
  images: ImageItem[];
  fonts: Record<string, { family?: string; ascent: number; descent: number }>;
}

interface State {
  ctm: Matrix;
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dash: number[];
  fill: string | null;
  stroke: string | null;
  fillAlpha: number;
  strokeAlpha: number;
}

type UserSubPath = { closed: boolean; segments: PathSegment[] };

/** 平铺图案（TilingPattern）的图案单元：一段 operator list + 图案矩阵 + 平铺网格。 */
interface PendingPattern {
  opList: { fnArray: number[]; argsArray: unknown[][] };
  matrix: Matrix | null;
  /** 图案单元的 BBox（图案空间），平铺网格以它为原点。 */
  cell: BBox | null;
  stepX: number;
  stepY: number;
}

const DEFAULT_ASCENT = 0.8;
const DEFAULT_DESCENT = -0.2;

function cloneState(s: State): State {
  return { ...s, ctm: [...s.ctm] as Matrix, dash: [...s.dash] };
}

/** 解码 pdfjs v6 `constructPath` 里那种扁平编码的路径数据。 */
function decodePath(data: ArrayLike<number>, out: UserSubPath[]): void {
  let cur: UserSubPath | undefined;
  const ensure = (): UserSubPath => {
    let c = cur;
    if (!c) {
      c = { closed: false, segments: [] };
      cur = c;
      out.push(c);
    }
    return c;
  };
  const n = data.length;
  let i = 0;
  while (i < n) {
    const cmd = data[i++] | 0;
    if (cmd === 0) {
      const x = data[i++];
      const y = data[i++];
      cur = { closed: false, segments: [{ t: "M", x, y }] };
      out.push(cur);
    } else if (cmd === 1) {
      const x = data[i++];
      const y = data[i++];
      ensure().segments.push({ t: "L", x, y });
    } else if (cmd === 2) {
      const x1 = data[i++];
      const y1 = data[i++];
      const x2 = data[i++];
      const y2 = data[i++];
      const x = data[i++];
      const y = data[i++];
      ensure().segments.push({ t: "C", x1, y1, x2, y2, x, y });
    } else if (cmd === 3) {
      const x1 = data[i++];
      const y1 = data[i++];
      const x = data[i++];
      const y = data[i++];
      ensure().segments.push({ t: "Q", x1, y1, x, y });
    } else if (cmd === 4) {
      ensure().closed = true;
    } else {
      return; // 未知编码：放弃剩余数据
    }
  }
}

/** 把用户空间的路径段映射到设备空间，并收集所有端点用于求外框。 */
function mapSubPaths(userPaths: UserSubPath[], m: Matrix, digits: number): { subpaths: SubPath[]; points: [number, number][] } {
  const allPoints: [number, number][] = [];
  const subpaths = userPaths.map((sp) => {
    const pts: [number, number][] = [];
    const segments: PathSegment[] = sp.segments.map((seg) => {
      if (seg.t === "M") {
        const p = applyPoint(m, seg.x, seg.y);
        pts.push(p);
        return { t: "M", x: roundTo(p[0], digits), y: roundTo(p[1], digits) };
      }
      if (seg.t === "L") {
        const p = applyPoint(m, seg.x, seg.y);
        pts.push(p);
        return { t: "L", x: roundTo(p[0], digits), y: roundTo(p[1], digits) };
      }
      if (seg.t === "C") {
        const p1 = applyPoint(m, seg.x1, seg.y1);
        const p2 = applyPoint(m, seg.x2, seg.y2);
        const p = applyPoint(m, seg.x, seg.y);
        pts.push(p1, p2, p);
        return {
          t: "C",
          x1: roundTo(p1[0], digits),
          y1: roundTo(p1[1], digits),
          x2: roundTo(p2[0], digits),
          y2: roundTo(p2[1], digits),
          x: roundTo(p[0], digits),
          y: roundTo(p[1], digits),
        };
      }
      if (seg.t === "Q") {
        const p1 = applyPoint(m, seg.x1, seg.y1);
        const p = applyPoint(m, seg.x, seg.y);
        pts.push(p1, p);
        return { t: "Q", x1: roundTo(p1[0], digits), y1: roundTo(p1[1], digits), x: roundTo(p[0], digits), y: roundTo(p[1], digits) };
      }
      return { t: "Z" } as PathSegment;
    });
    allPoints.push(...pts);
    return { closed: sp.closed, bbox: roundBox(boxOfPoints(pts), digits), segments };
  });
  return { subpaths, points: allPoints };
}

interface RawRun {
  x: number;
  y: number;
  fontSize: number;
  color?: string;
  alpha?: number;
  /** 对应的 operator 序号，用于判断后续是否有图形把它盖住。 */
  seq: number;
}

class Interpreter {
  readonly shapes: Shape[] = [];
  /** 与 shapes 一一对应的 operator 序号（用于判断“谁把谁盖住了”）。 */
  readonly shapeSeq: number[] = [];
  readonly images: ImageItem[] = [];
  readonly runs: RawRun[] = [];
  readonly digits: number;

  private state: State;
  private stack: State[] = [];
  private userPath: UserSubPath[] = [];
  private opIndex = 0;
  /** clip/eoClip 只是“标记”，真正的路径由随后的 endPath 送上。 */
  private pendingClip: boolean | null = null;
  /**
   * pdfjs 的 baseTransform：图案空间要靠它落到设备空间。
   * 它等于「当前内容流的默认坐标系」——页面内容流就是页面基矩阵，
   * 进了表单 XObject（paintFormXObjectBegin）就换成那一刻的 CTM。
   */
  private baseTransform: Matrix;
  private baseTransformStack: Matrix[] = [];
  /** setFillColorN/setStrokeColorN 用平铺图案填充时，把图案单元存下来，等真正绘制那一下再进去抽。 */
  private pendingPattern: PendingPattern | null = null;

  // 文本状态
  private tm: Matrix | null = null;
  private tmScale = 1;
  private tx = 0;
  private ty = 0;
  private leading = 0;
  private charSpacing = 0;
  private wordSpacing = 0;
  private hScale = 1;
  private textRise = 0;
  private fontSize = 0;
  private textMode = 0;

  constructor(base: Matrix, digits: number) {
    this.digits = digits;
    this.baseTransform = base;
    this.state = {
      ctm: base,
      lineWidth: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dash: [],
      fill: "#000000",
      stroke: "#000000",
      fillAlpha: 1,
      strokeAlpha: 1,
    };
  }

  private d(n: number): number {
    return roundTo(n, this.digits);
  }

  /** 当前 CTM 下，文本基线原点的设备坐标与有效字号。 */
  private textPosition(): { x: number; y: number; fontSize: number } | null {
    if (!this.tm) return null;
    const tm: Matrix = [this.tm[0], this.tm[1], this.tm[2], this.tm[3], this.tm[4] + this.tx, this.tm[5] + this.ty + this.textRise];
    const m = mul(this.state.ctm, tm);
    const [x, y] = applyPoint(m, 0, 0);
    return { x, y, fontSize: Math.hypot(m[2], m[3]) * this.tmScale };
  }

  private pushRun(): void {
    const pos = this.textPosition();
    if (!pos) return;
    // 文本渲染模式：0/4/7 填充，1/5/8 描边，2/6 先填后描
    const stroked = (this.textMode & 3) === 1 || (this.textMode & 3) === 2;
    const color = stroked ? this.state.stroke : this.state.fill;
    const alpha = stroked ? this.state.strokeAlpha : this.state.fillAlpha;
    const run: RawRun = { x: pos.x, y: pos.y, fontSize: pos.fontSize, seq: this.opIndex };
    if (color) run.color = color;
    if (alpha !== 1) run.alpha = this.d(alpha);
    this.runs.push(run);
  }

  /** 依据 showText 的字形宽度推进文本位置（等价于 pdfjs 的 computeAdjustedWidth）。 */
  private advance(glyphs: unknown): number {
    let sum = 0;
    let count = 0;
    let spaces = 0;
    for (const g of glyphs as { width?: number; unicode?: string }[]) {
      if (typeof g?.width !== "number") continue;
      sum += g.width;
      count++;
      if (g.unicode === " ") spaces++;
    }
    const fs = this.fontSize * this.hScale;
    return (sum * fs) / 1000 + this.charSpacing * count + this.wordSpacing * spaces;
  }

  private showText(glyphs: unknown, advance = true): void {
    this.pushRun();
    if (advance) this.tx += this.advance(glyphs);
  }

  private emit(paint: PaintKind, minMax: ArrayLike<number> | null, evenOdd: boolean): void {
    const state = this.state;
    if (this.userPath.length === 0) return;
    const mapped = mapSubPaths(this.userPath, state.ctm, this.digits);

    let bbox: BBox;
    if (minMax && minMax.length >= 4) {
      bbox = boxOfRect(state.ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
    } else {
      bbox = boxOfPoints(mapped.points);
    }
    if (paint === "stroke" || paint === "fillStroke") {
      bbox = expandBox(bbox, (state.lineWidth * scaleOf(state.ctm)) / 2);
    }
    bbox = roundBox(bbox, this.digits);

    const shape: Shape = { paint, bbox, subpaths: mapped.subpaths };
    if (evenOdd) shape.evenOdd = true;
    if (paint === "fill" || paint === "fillStroke" || paint === "shading") {
      shape.fill = state.fill;
      shape.fillAlpha = this.d(state.fillAlpha);
    }
    if (paint === "stroke" || paint === "fillStroke") {
      shape.stroke = state.stroke;
      shape.strokeAlpha = this.d(state.strokeAlpha);
      shape.strokeWidth = this.d(state.lineWidth * scaleOf(state.ctm));
      shape.lineCap = state.lineCap;
      shape.lineJoin = state.lineJoin;
      shape.miterLimit = this.d(state.miterLimit);
      if (state.dash.length) shape.dash = state.dash.map((v) => this.d(v));
    }
    this.shapes.push(shape);
    this.shapeSeq.push(this.opIndex);
    this.userPath = [];
    // 这一笔如果是用平铺图案画的，顺便把图案单元里的位图抽出来
    if (paint !== "clip") this.collectPatternImages(bbox);
  }

  /**
   * 抽平铺图案（TilingPattern）里的位图。
   *
   * 图案单元的内容躺在「图案空间」里：pdfjs 渲染时用 `默认坐标系基矩阵 ∘ 图案矩阵`
   * 把它映射到设备空间（图案锚在当前内容流的默认坐标系上，跟绘制那一刻的 CTM 无关）。
   * 图案会按 XStep/YStep 平铺，网格以图案 BBox 为原点；这里挑「压住填充区域左上角」
   * 的那一格（跟 pdfjs 挑第一格的算法一致），只交出一份图案单元，再用填充区域的外框
   * 裁一刀 —— 免得报出一片根本看不见的外框（Skia 导出的图案单元常常是整页大小）。
   */
  private collectPatternImages(clip: BBox): void {
    const pending = this.pendingPattern;
    if (!pending) return;
    this.pendingPattern = null;

    const base = pending.matrix ? mul(this.baseTransform, pending.matrix) : this.baseTransform;
    const tile = this.patternTileOffset(base, clip, pending);
    const sub = new Interpreter(mul(base, tile), this.digits);
    sub.run(pending.opList);
    for (const img of sub.images) {
      const bbox = intersectBox(img.bbox, clip);
      if (!bbox) continue;
      this.images.push({ ...img, bbox: roundBox(bbox, this.digits), pattern: true });
    }
  }

  /** 把填充区域的外框逆映射回图案空间，算出覆盖它左上角的那一格平铺偏移量。 */
  private patternTileOffset(base: Matrix, clip: BBox, pattern: PendingPattern): Matrix {
    const inv = invertMatrix(base);
    if (!inv || !pattern.cell || !pattern.stepX || !pattern.stepY) return IDENTITY;
    // 角点要用对角两点分别映射（base 里常有 y 翻转，不能只取画布空间的左上角）
    const c1 = applyPoint(inv, clip[0], clip[1]);
    const c2 = applyPoint(inv, clip[2], clip[3]);
    const px = Math.min(c1[0], c2[0]);
    const py = Math.min(c1[1], c2[1]);
    const n = Math.floor((px - pattern.cell[0]) / Math.abs(pattern.stepX));
    const m = Math.floor((py - pattern.cell[1]) / Math.abs(pattern.stepY));
    return [1, 0, 0, 1, n * pattern.stepX, m * pattern.stepY];
  }

  /** setFillColorN/setStrokeColorN：参数是平铺图案时把图案单元记下来，否则清掉上一份。 */
  private notePattern(op: number, args: unknown[]): void {
    const isPattern = (op === OPS.setFillColorN || op === OPS.setStrokeColorN) && args[0] === "TilingPattern";
    const opList = args[2] as PendingPattern["opList"] | undefined;
    const m = args[3] as number[] | null | undefined;
    const cell = args[4] as number[] | null | undefined;
    const stepX = args[5] as number | undefined;
    const stepY = args[6] as number | undefined;
    if (!isPattern || !opList || !Array.isArray(opList.fnArray)) {
      this.pendingPattern = null;
      return;
    }
    this.pendingPattern = {
      opList,
      matrix: Array.isArray(m) && m.length >= 6 ? [m[0], m[1], m[2], m[3], m[4], m[5]] : null,
      cell: Array.isArray(cell) && cell.length >= 4 ? [cell[0], cell[1], cell[2], cell[3]] : null,
      stepX: typeof stepX === "number" ? stepX : 0,
      stepY: typeof stepY === "number" ? stepY : 0,
    };
  }

  /** endPath（`n`）：若此前有 clip/eoClip 标记，这条路径就是裁剪区，记下来；否则是纯丢弃的路径，忽略。 */
  private consumePendingClip(minMax: ArrayLike<number> | null): void {
    if (this.pendingClip === null) {
      this.userPath = [];
      return;
    }
    const evenOdd = this.pendingClip;
    this.pendingClip = null;
    this.emit("clip", minMax, evenOdd);
  }

  private unitSquareBox(): BBox {
    return roundBox(boxOfRect(this.state.ctm, 0, 0, 1, 1), this.digits);
  }

  private addUserSegment(seg: PathSegment): void {
    if (seg.t === "M") {
      this.userPath.push({ closed: false, segments: [seg] });
      return;
    }
    if (this.userPath.length === 0) this.userPath.push({ closed: false, segments: [] });
    const cur = this.userPath[this.userPath.length - 1];
    if (seg.t === "Z") cur.closed = true;
    else cur.segments.push(seg);
  }

  run(opList: { fnArray: number[]; argsArray: unknown[][] }): void {
    const { fnArray, argsArray } = opList;
    for (let i = 0; i < fnArray.length; i++) {
      const op = fnArray[i];
      const args = (argsArray[i] ?? []) as unknown[];
      this.opIndex = i;
      this.step(op, args);
    }
  }

  private step(op: number, args: unknown[]): void {
    const s = this.state;
    switch (op) {
      case OPS.save:
        this.stack.push(cloneState(s));
        break;
      case OPS.restore:
        if (this.stack.length) this.state = this.stack.pop()!;
        break;
      case OPS.transform: {
        const t = args as number[];
        s.ctm = mul(s.ctm, [t[0], t[1], t[2], t[3], t[4], t[5]]);
        break;
      }

      // ---- 路径构造（老式逐指令）----
      case OPS.moveTo:
        this.addUserSegment({ t: "M", x: args[0] as number, y: args[1] as number });
        break;
      case OPS.lineTo:
        this.addUserSegment({ t: "L", x: args[0] as number, y: args[1] as number });
        break;
      case OPS.curveTo:
        this.addUserSegment({
          t: "C",
          x1: args[0] as number,
          y1: args[1] as number,
          x2: args[2] as number,
          y2: args[3] as number,
          x: args[4] as number,
          y: args[5] as number,
        });
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        this.addUserSegment({
          t: "C",
          x1: args[0] as number,
          y1: args[1] as number,
          x2: args[2] as number,
          y2: args[3] as number,
          x: args[2] as number,
          y: args[3] as number,
        });
        break;
      case OPS.closePath:
        this.addUserSegment({ t: "Z" });
        break;
      case OPS.rectangle: {
        const [x, y, w, h] = args as number[];
        this.addUserSegment({ t: "M", x, y });
        this.addUserSegment({ t: "L", x: x + w, y });
        this.addUserSegment({ t: "L", x: x + w, y: y + h });
        this.addUserSegment({ t: "L", x, y: y + h });
        this.addUserSegment({ t: "Z" });
        break;
      }

      // ---- 绘制（老式）----
      case OPS.fill:
        this.emit("fill", null, false);
        break;
      case OPS.eoFill:
        this.emit("fill", null, true);
        break;
      case OPS.stroke:
      case OPS.closeStroke:
        this.emit("stroke", null, false);
        break;
      case OPS.fillStroke:
      case OPS.closeFillStroke:
        this.emit("fillStroke", null, false);
        break;
      case OPS.eoFillStroke:
      case OPS.closeEOFillStroke:
        this.emit("fillStroke", null, true);
        break;
      // clip/eoClip 只是“打个标记”，真正带着路径的是紧随其后的 endPath
      case OPS.clip:
        this.pendingClip = false;
        break;
      case OPS.eoClip:
        this.pendingClip = true;
        break;
      case OPS.endPath:
        this.consumePendingClip(null);
        break;

      // ---- 绘制（pdfjs v6 合并形式）----
      case OPS.constructPath: {
        const paintOp = args[0] as number;
        // pdfjs 把路径数据包在一层数组里传过来（constructPath 内部 `let [path] = data`）
        const rawArgs = args[1] as unknown;
        const data = (Array.isArray(rawArgs) && typeof rawArgs[0] !== "number" ? rawArgs[0] : rawArgs) as ArrayLike<number>;
        const minMax = (args[2] ?? null) as ArrayLike<number> | null;
        this.userPath = [];
        decodePath(data, this.userPath);
        if (paintOp === OPS.endPath) {
          this.consumePendingClip(minMax);
          break;
        }
        const kind: PaintKind =
          paintOp === OPS.fill || paintOp === OPS.eoFill
            ? "fill"
            : paintOp === OPS.stroke || paintOp === OPS.closeStroke
              ? "stroke"
              : paintOp === OPS.clip || paintOp === OPS.eoClip
                ? "clip"
                : "fillStroke";
        const evenOdd =
          paintOp === OPS.eoFill || paintOp === OPS.eoFillStroke || paintOp === OPS.closeEOFillStroke || paintOp === OPS.eoClip;
        this.emit(kind, minMax, evenOdd);
        break;
      }

      // ---- 图形状态 ----
      case OPS.setLineWidth:
        s.lineWidth = args[0] as number;
        break;
      case OPS.setLineCap:
        s.lineCap = args[0] as number;
        break;
      case OPS.setLineJoin:
        s.lineJoin = args[0] as number;
        break;
      case OPS.setMiterLimit:
        s.miterLimit = args[0] as number;
        break;
      case OPS.setDash:
        s.dash = (args[0] as number[]) ?? [];
        break;
      case OPS.setGState: {
        const pairs = (args[0] ?? args) as [string, unknown][];
        for (const pair of pairs) {
          if (!Array.isArray(pair)) continue;
          const [key, value] = pair as [string, unknown];
          if (key === "LW") s.lineWidth = value as number;
          else if (key === "LC") s.lineCap = value as number;
          else if (key === "LJ") s.lineJoin = value as number;
          else if (key === "ML") s.miterLimit = value as number;
          else if (key === "D") s.dash = (value as unknown as [number[] | null, number])?.[0] ?? [];
          else if (key === "ca") s.fillAlpha = value as number;
          else if (key === "CA") s.strokeAlpha = value as number;
        }
        break;
      }

      // ---- 颜色 ----
      // 注意：图案（setFillColorN/setStrokeColorN）和纯色是互斥的，谁后设置谁作数，
      // 所以设纯色时要把上一份待处理的图案清掉，免得把图案的位图挂到不相干的图形上。
      case OPS.setFillRGBColor:
        s.fill = String(args[0]);
        this.pendingPattern = null;
        break;
      case OPS.setStrokeRGBColor:
        s.stroke = String(args[0]);
        this.pendingPattern = null;
        break;
      case OPS.setFillGray:
        s.fill = grayToHex(args[0] as number);
        this.pendingPattern = null;
        break;
      case OPS.setStrokeGray:
        s.stroke = grayToHex(args[0] as number);
        this.pendingPattern = null;
        break;
      case OPS.setFillCMYKColor:
        s.fill = cmykToHex(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
        this.pendingPattern = null;
        break;
      case OPS.setStrokeCMYKColor:
        s.stroke = cmykToHex(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
        this.pendingPattern = null;
        break;
      case OPS.setFillTransparent:
      case OPS.setFillColorN:
      case OPS.setFillColor:
        this.notePattern(op, args);
        s.fill = null;
        break;
      case OPS.setStrokeTransparent:
      case OPS.setStrokeColorN:
      case OPS.setStrokeColor:
        this.notePattern(op, args);
        s.stroke = null;
        break;

      // ---- 组 / 表单 ----
      // 表单 XObject 有自己的一套「默认坐标系」：pdfjs 在这里把 baseTransform 换成当前 CTM，
      // 图案（TilingPattern）就是锚在这套坐标系上的，所以必须跟着换。
      case OPS.beginGroup:
        this.stack.push(cloneState(s));
        break;
      case OPS.endGroup:
        if (this.stack.length) this.state = this.stack.pop()!;
        break;
      case OPS.beginAnnotation:
        this.stack.push(cloneState(s));
        this.baseTransformStack.push(this.baseTransform);
        this.baseTransform = s.ctm;
        break;
      case OPS.endAnnotation:
        if (this.stack.length) this.state = this.stack.pop()!;
        this.baseTransform = this.baseTransformStack.pop() ?? this.baseTransform;
        break;
      case OPS.paintFormXObjectBegin: {
        this.stack.push(cloneState(s));
        const m = args[0] as number[] | null;
        if (m) s.ctm = mul(s.ctm, [m[0], m[1], m[2], m[3], m[4], m[5]]);
        this.baseTransformStack.push(this.baseTransform);
        this.baseTransform = s.ctm;
        break;
      }
      case OPS.paintFormXObjectEnd:
        if (this.stack.length) this.state = this.stack.pop()!;
        this.baseTransform = this.baseTransformStack.pop() ?? this.baseTransform;
        break;

      // ---- 渐变 / 位图 ----
      case OPS.shadingFill: {
        const bbox = this.unitSquareBox();
        this.shapes.push({ paint: "shading", bbox, fill: s.fill, fillAlpha: this.d(s.fillAlpha), subpaths: [] });
        this.shapeSeq.push(this.opIndex);
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintImageXObjectRepeat: {
        const repeat = op === OPS.paintImageXObjectRepeat;
        const positions = repeat ? (args[3] as number[]) : [0, 0];
        const sx = repeat ? (args[1] as number) : 1;
        const sy = repeat ? (args[2] as number) : 1;
        let bbox: BBox | undefined;
        for (let k = 0; k + 1 < positions.length; k += 2) {
          const m = mul(s.ctm, [sx, 0, 0, sy, positions[k], positions[k + 1]]);
          const b = roundBox(boxOfRect(m, 0, 0, 1, 1), this.digits);
          bbox = bbox ? boxOfPoints([...boxCorners(bbox), ...boxCorners(b)]) : b;
        }
        const item: ImageItem = { kind: repeat ? "repeat" : "image", name: String(args[0]), bbox: bbox ?? [0, 0, 0, 0] };
        if (typeof args[1] === "number" && !repeat) {
          item.intrinsicWidth = args[1] as number;
          item.intrinsicHeight = args[2] as number;
        }
        this.images.push(item);
        break;
      }
      case OPS.paintInlineImageXObject: {
        const img = args[0] as { width?: number; height?: number };
        this.images.push({
          kind: "inline",
          intrinsicWidth: img?.width,
          intrinsicHeight: img?.height,
          bbox: this.unitSquareBox(),
        });
        break;
      }
      case OPS.paintInlineImageXObjectGroup:
      case OPS.paintImageMaskXObjectGroup: {
        this.images.push({ kind: "mask", bbox: this.unitSquareBox() });
        break;
      }
      case OPS.paintImageMaskXObject:
      case OPS.paintSolidColorImageMask: {
        this.images.push({ kind: "mask", bbox: this.unitSquareBox() });
        break;
      }

      // ---- 文本 ----
      case OPS.beginText:
        this.tm = null;
        this.tmScale = 1;
        this.tx = 0;
        this.ty = 0;
        break;
      case OPS.endText:
        this.tm = null;
        break;
      case OPS.setFont: {
        const size = args[1] as number;
        this.fontSize = Math.abs(size);
        this.textMode = 0;
        break;
      }
      case OPS.setTextMatrix: {
        const m = args[0] as number[];
        this.tm = [m[0], m[1], m[2], m[3], m[4], m[5]];
        this.tmScale = Math.hypot(m[0], m[1]) || 1;
        this.tx = 0;
        this.ty = 0;
        break;
      }
      case OPS.moveText:
        this.tx += args[0] as number;
        this.ty += args[1] as number;
        break;
      case OPS.setLeading:
        this.leading = args[0] as number;
        break;
      case OPS.setLeadingMoveText:
        this.leading = -(args[1] as number);
        this.tx += args[0] as number;
        this.ty += args[1] as number;
        break;
      case OPS.nextLine:
        this.ty -= this.leading;
        break;
      case OPS.setCharSpacing:
        this.charSpacing = (args[0] as number) * this.fontSize;
        break;
      case OPS.setWordSpacing:
        this.wordSpacing = (args[0] as number) * this.fontSize;
        break;
      case OPS.setHScale:
        this.hScale = (args[0] as number) / 100;
        break;
      case OPS.setTextRise:
        this.textRise = args[0] as number;
        break;
      case OPS.setTextRenderingMode:
        this.textMode = args[0] as number;
        break;
      case OPS.showText:
        this.showText(args[0]);
        break;
      case OPS.showSpacedText: {
        this.pushRun();
        for (const g of args[0] as (number | { width?: number })[]) {
          if (typeof g === "number") this.tx += g;
        }
        break;
      }
      case OPS.nextLineShowText:
        this.ty -= this.leading;
        this.showText(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        this.ty -= this.leading;
        this.charSpacing = (args[0] as number) * this.fontSize;
        this.wordSpacing = (args[1] as number) * this.fontSize;
        this.showText(args[2]);
        break;

      default:
        break;
    }
  }
}

function boxCorners(b: BBox): [number, number][] {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}

interface RawTextItem {
  str: string;
  dir?: string;
  width: number;
  height: number;
  transform: number[];
  fontName?: string;
  hasEOL?: boolean;
}

/**
 * 判断某个（在 seq 时刻绘制的）文本是否被之后绘制的不透明填充完全盖住。
 * 典型场景：PDF 里放了一层「隐藏文本层」（颜色/坐标来自不可见图层），
 * 真实的可见文字其实是矢量轮廓。这种情况不能把隐藏层的颜色当真。
 */
function boxArea(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function intersectArea(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 隐藏文本层的文字通常同时也以「矢量轮廓」画了一遍（那才是可见的那份）。
 * 这里在被覆盖文本的后续图形里，找一个外框与它高度重合的，取其颜色当作可见颜色。
 */
function findOutlineColor(bbox: BBox, seq: number, shapes: Shape[], shapeSeq: number[]): string | undefined {
  const ta = Math.max(1e-6, boxArea(bbox));
  let bestScore = 0;
  let bestColor: string | undefined;
  for (let i = 0; i < shapes.length; i++) {
    if (shapeSeq[i] <= seq) continue;
    const s = shapes[i];
    if (s.paint !== "fill" && s.paint !== "fillStroke" && s.paint !== "stroke") continue;
    if ((s.fillAlpha ?? 1) < 1 || (s.strokeAlpha ?? 1) < 1) continue;
    const color = s.fill && s.fill !== "transparent" ? s.fill : s.stroke && s.stroke !== "transparent" ? s.stroke : undefined;
    if (!color) continue;
    const sa = boxArea(s.bbox);
    if (sa <= 0 || sa > ta * 4) continue; // 太大的是背景/卡片，不是文字轮廓
    const score = intersectArea(bbox, s.bbox) / Math.min(ta, sa);
    if (score >= 0.7 && score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }
  return bestColor;
}

function isCovered(bbox: BBox, seq: number, shapes: Shape[], shapeSeq: number[]): boolean {
  const area = Math.max(1e-6, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  for (let i = 0; i < shapes.length; i++) {
    if (shapeSeq[i] <= seq) continue;
    const s = shapes[i];
    if (s.paint !== "fill" && s.paint !== "fillStroke" && s.paint !== "shading") continue;
    if ((s.fillAlpha ?? 1) < 1) continue;
    if (!s.fill || s.fill === "transparent") continue;
    const b = s.bbox;
    if (b[0] > bbox[0] || b[1] > bbox[1] || b[2] < bbox[2] || b[3] < bbox[3]) continue;
    if ((b[2] - b[0]) * (b[3] - b[1]) >= area * 4) return true;
  }
  return false;
}

export interface ExtractPageOptions {
  precision?: number;
}

/** 抽取一页的全部内容。 */
export async function extractPage(page: PDFPageProxy, options: ExtractPageOptions = {}): Promise<PageContent> {
  const digits = Math.max(0, Math.min(6, options.precision ?? 3));
  const viewport = page.getViewport({ scale: 1 });
  const base = viewport.transform as Matrix;

  const [opList, textContent] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  const interp = new Interpreter(base, digits);
  interp.run(opList as unknown as { fnArray: number[]; argsArray: unknown[][] });

  // ---- 文本：几何以 getTextContent 为准，颜色用绘图顺序就近匹配 ----
  const styles = (textContent.styles ?? {}) as Record<string, { fontFamily?: string; ascent?: number; descent?: number }>;
  const runs = interp.runs;
  const text: TextItem[] = [];
  const runSeq: (number | undefined)[] = [];

  for (const raw of textContent.items as RawTextItem[]) {
    if (typeof raw?.str !== "string") continue;
    const transform = raw.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    if (raw.str.trim() === "") {
      // 空串是 pdfjs 的换行标记；纯空格项是排版产物（宽度常常是假的），都跳过
      if (raw.hasEOL && text.length) text[text.length - 1].eol = true;
      continue;
    }
    const dt = mul(base, transform as Matrix);
    const style = raw.fontName ? styles[raw.fontName] : undefined;
    // 注意：内嵌子集字体的 ascent/descent 可能是 NaN， 用 `??` 兜不住
    const ascent = Number.isFinite(style?.ascent) ? (style!.ascent as number) : DEFAULT_ASCENT;
    const descent = Number.isFinite(style?.descent) ? (style!.descent as number) : DEFAULT_DESCENT;
    // item.transform 已经含了字号与页面 CTM 的缩放；item.width 是「PDF 用户空间」下的宽度，
    // 换算到文本空间（1 em = 1 单位）才能拿去框外框。
    const itemScale = Math.hypot(transform[0], transform[1]) || 1;
    const fontSize = Math.hypot(dt[2], dt[3]);
    const textSpaceWidth = raw.width / itemScale;
    const box = boxOfRect(dt, 0, descent, textSpaceWidth, ascent);

    const item: TextItem = {
      text: raw.str,
      x: roundTo(dt[4], digits),
      y: roundTo(dt[5], digits),
      width: roundTo(raw.width, digits),
      height: roundTo((ascent - descent) * fontSize, digits),
      fontSize: roundTo(fontSize, digits),
      rotation: roundTo(rotationOf(dt), 2),
      bbox: roundBox(box, digits),
    };
    if (raw.fontName) item.fontName = raw.fontName;
    if (style?.fontFamily) item.fontFamily = style.fontFamily;
    if (raw.dir) item.dir = raw.dir;

    if (runs.length) {
      // run 的位置是基线原点，所以拿文本项自己的基线原点去比（而不是外框中心）
      let best: RawRun | undefined;
      let bestDist = Infinity;
      for (const run of runs) {
        const d = Math.hypot(run.x - item.x, run.y - item.y);
        if (d < bestDist) {
          bestDist = d;
          best = run;
        }
      }
      // 允许的误差随字号放宽；超过则视为未匹配（例如文本以 path 形式绘制）
      if (best && bestDist <= Math.max(2, fontSize * 0.5)) {
        if (best.color) item.color = best.color;
        if (best.alpha !== undefined) item.alpha = best.alpha;
        runSeq.push(best.seq);
      } else {
        runSeq.push(undefined);
      }
    } else {
      runSeq.push(undefined);
    }
    text.push(item);
  }

  // 被后续不透明图形盖住的文本 = 隐藏文本层，颜色不可信
  for (let k = 0; k < text.length; k++) {
    const seq = runSeq[k];
    if (seq === undefined) continue;
    if (isCovered(text[k].bbox, seq, interp.shapes, interp.shapeSeq)) {
      text[k].covered = true;
      delete text[k].alpha;
      // 可见文字多半是同一位置的矢量轮廓，颜色从那里取
      const outline = findOutlineColor(text[k].bbox, seq, interp.shapes, interp.shapeSeq);
      if (outline) {
        text[k].color = outline;
        text[k].colorFrom = "outline";
      } else {
        delete text[k].color;
      }
    }
  }

  return {
    page: page.pageNumber,
    width: roundTo(viewport.width, digits),
    height: roundTo(viewport.height, digits),
    rotation: page.rotate,
    unit: "pt",
    coord: "top-left origin, y down",
    text,
    shapes: interp.shapes,
    images: interp.images,
    fonts: Object.fromEntries(
      Object.entries(styles).map(([name, s]) => [
        name,
        {
          family: s.fontFamily,
          ascent: Number.isFinite(s.ascent) ? (s.ascent as number) : DEFAULT_ASCENT,
          descent: Number.isFinite(s.descent) ? (s.descent as number) : DEFAULT_DESCENT,
        },
      ]),
    ),
  };
}
