---
title: Reconstructing a Design from a PDF
description: The recommended workflow and tips for precisely rebuilding a design file from a PDF with pdf-parse-mcp.
outline: deep
---

# Reconstructing a Design from a PDF

This is the core purpose of the tool: pull out the precise position and style of every glyph, line and rectangle in a PDF and rebuild the design file.

## Recommended workflow

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

## Tips

- **Coarse before fine**: start with `detail: "box"` to see the skeleton; don't jump straight to `full`.
- **Zoom in**: to verify icon/line alignment, `pdf_render` + `region` + a large `scale` is a magnifying glass.
- **Region filtering**: when there are many items, narrow the extraction with `region`; note that it **filters, it does not clip**, and coordinates stay in page space.
- **Watch hidden text layers**: for text with `covered: true`, the content is trustworthy while color/geometry come from the recovered values.
- **Control the payload**: the `include`, `limit` and `detail` trio keeps your context from blowing up.

## Visual verification

The fastest way to check "is the extracted geometry actually accurate" is an [overlay debug image](./overlay.md): the render as backdrop with the geometry drawn on top — drift or missed items are obvious at a glance.
