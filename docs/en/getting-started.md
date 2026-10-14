---
title: Getting Started
description: Install @ai-zen/pdf-parse-mcp, wire it into an MCP client such as Claude Desktop / Cline / Cursor, and make your first extract and render calls.
outline: deep
---

# Getting Started

## Requirements

- **Node.js ≥ 22.13** (a pdfjs 6 requirement).
- **No system dependencies**: the canvas implementation (`@napi-rs/canvas`) and all font / cmap / wasm assets ship as **prebuilt artifacts** inside the package.

## Install / run

Run it directly with `npx` (no pre-install needed):

```bash
npx -y @ai-zen/pdf-parse-mcp
```

Or install it as a dependency to use the [programmatic API](./api/index.md):

```bash
npm install @ai-zen/pdf-parse-mcp
```

## Wiring an MCP client

Add this snippet to any MCP client (Claude Desktop, Cline, Cursor, your own agent…):

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

Once wired, the client can call the three tools `pdf_info` / `pdf_extract` / `pdf_render`.

## Your first calls

Given a `design.pdf`, a typical three-step flow:

```
1. pdf_info      { "path": "design.pdf" }
                 → how many pages, how big each page is

2. pdf_extract   { "path": "design.pdf", "page": 1 }
                 → all text / shapes / bitmaps on page 1 (detail=box by default, tiny output)

3. pdf_render    { "path": "design.pdf", "page": 1, "scale": 1 }
                 → a full-page thumbnail to eyeball the layout
```

::: tip Coordinate convention
All coordinates use a **top-left origin, y down, in points (1pt = 1/72 inch)**. See [Core Concepts](./concepts.md).
:::

## Next steps

- Full parameters for each tool: [MCP Tools](./tools.md)
- The complete reconstruction flow: [Reconstructing a Design from a PDF](./guides/reconstruct-design.md)
