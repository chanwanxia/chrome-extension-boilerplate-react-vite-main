import 'webextension-polyfill';

/**
 * session/local storage 中按 tabId 存储日志列表的 key。
 */
const STORAGE_LOGS_KEY = 'agent.logsByTabId.v1';
/**
 * session/local storage 中记录 tab 录制/调试状态的 key。
 */
const STORAGE_RECORDING_KEY = 'agent.recordingTabs.v1';
/**
 * session/local storage 中按 tabId 存储调试快照的 key。
 */
const STORAGE_SNAPSHOTS_KEY = 'agent.snapshotsByTabId.v1';

/**
 * 用于“设置断点后自动恢复一次”的轻量状态开关（避免每次 paused 都自动 resume）。
 */
const autoResumeOnceByTabId = new Map();

/**
 * 毫秒时间戳转 ISO 字符串。
 */
const toIso = ms => new Date(ms).toISOString();
/**
 * 获取当前毫秒时间戳。
 */
const nowMs = () => Date.now();

/**
 * 优先使用 session storage（随浏览器会话），不可用时退回 local storage。
 */
const storageArea = chrome.storage?.session ?? chrome.storage?.local;

/**
 * 把 chrome.* 的 callback API 转成 Promise，并统一处理 runtime.lastError。
 */
const chromeCallback = fn =>
  new Promise((resolve, reject) => {
    fn(result => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });

/**
 * 从 storageArea 读取单个 key；读取失败或 key 不存在时返回 fallback。
 */
const getSessionValue = async (key, fallback) => {
  if (!storageArea) return fallback;
  const items = await chromeCallback(cb => storageArea.get(key, cb));
  if (!items || typeof items !== 'object') return fallback;
  const value = items[key];
  return value === undefined ? fallback : value;
};

/**
 * 向 storageArea 写入单个 key。
 */
const setSessionValue = async (key, value) => {
  if (!storageArea) return;
  await chromeCallback(cb => storageArea.set({ [key]: value }, cb));
};

/**
 * 把 CDP RemoteObject 转成可展示的字符串预览（避免大对象/循环引用）。
 */
const remoteObjectToPreview = obj => {
  if (!obj || typeof obj !== 'object') return String(obj);
  if ('value' in obj) return String(obj.value);
  if (typeof obj.unserializableValue === 'string') return obj.unserializableValue;
  if (typeof obj.description === 'string') return obj.description;
  return obj.type ? `[${obj.type}]` : '[unknown]';
};

/**
 * 统一 timestamp：CDP 可能给秒/毫秒，且可能是非法值。
 */
const normalizeTimestampMs = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return nowMs();
  if (value > 1e12) return value;
  return Math.round(value * 1000);
};

/**
 * 从 CDP stackTrace.callFrames 归一化出更小的帧结构（url/line/column/functionName）。
 */
const normalizeCallFrames = stackTrace => {
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
};

/**
 * 向指定 tabId 追加一条日志并广播通知 popup 更新。
 */
const pushLog = async (tabId, entry) => {
  const logsByTabId = await getSessionValue(STORAGE_LOGS_KEY, {});
  const current = Array.isArray(logsByTabId[tabId]) ? logsByTabId[tabId] : [];
  const next = [entry, ...current].slice(0, 200);
  const updated = { ...logsByTabId, [tabId]: next };
  await setSessionValue(STORAGE_LOGS_KEY, updated);
  try {
    chrome.runtime.sendMessage({ type: 'AGENT_LOGS_UPDATED', tabId });
  } catch {
    void 0;
  }
};

/**
 * 向指定 tabId 追加一次“调试快照”并广播通知 popup 更新。
 */
const pushSnapshot = async (tabId, snapshot) => {
  const snapshotsByTabId = await getSessionValue(STORAGE_SNAPSHOTS_KEY, {});
  const current = Array.isArray(snapshotsByTabId[tabId]) ? snapshotsByTabId[tabId] : [];
  const next = [snapshot, ...current].slice(0, 30);
  const updated = { ...snapshotsByTabId, [tabId]: next };
  await setSessionValue(STORAGE_SNAPSHOTS_KEY, updated);
  try {
    chrome.runtime.sendMessage({ type: 'AGENT_SNAPSHOTS_UPDATED', tabId });
  } catch {
    void 0;
  }
};

/**
 * 读取所有 tab 的录制/调试状态字典。
 */
const getRecordingTabs = async () => getSessionValue(STORAGE_RECORDING_KEY, {});
/**
 * 写入所有 tab 的录制/调试状态字典。
 */
