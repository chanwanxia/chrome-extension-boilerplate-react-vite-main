import { stopRecording } from './runtime.js';

/**
 * 注册 tabs 相关监听器：
 * - tab 关闭时清理该 tab 的录制/调试状态，避免残留 attach。
 */
export function registerTabListeners() {
  chrome.tabs.onRemoved.addListener(tabId => {
    void (async () => {
      try {
        await stopRecording(tabId);
      } catch {
        void 0;
      }
    })();
  });
}
