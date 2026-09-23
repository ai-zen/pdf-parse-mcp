/** 文档打开与缓存。按路径 + 修改时间缓存已解析的文档，避免每次工具调用都重新解析。 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { pdfjs, assets, assetUrl, type PDFDocumentProxy, type PDFPageProxy } from "./pdfjs.js";

const MAX_CACHED = 8;

interface Entry {
  doc: PDFDocumentProxy;
  mtimeMs: number;
  size: number;
  usedAt: number;
}

const cache = new Map<string, Entry>();

function loadingOptions(data: Uint8Array, password?: string) {
  return {
    data,
    password,
    standardFontDataUrl: assetUrl(assets.standardFonts),
    cMapUrl: assetUrl(assets.cmaps),
    cMapPacked: true,
    wasmUrl: assetUrl(assets.wasm),
    iccUrl: assetUrl(assets.icc),
    useSystemFonts: false,
  };
}

export async function resolveFile(input: string): Promise<string> {
  const abs = path.resolve(input);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    throw new Error(`文件不存在或无法读取: ${abs}`);
  }
  if (!stat.isFile()) throw new Error(`不是文件: ${abs}`);
  return abs;
}

/** 打开（或从缓存取出）一个 PDF 文档。 */
export async function openDocument(file: string, password?: string): Promise<PDFDocumentProxy> {
  const abs = await resolveFile(file);
  const stat = await fs.stat(abs);
  const cached = cache.get(abs);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    cached.usedAt = Date.now();
    return cached.doc;
  }
  if (cached) {
    cache.delete(abs);
    await destroy(cached.doc);
  }

  const data = new Uint8Array(await fs.readFile(abs));
  let doc: PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument(loadingOptions(data, password)).promise;
  } catch (err) {
    const e = err as { name?: string; code?: number; message?: string };
    if (e?.name === "PasswordException") {
      throw new Error(e.code === 2 ? `密码错误: ${abs}` : `该 PDF 已加密，需要密码: ${abs}`);
    }
    throw new Error(`无法解析 PDF（${abs}）: ${e?.message ?? String(err)}`);
  }

  await evictIfNeeded();
  cache.set(abs, { doc, mtimeMs: stat.mtimeMs, size: stat.size, usedAt: Date.now() });
  return doc;
}

async function evictIfNeeded(): Promise<void> {
  if (cache.size < MAX_CACHED) return;
  let oldestKey: string | undefined;
  let oldest = Infinity;
  for (const [key, entry] of cache) {
    if (entry.usedAt < oldest) {
      oldest = entry.usedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    const entry = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (entry) await destroy(entry.doc);
  }
}

/** pdfjs v6 的 PDFDocumentProxy 自身没有 destroy，销毁要经 loadingTask。 */
async function destroy(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy().catch(() => {});
}

export async function openPage(file: string, pageNumber: number, password?: string): Promise<PDFPageProxy> {
  const doc = await openDocument(file, password);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
    throw new Error(`页码超出范围: ${pageNumber}（该文档共 ${doc.numPages} 页）`);
  }
  return doc.getPage(pageNumber);
}

export async function closeAllDocuments(): Promise<void> {
  const docs = [...cache.values()];
  cache.clear();
  await Promise.allSettled(docs.map((d) => d.doc.loadingTask.destroy()));
}