const setRecordingTabs = async recordingTabs => setSessionValue(STORAGE_RECORDING_KEY, recordingTabs);

/**
 * 获取单个 tab 的状态对象（debuggerAttached/recording 等）。
 */
const getTabState = async tabId => {
  const recordingTabs = await getRecordingTabs();
  const state = recordingTabs[tabId];
  return state && typeof state === 'object' ? state : {};
};

/**
 * 判断指定 tab 是否已 attach debugger（CDP）。
 */
const isDebuggerAttachedToTab = async tabId => {
  const state = await getTabState(tabId);
  return Boolean(state.debuggerAttached ?? state.attached);
};

/**
 * 判断指定 tab 是否正在“录制”（仅启用 Runtime/Log + 页面 hooks）。
 */
const isRecordingOnTab = async tabId => {
  const state = await getTabState(tabId);
  if (typeof state.recording === 'boolean') return state.recording;
  return Boolean(state.attached);
};

/**
 * 对指定 tab 的状态做部分更新，并写入 updatedAt。
 */
const patchTabState = async (tabId, patch) => {
  const recordingTabs = await getRecordingTabs();
  const current = recordingTabs[tabId] && typeof recordingTabs[tabId] === 'object' ? recordingTabs[tabId] : {};
  const next = {
    ...recordingTabs,
    [tabId]: {
      ...current,
      ...patch,
      updatedAt: toIso(nowMs()),
    },
  };
  await setRecordingTabs(next);
};

/**
 * 标记 tab 的 debugger attach 状态。
 */
const setDebuggerAttached = async (tabId, debuggerAttached) =>
  patchTabState(tabId, { debuggerAttached: Boolean(debuggerAttached) });
/**
 * 标记 tab 的录制状态。
 */
const setRecording = async (tabId, recording) => patchTabState(tabId, { recording: Boolean(recording) });

/**
 * attach 指定 tab 的 debugger（CDP）。
 */
const dbgAttach = (tabId, protocolVersion = '1.3') =>
  chromeCallback(cb => chrome.debugger.attach({ tabId }, protocolVersion, cb));
/**
 * detach 指定 tab 的 debugger（CDP）。
 */
const dbgDetach = tabId => chromeCallback(cb => chrome.debugger.detach({ tabId }, cb));
/**
 * 发送 CDP 命令到指定 tab。
 */
const dbgSend = (tabId, method, params) =>
  chromeCallback(cb => chrome.debugger.sendCommand({ tabId }, method, params ?? {}, cb));

/**
 * 注入页面 hooks（MAIN world）：
 * - window.error/unhandledrejection
 * - Vue.config.errorHandler（如果存在）
 */
const installPageHooks = async tabId => {
  if (!chrome.scripting?.executeScript) return;
  try {
    await chromeCallback(cb =>
      chrome.scripting.executeScript(
        {
          target: { tabId },
          world: 'MAIN',
          func: () => {
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
                  const src =
                    target && typeof target === 'object'
                      ? target.src || target.href || target.currentSrc || target.baseURI
                      : undefined;
                  console.error(prefix, 'window.error', safe(ev && ev.message), src ? `resource=${src}` : '');
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
                      vm && vm.$options
                        ? vm.$options.name || vm.$options._componentTag || vm.$options.__file
                        : undefined;
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
          },
        },
        cb,
      ),
    );
  } catch {
    void 0;
  }
};

/**
 * 确保指定 tab 已 attach debugger，避免重复 attach 报错。
 */
const ensureDebuggerAttached = async tabId => {
  if (await isDebuggerAttachedToTab(tabId)) return;
  await dbgAttach(tabId);
  await setDebuggerAttached(tabId, true);
};

/**
 * 开启调试能力：Runtime/Log/Debugger，并注入页面 hooks。
 */
const enableDebugger = async tabId => {
  await ensureDebuggerAttached(tabId);
  await dbgSend(tabId, 'Runtime.enable');
  await dbgSend(tabId, 'Log.enable');
  await dbgSend(tabId, 'Debugger.enable');
  await installPageHooks(tabId);
};

/**
 * 按 url + line(+column) 设置断点，并标记“仅自动恢复一次”的开关。
 */
const armBreakpoint = async ({ tabId, url, line, column }) => {
  await enableDebugger(tabId);
  const lineNumber = Math.max(0, (Number(line) || 1) - 1);
  const columnNumber = Number.isFinite(Number(column)) ? Number(column) : undefined;
  const res = await dbgSend(tabId, 'Debugger.setBreakpointByUrl', {
    url,
    lineNumber,
    ...(typeof columnNumber === 'number' ? { columnNumber } : {}),
  });
  const breakpointId = res && typeof res === 'object' ? res.breakpointId : undefined;
  autoResumeOnceByTabId.set(tabId, true);
  return { ok: true, breakpointId };
};

