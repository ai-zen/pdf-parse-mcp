---
title: 叠加调试图
description: 用 overlay 把渲染页面与抽取几何叠加，直观校验 pdf-parse-mcp 的抽取准确性。
outline: deep
---

# 叠加调试图

想确认"抽出来的几何到底准不准"，叠加图是最快的答案——以渲染页为底，把几何画在上面。

## CLI

```bash
npm run overlay -- pdfs/demo1.pdf                         # → tmp/overlay/demo1-p1-overlay.png
npm run overlay -- pdfs/demo3.pdf --page all --scale 3
npm run overlay -- design.pdf --layers render,shapes,text,labels
npm run overlay -- design.pdf --region 0,0,300,300 --line 2
```

## 图层

| 图层 | 绘制内容 | 默认 |
|------|----------|:---:|
| `render` | 渲染页作为底图 | ✅ |
| `text` | 文本框（蓝）+ 基线原点与宽度（粉） | ✅ |
| `shapes` | 图形轮廓：填充品红 / 描边绿 / 渐变红 / 裁剪灰虚线 | ✅ |
| `images` | 位图框（橙，标注原始像素尺寸） | ✅ |
| `legend` | 各图层计数图例（右上） | ✅ |
| `labels` | 每项文本内容（黄） | — |
| `shapeBoxes` | 图形外框（虚线） | — |

## 编程接口

```js
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

## 用途

叠加图是**调试视图**：它会打开 `includeClip`，因此裁剪区也会被画出（灰色虚线）。适合做**回归**——改动抽取逻辑后，在真实文档上跑一遍叠加图，任何漂移或漏抽都一目了然。
