/** 2D 仿射矩阵与几何/颜色工具。矩阵采用 PDF/canvas 的 6 元组 [a,b,c,d,e,f]。 */

export type Matrix = [number, number, number, number, number, number];
/** [x0, y0, x1, y1]，已按左上原点、y 向下归一化。 */
export type BBox = [number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 ∘ m2（先应用 m2，再应用 m1），与 pdfjs 的 Util.transform 一致。 */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** 逆矩阵（设备坐标 → 用户坐标）；不可逆时返回 null。 */
export function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** 面积缩放系数（各向同性缩放时精确）。 */
export function scaleOf(m: Matrix): number {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return det > 0 ? Math.sqrt(det) : Math.hypot(m[0], m[1]) || 1;
}

/** 旋转角（度）。 */
export function rotationOf(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

export function boxOfPoints(points: readonly (readonly [number, number])[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

/** 把矩形 [x0,y0,x1,y1] 经矩阵变换后求轴对齐外框。 */
export function boxOfRect(m: Matrix, x0: number, y0: number, x1: number, y1: number): BBox {
  return boxOfPoints([
    applyPoint(m, x0, y0),
    applyPoint(m, x1, y0),
    applyPoint(m, x1, y1),
    applyPoint(m, x0, y1),
  ]);
}

export function expandBox(b: BBox, by: number): BBox {
  return [b[0] - by, b[1] - by, b[2] + by, b[3] + by];
}

export function unionBox(a: BBox | undefined, b: BBox): BBox {
  if (!a) return b;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** 两个外框的交集；不相交（或只剩零面积）时返回 null。 */
export function intersectBox(a: BBox, b: BBox): BBox | null {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

const pow = (digits: number) => 10 ** digits;

export function roundTo(n: number, digits: number): number {
  const p = pow(digits);
  const r = Math.round(n * p) / p;
  return Object.is(r, -0) ? 0 : r;
}

export function roundBox(b: BBox, digits: number): BBox {
  return [roundTo(b[0], digits), roundTo(b[1], digits), roundTo(b[2], digits), roundTo(b[3], digits)];
}

export function boxSize(b: BBox, digits: number): [number, number] {
  return [roundTo(b[2] - b[0], digits), roundTo(b[3] - b[1], digits)];
}

// ---- 颜色 ----

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function grayToHex(g: number): string {
  const v = clamp255(g);
  return `#${[v, v, v].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[clamp255(r), clamp255(g), clamp255(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function cmykToHex(c: number, m: number, y: number, k: number): string {
  return rgbToHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
}
