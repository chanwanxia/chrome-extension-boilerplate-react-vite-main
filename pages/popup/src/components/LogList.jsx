import { cn } from '@extension/ui/react';
import { formatLocalTime, pickPrimaryFrame } from '@src/utils/popupAnalysis';

/**
 * 日志列表：展示采集到的 logs，并支持选中/触发断点调试。
 * @param {{
 *   logs: any[],
 *   selectedLogId: string | undefined,
 *   busy: boolean,
 *   locked: boolean,
 *   onSelectLog: (log: any) => void,
 *   onArmBreakpoint: (log: any) => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
const LogList = ({ logs, selectedLogId, busy, locked, onSelectLog, onArmBreakpoint }) => (
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
                onSelectLog(item);
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (busy || locked) return;
                onSelectLog(item);
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
                        onArmBreakpoint(item);
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
  );

export default LogList;
