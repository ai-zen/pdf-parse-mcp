---
title: API 参考
description: "@ai-zen/pdf-parse-mcp 的编程接口——openDocument / openPage / extractPage / renderPage / renderOverlay 与导出类型。"
outline: deep
---

# API 参考

本包的主要用法是作为 MCP stdio 服务，同时也导出核心能力，便于在别的 Node 程序里直接复用。

## 导入

```ts
import {
  openDocument, openPage, closeAllDocuments, resolveFile,
  extractPage, renderPage,
  renderOverlay, OVERLAY_LAYERS, DEFAULT_LAYERS,
  serveMCP,
} from "@ai-zen/pdf-parse-mcp";
```

## 文档生命周期

### `openDocument(path, password?)`

打开一个 PDF 文档，返回 pdfjs 文档对象。文档按"路径 + mtime"缓存复用。

### `openPage(path, pageNumber)`

打开文档并取某一页。

### `closeAllDocuments()`

释放所有缓存的文档。

### `resolveFile(path)`

解析文件路径（供内部与工具层使用）。

## 抽取

### `extractPage(page, options?)`

从某一页抽取内容，返回 `PageContent`。

```ts
import { openPage, extractPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const content = await extractPage(page, { precision: 2 });
```

选项（`ExtractPageOptions`）：

| 选项 | 说明 |
|------|------|
| `precision` | 坐标保留小数位 |
| `includeClip` | 是否把裁剪区也算作图形返回，默认 `false` |
| `region` | 只保留某区域（**过滤，不裁剪**） |
| `applyClip` | 丢弃外框与当前裁剪区**完全不相交**的元素，默认 `false` |

::: warning `applyClip` 的定位
`applyClip` 刻意保守，**从不返回被裁剪后的几何**（那需要路径布尔运算或栅格化）。在真实 Skia 导出上它常常一个也不丢，所以别指望它做可见性清理。正因如此，它**未**出现在 MCP 工具 schema 里——只会给 Agent 添噪声。
:::

## 渲染

### `renderPage(page, options?)`

把某一页栅格化为图片，返回 `RenderResult`。

```ts
import { openPage, renderPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const png = await renderPage(page, { scale: 2, region: [0, 0, 300, 300] });
```

选项（`RenderOptions`）：`scale`、`dpi`、`region`、`background`、`format`。

## 叠加调试图

### `renderOverlay(page, options?)`

在渲染页面上叠加抽取到的几何，返回 `{ buffer, counts }`，用于可视化校验。

```ts
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

选项（`OverlayOptions`）：`scale`、`layers`、`region`、`line`、`includeClip`、`applyClip` 等。图层说明见[叠加调试图](../guides/overlay.md)。

## 导出类型

`PageContent`、`TextItem`、`Shape`、`SubPath`、`PathSegment`、`ImageItem`、`ExtractPageOptions`、`RenderOptions`、`RenderResult`、`OverlayOptions`、`OverlayResult`、`OverlayLayer`。

## MCP 服务

### `serveMCP()`

启动 MCP stdio 服务器（即 `dist/cli.js` 的 CLI 入口）。
