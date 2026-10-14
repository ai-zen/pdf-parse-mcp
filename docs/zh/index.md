---
title: pdf-parse-mcp 文档
description: "@ai-zen/pdf-parse-mcp 概览——把 PDF 精确拆解成文本、矢量图形与位图的几何与样式，并提供按需栅格渲染的 MCP 服务器。"
outline: deep
---

# pdf-parse-mcp

`@ai-zen/pdf-parse-mcp` 是一个 **MCP 服务器（stdio）**，用来把 PDF **精确拆解**给 Agent：它给出文本、矢量图形、位图的**坐标与尺寸**，并支持按需栅格渲染。

它不是"把 PDF 抽成一坨纯文本"，而是面向「**从 PDF 还原设计稿**」这一场景：你能拿到文件里每个字形、每条线、每个矩形的**位置、尺寸、颜色、线宽**。

- **精确几何**：文本有基线原点与 bbox、字号、旋转、颜色；图形有填充/描边、透明度、线宽、外框；位图有放置框与原始像素尺寸。
- **屏幕坐标系**：统一采用**左上原点、y 向下、单位 pt**（1pt = 1/72 英寸）——屏幕与设计工具的直觉坐标系，而非 PDF 内部的"左下原点、y 向上"。
- **按需渲染**：整页或任意区域栅格化为 PNG/JPEG，`region` 配合大 `scale` 相当于放大镜。
- **单一事实来源**：本仓库 `docs/` 是文档唯一来源，website 只做聚合呈现。

## 三个工具

| 工具 | 作用 |
|------|------|
| `pdf_info` | 文档级信息：页数、每页尺寸与旋转、元数据 |
| `pdf_extract` | **核心工具**：抽取单页的文本 / 矢量图形 / 位图 |
| `pdf_render` | 单页栅格化为图片（整页或局部） |

## 文档导航

- [快速开始](./getting-started.md) — 环境要求、安装、接入 MCP 客户端与首次调用。
- [MCP 工具](./tools.md) — `pdf_info` / `pdf_extract` / `pdf_render` 的参数与返回详解。
- [核心概念](./concepts.md) — 坐标约定、隐藏文本层、图案与渐变、常见陷阱。
- [API 参考](./api/index.md) — 编程接口 `openPage` / `extractPage` / `renderPage` / `renderOverlay`。
- [从 PDF 还原设计稿](./guides/reconstruct-design.md) — 推荐工作流与技巧。
- [叠加调试图](./guides/overlay.md) — 用 overlay 直观校验抽取准确性。
