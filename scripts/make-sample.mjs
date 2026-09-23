// 生成测试用的最小、未压缩 PDF。仅开发用，不随包发布（package.json files 只含 dist）。
//
//   tmp/sample.pdf         常规场景：矢量图形 + 文本 + 位图 + CTM 变换
//   tmp/sample-hidden.pdf  隐藏文本层场景：先画一层不可见文本（红），再用整页不透明底盖掉，
//                          可见文字以矢量轮廓单独画一遍 —— Skia/Chrome 导出的常见形态
//   tmp/sample-pattern.pdf 平铺图案场景：用一块 40x40 的矩形填充 TilingPattern，
//                          图案单元里贴一张位图 —— Skia/Chrome 导出的「位图填充图形」常见形态
//   tmp/sample-clip.pdf    裁剪区场景：左下 120x120 的裁剪窗口，三个矩形分别完全在窗外/内、只相交一部分
//                          —— 用来验证 applyClip 只丢「外框与裁剪区完全不相交」的元素
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAIN_CONTENT = `0.2 0.4 0.9 rg
100 100 200 150 re
f
1 0 0 RG
3 w
100 300 m
400 300 l
S
0.1 0.7 0.3 rg
200 400 m
250 500 350 500 400 400 c
f
q
1.5 0 0 1.5 20 20 cm
0 0 0 rg
100 400 40 20 re
f
1 0 0 RG
1.5 w
150 420 m
190 420 l
S
BT
/F1 10 Tf
1 0 0 1 100 430 Tm
(Inside CTM) Tj
ET
Q
q
150 0 0 100 400 560 cm
/Im1 Do
Q
0 0 0 rg
BT
/F1 24 Tf
1 0 0 1 72 700 Tm
(Hello World) Tj
ET
0.9 0.1 0.1 rg
BT
/F1 12 Tf
1 0 0 1 72 660 Tm
(Red text) Tj
ET
`;

// 隐藏文本层：红字 → 整页白底盖住 → 同位置画一块彩色“轮廓”
// 顺带塞一个含 NUL 的字符串，用来验证叠加图不会因为脏字符崩掉
const HIDDEN_CONTENT = `1 0 0 rg
BT
/F1 24 Tf
1 0 0 1 72 700 Tm
(Hidden Label) Tj
ET
BT
/F1 12 Tf
1 0 0 1 72 640 Tm
(Nul\\000 here) Tj
ET
1 1 1 rg
0 0 612 792 re
f
0.1 0.2 0.3 rg
72 694.91 124 26.81 re
f
`;

// 2x2 RGB 图（红/绿/蓝/白）
const IMG = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);

// 平铺图案：紫色矩形用图案填充；图案单元 40x40，里面整块贴一张 2x2 的位图。
// 图案矩阵把图案空间平移到矩形上（图案锚定在页面默认坐标系，不跟绘制时的 CTM 走）。
const PATTERN_CONTENT = `/Pattern cs
/P1 scn
100 100 40 40 re
f
`;

const PATTERN_CELL = `q
40 0 0 40 0 0 cm
/Im2 Do
Q
`;

// 裁剪区：用户空间左下 120x120（左上原点换算后是 x 0..120, y 672..792）。
// 三个矩形：红 = 完全在裁剪区外（240,152)-(280,192)、绿 = 完全在内 (10,722)-(70,782)、
// 蓝 = 只相交一部分 (100,592)-(200,692)。
const CLIP_CONTENT = `0 0 120 120 re W n
1 0 0 rg
240 600 40 40 re
f
0.1 0.6 0.2 rg
10 10 60 60 re
f
0.2 0.3 0.9 rg
100 100 100 100 re
f
`;

function imageXObject() {
  return (
    "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB " +
    `/BitsPerComponent 8 /Length ${IMG.length} >>\nstream\n${IMG.toString("latin1")}\nendstream`
  );
}

function tilingPattern() {
  return (
    "<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 " +
    "/BBox [0 0 40 40] /XStep 40 /YStep 40 /Matrix [1 0 0 1 100 100] " +
    "/Resources << /XObject << /Im2 7 0 R >> >> " +
    `/Length ${Buffer.byteLength(PATTERN_CELL, "latin1")} >>\nstream\n${PATTERN_CELL}endstream`
  );
}

function buildPdf(content, { image = false, pattern = false } = {}) {
  const resources = ["/Font << /F1 4 0 R >>"];
  if (image) resources.push("/XObject << /Im1 6 0 R >>");
  if (pattern) {
    resources.push("/XObject << /Im2 7 0 R >>");
    resources.push("/Pattern << /P1 6 0 R >>");
  }

  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
    `/Resources << ${resources.join(" ")} >> /Contents 5 0 R >>`;
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[5] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`;
  if (image) objs[6] = imageXObject();
  if (pattern) {
    objs[6] = tilingPattern();
    objs[7] = imageXObject();
  }

  let out = "%PDF-1.7\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, "latin1");
  const count = objs.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function write(target, buffer) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`wrote ${target} (${buffer.length} bytes)`);
}

const base = process.env.PDF_SAMPLE_DIR || "tmp";
write(`${base}/sample.pdf`, buildPdf(MAIN_CONTENT, { image: true }));
write(`${base}/sample-hidden.pdf`, buildPdf(HIDDEN_CONTENT));
write(`${base}/sample-pattern.pdf`, buildPdf(PATTERN_CONTENT, { pattern: true }));
write(`${base}/sample-clip.pdf`, buildPdf(CLIP_CONTENT));
