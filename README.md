# @ai-zen/pdf-parse-mcp

**English** | [简体中文](./README.zh-CN.md)

An MCP server that takes PDFs apart precisely for agents: **coordinates and sizes for text, vector shapes, and bitmaps — plus on-demand raster rendering**.

Built for the "**reconstruct a design file from a PDF**" use case — you get the position, size, color, and stroke width of every glyph, line, and rectangle in the file, instead of one blob of plain text.

```
npx -y @ai-zen/pdf-parse-mcp
```

## What it actually gives you

| You want | You get |
| --- | --- |
| Where a glyph is, how big it is | Baseline origin `x/y`, bounding box `bbox`, `fontSize`, rotation, color |
| The shape of a rect / line / curve | Subpath geometry (`M`/`L`/`C`/`Q`/close flags) plus `bbox` |
| What it looks like | Fill color, stroke color, alpha, line width, cap/join/dash |
| Where the images are | Placement box of every bitmap plus its intrinsic pixel size |
| To just look at it | Rasterize the whole page or any region to PNG/JPEG |

All coordinates use a **top-left origin, y down, in points (1pt = 1/72 inch)** — the intuitive coordinate system of screens and design tools, instead of PDF's internal "bottom-left origin, y up".

## Install / wiring

Add a snippet to any MCP client (Claude Desktop, Cline, Cursor, your own agent…):

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

No system dependencies: the canvas implementation (`@napi-rs/canvas`) and all font/cmap/wasm assets ship as prebuilt artifacts inside the package.

Requires Node.js **≥ 22.13** (pdfjs 6 requirement).

## Tools

### `pdf_info`

Document-level information: page count, per-page size and rotation, metadata.

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

Parameters: `path` (required), `password`, `maxPages` (default 100).

### `pdf_extract`

Extract everything on a single page. **This is the core tool.**

Parameters:

| Parameter | Description |
| --- | --- |
| `path` | PDF path (required) |
| `page` | Page number, 1-based (required) |
| `include` | Return only a subset of `["text"｜"shapes"｜"images"]`; all by default |
| `detail` | `box` (default, boxes + styles only, tiny output) or `full` (with complete path segments M/L/C/Q/Z). ⚠️ **Don't turn on `full` unless you know what you're doing**: one demo page with 66 shapes carries 8,078 segments, inflating the shapes JSON from 6.5 KB to 550 KB — it will blow up your context. If you really need to redraw a shape, narrow it down with `region` first |
| `precision` | Decimal places for coordinates, default 3 |
| `includeClip` | Also return clip-region shapes (`paint: "clip"`), default `false` |
| `region` | Only extract items intersecting this rect `[x0,y0,x1,y1]` (pt, top-left origin); no limit by default |
| `limit` | Max items per category, default 5000 (exceeding it is flagged in `truncated`) |
| `password` | Password for encrypted documents |

Return shape (truncated; the `shapes` entries below show what `detail:"full"` gives):

```jsonc
{
  "page": 1,
  "width": 595.28, "height": 841.89, "rotation": 0,
  "unit": "pt", "coord": "top-left origin, y down",
  "counts": { "text": 42, "shapes": 17, "images": 2 },

  "text": [
    {
      "text": "Hello World",
      "x": 72, "y": 92,                    // baseline origin
      "width": 124.008, "height": 26.813,  // visual width / line height
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
      "bbox": [98.5, 490.5, 401.5, 493.5],  // stroke box already expanded by line width
      "stroke": "#ff0000", "strokeWidth": 3,
      "lineCap": 0, "lineJoin": 0, "miterLimit": 10,
      "subpaths": [ /* … */ ]
    }
  ],

  "images": [
    { "kind": "image", "name": "img_p0_1",
      "intrinsicWidth": 800, "intrinsicHeight": 600,
      "bbox": [400, 132, 550, 232] },
    { "kind": "image", "name": "img_p0_3",            // bitmap from a tiling pattern cell
      "intrinsicWidth": 300, "intrinsicHeight": 300,
      "bbox": [24, 668, 56, 700], "pattern": true }
  ],

  "fonts": { "g_d0_f1": { "family": "sans-serif", "ascent": 0.905, "descent": -0.212 } }
}
```

