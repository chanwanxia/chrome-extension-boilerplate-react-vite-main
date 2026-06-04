import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared/react';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui/react';

import { useEffect, useMemo, useRef, useState } from 'react';
import LogList from '@src/components/LogList';
import AnalysisPanel from '@src/components/AnalysisPanel';
import { sendRuntimeMessage } from '@src/utils/chrome';
import {
  analyzeLog,
  getIssuePrimaryLocation,
  isIssueRelatedLog,
  isIssueRelatedSnapshot,
  pickPrimaryFrame,
} from '@src/utils/popupAnalysis';
import { formatConsoleLikeError } from '@src/utils/distSnippet';
import { usePopupRecorder } from '@src/hooks/usePopupRecorder';

const STORAGE_QWEN_KEY = 'agent.qwenKey.v1';

/**
 * 把 background 抛出的 AI 错误（含 qwen_http_ 状态码）转成更可读的提示文案。
 * @param {unknown} err
 * @returns {string}
 */
const formatAiErrorMessage = err => {
  const text = err instanceof Error ? err.message : String(err ?? '');
  const m = text.match(/^qwen_http_(\d+)(?::\s*([\s\S]+))?$/);
  if (!m) return text || 'ai_analyze_failed';
  const status = Number(m[1]);
  const raw = (m[2] ?? '').trim();
  const json = raw
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })()
    : null;

  if (status === 401) {
    const remote = json?.error?.message ? String(json.error.message).trim() : '';
    return `Qwen Key 无效或已过期（401）。${remote || '请在下方重新填写可用的 DashScope API Key。'}`;
  }
  if (status === 429) return '请求过于频繁或配额不足（429）。请稍后重试或检查账户额度。';
  if (status === 403) return '无权限访问该模型/接口（403）。请检查账号权限或模型是否可用。';
  return text;
};

/**
 * Popup 主界面：日志列表 + dist 分析 + 断点调试入口。
 */
