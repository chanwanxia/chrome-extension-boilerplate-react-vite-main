import { LIMITS } from '../const/index.js';
import { nowMs, pushLog, toIso } from './errorService.js';

const requestMetaByTabId = new Map();

/**
 * 获取/创建指定 tabId 的 request meta map（requestId -> {url, method, type, ts}）。
 */
function getRequestMetaMap(tabId) {
  const current = requestMetaByTabId.get(tabId);
  if (current) return current;
  const next = new Map();
  requestMetaByTabId.set(tabId, next);
  return next;
}

/**
 * 清理指定 tab 的网络请求 meta（tab stop/detach 时调用）。
 */
export function clearRequestMeta(tabId) {
  requestMetaByTabId.delete(tabId);
}

/**
 * 处理 CDP Network.requestWillBeSent：记录 requestId 对应的 url/method/type/timestamp。
 */
export function handleNetworkRequestWillBeSent(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
  const request = p.request && typeof p.request === 'object' ? p.request : {};
  const url = typeof request.url === 'string' ? request.url : undefined;
  const reqMethod = typeof request.method === 'string' ? request.method : undefined;
  const type = typeof p.type === 'string' ? p.type : undefined;
  const ts = typeof p.timestamp === 'number' ? p.timestamp : undefined;
  if (!requestId || !url) return;
  const map = getRequestMetaMap(tabId);
  map.set(requestId, { url, method: reqMethod, type, ts });
  if (map.size > LIMITS.requestMetaPerTab) {
    const firstKey = map.keys().next().value;
    if (typeof firstKey === 'string') map.delete(firstKey);
  }
}

/**
 * 处理 CDP Network.responseReceived：只对 API/XHR/Fetch 或核心资源的 4xx/5xx 打 error 日志。
 */
export async function handleNetworkResponseReceived(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
  const type = typeof p.type === 'string' ? p.type : undefined;
  const response = p.response && typeof p.response === 'object' ? p.response : {};
  const url = typeof response.url === 'string' ? response.url : undefined;
  const status = typeof response.status === 'number' ? response.status : undefined;
  if (!url || typeof status !== 'number') return;
  if (status < 400) return;

  const isApi = type === 'XHR' || type === 'Fetch';
  const isCoreResource =
    type === 'Document' || type === 'Script' || type === 'Stylesheet' || type === 'Image' || type === 'Font';
  if (!isApi && !isCoreResource) return;

  const meta = requestId ? getRequestMetaMap(tabId).get(requestId) : undefined;
  const methodText = meta && typeof meta.method === 'string' ? meta.method : undefined;
  const message = isApi
    ? `[API] ${methodText || ''} ${url} status=${status}`.trim()
    : `[RES] ${type || ''} ${url} status=${status}`.trim();

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'network',
    level: 'error',
    occurredAt: toIso(nowMs()),
    message,
    args: [],
    frames: [],
    location: undefined,
    source: 'network',
  });
}

/**
 * 处理 CDP Network.loadingFinished：对 XHR/Fetch 的超慢请求（>=60s）打 error 日志。
 */
export async function handleNetworkLoadingFinished(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
  const ts = typeof p.timestamp === 'number' ? p.timestamp : undefined;
  if (!requestId) return;
  const map = getRequestMetaMap(tabId);
  const meta = map.get(requestId);
  map.delete(requestId);
  if (!meta || typeof meta.ts !== 'number' || typeof ts !== 'number') return;
  const type = typeof meta.type === 'string' ? meta.type : undefined;
  if (type !== 'XHR' && type !== 'Fetch') return;

  const durMs = Math.round((ts - meta.ts) * 1000);
  if (!Number.isFinite(durMs) || durMs < 60_000) return;
  const message = `[API] ${meta.method || ''} ${meta.url} slow=${durMs}ms`.trim();

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'network',
    level: 'error',
    occurredAt: toIso(nowMs()),
    message,
    args: [],
    frames: [],
    location: undefined,
    source: 'network',
  });
}

/**
 * 处理 CDP Network.loadingFailed：对 API/XHR/Fetch 或核心资源的失败打 error 日志。
 */
export async function handleNetworkLoadingFailed(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
  const type = typeof p.type === 'string' ? p.type : undefined;
  const errorText = typeof p.errorText === 'string' ? p.errorText : undefined;
  const canceled = Boolean(p.canceled);
  if (!requestId) return;

  const map = getRequestMetaMap(tabId);
  const meta = map.get(requestId);
  map.delete(requestId);

  const url = meta && typeof meta.url === 'string' ? meta.url : undefined;
  const methodText = meta && typeof meta.method === 'string' ? meta.method : undefined;

  const isApi = type === 'XHR' || type === 'Fetch';
  const isCoreResource =
    type === 'Document' || type === 'Script' || type === 'Stylesheet' || type === 'Image' || type === 'Font';
  if (!isApi && !isCoreResource) return;
  if (canceled && !isApi) return;

  const message = isApi
    ? `[API] ${methodText || ''} ${url || ''} failed ${errorText || ''}`.trim()
    : `[RES] ${type || ''} ${url || ''} failed ${errorText || ''}`.trim();

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'network',
    level: 'error',
    occurredAt: toIso(nowMs()),
    message,
    args: [],
    frames: [],
    location: undefined,
    source: 'network',
  });
}
