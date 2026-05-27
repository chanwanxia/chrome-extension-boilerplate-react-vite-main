/**
 * storage 中按 tabId 存储日志列表的 key。
 */
export const STORAGE_LOGS_KEY = 'agent.logsByTabId.v1';

/**
 * storage 中记录 tab 录制/调试状态的 key。
 */
export const STORAGE_RECORDING_KEY = 'agent.recordingTabs.v1';

/**
 * storage 中按 tabId 存储调试快照的 key。
 */
export const STORAGE_SNAPSHOTS_KEY = 'agent.snapshotsByTabId.v1';

/**
 * CDP 协议版本：用于 chrome.debugger.attach。
 */
export const CDP_PROTOCOL_VERSION = '1.3';

/**
 * 各类数据量上限：避免 storage / 内存无限增长。
 */
export const LIMITS = {
  logsPerTab: 200,
  snapshotsPerTab: 30,
  requestMetaPerTab: 4000,
  scopePropertiesPerObject: 30,
  maxSnapshotFrames: 3,
  maxSnapshotScopes: 3,
};

/**
 * runtime message 类型常量：popup/content-script <-> background。
 */
export const MESSAGE_TYPES = {
  recorderStart: 'AGENT_RECORDER_START',
  recorderStop: 'AGENT_RECORDER_STOP',
  recorderStatus: 'AGENT_RECORDER_STATUS',
  logsGet: 'AGENT_LOGS_GET',
  logsClear: 'AGENT_LOGS_CLEAR',
  snapshotsGet: 'AGENT_SNAPSHOTS_GET',
  breakpointArm: 'AGENT_BREAKPOINT_ARM',
  debuggerResume: 'AGENT_DEBUGGER_RESUME',
  logsUpdated: 'AGENT_LOGS_UPDATED',
  snapshotsUpdated: 'AGENT_SNAPSHOTS_UPDATED',
};
