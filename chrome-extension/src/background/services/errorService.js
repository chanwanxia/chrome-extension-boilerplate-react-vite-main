import { LIMITS, MESSAGE_TYPES, STORAGE_LOGS_KEY, STORAGE_SNAPSHOTS_KEY } from '../const/index.js';
import { getStorageValue, setStorageValue } from './storageService.js';

/**
 * 获取当前毫秒时间戳。
 */
export function nowMs() {
  return Date.now();
}

/**
 * 毫秒时间戳转 ISO 字符串。
 */
export function toIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * 统一 timestamp：CDP 可能给秒/毫秒，且可能是非法值。
 */
export function normalizeTimestampMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return nowMs();
  if (value > 1e12) return value;
  return Math.round(value * 1000);
}

/**
 * 把 CDP RemoteObject 转成可展示的字符串预览（避免大对象/循环引用）。
 */
export function remoteObjectToPreview(obj) {
  if (!obj || typeof obj !== 'object') return String(obj);
  if ('value' in obj) return String(obj.value);
  if (typeof obj.unserializableValue === 'string') return obj.unserializableValue;
  if (typeof obj.description === 'string') return obj.description;
  return obj.type ? `[${obj.type}]` : '[unknown]';
}

/**
 * 从 CDP stackTrace.callFrames 归一化出更小的帧结构（url/line/column/functionName）。
 */
export function normalizeCallFrames(stackTrace) {
  const callFrames = stackTrace && typeof stackTrace === 'object' ? stackTrace.callFrames : undefined;
  if (!Array.isArray(callFrames)) return [];
  return callFrames
    .filter(f => f && typeof f === 'object')
    .map(f => ({
      functionName: typeof f.functionName === 'string' ? f.functionName : undefined,
      url: typeof f.url === 'string' ? f.url : undefined,
      line: typeof f.lineNumber === 'number' ? f.lineNumber + 1 : undefined,
      column: typeof f.columnNumber === 'number' ? f.columnNumber : undefined,
    }))
    .filter(f => f.url && typeof f.line === 'number');
}

/**
 * 向指定 tabId 追加一条日志并广播通知 popup 更新。
 */
export async function pushLog(tabId, entry) {
  const logsByTabId = await getStorageValue(STORAGE_LOGS_KEY, {});
  const current = Array.isArray(logsByTabId[tabId]) ? logsByTabId[tabId] : [];
  const next = [entry, ...current].slice(0, LIMITS.logsPerTab);
  const updated = { ...logsByTabId, [tabId]: next };
  await setStorageValue(STORAGE_LOGS_KEY, updated);
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.logsUpdated, tabId });
  } catch {
    void 0;
  }
}

/**
 * 向指定 tabId 追加一次“调试快照”并广播通知 popup 更新。
 */
export async function pushSnapshot(tabId, snapshot) {
  const snapshotsByTabId = await getStorageValue(STORAGE_SNAPSHOTS_KEY, {});
  const current = Array.isArray(snapshotsByTabId[tabId]) ? snapshotsByTabId[tabId] : [];
  const next = [snapshot, ...current].slice(0, LIMITS.snapshotsPerTab);
  const updated = { ...snapshotsByTabId, [tabId]: next };
  await setStorageValue(STORAGE_SNAPSHOTS_KEY, updated);
  try {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPES.snapshotsUpdated, tabId });
  } catch {
    void 0;
  }
}

/**
 * 读取指定 tab 的日志列表。
 */
export async function getLogs(tabId) {
  const logsByTabId = await getStorageValue(STORAGE_LOGS_KEY, {});
  return Array.isArray(logsByTabId[tabId]) ? logsByTabId[tabId] : [];
}

/**
 * 清空指定 tab 的日志列表。
 */
export async function clearLogs(tabId) {
  const logsByTabId = await getStorageValue(STORAGE_LOGS_KEY, {});
  const updated = { ...logsByTabId, [tabId]: [] };
  await setStorageValue(STORAGE_LOGS_KEY, updated);
}

