import 'webextension-polyfill';
import { exampleThemeStorage } from '@extension/storage';
exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
});
console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.js' and save to reload.");
