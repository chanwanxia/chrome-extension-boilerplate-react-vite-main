import 'highlight.js/styles/github.css';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import { cn } from '@extension/ui/react';
import { useMemo } from 'react';

hljs.registerLanguage('javascript', javascript);

/**
 * 数值夹取到 [min, max]。
 */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * 最小可用的 HTML 转义（避免引入额外依赖/兼容差异）。
 */
const escapeHtml = input =>
  String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 粗略判断 token 的边界字符：用于在错误列附近选取一个“更像变量/属性/函数名”的片段。
 */
const isStopChar = ch => /[\s()[\]{};,.]/.test(String(ch ?? ''));

/**
 * 根据列号选择一个可读的局部范围（优先命中标识符/属性名等）。
 */
const pickErrorRange = (lineText, column) => {
  const s = String(lineText ?? '');
  const col = clamp(Number(column) || 0, 0, Math.max(0, s.length));
  if (!s) return { start: 0, end: 0 };

  let start = col;
  while (start > 0 && !isStopChar(s[start - 1])) start -= 1;

  let end = col;
  while (end < s.length && !isStopChar(s[end])) end += 1;
  if (end <= start) end = Math.min(s.length, start + 1);

  return { start, end };
};

/**
 * 仅对“错误行”做局部标红：把错误列附近 token 包进 span，避免整行都难以阅读。
 */
const renderErrorLineHtml = (lineText, column) => {
  const s = String(lineText ?? '');
  const { start, end } = pickErrorRange(s, column);
  const before = escapeHtml(s.slice(0, start));
  const mid = escapeHtml(s.slice(start, end));
  const after = escapeHtml(s.slice(end));
  return `${before}<span class="analysis-token--error">${mid || '&nbsp;'}</span>${after}`;
};

/**
 * 带行号的代码片段展示组件：
 * - 使用 highlight.js 做 JS 语法高亮
 * - 支持把指定 (line, column) 标成错误行并渲染 caret
 */
const CodeSnippet = ({ text, highlight }) => {
  const { htmlLines, rawLines } = useMemo(() => {
    const src = String(text ?? '');
    const raw = src.split('\n');

    try {
      const html = hljs.highlight(src, { language: 'javascript', ignoreIllegals: true }).value;
      return { htmlLines: html.split('\n'), rawLines: raw };
    } catch {
      return { htmlLines: raw.map(l => escapeHtml(l)), rawLines: raw };
    }
  }, [text]);

  return (
    <div className="analysis-pre mt-1">
      {rawLines.map((lineText, idx) => {
        const lineNo = idx + 1;
        const prefix = `${String(lineNo).padStart(4, ' ')}| `;
        const isErr = Boolean(highlight && highlight.line === lineNo);
        const caretCol = isErr && highlight ? prefix.length + Math.max(0, highlight.column) : undefined;
        const html =
          isErr && typeof highlight?.column === 'number'
            ? renderErrorLineHtml(lineText, highlight.column)
            : (htmlLines[idx] ?? escapeHtml(lineText));

        return (
          <div key={String(lineNo)}>
            <div className={cn('analysis-line', isErr && 'analysis-line--error')}>
              <span>{prefix}</span>
              <span className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
            {typeof caretCol === 'number' ? (
              <div className={cn('analysis-line--caret')}>{`${' '.repeat(Math.min(240, caretCol))}^`}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default CodeSnippet;