A few conventions:

- `bbox` is always `[x0, y0, x1, y1]`, top-left origin, y down.
- Path segment coordinates are already in **device space** (page CTM and current transform applied), so you can use them directly as design-file coordinates.
- Curve segments keep their control points (`C` = cubic Bézier, `Q` = quadratic); `bbox` is the tight box of the whole path.
- A `null` stroke color means a pattern/gradient stroke; `paint: "shading"` means the region was originally a gradient fill (render gradients with `pdf_render`).
- Text color is recovered by nearest-in-paint-order matching; **if it can't be determined we omit it** rather than inventing one.
- Clip regions (`paint: "clip"`) are **omitted by default**: they are never painted, they only constrain visibility; pass `includeClip: true` to get them.
- `region` **filters only**: items whose box intersects it are returned unchanged, geometry is **not clipped**, and coordinates stay in page space (so they line up with `pdf_render`'s `region` magnifier).
- Shapes give boxes and styles by default (`detail: "box"`): a full path often runs to hundreds of segments, which is noise when you only need the layout.
  ⚠️ **Don't use `detail: "full"` unless you know what you're doing** — it exists for "redraw this shape exactly" work and can multiply the payload by tens (demo1: 66 shapes, 8,078 segments, 550 KB). If you need the geometry, scope it with `region` first.
- A bitmap tagged `"pattern": true` comes from a **tiling pattern (TilingPattern)** cell — the "use an image as fill" trick (very common in Skia/Chrome exports). The cell is tiled across the page by `XStep/YStep`; we report only the visible part of **that one cell**, not the full tiled extent.

### `pdf_render`

Rasterize a single page to an image.

| Parameter | Description |
| --- | --- |
| `path` / `page` | Required |
| `scale` | Zoom factor (relative to 72dpi), default 1 |
| `dpi` | Target DPI (equivalent to `scale = dpi/72`; wins if both are given) |
| `region` | `[x0,y0,x1,y1]`, pt, top-left origin — render only this region |
| `background` | Default `#ffffff`; pass `transparent` to keep alpha |
| `format` | `png` (default) / `jpeg` |
| `save` | If given, write the file and return path info only; otherwise the image itself is returned to the agent |

`region` plus a large `scale` is a magnifying glass: checking whether an icon or a line is really aligned beats a full-page thumbnail by a mile.

## Typical workflow for reconstructing a design

```
1. pdf_info                      → how many pages, how big each page is
2. pdf_extract(page, detail:"box")
                                 → all boxes and styles first, to see the layout skeleton
3. pdf_extract(page, include:["text"])
                                 → copy, font size, weight, color
4. pdf_render(page, scale:1)     → full-page thumbnail to verify layout
5. pdf_render(page, region:[x0,y0,x1,y1], scale:4)
                                 → zoom in on a detail to verify alignment
6. rebuild the design from 1–5, then render and compare (to replicate a shape exactly, re-extract that page with `detail:"full"` for its path segments)
```

## Overlay debug images (visual check)

To find out "is the extracted geometry actually accurate", an overlay image is the fastest answer — the render as backdrop, the geometry drawn on top:

```bash
npm run overlay -- pdfs/demo1.pdf                         # → tmp/overlay/demo1-p1-overlay.png
npm run overlay -- pdfs/demo3.pdf --page all --scale 3
npm run overlay -- design.pdf --layers render,shapes,text,labels
npm run overlay -- design.pdf --region 0,0,300,300 --line 2
```

| Layer | Draws | Default |
| --- | --- | :---: |
| `render` | rendered page as backdrop | ✅ |
| `text` | text boxes (blue) + baseline origin and width (pink) | ✅ |
| `shapes` | shape outlines: fill magenta / stroke green / shading red / clip gray dashed | ✅ |
| `images` | image boxes (orange, labeled with intrinsic pixel size) | ✅ |
| `legend` | legend with per-layer counts (top-right) | ✅ |
| `labels` | text content of each item (yellow) | — |
| `shapeBoxes` | shape bounding boxes (dashed) | — |

Programmatic interface:

```js
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

The overlay is a debug view: it turns `includeClip` on, so clip regions are drawn as well (gray dashed). Great for regression: after changing extraction logic, run the overlay on real documents and any drift or missed item is obvious at a glance.

## Programmatic usage

The main use of this package is the MCP server, but the core is exported as well:

```js
import { openPage, extractPage, renderPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const content = await extractPage(page, { precision: 2 });
const png = await renderPage(page, { scale: 2, region: [0, 0, 300, 300] });
```

`extractPage` also takes three optional switches (same semantics as the MCP tool): `includeClip` (also return clip regions as shapes, off by default), `region` (keep a single area — it filters, it does not clip) and `applyClip` (off by default: drop items whose box does not intersect the active clip region at all). `applyClip` is deliberately conservative and **never returns clipped geometry**; on real Skia exports it often drops nothing at all, so don't count on it for visibility cleanup.

Documents are cached and reused by "path + mtime"; call `closeAllDocuments()` to release them.

## Hidden text layers (important)

Chrome/Skia-style exporters commonly do this: **visible text is painted as vector outlines**, with an invisible text object underneath (for searchability/selection). That text layer's color — sometimes even its position — has nothing to do with what is visible.

This tool detects the pattern and does two things:

1. Text fully covered by later, opaque artwork is marked `"covered": true` (don't treat it as visible content);
2. If a "text outline" shape sits at the same spot, its color is used to recover `color`, and `"colorFrom": "outline"` is set; if none is found, no `color` is reported at all.

```jsonc
{ "text": "Mailboxes", "x": 24, "y": 56.64, "fontSize": 24,
  "color": "#e8e8ea", "covered": true, "colorFrom": "outline",
  "bbox": [24, 37.44, 141.79, 61.44] }
```

In other words: **for text with `covered: true`, the string content is trustworthy; color and geometry should be taken from the recovered values.**
Measured on real documents (mobile design exports from Skia/PDF m117): 13/13 and 20/23 text items had their colors recovered correctly.

## Known limitations

- **Text color**: regular PDFs use the color from the drawing operators directly; hidden text layers go through the recovery logic above, and if recovery fails no color is reported (never a wrong one).
- **Gradients** are only marked positionally (`paint: "shading"`); color stops are not extracted.
- **Pattern (TilingPattern) fills**: `fill` is `null` (a pattern has no single color); bitmaps painted inside the pattern cell are extracted and tagged `pattern: true`, but only the portion of **that one cell** intersecting the filled area is reported — tiled copies are not expanded into separate entries.
- **Transparency groups** (isolated): inner coordinates are mapped through to the final composited position and are correct in normal cases; rare form XObjects with a custom `group.matrix` may be slightly off.
- Bitmaps report **placement and intrinsic pixel size** only, not pixel data (use `pdf_render` to look at them).
- When artwork is covered by later opaque fills, text is marked `covered`; shapes do not track occlusion yet.
- Mind the output size on very large pages: control it with `detail: "box"`, `include`, and `limit`.

## Development

```bash
npm install
npm run build     # tsc → dist/
npm test          # build + core assertions + MCP stdio end-to-end
npm run overlay -- pdfs/demo1.pdf   # generate an overlay for visual inspection
```

`scripts/make-sample.mjs` generates three minimal PDFs on the fly as golden fixtures:

- `tmp/sample.pdf` — vector shapes / text / bitmaps / CTM transforms;
- `tmp/sample-hidden.pdf` — hidden text layer + covered by an opaque background + outline-recovered color;
- `tmp/sample-pattern.pdf` — a rectangle filled with a tiling pattern (TilingPattern) whose cell embeds a bitmap.

`npm test` also uses `pdfs/demo1~3.pdf` (real design exports from Skia/PDF m117) as golden fixtures: it asserts semantics only (page size, hidden-text color recovery, pattern bitmap placement) and never locks item counts, so normal extraction improvements will not turn it red.

## License

MIT
