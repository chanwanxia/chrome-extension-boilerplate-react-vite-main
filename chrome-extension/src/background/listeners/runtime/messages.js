import { createRuntimeMessageHandler } from '../../messages/index.js';
import { clearLogs, getLogs, getSnapshots } from '../../services/errorService.js';
import { aiAgentLoop, aiAnalyze } from './ai.js';
import {
  armBreakpoint,
  getStatus,
  registerDebuggerEvents,
  resumeDebugger,
  startRecording,
  stopRecording,
} from './debugger.js';

/**
 * 注册 chrome.runtime.onMessage 监听：统一走路由处理，并安全返回 sendResponse。
 * @returns {void}
 */
function registerRuntimeMessages() {
  const actions = {
    aiAnalyze,
    aiAgentLoop,
    startRecording,
    stopRecording,
    getStatus,
    getLogs,
    clearLogs,
    getSnapshots,
    armBreakpoint,
    resumeDebugger,
  };

  const handle = createRuntimeMessageHandler(actions);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    /**
     * 统一 sendResponse 的 try/catch，避免响应阶段抛错导致通道中断。
     * @param {any} response
     * @returns {void}
     */
    const done = response => {
      try {
        sendResponse(response);
      } catch {
        void 0;
      }
    };

    void (async () => {
      try {
        const result = await handle(message, sender);
        done(result);
      } catch (e) {
        done({ ok: false, error: e instanceof Error ? e.message : 'unknown_error' });
      }
    })();

    return true;
  });
}

/**
 * 统一注册 background 的 runtime/debugger 相关监听器。
 * @returns {void}
 */
export function registerRuntimeListeners() {
  registerDebuggerEvents();
  registerRuntimeMessages();
}
