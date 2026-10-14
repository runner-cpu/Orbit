import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 相对路径：产物可放在 GitHub Pages 的任意子路径下，也可直接本地打开
  base: './',
  resolve: {
    alias: [
      {
        // satellite.js v7 的包入口会连带引入 WASM 批量解算器（含顶层 await
        // 与 node: 内置模块），在浏览器构建中无法打包。本项目只需要标准 SGP4，
        // 因此把裸模块名指向只导出纯 JS 实现的本地封装。
        find: /^satellite\.js$/,
        replacement: path.resolve(HERE, 'src/core/vendor.ts'),
      },
    ],
  },
  build: {
    target: 'es2020',
    // 轨道数据是二进制与文本资源，不走 JS 打包，只作为静态文件复制
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
