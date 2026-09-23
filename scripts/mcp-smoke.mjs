// MCP 端到端冒烟测试：真的起一个 stdio 服务，走标准客户端协议调用三个工具。
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import "./make-sample.mjs"; // 生成 tmp/sample.pdf

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/cli.js"],
  cwd: process.cwd(),
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
assert.deepEqual(names, ["pdf_extract", "pdf_info", "pdf_render"], `工具列表不符: ${names}`);

// pdf_info
const info = await client.callTool({ name: "pdf_info", arguments: { path: "tmp/sample.pdf" } });
const infoPayload = JSON.parse(info.content[0].text);
assert.equal(infoPayload.pages, 1);
assert.deepEqual(infoPayload.pageSizes[0], { page: 1, width: 612, height: 792, rotation: 0 });

// pdf_extract
const extract = await client.callTool({
  name: "pdf_extract",
  arguments: { path: "tmp/sample.pdf", page: 1 },
});
const extractPayload = JSON.parse(extract.content[0].text);
assert.equal(extractPayload.counts.shapes, 5);
assert.equal(extractPayload.counts.images, 1);
assert.ok(extractPayload.text.some((t) => t.text === "Hello World" && t.color === "#000000"));

// pdf_extract（detail=box 应去掉路径细节）
const boxOnly = await client.callTool({
  name: "pdf_extract",
  arguments: { path: "tmp/sample.pdf", page: 1, include: ["shapes"], detail: "box" },
});
const boxPayload = JSON.parse(boxOnly.content[0].text);
assert.equal(boxPayload.shapes.length, 5);
assert.deepEqual(boxPayload.shapes[0].subpaths, []);
assert.equal(boxPayload.text, undefined, "include 只给 shapes 时不应返回文本");

// pdf_render（返回图片）
const rendered = await client.callTool({
  name: "pdf_render",
  arguments: { path: "tmp/sample.pdf", page: 1, scale: 0.5 },
});
const imageBlock = rendered.content.find((c) => c.type === "image");
assert.ok(imageBlock, "应返回 image 内容块");
assert.equal(imageBlock.mimeType, "image/png");
assert.ok(imageBlock.data.length > 1000, "图片 base64 不应为空");

// 越界页码应报错而不是崩溃
const outOfRange = await client.callTool({ name: "pdf_extract", arguments: { path: "tmp/sample.pdf", page: 9 } });
assert.equal(outOfRange.isError, true);
assert.match(outOfRange.content[0].text, /页码超出范围/);

await client.close();
console.log("✅ mcp-smoke: stdio 协议与三个工具均正常");
