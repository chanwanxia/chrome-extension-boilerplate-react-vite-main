import { MESSAGE_TYPES } from '../const/index.js';

/**
 * 从消息体解析 tabId 并做基础校验。
 */
function parseTabId(msg) {
  const tabId = Number(msg?.tabId);
  return Number.isFinite(tabId) ? tabId : null;
}

/**
 * 处理来自 popup 的消息（start/stop/status/logs/snapshots/breakpoint/resume）。
 */
export async function handlePopupMessage(msg, actions) {
  const type = msg?.type;

  if (type === MESSAGE_TYPES.aiAnalyze) {
    const apiKey = typeof msg?.apiKey === 'string' ? msg.apiKey.trim() : '';
    if (!apiKey) return { ok: false, error: 'missing_apiKey' };

    const error = msg?.error && typeof msg.error === 'object' ? msg.error : {};
    const distText = typeof msg?.distText === 'string' ? msg.distText : '';
    const meta = msg?.meta && typeof msg.meta === 'object' ? msg.meta : {};

    if (typeof actions?.aiAnalyze !== 'function') return { ok: false, error: 'ai_not_supported' };
    return actions.aiAnalyze({ apiKey, error, distText, meta });
  }

  if (type === MESSAGE_TYPES.aiAgentLoop) {
    const apiKey = typeof msg?.apiKey === 'string' ? msg.apiKey.trim() : '';
    if (!apiKey) return { ok: false, error: 'missing_apiKey' };

    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };

    const sessionId = typeof msg?.sessionId === 'string' ? msg.sessionId.trim() : '';
    const selectedLogId = typeof msg?.selectedLogId === 'string' ? msg.selectedLogId.trim() : '';
    if (!sessionId && !selectedLogId) return { ok: false, error: 'missing_selectedLogId' };

    const objective = typeof msg?.objective === 'string' ? msg.objective.trim() : '';
    const error = msg?.error && typeof msg.error === 'object' ? msg.error : {};
    const distText = typeof msg?.distText === 'string' ? msg.distText : '';
    const meta = msg?.meta && typeof msg.meta === 'object' ? msg.meta : {};

    const options = msg?.options && typeof msg.options === 'object' ? msg.options : {};
    const maxSteps = Number(options?.maxSteps);

    if (typeof actions?.aiAgentLoop !== 'function') return { ok: false, error: 'ai_agent_not_supported' };
    return actions.aiAgentLoop({
      apiKey,
      tabId,
      sessionId: sessionId || undefined,
      selectedLogId: selectedLogId || undefined,
      objective,
      error,
      distText,
      meta,
      options: { maxSteps },
    });
  }

  if (type === MESSAGE_TYPES.recorderStart) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    return actions.startRecording(tabId);
  }

  if (type === MESSAGE_TYPES.recorderStop) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    return actions.stopRecording(tabId);
  }

  if (type === MESSAGE_TYPES.recorderStatus) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    return actions.getStatus(tabId);
  }

  if (type === MESSAGE_TYPES.logsGet) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    const items = await actions.getLogs(tabId);
    return { ok: true, items };
  }

  if (type === MESSAGE_TYPES.logsClear) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    await actions.clearLogs(tabId);
    return { ok: true };
  }

  if (type === MESSAGE_TYPES.snapshotsGet) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    const items = await actions.getSnapshots(tabId);
    return { ok: true, items };
  }

  if (type === MESSAGE_TYPES.breakpointArm) {
    const tabId = parseTabId(msg);
    const url = typeof msg?.url === 'string' ? msg.url : undefined;
    const line = Number(msg?.line);
    const column = Number(msg?.column);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    if (!url) return { ok: false, error: 'invalid_url' };
    if (!Number.isFinite(line)) return { ok: false, error: 'invalid_line' };
    return actions.armBreakpoint({ tabId, url, line, column });
  }

  if (type === MESSAGE_TYPES.debuggerResume) {
    const tabId = parseTabId(msg);
    if (tabId === null) return { ok: false, error: 'invalid_tabId' };
    await actions.resumeDebugger(tabId);
    return { ok: true };
  }

  return { ok: false, error: 'unknown_message_type' };
}
