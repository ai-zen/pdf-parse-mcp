# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-24

First public release. `0.1.0` was the initial implementation and was never published.

### Added

- `pdf_extract`: `includeClip` parameter. Clip regions (`paint: "clip"`) are **no longer returned by default** — they are never painted and only constrain visibility; pass `includeClip: true` to get them back.
- `pdf_extract`: `region` parameter (`[x0,y0,x1,y1]`, pt, top-left origin) to extract only the items intersecting that rect. It **filters, it does not clip**: geometry is returned unchanged and stays in page coordinates, so it lines up with `pdf_render`'s `region`.
- `extractPage`: `applyClip` option (off by default) — drop items whose bounding box does not intersect the currently active clip region at all. Deliberately conservative; it never computes a clipped geometry (that would require path boolean operations or rasterization). Kept out of the MCP tool schema on purpose: on Skia exports it almost never fires, so it would only add noise for agents.
- `renderOverlay`: `includeClip` / `applyClip` options, exposed on the CLI as `--no-clip` and `--apply-clip`.

### Changed

- **`detail` now defaults to `box`** in `pdf_extract`. Path segments (`M/L/C/Q/Z`) are only returned with `detail: "full"`, which now carries a warning: one demo page with 66 shapes holds 8,078 segments, inflating the shapes JSON from 6.5 KB to 550 KB.
- Documentation split into `README.md` (English, primary — what npm shows) and `README.zh-CN.md` (Simplified Chinese), with language links on both.

## [0.1.0]

Initial implementation (never published):

- MCP stdio server exposing `pdf_info` / `pdf_extract` / `pdf_render`, plus a programmatic API (`openPage` / `extractPage` / `renderPage` / `renderOverlay`).
- Text extraction: string, baseline origin, box, font size, rotation, color — with hidden-text-layer handling (`covered: true`, `colorFrom: "outline"` color recovery from the visible outlines).
- Vector shapes: fill/stroke colors, alpha, line width, cap/join/dash, subpaths with `M`/`L`/`C`/`Q`/close, plus `paint: "shading"` markers for gradients.
- Bitmaps: placement box and intrinsic pixel size; bitmaps painted inside tiling patterns (TilingPattern) are extracted recursively and tagged `pattern: true`.
- Form XObject `baseTransform` stack, so pattern-anchored content lands on the right spot.
- Coordinate contract: top-left origin, y down, unit pt. Overlay debug images (`npm run overlay`), smoke tests (`smoke` / `mcp-smoke`) and on-the-fly golden sample PDFs.
