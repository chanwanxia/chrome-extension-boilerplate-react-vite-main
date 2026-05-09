import manifest from '../../../../chrome-extension/manifest.js';
import { MANAGER_ACTION_PROMPT_CONFIG } from '../const.js';
import { promptSelection } from '../helpers/utils.js';
import { deleteFeature, recoverFeature } from '../processing/index.js';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const manifestPath = resolve(import.meta.dirname, '..', '..', '..', '..', 'chrome-extension', 'manifest.js');
const manifestObject = JSON.parse(JSON.stringify(manifest));
export const runModuleManager = async (moduleName, action, isLastLap = true) => {
  if (!action) {
    action = await promptSelection(MANAGER_ACTION_PROMPT_CONFIG);
  }
  switch (action) {
    case 'delete':
      await deleteFeature(manifestObject, moduleName);
      break;
    case 'recover':
      await recoverFeature(manifestObject, moduleName);
  }
  const updatedManifest = `import { readFileSync } from 'node:fs';\nconst packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));\nconst manifest = ${JSON.stringify(manifestObject, null, 2)};\nmanifest.version = packageJson.version;\nexport default manifest;\n`;
  writeFileSync(manifestPath, updatedManifest);
  if (isLastLap) {
    execSync('pnpm i', {
      stdio: 'inherit',
      cwd: resolve('..', '..'),
    });
    execSync('pnpm -F chrome-extension lint:fix', {
      stdio: 'inherit',
      cwd: resolve('..', '..'),
    });
  }
};
