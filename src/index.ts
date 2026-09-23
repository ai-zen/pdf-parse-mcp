/**
 * 编程接口出口。包的主要用法是作为 MCP stdio 服务（见 dist/cli.js），
 * 这里额外导出核心能力，方便在别的 Node 程序里直接复用。
 */
export { serveMCP } from "./mcp/index.js";
export { openDocument, openPage, closeAllDocuments, resolveFile } from "./core/document.js";
export { extractPage } from "./core/extract.js";
export { renderPage } from "./core/render.js";
export { renderOverlay, OVERLAY_LAYERS, DEFAULT_LAYERS } from "./core/overlay.js";
export type {
  PageContent,
  TextItem,
  Shape,
  SubPath,
  PathSegment,
  ImageItem,
  ExtractPageOptions,
} from "./core/extract.js";
export type { RenderOptions, RenderResult } from "./core/render.js";
export type { OverlayOptions, OverlayResult, OverlayLayer } from "./core/overlay.js";
