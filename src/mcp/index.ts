/**
 * pdf-parse-mcp —— 标准 MCP server（stdio），面向「从 PDF 还原设计稿」的 Agent。
 *
 * 三个工具：
 *   pdf_info     文档级信息（页数、页面尺寸、元数据）
 *   pdf_extract  单页内容抽取（文本 / 矢量图形 / 位图的精确几何与样式）
 *   pdf_render   单页栅格化（整页或局部、可保存或直接返回图片）
 *
 * 坐标约定：左上原点、y 向下、单位 pt（1 pt = 1/72 英寸）。与 PDF 内部
 * 「左下原点、y 向上」不同，这里是面向设计稿的屏幕习惯坐标系。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { openDocument, closeAllDocuments } from "../core/document.js";
import { extractPage, type PageContent, type Shape, type ImageItem, type TextItem } from "../core/extract.js";
import { renderPage } from "../core/render.js";

export { closeAllDocuments } from "../core/document.js";
export { extractPage } from "../core/extract.js";
export { renderPage } from "../core/render.js";

const VERSION = "0.1.0";

const COORD_NOTE = "坐标：左上原点、y 向下、单位 pt（1pt=1/72 英寸）。";

const okText = (text: string) => ({ content: [{ type: "text" as const, text }] });
const failText = (err?: unknown) => ({
  content: [{ type: "text" as const, text: `错误: ${err instanceof Error ? err.message : String(err ?? "未知错误")}` }],
  isError: true,
});

const passwordField = z.string().optional().describe("若 PDF 已加密，提供打开密码");
const pathField = z.string().describe("PDF 文件路径（绝对或相对当前工作目录）");

type Include = "text" | "shapes" | "images";

interface ExtractPayload {
  page: number;
  width: number;
  height: number;
  rotation: number;
  unit: string;
  coord: string;
  text?: TextItem[];
  shapes?: Shape[];
  images?: ImageItem[];
  fonts?: PageContent["fonts"];
  truncated?: Record<string, boolean>;
  counts?: Record<string, number>;
}

function shapeBoxOnly(shape: Shape): Shape {
  return { ...shape, subpaths: [] };
}

export async function serveMCP(): Promise<void> {
  const server = new McpServer({ name: "pdf-parse-mcp", version: VERSION });

  // ---------- pdf_info ----------
  server.tool(
    "pdf_info",
    `读取 PDF 的文档级信息：页数、每页尺寸与旋转角、元数据（标题/作者/生成器等）。` +
      `用于在抽取前了解文档结构、确定要处理哪些页。${COORD_NOTE}`,
    {
      path: pathField,
      password: passwordField,
      maxPages: z.number().int().positive().optional().describe("最多列出多少页的尺寸，默认 100（文档很大时可调小）"),
    },
    async ({ path: file, password, maxPages }) => {
      try {
        const doc = await openDocument(file, password);
        const limitedMeta = (doc as unknown as { isEncrypted?: boolean }).isEncrypted;
        const meta = await doc.getMetadata().catch(() => null);
        const limit = Math.min(maxPages ?? 100, doc.numPages);
        const pageSizes: { page: number; width: number; height: number; rotation: number }[] = [];
        for (let i = 1; i <= limit; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          pageSizes.push({
            page: i,
            width: Number(vp.width.toFixed(3)),
            height: Number(vp.height.toFixed(3)),
            rotation: page.rotate,
          });
        }
        return okText(
          JSON.stringify({
            path: file,
            pages: doc.numPages,
            encrypted: typeof limitedMeta === "boolean" ? limitedMeta : undefined,
            unit: "pt",
            coord: "top-left origin, y down",
            metadata: meta?.info ?? null,
            pageSizes,
            pageSizesTruncated: limit < doc.numPages ? true : undefined,
          }),
        );
      } catch (err) {
        return failText(err);
      }
    },
  );

  // ---------- pdf_extract ----------
  server.tool(
    "pdf_extract",
    `抽取 PDF 某一页的全部内容，用于从 PDF 精确还原设计稿：\n` +
      `- text：文本片段（字符串、基线坐标 x/y、宽高、字号、旋转角、颜色、外框 bbox）\n` +
      `- shapes：矢量图形（填充/描边色、透明度、线宽、外框 bbox、以及子路径几何：M/L/C/Q/Z 线段；paint="clip" 是不可见的裁剪区）\n` +
      `- images：位图贴图（外框 bbox、原始像素尺寸、对象名）\n` +
      `${COORD_NOTE} 注意：Chrome/Skia 导出的 PDF 常把可见文字画成矢量轮廓，另垫一层不可见的文本对象；` +
      `这类文本会被标 "covered":true，颜色则由同位置的轮廓反推并标 "colorFrom":"outline"。\n` +
      `建议先整体抽取一次看清结构，图形很多时用 detail="box" 只取外框与样式，再对重点区域用 pdf_extract + pdf_render 局部细看。`,
    {
      path: pathField,
      page: z.number().int().positive().describe("页码，从 1 开始"),
      include: z
        .array(z.enum(["text", "shapes", "images"]))
        .optional()
        .describe("只返回指定类别，默认全部"),
      detail: z
        .enum(["full", "box"])
        .optional()
        .describe('图形细节级别：full（默认）含完整路径线段；box 只给外框+样式，输出更小'),
      precision: z.number().int().min(0).max(6).optional().describe("坐标保留小数位，默认 3"),
      limit: z.number().int().positive().optional().describe("每类结果条数上限，默认 5000"),
      password: passwordField,
    },
    async ({ path: file, page: pageNumber, include, detail, precision, limit, password }) => {
      try {
        const doc = await openDocument(file, password);
        const content = await extractPage(await getPageChecked(doc, pageNumber), { precision });
        const wanted: Include[] = include?.length ? include : ["text", "shapes", "images"];
        const max = limit ?? 5000;

        const payload: ExtractPayload = {
          page: content.page,
          width: content.width,
          height: content.height,
          rotation: content.rotation,
          unit: content.unit,
          coord: content.coord,
          counts: { text: content.text.length, shapes: content.shapes.length, images: content.images.length },
        };

        const truncated: Record<string, boolean> = {};
        if (wanted.includes("text")) {
          payload.text = content.text.slice(0, max);
          if (content.text.length > max) truncated.text = true;
        }
        if (wanted.includes("shapes")) {
          const list = detail === "box" ? content.shapes.map(shapeBoxOnly) : content.shapes;
          payload.shapes = list.slice(0, max);
          if (list.length > max) truncated.shapes = true;
        }
        if (wanted.includes("images")) {
          payload.images = content.images.slice(0, max);
          if (content.images.length > max) truncated.images = true;
        }
        if (Object.keys(truncated).length) payload.truncated = truncated;
        if (wanted.includes("text")) payload.fonts = content.fonts;

        return okText(JSON.stringify(payload));
      } catch (err) {
        return failText(err);
      }
    },
  );

  // ---------- pdf_render ----------
  server.tool(
    "pdf_render",
    `把 PDF 某一页栅格化成图片（PNG/JPEG）。可用于：整体查看版面、放大局部核对细节、验证还原结果。\n` +
      `- 默认返回图片本身（base64），Agent 可直接查看；给 save 则写入文件并只返回路径信息。\n` +
      `- region 可只渲染局部（[x0,y0,x1,y1]，pt，左上原点），配合较大 scale 相当于「放大镜」。\n` +
      `${COORD_NOTE}`,
    {
      path: pathField,
      page: z.number().int().positive().describe("页码，从 1 开始"),
      scale: z.number().positive().optional().describe("缩放倍数（相对 72dpi），默认 1"),
      dpi: z.number().positive().optional().describe("目标 DPI，等价于 scale=dpi/72；与 scale 同时给出时以 dpi 为准"),
      region: z
        .array(z.number())
        .length(4)
        .optional()
        .describe("只渲染该矩形区域 [x0,y0,x1,y1]，pt，左上原点"),
      background: z.string().optional().describe('背景色，默认 "#ffffff"；传 "transparent" 保留透明'),
      format: z.enum(["png", "jpeg"]).optional().describe("输出格式，默认 png"),
      save: z.string().optional().describe("保存到该路径（不给则直接返回图片内容）"),
      password: passwordField,
    },
    async ({ path: file, page: pageNumber, scale, dpi, region, background, format, save, password }) => {
      try {
        const doc = await openDocument(file, password);
        const target = await getPageChecked(doc, pageNumber);
        const opts: Parameters<typeof renderPage>[1] = {};
        if (scale !== undefined) opts.scale = scale;
        if (dpi !== undefined) opts.dpi = dpi;
        if (region) opts.region = region as [number, number, number, number];
        if (background) opts.background = background;
        if (format) opts.format = format;
        const result = await renderPage(target, opts);

        const summary = `page ${pageNumber}/${doc.numPages} · ` +
          `${result.width}×${result.height}px · scale=${Number(result.scale.toFixed(3))}` +
          (region ? ` · region=[${region.join(", ")}]pt` : "");

        if (save) {
          const out = path.resolve(save);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, result.buffer);
          return okText(`${summary}\n已保存: ${out} (${result.buffer.length} bytes)`);
        }

        const mimeType = result.format === "jpeg" ? "image/jpeg" : "image/png";
        return {
          content: [
            { type: "text" as const, text: summary },
            { type: "image" as const, data: result.buffer.toString("base64"), mimeType },
          ],
        };
      } catch (err) {
        return failText(err);
      }
    },
  );

  // 兜底：进程退出时释放文档
  const cleanup = () => void closeAllDocuments();
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function getPageChecked(doc: Awaited<ReturnType<typeof openDocument>>, pageNumber: number) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`页码超出范围: ${pageNumber}（该文档共 ${doc.numPages} 页）`);
  }
  return doc.getPage(pageNumber);
}
