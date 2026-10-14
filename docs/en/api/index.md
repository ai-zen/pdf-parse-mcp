---
title: API Reference
description: "The programmatic API of @ai-zen/pdf-parse-mcp — openDocument / openPage / extractPage / renderPage / renderOverlay and exported types."
outline: deep
---

# API Reference

The main use of this package is the MCP stdio server, but the core is exported as well so you can reuse it directly from other Node programs.

## Import

```ts
import {
  openDocument, openPage, closeAllDocuments, resolveFile,
  extractPage, renderPage,
  renderOverlay, OVERLAY_LAYERS, DEFAULT_LAYERS,
  serveMCP,
} from "@ai-zen/pdf-parse-mcp";
```

## Document lifecycle

### `openDocument(path, password?)`

Open a PDF document and return the pdfjs document object. Documents are cached and reused by "path + mtime".

### `openPage(path, pageNumber)`

Open the document and get a single page.

### `closeAllDocuments()`

Release all cached documents.

### `resolveFile(path)`

Resolve a file path (used internally and by the tool layer).

## Extraction

### `extractPage(page, options?)`

Extract content from a single page, returning a `PageContent`.

```ts
import { openPage, extractPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const content = await extractPage(page, { precision: 2 });
```

Options (`ExtractPageOptions`):

| Option | Description |
|--------|-------------|
| `precision` | Decimal places for coordinates |
| `includeClip` | Also return clip regions as shapes, default `false` |
| `region` | Keep a single area (it **filters**, it does not clip) |
| `applyClip` | Drop items whose box does not intersect the active clip region at all, default `false` |

::: warning What `applyClip` is (not) for
`applyClip` is deliberately conservative and **never returns clipped geometry** (that would require path boolean operations or rasterization). On real Skia exports it often drops nothing at all, so don't count on it for visibility cleanup. For that reason it is **not** part of the MCP tool schema — it would only add noise for agents.
:::

## Rendering

### `renderPage(page, options?)`

Rasterize a single page to an image, returning a `RenderResult`.

```ts
import { openPage, renderPage } from "@ai-zen/pdf-parse-mcp";

const page = await openPage("design.pdf", 1);
const png = await renderPage(page, { scale: 2, region: [0, 0, 300, 300] });
```

Options (`RenderOptions`): `scale`, `dpi`, `region`, `background`, `format`.

## Overlay debug images

### `renderOverlay(page, options?)`

Draw the extracted geometry on top of the rendered page, returning `{ buffer, counts }` for visual verification.

```ts
import { renderOverlay } from "@ai-zen/pdf-parse-mcp";

const { buffer, counts } = await renderOverlay(page, { scale: 2 });
```

Options (`OverlayOptions`): `scale`, `layers`, `region`, `line`, `includeClip`, `applyClip`, among others. See [Overlay Debug Images](../guides/overlay.md) for the layers.

## Exported types

`PageContent`, `TextItem`, `Shape`, `SubPath`, `PathSegment`, `ImageItem`, `ExtractPageOptions`, `RenderOptions`, `RenderResult`, `OverlayOptions`, `OverlayResult`, `OverlayLayer`.

## MCP server

### `serveMCP()`

Start the MCP stdio server (the CLI entry point, i.e. `dist/cli.js`).
