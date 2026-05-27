import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared/react';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui/react';

import { useEffect, useMemo, useRef, useState } from 'react';
import CodeSnippet from '@src/components/CodeSnippet';
import { extractDistContext, formatConsoleLikeError } from '@src/utils/distSnippet';

/**
 * 向 background 发送消息并统一兜底 runtime.lastError。
 */
const sendMessage = message =>
  new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      const err = chrome.runtime?.lastError;
      if (err) resolve({ ok: false, error: err.message });
      else resolve(response);
    });
  });

/**
 * 获取当前窗口激活标签页 id。
 */
const getActiveTabId = () =>
  new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs && tabs[0] && typeof tabs[0].id === 'number' ? tabs[0].id : undefined;
      resolve(tabId);
    });
  });

/**
 * 本地时间格式化（iso -> HH:mm:ss）。
 */
const formatLocalTime = iso => {
  const ts = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return new Date(ts).toTimeString().slice(0, 8);
  }
};

/**
 * 从堆栈帧列表里挑一个最可能属于当前扩展/业务代码的帧，用于定位 dist 产物位置。
 */
const pickPrimaryFrame = frames => {
  if (!Array.isArray(frames)) return undefined;
  return (
    frames.find(f => typeof f?.url === 'string' && f.url.startsWith('chrome-extension://')) ??
    frames.find(f => typeof f?.url === 'string' && !f.url.startsWith('extensions::')) ??
    frames[0]
  );
};

/**
 * 对日志 message 做粗分类，用于给出更贴近场景的排查建议。
 */
const classifyErrorType = log => {
  const kind = String(log?.kind ?? '');
  const text = String(log?.message ?? '');
  if (/\bSyntaxError\b/.test(text)) return '语法错误';
  if (/\[AGENT_HOOK\]\s*unhandledrejection/i.test(text) || /\bunhandledrejection\b/i.test(text)) return 'Promise错误';
  if (/\bFailed to load resource\b/i.test(text) || /\bresource=/.test(text)) return '资源加载错误';
  if (/\bFailed to fetch\b/i.test(text) || /\bNetworkError\b/i.test(text) || /\bnet::ERR\b/.test(text))
    return '网络请求错误';
  if (kind === 'exception') return 'JS执行错误';
  if (/\bTypeError\b|\bReferenceError\b|\bRangeError\b|\bURIError\b|\bEvalError\b/.test(text)) return 'JS执行错误';
  return 'JS执行错误';
};

/**
 * 从 “Failed to load resource ...” 的 message 中提取资源 URL 与状态码（如有）。
 */
const parseResourceLoadError = message => {
  const text = String(message ?? '');
  if (!/\bFailed to load resource\b/i.test(text) && !/\bresource=/.test(text)) return undefined;

  const statusMatch = text.match(/status of\s+(\d+)\s*\(([^)]*)\)/i);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const statusText = statusMatch && statusMatch[2] ? String(statusMatch[2]).trim() : undefined;

  const netErrMatch = text.match(/\b(net::ERR[^\s]+)\b/i);
  const netError = netErrMatch ? String(netErrMatch[1]) : undefined;

  const urlMatch = text.match(/\bhttps?:\/\/[^\s)]+/i);
  const url = urlMatch ? String(urlMatch[0]) : undefined;

  if (!url && typeof status !== 'number' && !netError) return undefined;
  return { url, status, statusText, netError };
};

/**
 * 根据 message + errorType 给出较短的“原因分析”提示文案。
 */
