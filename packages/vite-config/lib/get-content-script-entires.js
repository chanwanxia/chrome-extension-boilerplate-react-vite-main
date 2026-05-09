import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
export const getContentScriptEntries = matchesDir => {
  const entryPoints = {};
  const entries = readdirSync(matchesDir);
  entries.forEach(folder => {
    const filePath = resolve(matchesDir, folder);
    const isFolder = statSync(filePath).isDirectory();
    const haveIndexJsFile = readdirSync(filePath).includes('index.js');
    const haveIndexJsxFile = readdirSync(filePath).includes('index.jsx');
    if (isFolder && !(haveIndexJsFile || haveIndexJsxFile)) {
      throw new Error(`${folder} in \`matches\` doesn't have index.js or index.jsx file`);
    } else {
      entryPoints[folder] = resolve(filePath, haveIndexJsFile ? 'index.js' : 'index.jsx');
    }
  });
  return entryPoints;
};