const Popup = () => {
  const { tabId, recording, logs, snapshots, logsRef, refresh } = usePopupRecorder();
  const [selectedLogId, setSelectedLogId] = useState();
  const [analysis, setAnalysis] = useState();
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState();
  const [uiNotice, setUiNotice] = useState();
  const [qwenKey, setQwenKey] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState();
  const [aiResult, setAiResult] = useState();
  const [aiMode, setAiMode] = useState('single');
  const [aiSessionId, setAiSessionId] = useState('');
  const [aiSessionLogId, setAiSessionLogId] = useState('');
  const [aiUserAction, setAiUserAction] = useState('');
  const [aiBaseline, setAiBaseline] = useState();
  const [aiReproState, setAiReproState] = useState('idle');
  const analyzeTokenRef = useRef(0);

  const selectedLog = useMemo(() => logs.find(l => l.id === selectedLogId), [logs, selectedLogId]);
  const locked = recording;
  const aiDisabled = aiBusy || (locked && aiMode !== 'agent') || !String(qwenKey ?? '').trim();
  const hasNewEvidence = useMemo(() => {
    if (aiMode !== 'agent') return false;
    if (!aiBaseline) return false;
    if (!selectedLog) return false;

    const target = getIssuePrimaryLocation(selectedLog, analysis);
    const newLogCount = Math.max(0, logs.length - (aiBaseline.logsLen || 0));
    const newSnapshotCount = Math.max(0, snapshots.length - (aiBaseline.snapshotsLen || 0));

    const newLogs = newLogCount > 0 ? logs.slice(0, newLogCount) : [];
    const newSnapshots = newSnapshotCount > 0 ? snapshots.slice(0, newSnapshotCount) : [];

    if (!target) return newLogs.length > 0 || newSnapshots.length > 0;
    if (newLogs.some(l => isIssueRelatedLog(l, selectedLog, analysis))) return true;
    if (newSnapshots.some(s => isIssueRelatedSnapshot(s, selectedLog, analysis))) return true;
    return false;
  }, [aiMode, aiBaseline, logs, snapshots, selectedLog, analysis]);

  useEffect(() => {
    if (aiMode !== 'agent') return;
    if (!aiSessionId) return;
    if (aiReproState !== 'waiting') return;
    if (!recording) return;
    if (aiBusy) return;
    if (!hasNewEvidence) return;

    setAiReproState('continuing');
    void (async () => {
      try {
        await sendRuntimeMessage({ type: 'AGENT_RECORDER_STOP', tabId });
        await refresh(tabId);
      } catch {
        void 0;
      }
      await onAiAnalyze();
      setAiReproState('idle');
    })();
  }, [aiMode, aiSessionId, aiReproState, recording, aiBusy, hasNewEvidence, tabId]);

  useEffect(() => {
    setAiSessionId('');
    setAiSessionLogId('');
    setAiUserAction('');
    setAiBaseline(undefined);
    setAiReproState('idle');
    setAiResult(undefined);
  }, [selectedLogId]);

  useEffect(() => {
    if (aiMode !== 'agent') {
      setAiSessionId('');
      setAiSessionLogId('');
      setAiUserAction('');
      setAiBaseline(undefined);
      setAiReproState('idle');
    }
  }, [aiMode]);

  useEffect(() => {
    try {
      chrome.storage?.local?.get?.(STORAGE_QWEN_KEY, items => {
        const stored = items && typeof items === 'object' ? items[STORAGE_QWEN_KEY] : undefined;
        if (typeof stored === 'string' && stored.trim()) setQwenKey(stored);
      });
    } catch {
      void 0;
    }
  }, []);

  /**
   * 开始录制（注入/开启前端采集）。
   */
  const onStart = async () => {
    setUiError(undefined);
    setUiNotice(undefined);
    if (!tabId) return setUiError('未找到当前激活标签页');
    setBusy(true);
    try {
      const result = await sendRuntimeMessage({ type: 'AGENT_RECORDER_START', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'start_failed');
      await refresh(tabId);
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'start_failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 停止录制。
   */
  const onStop = async () => {
    setUiError(undefined);
    setUiNotice(undefined);
    if (!tabId) return setUiError('未找到当前激活标签页');
    setBusy(true);
    try {
      const result = await sendRuntimeMessage({ type: 'AGENT_RECORDER_STOP', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'stop_failed');
      await refresh(tabId);
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'stop_failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 清空当前 tab 的采集日志。
   */
  const onClear = async () => {
    if (locked) return;
    setUiError(undefined);
    setUiNotice(undefined);
    if (!tabId) return setUiError('未找到当前激活标签页');
    setBusy(true);
    try {
      const result = await sendRuntimeMessage({ type: 'AGENT_LOGS_CLEAR', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'clear_failed');
      await refresh(tabId);
      setSelectedLogId(undefined);
      setAnalysis(undefined);
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'clear_failed');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 把当前日志数组复制成 JSON，方便粘贴到工单/IM。
   */
  const onCopy = async () => {
    if (locked) return;
    setUiError(undefined);
    setUiNotice(undefined);
    try {
      const payload = JSON.stringify(logsRef.current, null, 2);
      await navigator.clipboard.writeText(payload);
      setUiNotice('已复制 logs JSON');
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'copy_failed');
    }
  };

  /**
   * 触发“dist 分析”：异步拉取产物并生成片段（支持取消过期任务）。
   */
  const onAnalyze = async log => {
    if (locked) return;
    setUiError(undefined);
    setUiNotice(undefined);
    setBusy(true);
    setAnalysis(undefined);
    setAiError(undefined);
    setAiResult(undefined);
    analyzeTokenRef.current += 1;
    const token = analyzeTokenRef.current;
    try {
      const result = await analyzeLog(log);
      if (token === analyzeTokenRef.current) setAnalysis(result);
    } catch (e) {
      if (token === analyzeTokenRef.current) setUiError(e instanceof Error ? e.message : 'analyze_failed');
    } finally {
      if (token === analyzeTokenRef.current) setBusy(false);
    }
  };

  /**
   * 触发 AI 诊断：把（错误日志 + dist 片段）发给 background，由 service worker 调用大模型。
   */
  const onAiAnalyze = async () => {
    if (locked && aiMode !== 'agent') return;
    setAiError(undefined);
    setAiResult(undefined);
    setAiUserAction('');
    if (!selectedLog) return setAiError('未选择日志');
    if (!analysis) return setAiError('请先完成 dist 分析');
    const apiKey = String(qwenKey ?? '').trim();
    if (!apiKey) return setAiError('请先填写 Qwen Key');
    if (aiMode === 'agent' && !tabId) return setAiError('未找到当前激活标签页');

    const distText = analysis?.generated?.context?.text ? String(analysis.generated.context.text) : '';
    const formatted = formatConsoleLikeError(selectedLog);

    setAiBusy(true);
    try {
      const currentIssueLogId = selectedLogId || selectedLog.id;
      const shouldUseSession =
        aiMode === 'agent' && aiSessionId && aiSessionLogId && aiSessionLogId === currentIssueLogId;
      const resp = await sendRuntimeMessage({
        type: aiMode === 'agent' ? 'AGENT_AI_AGENT_LOOP' : 'AGENT_AI_ANALYZE',
        apiKey,
        ...(aiMode === 'agent' ? { tabId } : {}),
        ...(aiMode === 'agent' ? { selectedLogId: currentIssueLogId } : {}),
        ...(shouldUseSession ? { sessionId: aiSessionId } : {}),
        ...(aiMode === 'agent'
          ? { objective: '严格仅分析当前选中问题；必要时通过强相关证据闭环采证，并给出可落地的修复建议。' }
          : {}),
        error: {
          occurredAt: selectedLog.occurredAt,
          message: String(selectedLog.message ?? ''),
          stack: formatted,
        },
        distText,
        meta: {
          errorType: analysis.errorType,
          guessedCause: analysis.cause,
          primaryFrame: analysis.primaryFrame,
        },
        ...(aiMode === 'agent' ? { options: { maxSteps: 6 } } : {}),
      });
      if (!resp?.ok) throw new Error(resp?.error ?? 'ai_analyze_failed');
      if (aiMode === 'agent' && resp?.status === 'waiting') {
        const nextSessionId = typeof resp.sessionId === 'string' ? resp.sessionId : aiSessionId;
        setAiSessionId(nextSessionId);
        setAiSessionLogId(currentIssueLogId);
        setAiUserAction(typeof resp.userAction === 'string' ? resp.userAction : '');
        setAiReproState('waiting');
      } else if (aiMode === 'agent') {
        setAiSessionId('');
        setAiSessionLogId('');
        setAiUserAction('');
        setAiBaseline(undefined);
        setAiReproState('idle');
      }

      setAiResult({
        status: typeof resp.status === 'string' ? resp.status : undefined,
        cause: typeof resp.cause === 'string' ? resp.cause : '',
        suggestion: Array.isArray(resp.suggestion)
          ? resp.suggestion
          : typeof resp.suggestion === 'string'
            ? [resp.suggestion]
            : [],
        evidence: Array.isArray(resp.evidence) ? resp.evidence : [],
        actionsTaken: Array.isArray(resp.actionsTaken) ? resp.actionsTaken : [],
      });
    } catch (e) {
      setAiError(formatAiErrorMessage(e));
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * 在页面侧设置断点并提示用户复现操作，让报错点在 DevTools 中可调试。
   */
  const onArmBreakpoint = async log => {
    if (locked) return;
    setUiError(undefined);
    setUiNotice(undefined);
    if (!tabId) return setUiError('未找到当前激活标签页');
    const primary = pickPrimaryFrame(log?.frames) ?? log?.location;
    if (!primary?.url || typeof primary?.line !== 'number') return setUiError('该条日志缺少 url/line，无法设置断点');
    setBusy(true);
    try {
      const result = await sendRuntimeMessage({
        type: 'AGENT_BREAKPOINT_ARM',
        tabId,
        url: primary.url,
        line: primary.line,
        column: typeof primary.column === 'number' ? primary.column : 0,
      });
      if (!result?.ok) throw new Error(result?.error ?? 'arm_breakpoint_failed');
      setUiNotice('已设置断点：请在页面重现同类操作；');
    } catch (e) {
      setUiError(e instanceof Error ? e.message : 'arm_breakpoint_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('App', 'bg-slate-50 text-slate-900')}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-left">
          <div className="text-sm font-semibold">Agent Console Recorder</div>
          <div className="text-xs text-slate-500">
            Tab: {tabId ?? '-'} · {recording ? 'Recording' : 'Stopped'}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className={cn(
              'rounded px-2 py-1 text-xs font-medium',
              recording ? 'bg-slate-200 text-slate-600' : 'bg-pink-200 text-slate-900',
            )}
            onClick={onStart}
            disabled={busy || recording}
            type="button">
            Start
          </button>
          <button
            className={cn(
              'rounded px-2 py-1 text-xs font-medium',
              recording ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600',
            )}
            onClick={onStop}
            disabled={busy || !recording}
            type="button">
            Stop
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white"
          onClick={() => refresh(tabId)}
          disabled={busy || locked || !tabId}
          type="button">
          Refresh
        </button>
        <button
          className="rounded bg-pink-200 px-2 py-1 text-xs font-medium text-slate-900"
          onClick={onCopy}
          disabled={busy || locked || logs.length === 0}
          type="button">
          Copy
        </button>
        <button
          className="rounded bg-slate-200 px-2 py-1 text-xs font-medium text-slate-900"
          onClick={onClear}
          disabled={busy || locked || logs.length === 0}
          type="button">
          Clear
        </button>
        <div className="ml-auto text-xs text-slate-500">
          Logs: {logs.length} · Snapshots: {snapshots.length}
        </div>
      </div>

      {locked ? (
        <div className="mt-2 rounded bg-slate-100 px-2 py-1 text-left text-xs text-slate-700">
          录制中：除 Stop 外已锁定所有操作
        </div>
      ) : null}

      {uiError ? (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-left text-xs text-red-700">{uiError}</div>
      ) : null}
      {uiNotice ? (
        <div className="mt-2 rounded bg-indigo-50 px-2 py-1 text-left text-xs text-indigo-700">{uiNotice}</div>
      ) : null}

      <LogList
        logs={logs}
        selectedLogId={selectedLogId}
        busy={busy}
        locked={locked}
        onSelectLog={log => {
          setSelectedLogId(log.id);
          void onAnalyze(log);
        }}
        onArmBreakpoint={log => {
          setSelectedLogId(log.id);
          void onArmBreakpoint(log);
        }}
      />

      <AnalysisPanel
        selectedLog={selectedLog}
        analysis={analysis}
        qwenKey={qwenKey}
        onChangeKey={v => {
          setQwenKey(v);
          try {
            chrome.storage?.local?.set?.({ [STORAGE_QWEN_KEY]: v });
          } catch {
            void 0;
          }
        }}
        aiMode={aiMode}
        setAiMode={setAiMode}
        aiBusy={aiBusy}
        aiDisabled={aiDisabled}
        onAiAnalyze={onAiAnalyze}
        aiSessionId={aiSessionId}
        aiUserAction={aiUserAction}
        aiReproState={aiReproState}
        recording={recording}
        busy={busy}
        onAgentStartWait={async () => {
          setAiReproState('waiting');
          setAiBaseline({ logsLen: logs.length, snapshotsLen: snapshots.length });
          await onStart();
        }}
        aiError={aiError}
        aiResult={aiResult}
      />
    </div>
  );
};
export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
