/**
 * pdfjs-dist 的 legacy 构建在 Node 下才会启用原生 Node 适配（禁用 FontFace、
 * 用 @napi-rs/canvas 渲染、用 fs 读取 standard_fonts / cmaps / wasm）。
 * 但该子路径没有随包提供类型声明，这里借用根入口（现代构建）的声明补上。
 *
 * 注意：只在打包/编译本包时生效；对外暴露的类型全部走根入口，使用方无需这个补丁。
 */
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
