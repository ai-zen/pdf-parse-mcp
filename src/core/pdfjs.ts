/**
 * pdfjs 加载与资源路径。
 *
 * 统一从这里引入 pdfjs，保证：
 *   - Node 下走 legacy 构建（自带 Node 适配：原生 canvas、fs 读字体/cmap/wasm）；
 *   - standard_fonts / cmaps / wasm / iccs 都指向包内实际目录，
 *     这样 npx 安装后无需任何额外配置即可解析与渲染。
 *
 * 关于类型：legacy 子路径没有随包附带 .d.ts（见 src/types/pdfjs.d.ts 的补丁），
 * 但对外的类型一律借用根入口的声明，避免把“缺失声明”这个问题传染给使用方。
 */
import path from "node:path";
import { createRequire } from "node:module";

import * as pdfjsRuntime from "pdfjs-dist/legacy/build/pdf.mjs";

/** pdfjs 命名空间。 */
export const pdfjs = pdfjsRuntime as unknown as typeof import("pdfjs-dist");

/** 画布操作码常量，抽取解释器用。 */
export const OPS: typeof pdfjs.OPS = pdfjs.OPS;

export type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
export type PDFPageProxy = import("pdfjs-dist").PDFPageProxy;
export type PageViewport = import("pdfjs-dist").PageViewport;
export type PDFDocumentLoadingTask = import("pdfjs-dist").PDFDocumentLoadingTask;

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));

/** pdfjs 的静态资源目录（本地文件系统路径）。 */
export const assets = {
  standardFonts: path.join(pdfjsRoot, "standard_fonts"),
  cmaps: path.join(pdfjsRoot, "cmaps"),
  wasm: path.join(pdfjsRoot, "wasm"),
  icc: path.join(pdfjsRoot, "iccs"),
} as const;

/** pdfjs 要求资源地址以 "/" 结尾（Windows 的 "\" 会被判为非法）。 */
export function assetUrl(dir: string): string {
  return dir.replaceAll("\\", "/") + "/";
}
