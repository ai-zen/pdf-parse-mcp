// 核心能力冒烟测试：解析 → 抽取 → 渲染，并用断言锁住关键几何/样式。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import "./make-sample.mjs"; // 生成 tmp/sample.pdf

const { openPage, openDocument, extractPage, renderPage, renderOverlay, closeAllDocuments } = await import("../dist/index.js");

const FILE = "tmp/sample.pdf";
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---------- 文档 ----------
const doc = await openDocument(FILE);
assert.equal(doc.numPages, 1, "页数应为 1");

// ---------- 抽取 ----------
const page = await openPage(FILE, 1);
const content = await extractPage(page, { precision: 3 });

assert.equal(content.page, 1);
assert.equal(content.unit, "pt");
assert.ok(near(content.width, 612) && near(content.height, 792), `页面尺寸应为 612x792，实际 ${content.width}x${content.height}`);

// 文本
const texts = Object.fromEntries(content.text.map((t) => [t.text, t]));
assert.ok(texts["Hello World"], "应能抽出 Hello World");
assert.ok(near(texts["Hello World"].x, 72) && near(texts["Hello World"].y, 92), `Hello World 基线应为 (72,92)，实际 (${texts["Hello World"].x},${texts["Hello World"].y})`);
assert.ok(near(texts["Hello World"].fontSize, 24), `Hello World 字号应为 24，实际 ${texts["Hello World"].fontSize}`);
assert.ok(near(texts["Hello World"].width, 124.008), `Hello World 宽度应为 124.008，实际 ${texts["Hello World"].width}`);
assert.ok(near(texts["Hello World"].bbox[0], 72) && near(texts["Hello World"].bbox[2], 196.01), `Hello World 外框错误: ${JSON.stringify(texts["Hello World"].bbox)}`);
assert.equal(texts["Hello World"].color, "#000000", "Hello World 颜色应为黑色");
assert.equal(texts["Red text"]?.color, "#e61a1a", `Red text 颜色应为 #e61a1a，实际 ${texts["Red text"]?.color}`);

// CTM 内的文本：字号 10 × CTM 缩放 1.5 = 15，位置经 CTM 后为 (170, 792-665=127)
const inCtm = texts["Inside CTM"];
assert.ok(inCtm, "应能抽出 CTM 内的文本");
assert.ok(near(inCtm.fontSize, 15), `CTM 内文本字号应为 15，实际 ${inCtm.fontSize}`);
assert.ok(near(inCtm.x, 170) && near(inCtm.y, 127), `CTM 内文本基线应为 (170,127)，实际 (${inCtm.x},${inCtm.y})`);

// 图形
assert.equal(content.shapes.length, 5, `应有 5 个图形，实际 ${content.shapes.length}`);
const blueRect = content.shapes[0];
assert.equal(blueRect.paint, "fill");
assert.equal(blueRect.fill, "#3366e6");
assert.deepEqual(blueRect.bbox, [100, 542, 300, 692], `蓝色矩形外框应换算成左上原点，实际 ${JSON.stringify(blueRect.bbox)}`);
assert.equal(blueRect.subpaths.length, 1);
assert.equal(blueRect.subpaths[0].closed, true);
assert.ok(blueRect.subpaths[0].segments.length >= 4, "矩形应至少含 M/L/L/L 四段（闭合由 closed 标记）");

const redLine = content.shapes[1];
assert.equal(redLine.paint, "stroke");
assert.equal(redLine.stroke, "#ff0000");
assert.equal(redLine.strokeWidth, 3, `线宽应换算为 3，实际 ${redLine.strokeWidth}`);

const curve = content.shapes[2];
assert.ok(curve.subpaths[0].segments.some((s) => s.t === "C"), "第三条路径应含三次贝塞尔段");
assert.equal(curve.fill, "#1ab24c");

// CTM 内的矩形：user(100,400)-(140,420) 经 [1.5,0,0,1.5,20,20] 后落在 (170,142)-(230,172)
assert.deepEqual(content.shapes[3].bbox, [170, 142, 230, 172], `CTM 内矩形外框错误: ${JSON.stringify(content.shapes[3].bbox)}`);
assert.equal(content.shapes[4].strokeWidth, 2.25, `CTM 内线宽应放大到 2.25，实际 ${content.shapes[4].strokeWidth}`);

// 位图：user 单位方格经 [150,0,0,100,400,560] 后 → (400,132)-(550,232)
assert.equal(content.images.length, 1, `应有 1 张位图，实际 ${content.images.length}`);
assert.deepEqual(content.images[0].bbox, [400, 132, 550, 232], `位图外框错误: ${JSON.stringify(content.images[0].bbox)}`);
assert.equal(content.images[0].intrinsicWidth, 2);

