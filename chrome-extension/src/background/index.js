import 'webextension-polyfill';

import { registerRuntimeListeners } from './listeners/runtime.js';
import { registerTabListeners } from './listeners/tabs.js';

/**
 * Background service worker 入口：集中注册所有监听器。
 */
function bootstrap() {
  registerRuntimeListeners();
  registerTabListeners();
}

bootstrap();