/**
 * 开始录制：确保 attach + enable Runtime/Log，并注入页面 hooks（不启用 Debugger）。
 */
const startRecording = async tabId => {
  if (await isRecordingOnTab(tabId)) return { ok: true, already: true };
  await ensureDebuggerAttached(tabId);
  await dbgSend(tabId, 'Runtime.enable');
  await dbgSend(tabId, 'Log.enable');
  await installPageHooks(tabId);
  await setRecording(tabId, true);
  return { ok: true };
};

/**
 * 停止录制：detach debugger 并清理状态。
 */
const stopRecording = async tabId => {
  if (!(await isDebuggerAttachedToTab(tabId))) return { ok: true, already: true };
  await dbgDetach(tabId);
  await setRecording(tabId, false);
  await setDebuggerAttached(tabId, false);
  autoResumeOnceByTabId.delete(tabId);
  return { ok: true };
};

/**
 * 监听 CDP 事件：
 * - Log.entryAdded / Runtime.consoleAPICalled / Runtime.exceptionThrown：采集错误日志
 * - Debugger.paused：采集快照并（如需要）自动 resume 一次
 */
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source?.tabId;
  if (typeof tabId !== 'number') return;

  if (method === 'Log.entryAdded') {
    const p = params && typeof params === 'object' ? params : {};
    const entry = p.entry && typeof p.entry === 'object' ? p.entry : {};
    const level = typeof entry.level === 'string' ? entry.level : 'info';
    if (level !== 'error') return;

    const textParts = [];
    if (typeof entry.text === 'string' && entry.text.trim()) textParts.push(entry.text.trim());
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
    return;
  }

  if (method === 'Runtime.consoleAPICalled') {
    const p = params && typeof params === 'object' ? params : {};
    const type = typeof p.type === 'string' ? p.type : 'log';
    if (type !== 'error' && type !== 'assert') return; // 只抓控制台的error类日志
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
    return;
  }

  if (method === 'Runtime.exceptionThrown') {
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
    return;
  }

  if (method === 'Debugger.paused') {
    const p = params && typeof params === 'object' ? params : {};
    const callFrames = Array.isArray(p.callFrames) ? p.callFrames : [];
    const reason = typeof p.reason === 'string' ? p.reason : 'paused';

    const topFrames = callFrames.slice(0, 3);
    const frames = [];

    for (const frame of topFrames) {
      const callFrameId = frame && typeof frame === 'object' ? frame.callFrameId : undefined;
      if (typeof callFrameId !== 'string') continue;

      const functionName = typeof frame.functionName === 'string' ? frame.functionName : undefined;
      const loc = frame.location && typeof frame.location === 'object' ? frame.location : {};
      const line = typeof loc.lineNumber === 'number' ? loc.lineNumber + 1 : undefined;
      const column = typeof loc.columnNumber === 'number' ? loc.columnNumber : undefined;
      const url = typeof frame.url === 'string' ? frame.url : undefined;

      let thisPreview;
      try {
        const evalThis = await dbgSend(tabId, 'Debugger.evaluateOnCallFrame', {
          callFrameId,
          expression: 'this',
          generatePreview: true,
          returnByValue: false,
          silent: true,
        });
        if (evalThis && typeof evalThis === 'object' && evalThis.result) {
          thisPreview = remoteObjectToPreview(evalThis.result);
        }
      } catch {
        thisPreview = undefined;
      }

      let vueHint;
      try {
        const evalVue = await dbgSend(tabId, 'Debugger.evaluateOnCallFrame', {
          callFrameId,
          expression:
            "(() => { const t = this; if (!t || typeof t !== 'object') return null; if (!t._isVue) return null; const o = t.$options || {}; const r = t.$route || {}; return { isVue: true, name: o.name || o._componentTag || null, file: o.__file || null, route: { name: r.name || null, path: r.fullPath || r.path || null } }; })()",
          returnByValue: true,
          silent: true,
        });
        if (evalVue && typeof evalVue === 'object' && evalVue.result && typeof evalVue.result.value !== 'undefined') {
          vueHint = evalVue.result.value;
        }
      } catch {
        vueHint = undefined;
      }

      const scopes = [];
      const chain = frame.scopeChain && Array.isArray(frame.scopeChain) ? frame.scopeChain : [];
      for (const scope of chain.slice(0, 3)) {
        const type = scope && typeof scope === 'object' && typeof scope.type === 'string' ? scope.type : 'unknown';
        const objectId = scope?.object?.objectId;
        if (typeof objectId !== 'string') continue;
        try {
          const props = await dbgSend(tabId, 'Runtime.getProperties', {
            objectId,
            ownProperties: true,
            generatePreview: true,
          });
          const result = props && typeof props === 'object' && Array.isArray(props.result) ? props.result : [];
          const items = result
            .filter(p => p && typeof p === 'object' && typeof p.name === 'string')
            .slice(0, 30)
            .map(p => ({
              name: p.name,
              value: p.value ? remoteObjectToPreview(p.value) : p.get ? '[getter]' : undefined,
            }));
          scopes.push({ type, items });
        } catch {
          scopes.push({ type, items: [] });
        }
      }

      frames.push({
        functionName,
        url,
        line,
        column,
        thisPreview,
        vueHint,
        scopes,
      });
    }

    await pushSnapshot(tabId, {
      id: crypto.randomUUID(),
      tabId,
      occurredAt: toIso(nowMs()),
      reason,
      frames,
    });

    if (autoResumeOnceByTabId.get(tabId)) {
      autoResumeOnceByTabId.delete(tabId);
      try {
        await dbgSend(tabId, 'Debugger.resume');
      } catch {
        void 0;
      }
    }
    return;
  }
});