/**
 * 读取指定 tab 的快照列表。
 */
export async function getSnapshots(tabId) {
  const snapshotsByTabId = await getStorageValue(STORAGE_SNAPSHOTS_KEY, {});
  return Array.isArray(snapshotsByTabId[tabId]) ? snapshotsByTabId[tabId] : [];
}

/**
 * 处理 CDP Log.entryAdded：仅收集 error/warning(看起来像 Error) 并写入日志。
 */
export async function handleCdpLogEntryAdded(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const entry = p.entry && typeof p.entry === 'object' ? p.entry : {};
  const level = typeof entry.level === 'string' ? entry.level : 'info';
  const text = typeof entry.text === 'string' ? entry.text : '';
  const looksLikeError = /^\s*Error:\s+/i.test(text);
  if (level !== 'error' && !(level === 'warning' && looksLikeError)) return;

  const textParts = [];
  if (text.trim()) textParts.push(text.trim());
  if (typeof entry.url === 'string' && entry.url.trim()) textParts.push(entry.url.trim());
  const message = textParts.length ? textParts.join(' ') : '[Log.error]';

  const frames = normalizeCallFrames(entry.stackTrace);
  const firstFrame = frames[0];
  const url = typeof entry.url === 'string' ? entry.url : firstFrame?.url;
  const line = typeof entry.lineNumber === 'number' ? entry.lineNumber + 1 : firstFrame?.line;

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'log',
    level: 'error',
    occurredAt: toIso(normalizeTimestampMs(entry.timestamp)),
    message,
    args: [],
    frames,
    location: url && typeof line === 'number' ? { url, line, column: undefined } : undefined,
    source: typeof entry.source === 'string' ? entry.source : undefined,
  });
}

/**
 * 处理 CDP Runtime.consoleAPICalled：只抓 error/assert 并写入日志。
 */
export async function handleCdpConsoleAPICalled(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const type = typeof p.type === 'string' ? p.type : 'log';
  if (type !== 'error' && type !== 'assert') return;

  const args = Array.isArray(p.args) ? p.args.map(remoteObjectToPreview) : [];
  const message = args.length ? args.join(' ') : type;
  const frames = normalizeCallFrames(p.stackTrace);
  const firstFrame = frames[0];

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'console',
    level: type,
    occurredAt: toIso(nowMs()),
    message,
    args,
    frames,
    location: firstFrame ? { url: firstFrame.url, line: firstFrame.line, column: firstFrame.column } : undefined,
  });
}

/**
 * 处理 CDP Runtime.exceptionThrown：写入异常日志。
 */
export async function handleCdpExceptionThrown(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const details = p.exceptionDetails && typeof p.exceptionDetails === 'object' ? p.exceptionDetails : {};
  const exception = details.exception && typeof details.exception === 'object' ? details.exception : {};
  const description =
    typeof exception.description === 'string'
      ? exception.description
      : typeof details.text === 'string'
        ? details.text
        : 'Uncaught exception';
  const frames = normalizeCallFrames(details.stackTrace);
  const firstFrame = frames[0];

  await pushLog(tabId, {
    id: crypto.randomUUID(),
    tabId,
    kind: 'exception',
    level: 'error',
    occurredAt: toIso(nowMs()),
    message: description,
    frames,
    location: firstFrame ? { url: firstFrame.url, line: firstFrame.line, column: firstFrame.column } : undefined,
  });
}

/**
 * 注入页面 hooks（MAIN world）：
 * - window.error/unhandledrejection
 * - Vue.config.errorHandler（如果存在）
 * - fetch/xhr 60s pending、network error
 * - blank screen / stall 检测（转成 console.error，统一由 CDP 采集）
 */
export async function installPageHooks(tabId) {
  if (!chrome.scripting?.executeScript) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: pageHooksMainWorld,
    });
  } catch {
    void 0;
  }
}

/**
 * MAIN world 内运行的 hook：必须是纯函数（不可引用模块外变量）。
 */
