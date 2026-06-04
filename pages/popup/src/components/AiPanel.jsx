/**
 * AI 分析面板：管理 key 输入、模式选择、触发分析、展示结果/等待提示。
 * @param {{
 *   qwenKey: string,
 *   onChangeKey: (next: string) => void,
 *   aiMode: 'single' | 'agent',
 *   setAiMode: (mode: 'single' | 'agent') => void,
 *   aiBusy: boolean,
 *   aiDisabled: boolean,
 *   onAiAnalyze: () => Promise<void>,
 *   analysisHasDistText: boolean,
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
const AiPanel = ({
  qwenKey,
  onChangeKey,
  aiMode,
  setAiMode,
  aiBusy,
  aiDisabled,
  onAiAnalyze,
  analysisHasDistText,
  aiSessionId,
  aiUserAction,
  aiReproState,
  recording,
  busy,
  onAgentStartWait,
  aiError,
  aiResult,
}) => (
    <div className="mt-2 text-left">
      <div className="text-xs font-semibold">AI 分析</div>
      <div className="mt-1 grid gap-2">
        <div className="grid gap-1">
          <div className="text-[12px] text-slate-700">Qwen Key</div>
          <input
            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-900"
            value={qwenKey}
            onChange={e => onChangeKey(e.target.value)}
            placeholder="请输入可用的Qwen Key"
            type="textarea"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-[11px] text-slate-700">
            <input checked={aiMode === 'single'} onChange={() => setAiMode('single')} type="radio" name="ai-mode" />
            单次诊断
          </label>
          <label className="flex items-center gap-1 text-[11px] text-slate-700">
            <input checked={aiMode === 'agent'} onChange={() => setAiMode('agent')} type="radio" name="ai-mode" />
            闭环智能体
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white"
            onClick={onAiAnalyze}
            disabled={aiDisabled}
            type="button">
            {aiBusy ? '分析中...' : aiMode === 'agent' ? '智能体分析' : 'AI 诊断'}
          </button>
          <div className="text-[11px] text-slate-500">
            {analysisHasDistText ? '基于 dist 片段 + 错误日志' : '未找到 dist 片段，将仅基于错误日志'}
          </div>
        </div>

        {aiMode === 'agent' && aiSessionId ? (
          <div className="grid gap-2 rounded bg-amber-50 px-2 py-2 text-left text-xs text-amber-800">
            {aiUserAction ? <div className="whitespace-pre-wrap break-words">{aiUserAction}</div> : null}
            <div className="grid gap-2">
              <div className="text-[11px] text-amber-900">
                操作：点击下方按钮开始录制，然后切回页面复现一次；检测到同类错误后会自动继续分析。
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white"
                  onClick={onAgentStartWait}
                  disabled={busy || recording}
                  type="button">
                  开始录制并等待复现
                </button>
              </div>
              <div className="text-[11px] text-amber-900">
                {aiReproState === 'continuing'
                  ? '已检测到复现，正在自动继续分析...'
                  : recording
                    ? '录制中：请切回页面复现一次操作。'
                    : '未开始录制：请先点击“开始录制并等待复现”。'}
              </div>
            </div>
          </div>
        ) : null}

        {aiError ? (
          <div className="whitespace-pre-wrap break-words rounded bg-red-50 px-2 py-1 text-left text-xs text-red-700">
            {aiError}
          </div>
        ) : null}

        {aiResult ? (
          <div className="grid gap-2">
            <div>
              <div className="text-[12px] font-semibold text-slate-900">错误原因</div>
              <pre className="analysis-pre analysis-pre--wrap mt-1">{aiResult.cause || '-'}</pre>
            </div>
            <div>
              <div className="text-[12px] font-semibold text-slate-900">修改建议</div>
              <pre className="analysis-pre analysis-pre--wrap mt-1">
                {Array.isArray(aiResult.suggestion) && aiResult.suggestion.length
                  ? aiResult.suggestion.join('\n')
                  : '-'}
              </pre>
            </div>
            {aiMode === 'agent' ? (
              <>
                <div>
                  <div className="text-[12px] font-semibold text-slate-900">已执行动作</div>
                  <pre className="analysis-pre analysis-pre--wrap mt-1">
                    {Array.isArray(aiResult.actionsTaken) && aiResult.actionsTaken.length
                      ? aiResult.actionsTaken.join('\n')
                      : '-'}
                  </pre>
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-slate-900">证据</div>
                  <pre className="analysis-pre analysis-pre--wrap mt-1">
                    {Array.isArray(aiResult.evidence) && aiResult.evidence.length ? aiResult.evidence.join('\n') : '-'}
                  </pre>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

export default AiPanel;
