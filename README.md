# @ai-zen/pdf-parse-mcp

把 PDF 精确拆开给 Agent 看的 MCP 服务：**文本 + 矢量图形 + 位图的坐标与尺寸全都给你，还能随手渲染成图**。

专为「**从 PDF 还原设计稿**」这个场景设计 —— PDF 里每个字、每条线、每个矩形的位置、大小、颜色、线宽都能拿到，而不是只有一坨纯文本。

```
npx -y @ai-zen/pdf-parse-mcp
```

## 它到底给你什么

| 你想要的 | 它给的 |
| --- | --- |
| 这个字在哪、多大 | 基线坐标 `x/y`、外框 `bbox`、字号 `fontSize`、旋转角、颜色 |
| 这个矩形/线条/曲线的形状 | 子路径几何（`M`/`L`/`C`/`Q`/闭合标记）、外框 `bbox` |
| 它长什么样 | 填充色、描边色、透明度、线宽、线帽/线接/虚线 |
| 图在哪 | 位图的贴图外框 + 原始像素尺寸 |
| 我想直接看一眼 | 整页或任意局部区域栅格化成 PNG/JPEG |

坐标统一为**左上原点、y 向下、单位 pt（1pt = 1/72 英寸）** —— 屏幕/设计工具的直觉坐标系，而不是 PDF 内部那套「左下原点、y 向上」。

## 安装 / 接入

任意 MCP 客户端（Claude Desktop、Cline、Cursor、自研 Agent…）加一段配置即可：

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

不需要装任何系统依赖：渲染用的 canvas（`@napi-rs/canvas`）和字体/cmap/wasm 资源都随包自带预编译产物。

要求 Node.js **≥ 22.13**（跟随 pdfjs 6 的要求）。

## 工具

### `pdf_info`

文档级信息：页数、每页尺寸与旋转角、元数据。

```jsonc
{
  "path": "design.pdf",
  "pages": 3,
  "unit": "pt",
  "coord": "top-left origin, y down",
  "metadata": { "Title": "首页设计稿", "Producer": "Figma" },
  "pageSizes": [{ "page": 1, "width": 595.28, "height": 841.89, "rotation": 0 }]
}
```

参数：`path`（必需）、`password`、`maxPages`（默认 100）。

### `pdf_extract`

抽取某一页的全部内容。**这是核心工具。**

参数：

| 参数 | 说明 |
| --- | --- |
| `path` | PDF 路径（必需） |
| `page` | 页码，从 1 开始（必需） |
| `include` | 只返回 `["text"｜"shapes"｜"images"]` 的子集，默认全返回 |
| `detail` | `full`（默认，含完整路径线段）或 `box`（只给外框+样式，输出小很多） |
| `precision` | 坐标保留小数位，默认 3 |
| `limit` | 每类条数上限，默认 5000（超出会在 `truncated` 里标记） |
| `password` | 加密文档的打开密码 |

返回结构（截断示意）：

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
      "width": 124.008, "height": 26.813,  // 视觉宽 / 行高
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
      "bbox": [98.5, 490.5, 401.5, 493.5],  // 描边的外框已按线宽外扩
      "stroke": "#ff0000", "strokeWidth": 3,
      "lineCap": 0, "lineJoin": 0, "miterLimit": 10,
      "subpaths": [ /* … */ ]
    }
  ],

  "images": [
    { "kind": "image", "name": "img_p0_1",
      "intrinsicWidth": 800, "intrinsicHeight": 600,
      "bbox": [400, 132, 550, 232] },
    { "kind": "image", "name": "img_p0_3",            // 来自平铺图案的位图
      "intrinsicWidth": 300, "intrinsicHeight": 300,
      "bbox": [24, 668, 56, 700], "pattern": true }
  ],

  "fonts": { "g_d0_f1": { "family": "sans-serif", "ascent": 0.905, "descent": -0.212 } }
}
```

几个约定：

- `bbox` 一律是 `[x0, y0, x1, y1]`，左上原点、y 向下。
- 路径段的坐标已经是**设备空间**（跑完页面 CTM 与当前变换），可以直接当设计稿坐标用。
- 曲线段保留控制点（`C` = 三次贝塞尔，`Q` = 二次），`bbox` 取的是整条路径的紧致外框。
- 描边颜色为 `null` 表示是图案/渐变描边；`paint: "shading"` 表示这里原本是渐变填充（渐变本身的渲染请用 `pdf_render`）。
- 文本颜色是「按绘制顺序就近匹配」得到的；**拿不到就宁可不给**，不会瞎编。
- `paint: "clip"` 是没有被绘制的裁剪区（只影响可见范围），不是可见图形。
- 位图带了 `"pattern": true`，说明它来自**平铺图案（TilingPattern）**的图案单元
  —— 就是「拿一张图当填充」那种做法（Skia/Chrome 导出很常见）。图案单元会按 `XStep/YStep`
  在页面上平铺，这里只给图案单元**这一份**里可见的那部分外框，不代表整片平铺范围。

### `pdf_render`

把某一页栅格化成图片。

| 参数 | 说明 |
| --- | --- |
| `path` / `page` | 必需 |
| `scale` | 缩放倍数（相对 72dpi），默认 1 |
| `dpi` | 目标 DPI（等价 `scale = dpi/72`，与 `scale` 同给时以 `dpi` 为准） |
| `region` | `[x0,y0,x1,y1]`，pt，左上原点 —— 只渲染这块局部 |
| `background` | 默认 `#ffffff`；传 `transparent` 保留透明 |
| `format` | `png`（默认）/ `jpeg` |
| `save` | 给了就写文件并只返回路径信息；不给则直接把图片返回给 Agent |