const guessCause = (message, errorType) => {
  const text = String(message ?? '');
  const type = String(errorType ?? '');

  if (type === 'Promise错误') {
    return 'Promise/异步错误：重点检查 async/await 调用链、catch 是否缺失、以及接口失败分支是否被吞掉（尤其是 then/catch 中解构/读属性）';
  }
  if (type === '资源加载错误') {
    return '资源加载失败：检查静态资源路径、部署路径前缀（base/publicPath）、以及服务端是否返回 404/403；也可能是跨域/证书导致加载被阻止';
  }
  if (type === '网络请求错误') {
    return '网络请求失败：检查请求 URL、跨域/CORS、代理配置、证书、DNS/断网；若是接口 4xx/5xx，优先看 Network 面板响应体与后端日志';
  }
  if (type === '语法错误') {
    return '语法/解析异常：可能是构建产物损坏、返回内容不是 JS/JSON（例如接口返回 HTML）、或某段代码被错误注入导致解析失败';
  }

  const destructure = text.match(/Cannot destructure property '([^']+)' of '(?:([^']+))' as it is (undefined|null)/);
  if (destructure) {
    const prop = destructure[1];
    const base = destructure[2];
    return base
      ? `解构赋值失败：对象 "${base}" 为 undefined/null，无法解构属性 "${prop}"（常见于接口字段缺失/异步未就绪/参数为 undefined）`
      : `解构赋值失败：对象为 undefined/null，无法解构属性 "${prop}"（常见于接口字段缺失/异步未就绪/参数为 undefined）`;
  }

  const cannotRead = text.match(/Cannot read (?:properties|property) of (undefined|null)(?: \(reading '([^']+)'\))?/);
  if (cannotRead) {
    const base = cannotRead[1];
    const prop = cannotRead[2];
    return prop ? `某个对象为 ${base}，读取属性 "${prop}" 时抛错` : `某个对象为 ${base}，访问属性/方法时抛错`;
  }
  if (/is not a function/.test(text)) return '某个值并非函数却被调用，可能是导入错误/变量被覆盖/类型不符合预期';
  if (/<path> attribute d: Expected number/.test(text))
    return 'SVG path 的 d 属性出现非法数值（NaN/Infinity），通常是参与计算的坐标为 undefined/NaN（检查绘制/布局计算链路）';
  if (/404 \(Not Found\)/.test(text) || /\b404\b/.test(text))
    return '资源或接口返回 404：可能是路由/静态资源路径错误、服务未部署对应资源、或前端拼接 URL 错误';
  if (/net::ERR/.test(text)) return '网络错误：请求被阻止/断网/DNS/证书/跨域等导致资源加载失败';
  if (/Failed to fetch/.test(text)) return '网络请求失败，可能是跨域/URL 拼错/请求被拦截/离线';
  if (/Unexpected token/.test(text)) return '解析异常（JSON/JS 语法），可能是返回内容不是预期格式或构建产物损坏';
  if (/ResizeObserver loop limit exceeded/.test(text))
    return '页面布局频繁变更导致 ResizeObserver 循环，通常与渲染/样式抖动有关';
  return '通用运行时异常：优先查看第一条业务堆栈帧对应的变量/入参（可配合 断点调试 错误）';
};

/**
 * 单条日志分析：
 * - 提取主堆栈帧并拉取对应 dist 代码
 * - 用 AST + Prettier 定位/格式化函数片段，必要时回退到上下文窗口
 */
const analyzeLog = async log => {
  const primary = pickPrimaryFrame(log?.frames) ?? log?.location;
  const occurredAt = typeof log?.occurredAt === 'string' ? log.occurredAt : undefined;
  const message = log?.message;
  const errorType = classifyErrorType(log);
  const resource = errorType === '资源加载错误' ? parseResourceLoadError(message) : undefined;

  const analysis = {
    occurredAt,
    message,
    errorType,
    resource,
    primaryFrame: primary,
    generated: undefined,
    cause: guessCause(message, errorType),
  };

  if (!primary?.url || typeof primary?.line !== 'number') {
    return analysis;
  }

  const url = primary.url;
  const line = primary.line;
  const column = typeof primary.column === 'number' ? primary.column : 0;
  const functionName = typeof primary.functionName === 'string' ? primary.functionName : undefined;

  const generatedRes = await fetch(url);
  if (!generatedRes.ok) {
    return analysis;
  }
  const generatedCode = await generatedRes.text();
  analysis.generated = {
    url,
    line,
    column,
    context: await extractDistContext(generatedCode, line, column, functionName),
  };

  return analysis;
};

/**
 * Popup 主界面：日志列表 + dist 分析 + 断点调试入口。
 */
const Popup = () => {
  const [tabId, setTabId] = useState();
  const [recording, setRecording] = useState(false);
  const [logs, setLogs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedLogId, setSelectedLogId] = useState();
  const [analysis, setAnalysis] = useState();
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState();
  const [uiNotice, setUiNotice] = useState();
  const logsRef = useRef([]);
  const analyzeTokenRef = useRef(0);

  const selectedLog = useMemo(() => logs.find(l => l.id === selectedLogId), [logs, selectedLogId]);
  const locked = recording;

  /**
   * 同步 popup 展示数据：录制状态、日志列表、快照列表。
   */
  const refresh = async activeTabId => {
    if (!activeTabId) return;
    const status = await sendMessage({ type: 'AGENT_RECORDER_STATUS', tabId: activeTabId });
    if (status?.ok) setRecording(Boolean(status.recording));

    const result = await sendMessage({ type: 'AGENT_LOGS_GET', tabId: activeTabId });
    if (result?.ok && Array.isArray(result.items)) {
      logsRef.current = result.items;
      setLogs(result.items);
    }

    const snapshotsResult = await sendMessage({ type: 'AGENT_SNAPSHOTS_GET', tabId: activeTabId });
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
      if (msg.tabId !== tabId) return;
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
  }, [tabId]);

  /**
   * 开始录制（注入/开启前端采集）。
   */
  const onStart = async () => {
    setUiError(undefined);
    setUiNotice(undefined);
    if (!tabId) return setUiError('未找到当前激活标签页');
    setBusy(true);
    try {
      const result = await sendMessage({ type: 'AGENT_RECORDER_START', tabId });
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
      const result = await sendMessage({ type: 'AGENT_RECORDER_STOP', tabId });
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
      const result = await sendMessage({ type: 'AGENT_LOGS_CLEAR', tabId });
      if (!result?.ok) throw new Error(result?.error ?? 'clear_failed');
      setLogs([]);
      logsRef.current = [];
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
      const result = await sendMessage({
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

      <div className="log-container mt-2">
        {logs.length === 0 ? (
          <div className="p-2 text-left text-xs text-slate-500">
            暂无日志。点击 Start 后，在当前页面触发 console.error 或异常。
          </div>
        ) : (
          logs.map(item => {
            const isSelected = item.id === selectedLogId;
            const messageText = String(item.message ?? '');
            const primary = pickPrimaryFrame(item?.frames) ?? item?.location;
            const loc = item.location;
            const locText =
              loc && typeof loc.url === 'string'
                ? `${loc.url.split('/').slice(-1)[0]}:${loc.line ?? '-'}:${loc.column ?? '-'}`
                : '';
            const level = item.level ?? item.kind ?? 'log';
            const canArmBreakpoint = Boolean(primary?.url && typeof primary?.line === 'number');
            return (
              <div
                key={item.id}
                className={cn('log-item', isSelected && 'log-item--selected')}
                onClick={() => {
                  if (busy || locked) return;
                  setSelectedLogId(item.id);
                  void onAnalyze(item);
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  if (busy || locked) return;
                  setSelectedLogId(item.id);
                  void onAnalyze(item);
                }}
                role="button"
                tabIndex={0}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('log-badge', level === 'error' ? 'log-badge--error' : 'log-badge--info')}>
                        {String(level)}
                      </span>
                      <span className="truncate text-xs font-medium">{messageText}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="shrink-0">{formatLocalTime(item.occurredAt) || '-'}</span>
                      <span className="truncate">{locText}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {canArmBreakpoint ? (
                      <button
                        className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white"
                        onClick={e => {
                          e.stopPropagation();
                          if (busy || locked) return;
                          setSelectedLogId(item.id);
                          void onArmBreakpoint(item);
                        }}
                        disabled={busy || locked}
                        type="button">
                        断点调试
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="analysis-container mt-2">
        {!analysis ? (
          selectedLog ? (
            <div className="rounded bg-white p-2 text-left text-xs text-slate-500">
              点击一条日志自动进行 dist 片段定位；或点击 断点调试，在页面重现后调试错误。
            </div>
          ) : (
            <div className="rounded bg-white p-2 text-left text-xs text-slate-500">点击一条日志查看分析结果。</div>
          )
        ) : (
          <div className="rounded bg-white p-2 text-left">
            {analysis ? (
              <>
                {selectedLog ? (
                  <>
                    <div className="text-xs font-semibold">错误日志</div>
                    <pre className="analysis-pre mt-1" style={{ maxHeight: '146px' }}>
                      {formatConsoleLikeError(selectedLog)}
                    </pre>
                  </>
                ) : null}

                <div className="mt-2 text-xs font-semibold">dist 分析</div>
                <div className="mt-1 text-[12px] text-slate-700">错误类型：{analysis.errorType}</div>
                {analysis.errorType === '资源加载错误' && analysis.resource ? (
                  <div className="text-[12px] text-slate-700">
                    {analysis.resource.url ? (
                      <div className="mt-1 break-all">资源 URL：{analysis.resource.url}</div>
                    ) : null}
                    {typeof analysis.resource.status === 'number' ? (
                      <div className="mt-1">
                        状态码：{analysis.resource.status}
                        {analysis.resource.statusText ? ` (${analysis.resource.statusText})` : ''}
                      </div>
                    ) : null}
                    {analysis.resource.netError ? (
                      <div className="mt-1">网络错误：{analysis.resource.netError}</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-1 text-[12px] text-slate-700">原因分析：{analysis.cause}</div>
                {analysis.generated?.url ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-700">
                    <span className="break-all">
                      产物位置：{analysis.generated.url}:{analysis.generated.line}:{analysis.generated.column ?? 0}
                    </span>
                  </div>
                ) : null}

                {analysis.generated?.context?.text ? (
                  <>
                    <div className="mt-2 text-xs font-semibold">dist 片段</div>
                    {analysis.generated.context.kind === 'function' ? (
                      <CodeSnippet
                        text={analysis.generated.context.text}
                        highlight={analysis.generated.context.highlight}
                      />
                    ) : (
                      <pre className="analysis-pre mt-1">{analysis.generated.context.text}</pre>
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
