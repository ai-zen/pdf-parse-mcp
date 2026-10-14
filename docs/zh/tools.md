---
title: MCP 工具
description: pdf_info / pdf_extract / pdf_render 三个 MCP 工具的完整参数与返回结构说明。
outline: deep
---

# MCP 工具

服务器暴露三个工具，全部使用**左上原点、y 向下、单位 pt（1pt = 1/72 英寸）**的坐标约定。

## `pdf_info`

文档级信息：页数、每页尺寸与旋转角、元数据。用于在抽取前了解文档结构、确定要处理哪些页。

**参数**

| 参数 | 必填 | 说明 |
|------|:---:|------|
| `path` | ✅ | PDF 文件路径（绝对或相对当前工作目录） |
| `password` | | 若 PDF 已加密，提供打开密码 |
| `maxPages` | | 最多列出多少页的尺寸，默认 `100`（文档很大时可调小） |

**返回**

```jsonc
{
  "path": "design.pdf",
  "pages": 3,
  "unit": "pt",
  "coord": "top-left origin, y down",
  "metadata": { "Title": "Home screen design", "Producer": "Figma" },
  "pageSizes": [{ "page": 1, "width": 595.28, "height": 841.89, "rotation": 0 }]
}
```

## `pdf_extract`

抽取某一页的全部内容。**这是核心工具。**

**参数**

| 参数 | 必填 | 说明 |
|------|:---:|------|
| `path` | ✅ | PDF 文件路径 |
| `page` | ✅ | 页码，从 1 开始 |
| `include` | | 只返回 `["text"｜"shapes"｜"images"]` 的子集；默认全部 |
| `detail` | | `box`（默认）或 `full`，见下方警告 |
| `precision` | | 坐标保留小数位，默认 `3` |
| `includeClip` | | 是否把裁剪区（`paint:"clip"`）也算作图形返回，默认 `false` |
| `region` | | 只抽取与该矩形 `[x0,y0,x1,y1]` 相交的元素（pt，左上原点） |
| `limit` | | 每类结果条数上限，默认 `5000`（超限时在 `truncated` 标记） |
| `password` | | 加密文档的密码 |

::: warning 慎用 `detail: "full"`
默认 `box` 只给外框与样式，输出很小。`full` 会附带完整路径线段（M/L/C/Q/Z）——一页 66 条图形就带 **8078 段**，shapes JSON 从 **6.5 KB 膨胀到 550 KB**，会挤爆上下文。真要重画某个图形时，请先用 `region` 把范围缩到那一块，再传 `full`。
:::

**返回结构**（截断；下方 `shapes` 条目展示的是 `detail:"full"` 会给出的内容）

```jsonc
{
  "page": 1,
  "width": 595.28, "height": 841.89, "rotation": 0,
  "unit": "pt", "coord": "top-left origin, y down",
  "counts": { "text": 42, "shapes": 17, "images": 2 },

  "text": [
    {
      "text": "Hello World",
      "x": 72, "y": 92,                    // 基线原点
      "width": 124.008, "height": 26.813,  // 视觉宽度 / 行高
      "fontSize": 24, "rotation": 0,
      "bbox": [72, 70.28, 196.01, 97.09],
      "color": "#000000",
      "fontName": "g_d0_f1", "fontFamily": "sans-serif"
    }
  ],

  "shapes": [
    {
      "paint": "fill",                     // fill | stroke | fillStroke | clip | shading
      "bbox": [100, 542, 300, 692],
      "fill": "#3366e6", "fillAlpha": 1,
      "subpaths": [
        { "closed": true, "bbox": [100, 542, 300, 692],
          "segments": [
            { "t": "M", "x": 100, "y": 692 },
            { "t": "L", "x": 300, "y": 692 },
            { "t": "L", "x": 300, "y": 542 },
            { "t": "L", "x": 100, "y": 542 }
          ] }
      ]
    },
    {
      "paint": "stroke",
      "bbox": [98.5, 490.5, 401.5, 493.5],  // 描边外框已按线宽扩展
      "stroke": "#ff0000", "strokeWidth": 3,
      "lineCap": 0, "lineJoin": 0, "miterLimit": 10,
      "subpaths": [ /* … */ ]
    }
  ],

  "images": [
    { "kind": "image", "name": "img_p0_1",
      "intrinsicWidth": 800, "intrinsicHeight": 600,
      "bbox": [400, 132, 550, 232] },
    { "kind": "image", "name": "img_p0_3",            // 来自平铺图案单元格的位图
      "intrinsicWidth": 300, "intrinsicHeight": 300,
      "bbox": [24, 668, 56, 700], "pattern": true }
  ],

  "fonts": { "g_d0_f1": { "family": "sans-serif", "ascent": 0.905, "descent": -0.212 } }
}
```

**约定**

- `bbox` 恒为 `[x0, y0, x1, y1]`，左上原点、y 向下。
- 路径线段坐标已处于**设备空间**（页面 CTM 与当前变换均已应用），可直接当设计稿坐标使用。
- 曲线段保留控制点（`C` 三次贝塞尔、`Q` 二次）；`bbox` 是整条路径的紧致外框。
- 描边色为 `null` 表示图案/渐变描边；`paint: "shading"` 表示该区域原本是渐变填充（用 `pdf_render` 渲染渐变）。
- 文本颜色按绘制顺序就近匹配还原；**无法确定时直接省略**，绝不臆造。
- 裁剪区（`paint: "clip"`）默认**省略**：它们从不被绘制，只约束可见范围；传 `includeClip: true` 才返回。
- `region` **只过滤**：与外框相交的元素原样返回，**不裁剪几何**，坐标仍是整页坐标系（与 `pdf_render` 的 `region` 对齐）。
- 图形默认只给外框与样式（`detail: "box"`）。
- 位图标 `"pattern": true` 来自**平铺图案（TilingPattern）**单元格——"用图片当填充"的手法（Skia/Chrome 导出很常见）。它按 `XStep/YStep` 平铺整页，但只报告**该单个单元格**的可见部分，不展开完整平铺范围。

## `pdf_render`

把某一页栅格化为图片（PNG/JPEG）。

**参数**

| 参数 | 必填 | 说明 |
|------|:---:|------|
| `path` / `page` | ✅ | 文件路径与页码 |
| `scale` | | 缩放倍数（相对 72dpi），默认 `1` |
| `dpi` | | 目标 DPI（等价 `scale = dpi/72`；与 `scale` 同时给出时以 `dpi` 为准） |
| `region` | | `[x0,y0,x1,y1]`，pt，左上原点，只渲染该区域 |
| `background` | | 默认 `#ffffff`；传 `transparent` 保留透明 |
| `format` | | `png`（默认）/ `jpeg` |
| `save` | | 给定则写入文件并只返回路径信息；否则直接返回图片给 Agent |

::: tip 放大镜
`region` 配合较大的 `scale` 就是放大镜：核对某个图标或线条是否对齐，远比整页缩略图有效。
:::

## 典型工作流

从"看版面骨架"到"还原并比对"：

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

详见[从 PDF 还原设计稿](./guides/reconstruct-design.md)。
