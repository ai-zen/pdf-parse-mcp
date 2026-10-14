---
title: 从 PDF 还原设计稿
description: 使用 pdf-parse-mcp 把 PDF 精确重建为设计稿的推荐工作流与技巧。
outline: deep
---

# 从 PDF 还原设计稿

这是本工具的核心用途：把 PDF 里的每个字形、线条、矩形的位置与样式精确取出来，重建设计稿。

## 推荐工作流

```
1. pdf_info                      → 几页、每页多大
2. pdf_extract(page, detail:"box")
                                 → 先看全部外框与样式，摸清版面骨架
3. pdf_extract(page, include:["text"])
                                 → 文案、字号、字重、颜色
4. pdf_render(page, scale:1)     → 整页缩略图，核对版面
5. pdf_render(page, region:[x0,y0,x1,y1], scale:4)
                                 → 放大局部，核对对齐
6. 用 1–5 重建设计稿，再渲染比对
   （要精确复刻某图形时，对该页单独抽一次 detail:"full" 拿路径线段）
```

## 技巧

- **先粗后细**：先用 `detail: "box"` 看骨架，别一上来就 `full`。
- **局部放大**：核对图标/线条对齐，`pdf_render` + `region` + 大 `scale` 是放大镜。
- **区域过滤**：元素多时用 `region` 缩小抽取范围；注意它**只过滤不裁剪**，坐标仍是整页坐标系。
- **注意隐藏文本层**：`covered: true` 的文本，内容可信、颜色/几何取自还原值。
- **控制体积**：`include`、`limit`、`detail` 三件套，避免上下文被撑爆。

## 视觉校验

想确认"抽出来的几何到底准不准"，最快的办法是[叠加调试图](./overlay.md)：以渲染页为底，把几何画上去，一眼就能看出漂移或漏抽。
