/**
 * 向 background 发送 runtime message，并统一兜底 chrome.runtime.lastError。
 * @param {any} message
 * @returns {Promise<any>}
 */
export const sendRuntimeMessage = message =>
  new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      const err = chrome.runtime?.lastError;
      if (err) resolve({ ok: false, error: err.message });
      else resolve(response);
    });
  });

/**
 * 获取当前窗口激活标签页 id。
 * @returns {Promise<number | undefined>}
 */
export const getActiveTabId = () =>
  new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs && tabs[0] && typeof tabs[0].id === 'number' ? tabs[0].id : undefined;
      resolve(tabId);
    });
  });
