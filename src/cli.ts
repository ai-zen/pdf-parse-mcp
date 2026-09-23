#!/usr/bin/env node
/**
 * pdf-parse-mcp CLI —— 默认行为就是启动 MCP stdio 服务，方便直接写进 MCP 配置：
 *   npx -y @ai-zen/pdf-parse-mcp
 *
 * 注意：作为 stdio 服务运行时不能往 stdout 打印任何东西（会破坏协议），
 * 所以帮助信息只在显式请求时输出，且走 stdout 后立即退出。
 */
import { createRequire } from "node:module";

import { serveMCP } from "./mcp/index.js";

const require = createRequire(import.meta.url);
let version = "0.0.0";
try {
  version = (require("../package.json") as { version?: string }).version ?? version;
} catch {
  /* 忽略：读取不到就用默认版本号 */
}

const HELP = `pdf-parse-mcp v${version} — 从 PDF 精确抽取文本/矢量图形几何并渲染成图，供 Agent 还原设计稿

用法:
  pdf-parse-mcp              启动 MCP stdio 服务（默认）
  pdf-parse-mcp --help       显示帮助
  pdf-parse-mcp --version    显示版本

MCP 配置示例（Claude Desktop / Cline / 任意 MCP 客户端）:
  {
    "mcpServers": {
      "pdf-parse": {
        "command": "npx",
        "args": ["-y", "@ai-zen/pdf-parse-mcp"]
      }
    }
  }

工具:
  pdf_info     文档级信息（页数、页面尺寸、元数据）
  pdf_extract  单页内容抽取（文本 / 矢量图形 / 位图的坐标、尺寸、样式）
  pdf_render   单页栅格化（整页或局部，返回图片或保存到文件）

坐标约定: 左上原点、y 向下、单位 pt（1pt = 1/72 英寸）
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write(`${version}\n`);
    return;
  }

  await serveMCP();
}

main().catch((err) => {
  process.stderr.write(`[pdf-parse-mcp] 启动失败: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