function pageHooksMainWorld() {
  const w = window;
  if (w.__AGENT_HOOK_V1_INSTALLED__) return;
  w.__AGENT_HOOK_V1_INSTALLED__ = true;

  const prefix = '[AGENT_HOOK]';

  /**
   * 尽量把任意值转成可打印字符串，避免 JSON.stringify 失败导致 hook 抛错。
   */
  const safe = value => {
    try {
      if (typeof value === 'string') return value;
      if (value === null) return 'null';
      if (typeof value === 'undefined') return 'undefined';
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  /**
   * 简单的节流：按 key 控制最小输出间隔，避免刷屏。
   */
  const lastLogAt = Object.create(null);
  const shouldLog = (key, minIntervalMs) => {
    try {
      const now = Date.now();
      const prev = typeof lastLogAt[key] === 'number' ? lastLogAt[key] : 0;
      if (now - prev < minIntervalMs) return false;
      lastLogAt[key] = now;
      return true;
    } catch {
      return true;
    }
  };

  /**
   * 将 hook 捕获到的异常/异常状态统一打到 console.error。
   */
  const logError = (...args) => {
    try {
      console.error(prefix, ...args);
    } catch {
      void 0;
    }
  };

  try {
    const origFetch = w.fetch;
    if (typeof origFetch === 'function' && !origFetch.__AGENT_WRAPPED__) {
      const wrappedFetch = function (input, init) {
        const method =
          (init && typeof init === 'object' && typeof init.method === 'string' && init.method) ||
          (input && typeof input === 'object' && typeof input.method === 'string' && input.method) ||
          'GET';
        const url =
          typeof input === 'string'
            ? input
            : input && typeof input === 'object' && typeof input.url === 'string'
              ? input.url
              : safe(input);
        let done = false;
        let timeoutId;
        try {
          timeoutId = w.setTimeout(() => {
            try {
              if (done) return;
              if (shouldLog(`fetch:${method}:${url}:pending60s`, 5_000)) {
                logError('fetch', method, url, 'pending_over_60s');
              }
            } catch {
              void 0;
            }
          }, 60_000);
        } catch {
          timeoutId = undefined;
        }
        return origFetch
          .apply(this, arguments)
          .then(res => {
            try {
              done = true;
              if (typeof timeoutId === 'number') w.clearTimeout(timeoutId);
            } catch {
              void 0;
            }
            return res;
          })
          .catch(err => {
            try {
              done = true;
              if (typeof timeoutId === 'number') w.clearTimeout(timeoutId);
            } catch {
              void 0;
            }
            if (shouldLog(`fetch:${method}:${url}:error`, 300)) {
              logError('fetch', method, url, err instanceof Error ? err : safe(err));
            }
            throw err;
          });
      };
      wrappedFetch.__AGENT_WRAPPED__ = true;
      w.fetch = wrappedFetch;
    }
  } catch {
    void 0;
  }

  try {
    const XHR = w.XMLHttpRequest;
    const proto = XHR && XHR.prototype ? XHR.prototype : null;
    if (proto && typeof proto.open === 'function' && typeof proto.send === 'function' && !proto.__AGENT_WRAPPED__) {
      const META_KEY = '__AGENT_XHR_META__';
      const HOOKED_KEY = '__AGENT_XHR_HOOKED__';
      const origOpen = proto.open;
      const origSend = proto.send;

      /**
       * 记录每次 open 的 method/url，后续 send 的事件里可拼出可读信息。
       */
      proto.open = function (method, url) {
        try {
          this[META_KEY] = {
            method: typeof method === 'string' ? method : 'GET',
            url: typeof url === 'string' ? url : safe(url),
          };
        } catch {
          void 0;
        }
        return origOpen.apply(this, arguments);
      };

      /**
       * 注入 loadend/error/timeout/abort 监听，并对 pending 超时做报警。
       */
      proto.send = function () {
        const getMeta = () => {
          const m = this[META_KEY] && typeof this[META_KEY] === 'object' ? this[META_KEY] : {};
          return {
            method: typeof m.method === 'string' ? m.method : 'GET',
            url: typeof m.url === 'string' ? m.url : typeof this.responseURL === 'string' ? this.responseURL : '',
          };
        };
        try {
          if (!this[HOOKED_KEY]) {
            this[HOOKED_KEY] = true;

            this.addEventListener('loadend', () => {
              try {
                if (typeof this.__AGENT_XHR_TIMEOUT_ID__ === 'number') w.clearTimeout(this.__AGENT_XHR_TIMEOUT_ID__);
              } catch {
                void 0;
              }
            });

            this.addEventListener('error', () => {
              try {
                const { method, url } = getMeta();
                if (shouldLog(`xhr:${method}:${url}:error`, 300)) logError('xhr', method, url, 'network_error');
              } catch {
                void 0;
              }
            });

            this.addEventListener('timeout', () => {
              try {
                const { method, url } = getMeta();
                if (shouldLog(`xhr:${method}:${url}:timeout`, 300)) logError('xhr', method, url, 'timeout');
              } catch {
                void 0;
              }
            });

            this.addEventListener('abort', () => {
              try {
                const { method, url } = getMeta();
                if (shouldLog(`xhr:${method}:${url}:abort`, 800)) logError('xhr', method, url, 'abort');
              } catch {
                void 0;
              }
            });
          }
        } catch {
          void 0;
        }
        try {
          if (typeof this.__AGENT_XHR_TIMEOUT_ID__ === 'number') w.clearTimeout(this.__AGENT_XHR_TIMEOUT_ID__);
          const { method, url } = getMeta();
          this.__AGENT_XHR_TIMEOUT_ID__ = w.setTimeout(() => {
            try {
              if (shouldLog(`xhr:${method}:${url}:pending60s`, 5_000)) logError('xhr', method, url, 'pending_over_60s');
            } catch {
              void 0;
            }
          }, 60_000);
        } catch {
          void 0;
        }
        return origSend.apply(this, arguments);
      };

      proto.__AGENT_WRAPPED__ = true;
    }
  } catch {
    void 0;
  }

  /**
   * 捕获资源加载错误/运行时错误并转成 console.error，方便 CDP 侧统一收集。
   */
  w.addEventListener(
    'error',
    ev => {
      try {
        if (ev && ev.error) {
          console.error(prefix, 'window.error', ev.error);
          return;
        }
        const target = ev && ev.target ? ev.target : undefined;
        const tag = target && typeof target === 'object' && typeof target.tagName === 'string' ? target.tagName : '';
        const src = target && typeof target === 'object' ? target.src || target.href || target.currentSrc : undefined;
        const url = typeof src === 'string' ? src : undefined;
        const ext = url ? url.split('?')[0].split('#')[0].toLowerCase() : '';
        const isCore =
          tag === 'SCRIPT' ||
          tag === 'LINK' ||
          tag === 'IMG' ||
          ext.endsWith('.woff2') ||
          ext.endsWith('.woff') ||
          ext.endsWith('.ttf') ||
          ext.endsWith('.otf');
        if (!isCore) return;
        console.error(prefix, 'resource.error', tag || 'unknown', url || safe(ev && ev.message));
      } catch {
        void 0;
      }
    },
    true,
  );

  /**
   * 捕获 Promise 未处理 rejection 并转成 console.error。
   */
  w.addEventListener('unhandledrejection', ev => {
    try {
      const reason = ev ? ev.reason : undefined;
      console.error(prefix, 'unhandledrejection', reason instanceof Error ? reason : safe(reason));
    } catch {
      void 0;
    }
  });

  /**
   * rejection 已被处理：记录一次状态变化，辅助排查“吞错”。
   */
  w.addEventListener('rejectionhandled', ev => {
    try {
      const reason = ev ? ev.reason : undefined;
      console.error(prefix, 'rejectionhandled', reason instanceof Error ? reason : safe(reason));
    } catch {
      void 0;
    }
  });

  /**
   * 允许应用主动上报错误：window.__AGENT_REPORT_ERROR__(err, context)。
   */
  try {
    w.__AGENT_REPORT_ERROR__ = (err, context) => {
      try {
        const ctx = typeof context === 'string' ? context : safe(context);
        logError('app.report', ctx || '', err instanceof Error ? err : safe(err));
      } catch {
        void 0;
      }
    };
  } catch {
    void 0;
  }

  try {
    /**
     * 粗略判断元素是否“可见”（用于 blank screen 检测的启发式规则）。
     */
    const isVisible = el => {
      try {
        if (!el) return false;
        const style = w.getComputedStyle ? w.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        return Boolean(rect && rect.width > 2 && rect.height > 2);
      } catch {
        return false;
      }
    };

    /**
     * 页面是否已有“有意义的内容”（避免把正常白屏 loading 判成错误）。
     */
    const hasMeaningfulContent = () => {
      try {
        const d = w.document;
        if (!d || !d.body) return false;
        const root =
          d.getElementById('root') || d.getElementById('app') || d.querySelector('[data-reactroot]') || d.body;

        if (!isVisible(d.body)) return false;
        if (!root) return false;
        if (root.children && root.children.length > 0) return true;
        const text = typeof root.innerText === 'string' ? root.innerText.trim() : '';
        if (text.length >= 8) return true;
        if (d.querySelector('img,svg,canvas,video')) return true;
        return false;
      } catch {
        return false;
      }
    };

    /**
     * 延迟检测 blank screen：超过阈值时间仍无有效内容则上报一次。
     */
    const startBlankScreenWatch = reason => {
      try {
        const key = `blank:${reason || 'unknown'}`;
        if (!shouldLog(key, 10_000)) return;
        w.setTimeout(() => {
          try {
            if (!hasMeaningfulContent()) logError('page.blank_screen', reason || 'unknown');
          } catch {
            void 0;
          }
        }, 12_000);
      } catch {
        void 0;
      }
    };

    if (!w.__AGENT_BLANK_WATCH_INSTALLED__) {
      w.__AGENT_BLANK_WATCH_INSTALLED__ = true;
      startBlankScreenWatch('init');
      w.addEventListener('DOMContentLoaded', () => startBlankScreenWatch('domcontentloaded'));
      w.addEventListener('load', () => startBlankScreenWatch('load'));

      try {
        const hist = w.history;
        if (hist && typeof hist.pushState === 'function' && typeof hist.replaceState === 'function') {
          const origPush = hist.pushState;
          const origReplace = hist.replaceState;
          hist.pushState = function () {
            const res = origPush.apply(this, arguments);
            startBlankScreenWatch('pushState');
            return res;
          };
          hist.replaceState = function () {
            const res = origReplace.apply(this, arguments);
            startBlankScreenWatch('replaceState');
            return res;
          };
        }
      } catch {
        void 0;
      }

      w.addEventListener('popstate', () => startBlankScreenWatch('popstate'));
      w.addEventListener('hashchange', () => startBlankScreenWatch('hashchange'));

      try {
        let last = Date.now();
        w.setInterval(() => {
          try {
            const now = Date.now();
            const drift = now - last;
            last = now;
            if (drift > 10_000 && shouldLog(`stall:${Math.round(drift / 1000)}`, 30_000)) {
              logError('page.stall', `drift=${Math.round(drift)}ms`);
            }
          } catch {
            void 0;
          }
        }, 1000);
      } catch {
        void 0;
      }
    }
  } catch {
    void 0;
  }

  try {
    const Vue = w.Vue;
    if (Vue && Vue.config) {
      const prev = Vue.config.errorHandler;

      /**
       * Vue2 errorHandler hook：收集组件名/文件/info 以及原始错误对象。
       */
      Vue.config.errorHandler = function (err, vm, info) {
        try {
          const name =
            vm && vm.$options ? vm.$options.name || vm.$options._componentTag || vm.$options.__file : undefined;
          console.error(prefix, 'Vue.errorHandler', info || '', name || '', err);
        } catch {
          void 0;
        }
        if (typeof prev === 'function') return prev.apply(this, arguments);
      };
    }
  } catch {
    void 0;
  }
}
