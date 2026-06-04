import CodeSnippet from '@src/components/CodeSnippet';
import { formatConsoleLikeError } from '@src/utils/distSnippet';
import AiPanel from '@src/components/AiPanel';

/**
 * 分析区：展示错误日志、dist 分析结果，并包含 AI 分析区。
 * @param {{
 *   selectedLog: any,
 *   analysis: any,
 *   qwenKey: string,
 *   onChangeKey: (next: string) => void,
 *   aiMode: 'single' | 'agent',
 *   setAiMode: (mode: 'single' | 'agent') => void,
 *   aiBusy: boolean,
 *   aiDisabled: boolean,
 *   onAiAnalyze: () => Promise<void>,
 *   aiSessionId: string,
 *   aiUserAction: string,
 *   aiReproState: 'idle' | 'waiting' | 'continuing',
 *   recording: boolean,
 *   busy: boolean,
 *   onAgentStartWait: () => Promise<void>,
 *   aiError: string | undefined,
 *   aiResult: any,
 * }} props
 * @returns {import('react').JSX.Element}
 */
const AnalysisPanel = ({
  selectedLog,
  analysis,
  qwenKey,
  onChangeKey,
  aiMode,
  setAiMode,
  aiBusy,
  aiDisabled,
  onAiAnalyze,
  aiSessionId,
  aiUserAction,
  aiReproState,
  recording,
  busy,
  onAgentStartWait,
  aiError,
  aiResult,
}) => {
  if (!analysis) {
    return (
      <div className="analysis-container mt-2">
        {selectedLog ? (
          <div className="rounded bg-white p-2 text-left text-xs text-slate-500">
            点击一条日志自动进行 dist 片段定位；或点击 断点调试，在页面重现后调试错误。
          </div>
        ) : (
          <div className="rounded bg-white p-2 text-left text-xs text-slate-500">点击一条日志查看分析结果。</div>
        )}
      </div>
    );
  }

  const analysisHasDistText = Boolean(analysis?.generated?.context?.text);

  return (
    <div className="analysis-container mt-2">
      <div className="rounded bg-white p-2 text-left">
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
            {analysis.resource.url ? <div className="mt-1 break-all">资源 URL：{analysis.resource.url}</div> : null}
            {typeof analysis.resource.status === 'number' ? (
              <div className="mt-1">
                状态码：{analysis.resource.status}
                {analysis.resource.statusText ? ` (${analysis.resource.statusText})` : ''}
              </div>
            ) : null}
            {analysis.resource.netError ? <div className="mt-1">网络错误：{analysis.resource.netError}</div> : null}
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

        {analysisHasDistText ? (
          <>
            <div className="mt-2 text-xs font-semibold">dist 片段</div>
            {analysis.generated.context.kind === 'function' ? (
              <CodeSnippet text={analysis.generated.context.text} highlight={analysis.generated.context.highlight} />
            ) : (
              <pre className="analysis-pre mt-1">{analysis.generated.context.text}</pre>
            )}
          </>
        ) : null}

        <AiPanel
          qwenKey={qwenKey}
          onChangeKey={onChangeKey}
          aiMode={aiMode}
          setAiMode={setAiMode}
          aiBusy={aiBusy}
          aiDisabled={aiDisabled}
          onAiAnalyze={onAiAnalyze}
          analysisHasDistText={analysisHasDistText}
          aiSessionId={aiSessionId}
          aiUserAction={aiUserAction}
          aiReproState={aiReproState}
          recording={recording}
          busy={busy}
          onAgentStartWait={onAgentStartWait}
          aiError={aiError}
          aiResult={aiResult}
        />
      </div>
    </div>
  );
};

export default AnalysisPanel;
