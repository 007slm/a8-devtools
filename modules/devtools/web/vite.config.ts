import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/**
 * Antigravity 自定义协议 / 沙箱 WebView 侧边栏兼容插件：
 * 1. 将 ES Module (<script type="module" crossorigin ...>) 转为经典 <script defer src="...">；
 * 2. 移除 <link rel="stylesheet" crossorigin> 上的 crossorigin 属性，避免触发 Origin: null 拦截。
 */
function classicSidecarHtmlPlugin(): Plugin {
  return {
    name: 'classic-sidecar-html',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script\b([^>]*?)\btype=["']module["']([^>]*?)>/gi, (_, before, after) => {
          const cleaned = `${before}${after}`
            .replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, '')
            .replace(/\s+defer\b/gi, '');
          return `<script defer${cleaned}>`;
        })
        .replace(/<link\b([^>]*?)\brel=["']stylesheet["']([^>]*?)>/gi, (tag) =>
          tag.replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, ''),
        );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), classicSidecarHtmlPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../ui',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/index.js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
