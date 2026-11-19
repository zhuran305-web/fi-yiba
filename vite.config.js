import { miniappManifest } from '@heybox/hb-sdk/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// 版本号以 package.json 为唯一事实源，构建期注入 __APP_VERSION__
// （用 fs 读取而非 JSON import——JSON 导入会让构建静默不产出，见陷阱条目 1）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [miniappManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
