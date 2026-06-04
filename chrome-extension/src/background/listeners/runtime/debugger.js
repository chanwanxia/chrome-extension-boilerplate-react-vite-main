import { CDP_PROTOCOL_VERSION, LIMITS, STORAGE_RECORDING_KEY } from '../../const/index.js';
import {
  handleCdpConsoleAPICalled,
  handleCdpExceptionThrown,
  handleCdpLogEntryAdded,
  installPageHooks,
  pushSnapshot,
  remoteObjectToPreview,
  toIso,
  nowMs,
} from '../../services/errorService.js';
import { chromeCallback, getStorageValue, setStorageValue } from '../../services/storageService.js';
import {
  clearRequestMeta,
  handleNetworkLoadingFailed,
  handleNetworkLoadingFinished,
  handleNetworkRequestWillBeSent,
  handleNetworkResponseReceived,
} from '../../services/performanceService.js';

const autoResumeOnceByTabId = new Map();

/**
 * 读取所有 tab 的录制/调试状态字典。
 * @returns {Promise<Record<string, any>>}
 */
async function getRecordingTabs() {
  return getStorageValue(STORAGE_RECORDING_KEY, {});
}

/**
 * 写入所有 tab 的录制/调试状态字典。
 * @param {Record<string, any>} recordingTabs
 * @returns {Promise<void>}
 */
async function setRecordingTabs(recordingTabs) {
  return setStorageValue(STORAGE_RECORDING_KEY, recordingTabs);
}

/**
 * 获取单个 tab 的状态对象（debuggerAttached/recording 等）。
 * @param {number} tabId
 * @returns {Promise<Record<string, any>>}
 */
async function getTabState(tabId) {
  const recordingTabs = await getRecordingTabs();
  const state = recordingTabs[tabId];
  return state && typeof state === 'object' ? state : {};
}

/**
 * 对指定 tab 的状态做部分更新，并写入 updatedAt。
 * @param {number} tabId
 * @param {Record<string, any>} patch
 * @returns {Promise<void>}
 */
async function patchTabState(tabId, patch) {
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
}

/**
 * 判断指定 tab 是否已 attach debugger（CDP）。
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isDebuggerAttachedToTab(tabId) {
  const state = await getTabState(tabId);
  return Boolean(state.debuggerAttached ?? state.attached);
}

/**
 * 判断指定 tab 是否正在“录制”（仅启用 Runtime/Log/Network + 页面 hooks）。
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isRecordingOnTab(tabId) {
  const state = await getTabState(tabId);
  if (typeof state.recording === 'boolean') return state.recording;
  return Boolean(state.attached);
}

/**
 * 标记 tab 的 debugger attach 状态。
 * @param {number} tabId
 * @param {boolean} debuggerAttached
 * @returns {Promise<void>}
 */
async function setDebuggerAttached(tabId, debuggerAttached) {
  await patchTabState(tabId, { debuggerAttached: Boolean(debuggerAttached) });
}

/**
 * 标记 tab 的录制状态。
 * @param {number} tabId
 * @param {boolean} recording
 * @returns {Promise<void>}
 */
async function setRecording(tabId, recording) {
  await patchTabState(tabId, { recording: Boolean(recording) });
}

/**
 * attach 指定 tab 的 debugger（CDP）。
 * @param {number} tabId
 * @param {string} protocolVersion
 * @returns {Promise<any>}
 */
function dbgAttach(tabId, protocolVersion = CDP_PROTOCOL_VERSION) {
  return chromeCallback(cb => chrome.debugger.attach({ tabId }, protocolVersion, cb));
}

/**
 * detach 指定 tab 的 debugger（CDP）。
 * @param {number} tabId
 * @returns {Promise<any>}
 */
function dbgDetach(tabId) {
  return chromeCallback(cb => chrome.debugger.detach({ tabId }, cb));
}

/**
 * 发送 CDP 命令到指定 tab。
 * @param {number} tabId
 * @param {string} method
 * @param {Record<string, any> | undefined} params
 * @returns {Promise<any>}
 */
function dbgSend(tabId, method, params) {
  return chromeCallback(cb => chrome.debugger.sendCommand({ tabId }, method, params ?? {}, cb));
}

/**
 * 确保指定 tab 已 attach debugger，避免重复 attach 报错。
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function ensureDebuggerAttached(tabId) {
  if (await isDebuggerAttachedToTab(tabId)) return;
  await dbgAttach(tabId);
  await setDebuggerAttached(tabId, true);
}

/**
 * 开启调试能力：Runtime/Log/Network/Debugger，并注入页面 hooks。
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function enableDebugger(tabId) {
  await ensureDebuggerAttached(tabId);
  await dbgSend(tabId, 'Runtime.enable');
  await dbgSend(tabId, 'Log.enable');
  await dbgSend(tabId, 'Network.enable');
  await dbgSend(tabId, 'Debugger.enable');
  await installPageHooks(tabId);
}

/**
 * 按 url + line(+column) 设置断点，并标记“仅自动恢复一次”的开关。
 * @param {{tabId: number, url: string, line: number, column?: number}} input
 * @returns {Promise<{ok: true, breakpointId?: string}>}
 */
