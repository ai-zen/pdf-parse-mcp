---
title: Overlay Debug Images
description: Use the overlay to draw the rendered page and the extracted geometry together and verify pdf-parse-mcp's extraction accuracy visually.
outline: deep
---

# Overlay Debug Images

The fastest way to check "is the extracted geometry actually accurate" is an overlay — the render as backdrop with the geometry drawn on top.

## CLI

```bash
npm run overlay -- pdfs/demo1.pdf                         # → tmp/overlay/demo1-p1-overlay.png
npm run overlay -- pdfs/demo3.pdf --page all --scale 3
npm run overlay -- design.pdf --layers render,shapes,text,labels
npm run overlay -- design.pdf --region 0,0,300,300 --line 2
```

## Layers

| Layer | Draws | Default |
|-------|-------|:-------:|
| `render` | rendered page as backdrop | ✅ |
| `text` | text boxes (blue) + baseline origin and width (pink) | ✅ |
| `shapes` | shape outlines: fill magenta / stroke green / shading red / clip gray dashed | ✅ |
| `images` | image boxes (orange, labeled with intrinsic pixel size) | ✅ |
| `legend` | legend with per-layer counts (top-right) | ✅ |
| `labels` | text content of each item (yellow) | — |
| `shapeBoxes` | shape bounding boxes (dashed) | — |

## Programmatic interface

```js
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

## What it's for

The overlay is a **debug view**: it turns `includeClip` on, so clip regions are drawn as well (gray dashed). It is great for **regression** — after changing extraction logic, run the overlay on real documents and any drift or missed item is obvious at a glance.
