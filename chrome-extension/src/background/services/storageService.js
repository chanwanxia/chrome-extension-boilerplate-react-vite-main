/**
 * 获取 chrome.storage 的优先级：优先 session（随浏览器会话），不可用时退回 local。
 */
export function getStorageArea() {
  return chrome.storage?.session ?? chrome.storage?.local ?? null;
}

/**
 * 把 chrome.* 的 callback API 转成 Promise，并统一处理 runtime.lastError。
 */
export function chromeCallback(fn) {
  return new Promise((resolve, reject) => {
    fn(result => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

/**
 * 从 storageArea 读取单个 key；读取失败或 key 不存在时返回 fallback。
 */
export async function getStorageValue(key, fallback) {
  const storageArea = getStorageArea();
  if (!storageArea) return fallback;
  const items = await chromeCallback(cb => storageArea.get(key, cb));
  if (!items || typeof items !== 'object') return fallback;
  const value = items[key];
  return value === undefined ? fallback : value;
}

/**
 * 向 storageArea 写入单个 key。
 */
export async function setStorageValue(key, value) {
  const storageArea = getStorageArea();
  if (!storageArea) return;
  await chromeCallback(cb => storageArea.set({ [key]: value }, cb));
}
