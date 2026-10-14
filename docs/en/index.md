---
title: pdf-parse-mcp Documentation
description: "Overview of @ai-zen/pdf-parse-mcp — an MCP server that takes PDFs apart precisely into text, vector shapes and bitmaps (geometry and styles), with on-demand raster rendering."
outline: deep
---

# pdf-parse-mcp

`@ai-zen/pdf-parse-mcp` is an **MCP server (stdio)** that takes PDFs apart **precisely** for agents: it returns the **coordinates and sizes** of text, vector shapes and bitmaps, plus on-demand raster rendering.

It is not about "flattening a PDF into a blob of plain text". It is built for the "**reconstruct a design file from a PDF**" use case: you get the **position, size, color and stroke width** of every glyph, line and rectangle in the file.

- **Precise geometry**: text carries a baseline origin and bbox, font size, rotation and color; shapes carry fill/stroke, alpha, line width and boxes; bitmaps carry their placement box and intrinsic pixel size.
- **Screen coordinate system**: everything uses a **top-left origin, y down, in points (1pt = 1/72 inch)** — the intuitive coordinate system of screens and design tools, instead of PDF's internal "bottom-left origin, y up".
- **On-demand rendering**: rasterize a whole page or any region to PNG/JPEG; `region` plus a large `scale` is a magnifying glass.
- **Single source of truth**: this repo's `docs/` is the only source of documentation; the website only aggregates and renders it.

## The three tools

| Tool | Purpose |
|------|---------|
| `pdf_info` | Document-level info: page count, per-page size and rotation, metadata |
| `pdf_extract` | **The core tool**: extract text / vector shapes / bitmaps from one page |
| `pdf_render` | Rasterize one page to an image (whole page or a region) |

## Documentation navigation

- [Getting Started](./getting-started.md) — Requirements, install, wiring an MCP client, and your first call.
- [MCP Tools](./tools.md) — Full parameters and return shapes for `pdf_info` / `pdf_extract` / `pdf_render`.
- [Core Concepts](./concepts.md) — Coordinate convention, hidden text layers, patterns and gradients, and gotchas.
- [API Reference](./api/index.md) — Programmatic API `openPage` / `extractPage` / `renderPage` / `renderOverlay`.
- [Reconstructing a Design from a PDF](./guides/reconstruct-design.md) — The recommended workflow and tips.
- [Overlay Debug Images](./guides/overlay.md) — Visually verify extraction accuracy with an overlay.
