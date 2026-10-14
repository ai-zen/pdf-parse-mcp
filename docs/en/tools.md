---
title: MCP Tools
description: Complete parameters and return shapes for the pdf_info / pdf_extract / pdf_render MCP tools.
outline: deep
---

# MCP Tools

The server exposes three tools, all using a **top-left origin, y down, in points (1pt = 1/72 inch)** coordinate convention.

## `pdf_info`

Document-level information: page count, per-page size and rotation, metadata. Use it to understand the document structure and decide which pages to process.

**Parameters**

| Parameter | Required | Description |
|-----------|:--------:|-------------|
| `path` | ✅ | PDF file path (absolute or relative to the current working directory) |
| `password` | | Open password if the PDF is encrypted |
| `maxPages` | | How many pages' sizes to list, default `100` (lower it for huge documents) |

**Return**

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

Extract everything on a single page. **This is the core tool.**

**Parameters**

| Parameter | Required | Description |
|-----------|:--------:|-------------|
| `path` | ✅ | PDF file path |
| `page` | ✅ | Page number, 1-based |
| `include` | | Return only a subset of `["text"｜"shapes"｜"images"]`; all by default |
| `detail` | | `box` (default) or `full`, see the warning below |
| `precision` | | Decimal places for coordinates, default `3` |
| `includeClip` | | Also return clip regions (`paint:"clip"`) as shapes, default `false` |
| `region` | | Only extract items intersecting this rect `[x0,y0,x1,y1]` (pt, top-left origin) |
| `limit` | | Max items per category, default `5000` (flagged in `truncated` when exceeded) |
| `password` | | Password for encrypted documents |

::: warning Use `detail: "full"` with care
The default `box` returns boxes and styles only, so the output is tiny. `full` adds complete path segments (M/L/C/Q/Z) — one page with 66 shapes carries **8,078 segments**, inflating the shapes JSON from **6.5 KB to 550 KB** and blowing up your context. If you really need to redraw a shape, narrow it down with `region` first and then pass `full`.
:::

**Return shape** (truncated; the `shapes` entries below show what `detail:"full"` gives)

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

**Conventions**

- `bbox` is always `[x0, y0, x1, y1]`, top-left origin, y down.
- Path segment coordinates are already in **device space** (page CTM and current transform applied), so you can use them directly as design-file coordinates.
- Curve segments keep their control points (`C` = cubic Bézier, `Q` = quadratic); `bbox` is the tight box of the whole path.
- A `null` stroke color means a pattern/gradient stroke; `paint: "shading"` means the region was originally a gradient fill (render gradients with `pdf_render`).
- Text color is recovered by nearest-in-paint-order matching; **if it can't be determined we omit it** rather than inventing one.
- Clip regions (`paint: "clip"`) are **omitted by default**: they are never painted, they only constrain visibility; pass `includeClip: true` to get them.
- `region` **filters only**: items whose box intersects it are returned unchanged, geometry is **not clipped**, and coordinates stay in page space (so they line up with `pdf_render`'s `region`).
- Shapes give boxes and styles by default (`detail: "box"`).
- A bitmap tagged `"pattern": true` comes from a **tiling pattern (TilingPattern)** cell — the "use an image as fill" trick (very common in Skia/Chrome exports). The cell is tiled across the page by `XStep/YStep`; we report only the visible part of **that one cell**, not the full tiled extent.

## `pdf_render`

Rasterize a single page to an image (PNG/JPEG).

**Parameters**

| Parameter | Required | Description |
|-----------|:--------:|-------------|
| `path` / `page` | ✅ | File path and page number |
| `scale` | | Zoom factor (relative to 72dpi), default `1` |
| `dpi` | | Target DPI (equivalent to `scale = dpi/72`; wins if both are given) |
| `region` | | `[x0,y0,x1,y1]`, pt, top-left origin — render only this region |
| `background` | | Default `#ffffff`; pass `transparent` to keep alpha |
| `format` | | `png` (default) / `jpeg` |
| `save` | | If given, write the file and return path info only; otherwise the image itself is returned to the agent |

::: tip A magnifying glass
`region` plus a large `scale` is a magnifying glass: checking whether an icon or a line is really aligned beats a full-page thumbnail by a mile.
:::

## Typical workflow

From "see the layout skeleton" to "reconstruct and compare":

```
1. pdf_info                      → how many pages, how big each page is
2. pdf_extract(page, detail:"box")
                                 → all boxes and styles first, to see the layout skeleton
3. pdf_extract(page, include:["text"])
                                 → copy, font size, weight, color
4. pdf_render(page, scale:1)     → full-page thumbnail to verify layout
5. pdf_render(page, region:[x0,y0,x1,y1], scale:4)
                                 → zoom in on a detail to verify alignment
6. rebuild the design from 1–5, then render and compare
   (to replicate a shape exactly, re-extract that page with detail:"full" for its path segments)
```

See [Reconstructing a Design from a PDF](./guides/reconstruct-design.md).