export async function armBreakpoint({ tabId, url, line, column }) {
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
}

/**
 * 开始录制：确保 attach + enable Runtime/Log/Network，并注入页面 hooks（不启用 Debugger）。
 * @param {number} tabId
 * @returns {Promise<{ok: boolean, already?: boolean, error?: string}>}
 */
export async function startRecording(tabId) {
  if (await isRecordingOnTab(tabId)) return { ok: true, already: true };
  await ensureDebuggerAttached(tabId);
  await dbgSend(tabId, 'Runtime.enable');
  await dbgSend(tabId, 'Log.enable');
  await dbgSend(tabId, 'Network.enable');
  await installPageHooks(tabId);
  await setRecording(tabId, true);
  return { ok: true };
}

/**
 * 停止录制：detach debugger 并清理状态。
 * @param {number} tabId
 * @returns {Promise<{ok: boolean, already?: boolean}>}
 */
export async function stopRecording(tabId) {
  if (!(await isDebuggerAttachedToTab(tabId))) return { ok: true, already: true };
  await dbgDetach(tabId);
  await setRecording(tabId, false);
  await setDebuggerAttached(tabId, false);
  autoResumeOnceByTabId.delete(tabId);
  clearRequestMeta(tabId);
  return { ok: true };
}

/**
 * 获取指定 tab 的状态（recording/debuggerAttached）。
 * @param {number} tabId
 * @returns {Promise<{ok: true, recording: boolean, debuggerAttached: boolean}>}
 */
export async function getStatus(tabId) {
  const recording = await isRecordingOnTab(tabId);
  const debuggerAttached = await isDebuggerAttachedToTab(tabId);
  return { ok: true, recording, debuggerAttached };
}

/**
 * 恢复 Debugger：确保开启 Debugger.enable 后发送 resume。
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function resumeDebugger(tabId) {
  await enableDebugger(tabId);
  await dbgSend(tabId, 'Debugger.resume');
}

/**
 * 采集 Debugger.paused 快照：提取顶部若干帧、this 预览、Vue 组件 hint、作用域变量（截断）。
 * @param {number} tabId
 * @param {any} params
 * @returns {Promise<void>}
 */
async function handleDebuggerPaused(tabId, params) {
  const p = params && typeof params === 'object' ? params : {};
  const callFrames = Array.isArray(p.callFrames) ? p.callFrames : [];
  const reason = typeof p.reason === 'string' ? p.reason : 'paused';

  const topFrames = callFrames.slice(0, LIMITS.maxSnapshotFrames);
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
    for (const scope of chain.slice(0, LIMITS.maxSnapshotScopes)) {
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
          .filter(prop => prop && typeof prop === 'object' && typeof prop.name === 'string')
          .slice(0, LIMITS.scopePropertiesPerObject)
          .map(prop => ({
            name: prop.name,
            value: prop.value ? remoteObjectToPreview(prop.value) : prop.get ? '[getter]' : undefined,
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
}

/**
 * 注册 chrome.debugger.onEvent 监听：
 * - Log.entryAdded / Runtime.consoleAPICalled / Runtime.exceptionThrown：采集错误日志
 * - Network.*：采集网络异常/慢请求
 * - Debugger.paused：采集快照并（如需要）自动 resume 一次
 * @returns {void}
 */
export function registerDebuggerEvents() {
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    const tabId = source?.tabId;
    if (typeof tabId !== 'number') return;

    try {
      if (method === 'Log.entryAdded') return await handleCdpLogEntryAdded(tabId, params);
      if (method === 'Runtime.consoleAPICalled') return await handleCdpConsoleAPICalled(tabId, params);
      if (method === 'Runtime.exceptionThrown') return await handleCdpExceptionThrown(tabId, params);

      if (method === 'Network.requestWillBeSent') return handleNetworkRequestWillBeSent(tabId, params);
      if (method === 'Network.responseReceived') return await handleNetworkResponseReceived(tabId, params);
      if (method === 'Network.loadingFinished') return await handleNetworkLoadingFinished(tabId, params);
      if (method === 'Network.loadingFailed') return await handleNetworkLoadingFailed(tabId, params);

      if (method === 'Debugger.paused') return await handleDebuggerPaused(tabId, params);
    } catch {
      void 0;
    }
  });
}
