import { DEFAULT_CHOICES_VALUES, EXIT_PROMPT_ERROR, MODULE_CONFIG } from '../const.js';
import { colorfulLog } from '@extension/shared';
import { select } from '@inquirer/prompts';
import { readdirSync } from 'node:fs';
export const isFolderEmpty = path => !readdirSync(path).length;
export const promptSelection = async inputConfig =>
  select(inputConfig).catch(err => {
    if (err.name === EXIT_PROMPT_ERROR) {
      process.exit(0);
    } else {
      colorfulLog(err.message, 'error');
    }
  });
export const processModuleConfig = (manifestObject, moduleName, isRecovering) => {
  if (moduleName === 'content-runtime' || moduleName === 'devtools-panel' || moduleName === 'tests') {
    return;
  }
  const moduleConfigValues = MODULE_CONFIG[moduleName];
  const moduleConfigEntriesOfKeys = Object.entries(moduleConfigValues);
  if (moduleName === 'content' || moduleName === 'content-ui') {
    if (isRecovering) {
      moduleConfigValues.content_scripts.map(script => manifestObject.content_scripts?.push(script));
    } else {
      const outputFileName = new RegExp(`${moduleName}/+`);
      manifestObject.content_scripts = manifestObject.content_scripts?.filter(
        script => !outputFileName.test(script.js ? script.js[0] : ''),
      );
    }
    return;
  }
  moduleConfigEntriesOfKeys.forEach(([key, value]) => {
    const manifestValue = manifestObject[key];
    if (manifestValue) {
      if (manifestValue instanceof Array) {
        const arrayValues = Object.values(moduleConfigValues[key]);
        if (isRecovering) {
          manifestObject[key] = manifestValue.concat(arrayValues);
        } else {
          manifestObject[key] = manifestValue.filter(value => !arrayValues.includes(value));
        }
      } else {
        delete manifestObject[key];
      }
    } else if (isRecovering) {
      Object.assign(manifestObject, { [key]: value });
    } else {
      throw new Error(`Key ${key} not found in manifest.js`);
    }
  });
};
export const checkCliArgsIsValid = argv => {
  const [key, values] = Object.entries(argv)[1];
  if (Array.isArray(values)) {
    for (const value of values) {
      if (!DEFAULT_CHOICES_VALUES.some(moduleName => value === moduleName)) {
        throw new Error(`All values after --${key} must be names of pages`);
      }
    }
  }
  return true;
};
export const processSelection = async (choices, question, moduleName) => {
  if (!choices.length) {
    colorfulLog('No options available', 'warning');
    process.exit(0);
  }
  if (!moduleName) {
    const inputConfig = {
      message: question,
      choices,
    };
    return await promptSelection(inputConfig);
  }
  return null;
};
