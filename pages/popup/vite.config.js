import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';
const rootDir = resolve(import.meta.dirname); // pages/popup
const srcDir = resolve(rootDir, 'src'); // pages/popup/src
export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir, // @src 指向 pages/popup/src
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'popup'),
  },
});
