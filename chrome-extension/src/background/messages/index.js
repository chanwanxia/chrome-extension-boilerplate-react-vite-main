import { handleContentMessage } from './contentMessages.js';
import { handlePopupMessage } from './popupMessages.js';

/**
 * 创建 runtime.onMessage 的统一处理函数：
 * - 根据 sender.tab 是否存在区分 popup/content-script
 * - 返回结构化的 { ok, ... } 响应
 */
export function createRuntimeMessageHandler(actions) {
  return async (message, sender) => {
    const msg = message && typeof message === 'object' ? message : {};
    if (sender && sender.tab && typeof sender.tab.id === 'number') {
      return handleContentMessage(msg, actions);
    }
    return handlePopupMessage(msg, actions);
  };
}
