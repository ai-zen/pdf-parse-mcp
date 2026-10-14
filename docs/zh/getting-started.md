---
title: 快速开始
description: 安装 @ai-zen/pdf-parse-mcp，接入 Claude Desktop / Cline / Cursor 等 MCP 客户端，并完成第一次抽取与渲染。
outline: deep
---

# 快速开始

## 环境要求

- **Node.js ≥ 22.13**（pdfjs 6 的要求）。
- **无需任何系统级依赖**：canvas 实现（`@napi-rs/canvas`）与全部字体 / cmap / wasm 资源都以**预构建产物**随包分发。

## 安装 / 运行

直接以 `npx` 运行（无需预先安装）：

```bash
npx -y @ai-zen/pdf-parse-mcp
```

或安装为依赖，用于[编程接口](./api/index.md)：

```bash
npm install @ai-zen/pdf-parse-mcp
```

## 接入 MCP 客户端

在任意支持 MCP 的客户端（Claude Desktop、Cline、Cursor、你自己的 Agent……）里加入如下片段：

```json
{
  "mcpServers": {
    "pdf-parse": {
      "command": "npx",
      "args": ["-y", "@ai-zen/pdf-parse-mcp"]
    }
  }
}
```

接入后，客户端即可调用 `pdf_info` / `pdf_extract` / `pdf_render` 三个工具。

## 第一次调用

假设有一份 `design.pdf`，典型的三步走：

```
1. pdf_info      { "path": "design.pdf" }
                 → 知道有几页、每页多大

2. pdf_extract   { "path": "design.pdf", "page": 1 }
                 → 拿到第 1 页全部文本 / 图形 / 位图（默认 detail=box，输出很小）

3. pdf_render    { "path": "design.pdf", "page": 1, "scale": 1 }
                 → 渲染整页缩略图，肉眼核对版面
```

::: tip 坐标约定
所有坐标都是**左上原点、y 向下、单位 pt**（1pt = 1/72 英寸）。详见[核心概念](./concepts.md)。
:::

## 下一步

- 想了解每个工具的完整参数：[MCP 工具](./tools.md)
- 想了解完整还原流程：[从 PDF 还原设计稿](./guides/reconstruct-design.md)
