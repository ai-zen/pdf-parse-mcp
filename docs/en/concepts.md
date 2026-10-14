---
title: Core Concepts
description: pdf-parse-mcp's coordinate convention, device-space coordinates, hidden text layers, pattern fills and gradients, and known limitations.
outline: deep
---

# Core Concepts

## Coordinate convention

- **Top-left origin, y down, in points (1pt = 1/72 inch).**
- This is the intuitive coordinate system of screens and design tools, **different from PDF's internal "bottom-left origin, y up"**. Every `x/y`, `bbox` and `region` returned by the tools follows this convention.
- `bbox` is always `[x0, y0, x1, y1]`.

## Device-space coordinates

Path segment coordinates returned by `pdf_extract` are already in **device space** (page CTM and current transform applied), so you can use them directly as design-file coordinates without applying any further transform.

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

::: tip Takeaway
For text with `covered: true`: **the string content is trustworthy; color and geometry should be taken from the recovered values.**
:::

Measured on real documents (mobile design exports from Skia/PDF m117): 13/13 and 20/23 text items had their colors recovered correctly.

## Pattern fills and gradients

- **Gradients** are only marked positionally (`paint: "shading"`); color stops are not extracted. Render gradients with `pdf_render`.
- **Pattern (TilingPattern) fills**: `fill` is `null` (a pattern has no single color); bitmaps painted inside the pattern cell are extracted and tagged `pattern: true`, but only the portion of **that one cell** intersecting the filled area is reported — tiled copies are not expanded into separate entries.

## Known limitations

- **Text color**: regular PDFs use the color from the drawing operators directly; hidden text layers go through the recovery logic above, and if recovery fails no color is reported (never a wrong one).
- **Gradients**: marked positionally only; color stops are not extracted.
- **Pattern fills**: `fill` is `null`; bitmaps report only the visible part of the cell.
- **Transparency groups** (isolated): inner coordinates are mapped through to the final composited position and are correct in normal cases; rare form XObjects with a custom `group.matrix` may be slightly off.
- **Bitmaps**: placement and intrinsic pixel size only, not pixel data (use `pdf_render` to look at them).
- When artwork is covered by later opaque fills, text is marked `covered`; shapes do not track occlusion yet.
- Mind the output size on very large pages: control it with `detail: "box"`, `include`, and `limit`.

## Document caching

Documents are cached and reused by "path + mtime"; call `closeAllDocuments()` to release them.
