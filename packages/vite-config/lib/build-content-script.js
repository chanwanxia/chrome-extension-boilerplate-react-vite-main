import { withPageConfig } from './index.js';
import { IS_DEV } from '@extension/env';
import { makeEntryPointPlugin } from '@extension/hmr';
import { build as buildTW } from 'tailwindcss/lib/cli/build/index.js';
import { build } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const getContentScriptEntries = matchesDir => {
  const entryPoints = {};
  const entries = readdirSync(matchesDir);
  entries.forEach(folder => {
    const filePath = resolve(matchesDir, folder);
    const isFolder = statSync(filePath).isDirectory();
    const haveConfigJsFile = readdirSync(filePath).includes('config.js');
    const haveIndexJsxFile = readdirSync(filePath).includes('index.jsx');
    if (isFolder && !(haveConfigJsFile || haveIndexJsxFile)) {
      throw new Error(`${folder} in \`matches\` doesn't have config.js or index.jsx file`);
    } else {
      entryPoints[folder] = resolve(filePath, haveConfigJsFile ? 'config.js' : 'index.jsx');
    }
  });
  return entryPoints;
};
const configsBuilder = ({ matchesDir, srcDir, rootDir, contentName }) =>
  Object.entries(getContentScriptEntries(matchesDir)).map(([name, entry]) => ({
    name,
    config: withPageConfig({
      mode: IS_DEV ? 'development' : undefined,
      resolve: {
        alias: {
          '@src': srcDir,
        },
      },
      publicDir: resolve(rootDir, 'public'),
      plugins: [IS_DEV && makeEntryPointPlugin()],
      build: {
        lib: {
          name: name,
          formats: ['iife'],
          entry,
          fileName: name,
        },
        outDir: resolve(rootDir, '..', '..', 'dist', contentName),
      },
    }),
  }));
const builds = async ({ srcDir, contentName, rootDir, matchesDir, withTw }) =>
  configsBuilder({ matchesDir, srcDir, rootDir, contentName }).map(async ({ name, config }) => {
    if (withTw) {
      const folder = resolve(matchesDir, name);
      const args = {
        ['--input']: resolve(folder, 'index.css'),
        ['--output']: resolve(rootDir, 'dist', name, 'index.css'),
        ['--config']: resolve(rootDir, 'tailwind.config.js'),
        ['--watch']: IS_DEV,
      };
      await buildTW(args);
    }
    config.configFile = false;
    return build(config);
  });
// FIXME: USE THIS FOR ALL CONTENT SCRIPTs
export const contentBuilder = async ({ matchesDir, srcDir, rootDir, contentName, withTw = true }) =>
  builds({
    srcDir,
    contentName,
    rootDir,
    matchesDir,
    withTw,
  });