`region` + 大 `scale` 就是一把「放大镜」：看某个图标、某条线是不是真的对齐，比整页缩略图靠谱得多。

## 还原设计稿的典型用法

```
1. pdf_info                      → 有几页、每页多大
2. pdf_extract(page, detail:"box")
                                 → 先拿一页所有元素的外框和样式，看清版面骨架
3. pdf_extract(page, include:["text"])
                                 → 文案、字号、字重、颜色
4. pdf_render(page, scale:1)     → 整页缩略图，核对布局
5. pdf_render(page, region:[x0,y0,x1,y1], scale:4)
                                 → 局部放大，核对细节与对齐
6. 用 1~5 的数据把设计稿重建出来，再渲染比对
```

## 叠加调试图（人眼核对）

想知道「抽出来的几何到底准不准」，生成一张叠加图最快 —— 渲染结果当底，几何画在上面：

```bash
npm run overlay -- pdfs/demo1.pdf                         # → tmp/overlay/demo1-p1-overlay.png
npm run overlay -- pdfs/demo3.pdf --page all --scale 3
npm run overlay -- design.pdf --layers render,shapes,text,labels
npm run overlay -- design.pdf --region 0,0,300,300 --line 2
```

| 图层 | 画什么 | 默认 |
| --- | --- | :---: |
| `render` | 渲染底图 | ✅ |
| `text` | 文本外框（蓝）+ 基线起点与宽度（粉） | ✅ |
| `shapes` | 图形线框：fill 洋红 / stroke 绿 / shading 红 / clip 灰虚线 | ✅ |
| `images` | 位图外框（橙，标注原始像素尺寸） | ✅ |
| `legend` | 右上角图例（各图层计数） | ✅ |
| `labels` | 每条文本的内容（黄） | — |
| `shapeBoxes` | 图形外框（虚线） | — |

编程接口：

```js
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

用来回归很方便：改完抽取逻辑，跑一遍真实案例的叠加图，一眼就能看出有没有偏、有没有漏。

## 编程用法

包的主用法是 MCP 服务，但核心能力也直接导出了：

```js
import { openPage, extractPage, renderPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const content = await extractPage(page, { precision: 2 });
const png = await renderPage(page, { scale: 2, region: [0, 0, 300, 300] });
```

文档会按「路径 + 修改时间」缓存复用，`closeAllDocuments()` 可主动释放。

## 隐藏文本层（重要）

Chrome/Skia 这类导出器很常见的做法是：**可见文字画成矢量轮廓**，同时在下面垫一层
不可见的文本对象（为了可搜索/可选中）。那层文本的颜色、甚至位置都跟可见内容无关。

本工具会自动识别这种情况，并做两件事：

1. 被后绘制的不透明图形完全盖住的文本，标记 `"covered": true`（别把它当可见内容用）；
2. 如果同一位置有「文字轮廓」图形，就把轮廓的颜色作为 `color` 反推回来，
   并标注 `"colorFrom": "outline"`；找不到就干脆不给 `color`。

```jsonc
{ "text": "Mailboxes", "x": 24, "y": 56.64, "fontSize": 24,
  "color": "#e8e8ea", "covered": true, "colorFrom": "outline",
  "bbox": [24, 37.44, 141.79, 61.44] }
```

换句话说：**`covered: true` 的文本，文字内容可信，颜色/几何以反推值为准**。
真实案例（Skia/PDF m117 导出的移动端设计稿）实测：13/13、20/23 条文本都能反推出正确颜色。

## 已知限制

- **文本颜色**：正常 PDF 直接用绘图指令里的颜色；遇到「隐藏文本层」走上面的反推逻辑，
  反推不出来就不给颜色（不会给你一个错的）。
- **渐变**只标记位置（`paint: "shading"`），没有把色标拆出来。
- **图案（TilingPattern）填充**：`fill` 给 `null`（图案没有单一颜色）；图案单元里画到的位图会抽出来
  并标 `pattern: true`，但只给「图案单元这一份」与填充区域相交的那部分外框，不会把平铺出来的每一块副本都展开成一个条目。
- **透明组（isolated transparency group）**内部的坐标已按最终合成位置换算，正常情况是对的；极少数带自定义 `group.matrix` 的表单 XObject 可能有偏差。
- 位图只给**位置和原始像素尺寸**，不给像素数据（要看图请用 `pdf_render`）。
- 图元被后绘制的不透明图形盖住时，文本会被标 `covered`；图形目前不跟踪遮挡关系。
- 超大页面注意输出体积：用 `detail: "box"`、`include` 和 `limit` 控制。

## 开发

```bash
npm install
npm run build     # tsc → dist/
npm test          # 构建 + 核心断言 + MCP stdio 端到端
npm run overlay -- pdfs/demo1.pdf   # 生成叠加调试图，人眼核对
```

`scripts/make-sample.mjs` 会现场生成三个最小 PDF 作为金标准：

- `tmp/sample.pdf` —— 矢量图形/文本/位图/CTM 变换；
- `tmp/sample-hidden.pdf` —— 隐藏文本层 + 被不透明底盖住 + 文字转轮廓的反推场景；
- `tmp/sample-pattern.pdf` —— 用平铺图案（TilingPattern）填充矩形，图案单元里贴一张位图。

`npm test` 里还拿 `pdfs/demo1~3.pdf`（Skia/PDF m117 导出的真实设计稿）当金标准：
只断言语义（页面尺寸、隐藏文本层的颜色反推、图案位图的落点），不锁条数，正常的抽取改进不会把它打红。

## License

MIT
