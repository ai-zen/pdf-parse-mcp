#!/usr/bin/env node
// 叠加调试图生成器（开发/人眼核对用，不随包发布）。
//
// 用法:
//   node scripts/overlay.mjs <pdf> [更多 pdf...] [选项]
//   npm run overlay -- pdfs/demo1.pdf
//
// 选项:
//   --page <n|all>        页码，默认 1；all 表示全部页
//   --scale <n>           渲染缩放，默认 2
//   --out <dir>           输出目录，默认 tmp/overlay
//   --layers <a,b,...>    叠加图层，默认 render,shapes,text,images,legend
//                         可选: render,shapes,shapeBoxes,text,labels,images,legend
//   --line <n>            叠加线宽（像素），默认 1
//   --region x0,y0,x1,y1  只画局部（pt，左上原点）
//   -h, --help
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openPage, openDocument, renderOverlay, OVERLAY_LAYERS, closeAllDocuments } from "../dist/index.js";

const HELP = `叠加调试图生成器 —— 把渲染结果、文本外框、图形线框画到同一张图上，供人眼核对。

用法:
  node scripts/overlay.mjs <pdf> [更多 pdf...] [选项]
  npm run overlay -- pdfs/demo1.pdf

选项:
  --page <n|all>        页码，默认 1；all 表示全部页
  --scale <n>           渲染缩放，默认 2
  --out <dir>           输出目录，默认 tmp/overlay
  --layers <a,b,...>    叠加图层，默认 render,shapes,text,images,legend
                        可选: ${OVERLAY_LAYERS.join(",")}
  --line <n>            叠加线宽（像素），默认 1
  --region x0,y0,x1,y1  只画局部（pt，左上原点）
  -h, --help
`;

function parseArgs(argv) {
  const opts = { files: [], page: "1", scale: 2, out: "tmp/overlay", layers: undefined, line: 1, region: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === "--page") opts.page = next();
    else if (a === "--scale") opts.scale = Number(next());
    else if (a === "--out") opts.out = next();
    else if (a === "--line") opts.line = Number(next());
    else if (a === "--layers") opts.layers = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--region") {
      const parts = next().split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        console.error("--region 需要 4 个数字: x0,y0,x1,y1");
        process.exit(2);
      }
      opts.region = parts;
    } else if (a.startsWith("-")) {
      console.error(`未知选项: ${a}\n`);
      process.stdout.write(HELP);
      process.exit(2);
    } else opts.files.push(a);
  }
  if (!opts.files.length) {
    process.stdout.write(HELP);
    process.exit(2);
  }
  if (opts.layers) {
    const bad = opts.layers.filter((l) => !OVERLAY_LAYERS.includes(l));
    if (bad.length) {
      console.error(`未知图层: ${bad.join(", ")}（可选: ${OVERLAY_LAYERS.join(", ")}）`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(opts.out, { recursive: true });

for (const file of opts.files) {
  const doc = await openDocument(file);
  const pages =
    opts.page === "all" ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [Number(opts.page)];
  for (const pageNumber of pages) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
      console.error(`跳过: ${file} 第 ${pageNumber} 页超出范围（共 ${doc.numPages} 页）`);
      continue;
    }
    const page = await openPage(file, pageNumber);
    const result = await renderOverlay(page, {
      scale: opts.scale,
      region: opts.region,
      layers: opts.layers,
      lineWidth: opts.line,
    });
    const stem = path.basename(file).replace(/\.pdf$/i, "");
    const target = path.join(opts.out, `${stem}-p${pageNumber}-overlay.png`);
    writeFileSync(target, result.buffer);
    const c = result.counts;
    console.log(
      `${target}  ${result.width}×${result.height}px  scale=${result.scale}` +
        `  文本 ${c.text} · 图形 ${c.shapes} · 位图 ${c.images}  [${result.layers.join(",")}]`,
    );
  }
}

await closeAllDocuments();
