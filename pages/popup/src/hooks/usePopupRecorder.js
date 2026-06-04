import { useEffect, useMemo, useRef, useState } from 'react';
import { getActiveTabId, sendRuntimeMessage } from '@src/utils/chrome';

/**
 * Popup 侧录制器数据与消息订阅：
 * - 管理 tabId/recording/logs/snapshots
 * - 统一 refresh 与 background 通信
 * - 监听 AGENT_LOGS_UPDATED / AGENT_SNAPSHOTS_UPDATED 并自动 refresh
 * @returns {{
 *   tabId: number | undefined,
 *   recording: boolean,
 *   logs: any[],
 *   snapshots: any[],
 *   logsRef: import('react').MutableRefObject<any[]>,
 *   refresh: (tabId?: number) => Promise<void>,
 * }}
 */
export const usePopupRecorder = () => {
  const [tabId, setTabId] = useState();
  const [recording, setRecording] = useState(false);
  const [logs, setLogs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const logsRef = useRef([]);
  const tabIdRef = useRef();

  useEffect(() => {
    tabIdRef.current = tabId;
  }, [tabId]);

  /**
   * 同步 popup 展示数据：录制状态、日志列表、快照列表。
   * @param {number | undefined} activeTabId
   * @returns {Promise<void>}
   */
  const refresh = async activeTabId => {
    const resolvedTabId = typeof activeTabId === 'number' ? activeTabId : tabIdRef.current;
    if (!resolvedTabId) return;

    const status = await sendRuntimeMessage({ type: 'AGENT_RECORDER_STATUS', tabId: resolvedTabId });
    if (status?.ok) setRecording(Boolean(status.recording));

    const result = await sendRuntimeMessage({ type: 'AGENT_LOGS_GET', tabId: resolvedTabId });
    if (result?.ok && Array.isArray(result.items)) {
      logsRef.current = result.items;
      setLogs(result.items);
    }

    const snapshotsResult = await sendRuntimeMessage({ type: 'AGENT_SNAPSHOTS_GET', tabId: resolvedTabId });
    if (snapshotsResult?.ok && Array.isArray(snapshotsResult.items)) {
      setSnapshots(snapshotsResult.items);
    }
  };

  useEffect(() => {
    void (async () => {
      const activeTabId = await getActiveTabId();
      setTabId(activeTabId);
      await refresh(activeTabId);
    })();

    const onMessage = msg => {
      if (!msg || typeof msg !== 'object') return;
      if (typeof msg.tabId !== 'number') return;
      if (msg.tabId !== tabIdRef.current) return;
      if (msg.type !== 'AGENT_LOGS_UPDATED' && msg.type !== 'AGENT_SNAPSHOTS_UPDATED') return;
      void refresh(msg.tabId);
    };

    try {
      chrome.runtime.onMessage.addListener(onMessage);
    } catch {
      void 0;
    }

    return () => {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        void 0;
      }
    };
  }, []);

  const api = useMemo(
    () => ({
      tabId,
      recording,
      logs,
      snapshots,
      logsRef,
      refresh,
    }),
    [tabId, recording, logs, snapshots],
  );

  return api;
};