// ---------- 隐藏文本层（Skia/Chrome 导出的常见形态）----------
const hidden = await extractPage(await openPage("tmp/sample-hidden.pdf", 1), { precision: 3 });
const h = hidden.text.find((t) => t.text === "Hidden Label");
assert.ok(h, "应能抽出隐藏文本层的文字");
assert.equal(h.covered, true, "被后绘制的不透明底色盖住的文本应标记 covered");
assert.equal(h.colorFrom, "outline", "颜色应反推自可见的文字轮廓");
assert.match(h.color ?? "", /^#[0-9a-f]{6}$/, `应给出可用颜色，实际 ${h.color}`);
assert.notEqual(h.color, "#ff0000", "不能沿用隐藏文本层的红色");
assert.equal(hidden.shapes.length, 2, `应有「整页底色 + 文字轮廓」两块图形，实际 ${hidden.shapes.length}`);

// 含 NUL 的脏字符串不应让叠加图崩掉
assert.ok(hidden.text.some((t) => t.text.includes("\u0000")), "应能抽出含 NUL 的文本");

// ---------- 平铺图案（TilingPattern）里的位图 ----------
// 图案填的矩形是 user(100,100)-(140,140)，左上原点后为 (100,652)-(140,692)；
// 图案矩阵 [1 0 0 1 100 100] 把图案单元平移过去，图案单元 40x40 里贴了一张 2x2 的位图，
// 所以位图外框应与矩形完全重合。
const patterned = await extractPage(await openPage("tmp/sample-pattern.pdf", 1), { precision: 3 });
assert.equal(patterned.shapes.length, 1, `图案填充应留 1 个图形，实际 ${patterned.shapes.length}`);
assert.equal(patterned.shapes[0].paint, "fill");
assert.equal(patterned.shapes[0].fill, null, "图案填充拿不到纯色，应如实给 null");
assert.deepEqual(patterned.shapes[0].bbox, [100, 652, 140, 692], `图案填充外框错误: ${JSON.stringify(patterned.shapes[0].bbox)}`);
assert.equal(patterned.images.length, 1, `应能抽出图案单元里的位图，实际 ${patterned.images.length}`);
assert.equal(patterned.images[0].pattern, true, "来自图案的位图应标记 pattern");
assert.equal(patterned.images[0].intrinsicWidth, 2);
assert.deepEqual(patterned.images[0].bbox, [100, 652, 140, 692], `图案位图外框错误: ${JSON.stringify(patterned.images[0].bbox)}`);

// ---------- 真实案例（Skia/PDF 导出的移动端设计稿）----------
// 这几个是「金标准」：只锁语义，不锁条数，免得正常的抽取改进把测试打红。
const demo1 = await extractPage(await openPage("pdfs/demo1.pdf", 1), { precision: 2 });
assert.ok(near(demo1.width, 320) && near(demo1.height, 851), `demo1 页面尺寸应为 320x851，实际 ${demo1.width}x${demo1.height}`);

// 隐藏文本层：标题的文字内容被 Skia 拆成 "M ailbox es"，但颜色应从可见轮廓反推出来
const title = demo1.text.find((t) => /^M\s?ailbox/.test(t.text));
assert.ok(title, "demo1 应能抽出标题文本");
assert.equal(title.covered, true, "demo1 标题应被识别为隐藏文本层");
assert.equal(title.colorFrom, "outline", "demo1 标题颜色应反推自可见轮廓");
assert.match(title.color ?? "", /^#[0-9a-f]{6}$/, `demo1 标题应给出可用颜色，实际 ${title.color}`);

// 头像位图藏在平铺图案（TilingPattern）里，必须能按图案矩阵换算到正确位置
const demo1Avatars = demo1.images.filter((i) => i.pattern);
assert.equal(demo1Avatars.length, 1, `demo1 应抽到 1 张图案位图（头像），实际 ${demo1Avatars.length}`);
assert.deepEqual(demo1Avatars[0].bbox, [24, 668, 56, 700], `demo1 头像位图外框错误: ${JSON.stringify(demo1Avatars[0].bbox)}`);

// demo3 的 5 个会话头像同样走图案填充，且图案锚在表单 XObject 的坐标系上
const demo3 = await extractPage(await openPage("pdfs/demo3.pdf", 1), { precision: 2 });
const demo3Avatars = demo3.images.filter((i) => i.pattern);
assert.equal(demo3Avatars.length, 5, `demo3 应抽到 5 张图案位图（头像），实际 ${demo3Avatars.length}`);
for (const avatar of demo3Avatars) {
  const w = avatar.bbox[2] - avatar.bbox[0];
  const h = avatar.bbox[3] - avatar.bbox[1];
  assert.ok(w > 30 && w < 40 && Math.abs(w - h) < 2, `demo3 头像应是约 34x34 的方形，实际 ${w}x${h} (${JSON.stringify(avatar.bbox)})`);
  assert.ok(avatar.bbox[0] >= 0 && avatar.bbox[2] <= demo3.width, `demo3 头像应落在页面内: ${JSON.stringify(avatar.bbox)}`);
}

// ---------- 叠加调试图 ----------
const overlay = await renderOverlay(page, { scale: 1, layers: ["render", "text", "shapes", "legend"] });
assert.equal(overlay.width, 612);
assert.equal(overlay.height, 792);
assert.equal(overlay.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "叠加图应为合法 PNG");
assert.deepEqual(overlay.counts, { text: 3, shapes: 5, images: 1 }, `叠加图统计不符: ${JSON.stringify(overlay.counts)}`);

const overlayLabels = await renderOverlay(await openPage("tmp/sample-hidden.pdf", 1), {
  scale: 1,
  layers: ["labels", "text", "images"],
});
assert.equal(overlayLabels.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "带标签的叠加图也应为合法 PNG");

// ---------- 渲染 ----------
const full = await renderPage(page, { scale: 1 });
assert.equal(full.width, 612);
assert.equal(full.height, 792);
assert.equal(full.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "应为合法 PNG");

const zoomed = await renderPage(page, { region: [100, 542, 300, 692], scale: 2 });
assert.equal(zoomed.width, 400);
assert.equal(zoomed.height, 300);

const jpeg = await renderPage(page, { scale: 0.5, format: "jpeg" });
assert.equal(jpeg.format, "jpeg");
assert.equal(jpeg.buffer.subarray(0, 2).toString("hex"), "ffd8", "应为合法 JPEG");

// 与文档尺寸一致（渲染不等于空图）
assert.ok(full.buffer.length > 5000, "渲染结果不应为空图");

const raw = readFileSync(FILE);
assert.ok(raw.length > 0);

await closeAllDocuments();
console.log("✅ smoke: 抽取与渲染断言全部通过");