/**
 * tab 关闭时清理该 tab 的录制/调试状态，避免残留 attach。
 */
chrome.tabs.onRemoved.addListener(tabId => {
  void (async () => {
    try {
      await stopRecording(tabId);
    } catch {
      void 0;
    }
  })();
});

/**
 * popup/content-script 与 background 的消息通道：
 * - start/stop/status
 * - logs get/clear
 * - snapshots get
 * - breakpoint arm / resume
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message && typeof message === 'object' ? message : {};
  const type = msg.type;

  /**
   * 统一 sendResponse 的 try/catch，避免响应阶段抛错导致通道中断。
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
      if (type === 'AGENT_RECORDER_START') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const result = await startRecording(tabId);
        return done(result);
      }

      if (type === 'AGENT_RECORDER_STOP') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const result = await stopRecording(tabId);
        return done(result);
      }

      if (type === 'AGENT_RECORDER_STATUS') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const recording = await isRecordingOnTab(tabId);
        const debuggerAttached = await isDebuggerAttachedToTab(tabId);
        return done({ ok: true, recording, debuggerAttached });
      }

      if (type === 'AGENT_LOGS_GET') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const logsByTabId = await getSessionValue(STORAGE_LOGS_KEY, {});
        const logs = Array.isArray(logsByTabId[tabId]) ? logsByTabId[tabId] : [];
        return done({ ok: true, items: logs });
      }

      if (type === 'AGENT_LOGS_CLEAR') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const logsByTabId = await getSessionValue(STORAGE_LOGS_KEY, {});
        const updated = { ...logsByTabId, [tabId]: [] };
        await setSessionValue(STORAGE_LOGS_KEY, updated);
        return done({ ok: true });
      }

      if (type === 'AGENT_SNAPSHOTS_GET') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        const snapshotsByTabId = await getSessionValue(STORAGE_SNAPSHOTS_KEY, {});
        const items = Array.isArray(snapshotsByTabId[tabId]) ? snapshotsByTabId[tabId] : [];
        return done({ ok: true, items });
      }

      if (type === 'AGENT_BREAKPOINT_ARM') {
        const tabId = Number(msg.tabId);
        const url = typeof msg.url === 'string' ? msg.url : undefined;
        const line = Number(msg.line);
        const column = Number(msg.column);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        if (!url) return done({ ok: false, error: 'invalid_url' });
        if (!Number.isFinite(line)) return done({ ok: false, error: 'invalid_line' });
        const result = await armBreakpoint({ tabId, url, line, column });
        return done(result);
      }

      if (type === 'AGENT_DEBUGGER_RESUME') {
        const tabId = Number(msg.tabId);
        if (!Number.isFinite(tabId)) return done({ ok: false, error: 'invalid_tabId' });
        await enableDebugger(tabId);
        await dbgSend(tabId, 'Debugger.resume');
        return done({ ok: true });
      }

      return done({ ok: false, error: 'unknown_message_type' });
    } catch (e) {
      return done({ ok: false, error: e instanceof Error ? e.message : 'unknown_error' });
    }
  })();
  return true;
  // te
});
