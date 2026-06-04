import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import prettier from 'prettier/standalone';
import prettierPluginBabel from 'prettier/plugins/babel';
import prettierPluginEstree from 'prettier/plugins/estree';

/**
 * 把一条堆栈帧格式化成类似浏览器 console 的 `at ... (...)` 形式。
 */
const formatStackFrame = frame => {
  if (!frame || typeof frame !== 'object') return '';
  const url = typeof frame.url === 'string' ? frame.url : '';
  const line = typeof frame.line === 'number' ? frame.line : undefined;
  const column = typeof frame.column === 'number' ? frame.column : undefined;
  const func = typeof frame.functionName === 'string' && frame.functionName.trim() ? frame.functionName.trim() : '';
  const loc = url ? `${url}:${line ?? '-'}:${typeof column === 'number' ? column : '-'}` : '';
  if (!loc) return '';
  return func ? `    at ${func} (${loc})` : `    at ${loc}`;
};

/**
 * 把采集到的日志结构拼成一段更便于阅读的 error 文本（message + stack frames）。
 */
export const formatConsoleLikeError = log => {
  const message = String(log?.message ?? '').trim();
  const frames = Array.isArray(log?.frames) ? log.frames : [];
  const stackLines = frames.map(formatStackFrame).filter(Boolean);
  return [message || '[error]', ...stackLines].join('\n');
};

const HIGHLIGHT_MARKER = '/*__AGENT_HIGHLIGHT__*/';
/**
 * 判断字符是否属于 JS 标识符（用于避免 marker 插入到单词内部破坏语法）。
 */
const isWordChar = ch => typeof ch === 'string' && /[A-Za-z0-9_$]/.test(ch);

/**
 * 在接近目标位置插入一个 marker，方便 Prettier 之后定位 highlight 行列。
 * 注意：尽量避免把 marker 插在标识符中间导致语法破坏。
 */
const insertHighlightMarker = (src, preferredIndex) => {
  if (typeof preferredIndex !== 'number' || !Number.isFinite(preferredIndex)) return { text: src, inserted: false };
  const target = Math.max(0, Math.min(src.length, preferredIndex));

  const isSafeAt = pos => {
    const left = pos > 0 ? src[pos - 1] : '';
    const right = pos < src.length ? src[pos] : '';
    if (isWordChar(left) && isWordChar(right)) return false;
    return true;
  };

  const candidates = [0];
  for (let d = 1; d <= 80; d += 1) candidates.push(d, -d);

  for (const delta of candidates) {
    const pos = target + delta;
    if (pos < 0 || pos > src.length) continue;
    if (!isSafeAt(pos)) continue;
    const text = `${src.slice(0, pos)} ${HIGHLIGHT_MARKER} ${src.slice(pos)}`;
    return { text, inserted: true };
  }

  return { text: src, inserted: false };
};

/**
 * 去掉 IIFE 包裹：`(() => { ... })();` -> `...`。
 */
const stripIifeWrapper = formatted => {
  const lines = String(formatted ?? '').split('\n');
  const start = lines.findIndex(l => l.trim() === '(() => {');
  const end = lines.findIndex(l => l.trim() === '})();');
  if (start < 0 || end < 0 || end <= start) return String(formatted ?? '');
  const body = lines.slice(start + 1, end);
  const deindented = body.map(l => (l.startsWith('  ') ? l.slice(2) : l));
  return deindented.join('\n');
};

/**
 * 去掉 `const __agent__ = (...)` 包裹，仅返回右侧表达式。
 */
const stripConstAssignmentWrapper = formatted => {
  const lines = String(formatted ?? '').split('\n');
  const start = lines.findIndex(l => l.includes('const __agent__ ='));
  if (start < 0) return String(formatted ?? '');

  const joined = lines.slice(start).join('\n');
  const eq = joined.indexOf('=');
  if (eq < 0) return String(formatted ?? '');
  let body = joined.slice(eq + 1).trim();
  if (body.startsWith('(') && body.endsWith(');')) body = body.slice(1, -2).trim();
  else if (body.endsWith(';')) body = body.slice(0, -1).trim();
  return body;
};

/**
 * 从包含 marker 的文本中计算 marker 的行列，并移除 marker。
 */
const extractHighlightFromMarkedText = textWithMarker => {
  const s = String(textWithMarker ?? '');
  const idx = s.indexOf(HIGHLIGHT_MARKER);
  if (idx < 0) return { text: s, highlight: undefined };

  const before = s.slice(0, idx);
  const line = before.split('\n').length;
  const lastNl = before.lastIndexOf('\n');
  const column = idx - (lastNl >= 0 ? lastNl + 1 : 0);
  const text = before + s.slice(idx + HIGHLIGHT_MARKER.length);
  return { text, highlight: { line, column } };
};

/**
 * 使用 Prettier 对片段格式化，并尽量保留 highlight 的行列信息。
 * 片段可能不是完整的 Program，所以会做一些轻量包裹以提升可解析性。
 */
const formatWithPrettier = async (raw, highlightIndex) => {
  const src = String(raw ?? '');
  const { text: marked } = insertHighlightMarker(src, highlightIndex);
  const trimmed = marked.trim();

  let wrapped = marked;
  let unwrap = s => s;

  const isFnOrClass = /^(async\s+function\b|function\b|class\b)/.test(trimmed);
  const isBlock = trimmed.startsWith('{');
  const isSimpleDeclarator = /^[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(trimmed);
  const endsWithSemicolon = /;\s*$/.test(trimmed);
  const isStatementLike =
    /^(const|let|var|if|for|while|switch|try|return|throw|do|break|continue|debugger|import|export)\b/.test(trimmed);

  if (isFnOrClass) {
    wrapped = marked;
    unwrap = s => s;
  } else if (isBlock) {
    wrapped = `function __agent__() ${marked}`;
    unwrap = s => s.replace(/^function __agent__\(\)\s*/, '');
  } else if (isSimpleDeclarator) {
    wrapped = `const ${marked};`;
    unwrap = s => s;
  } else if (isStatementLike || endsWithSemicolon) {
    wrapped = `(() => {\n${marked}\n})();`;
    unwrap = stripIifeWrapper;
  } else {
    wrapped = `const __agent__ = (${marked});`;
    unwrap = stripConstAssignmentWrapper;
  }

  const format = async input =>
    prettier.format(input, {
      parser: 'babel',
      plugins: [prettierPluginBabel, prettierPluginEstree],
      printWidth: 100,
      semi: true,
      singleQuote: true,
      trailingComma: 'all',
    });

  let formatted;
  try {
    formatted = await format(wrapped);
  } catch {
    const fallbackWrapped = `(() => {\n${marked}\n})();`;
    try {
      formatted = await format(fallbackWrapped);
      unwrap = stripIifeWrapper;
    } catch (e2) {
      console.error('格式化备用代码失败', e2); // 增加处理逻辑，规则放行
      throw e2;
    }
  }

  const unwrapped = unwrap(formatted).trimEnd();
  return extractHighlightFromMarkedText(unwrapped);
};

/**
 * 将过长的格式化片段按“头部 + highlight 附近 + 尾部”截断，避免一次渲染过多内容。
 */
const truncateFormattedSnippet = (text, highlight, maxLines = 2000) => {
  const lines = String(text ?? '').split('\n');
  const total = lines.length;
  if (total <= maxLines) return { text: String(text ?? ''), highlight };

  const headCount = 60;
  const tailCount = 60;
  const midCount = Math.max(240, maxLines - headCount - tailCount - 2);

  const hlLine =
    typeof highlight?.line === 'number' && highlight.line >= 1
      ? highlight.line
      : Math.max(1, Math.min(total, Math.floor(total / 2)));
  let midStart = Math.max(0, hlLine - 1 - Math.floor(midCount / 2));
  const midEnd = Math.min(total, midStart + midCount);
  if (midEnd - midStart < midCount) midStart = Math.max(0, midEnd - midCount);

  const headEnd = Math.min(headCount, total);
  const tailStart = Math.max(0, total - tailCount);

  const parts = [];
  const addRange = (from, to) => {
    for (let i = from; i < to; i += 1) parts.push({ lineIndex: i, text: lines[i] ?? '' });
  };

  addRange(0, headEnd);
  parts.push({ lineIndex: -1, text: '…' });

  const midFrom = Math.max(midStart, headEnd);
  const midTo = Math.min(midEnd, tailStart);
  addRange(midFrom, midTo);
  parts.push({ lineIndex: -1, text: '…' });

  addRange(tailStart, total);

  const outLines = parts.map(p => p.text);

  let newHighlight;
  if (highlight && typeof highlight.line === 'number') {
    const hlIdx = highlight.line - 1;
    const newLineIndex = parts.findIndex(p => p.lineIndex === hlIdx);
    if (newLineIndex >= 0) newHighlight = { line: newLineIndex + 1, column: highlight.column ?? 0 };
  }

  return { text: outLines.join('\n'), highlight: newHighlight };
};

/**
 * 数值夹取到 [min, max]。
 */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * 将字符偏移量转换为 (line, column)（均从 1/0 开始，和现有 highlight 结构保持一致）。
 */
const offsetToLineColumn = (src, offset) => {
  const capped = clamp(Number(offset) || 0, 0, src.length);
  let line = 1;
  let column = 0;
  for (let i = 0; i < capped; i += 1) {
    if (src[i] === '\n') {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
};

/**
 * 判断 (line, column) 是否落在某个 loc 区间内。
 */
const isLocWithin = (loc, range) => {
  const afterStart = loc.line > range.start.line || (loc.line === range.start.line && loc.column >= range.start.column);
  const beforeEnd = loc.line < range.end.line || (loc.line === range.end.line && loc.column <= range.end.column);
  return afterStart && beforeEnd;
};

/**
 * Babel traverse path 是否为“函数/方法”节点。
 */
const isFunctionLikePath = path =>
  path.isFunctionDeclaration() ||
  path.isFunctionExpression() ||
  path.isArrowFunctionExpression() ||
  path.isObjectMethod() ||
  path.isClassMethod() ||
  path.isClassPrivateMethod();

/**
 * 从函数节点挑选“更适合展示”的根节点：
 * - 尽量只展示包含报错点的函数表达式/赋值/对象属性本身
 * - 避免把整段超长的变量声明/表达式语句全部带出来
 */
const pickSnippetRootPath = functionPath => {
  if (functionPath.isFunctionDeclaration()) return functionPath;

  const pp = functionPath.parentPath;
  if (pp?.isVariableDeclarator()) return pp;

  if (pp?.isAssignmentExpression()) return pp;

  if (pp?.isObjectProperty()) return pp;

  const stmt = functionPath.findParent(p => p.isStatement());
  return stmt ?? functionPath;
};

/**
 * 用 @babel/parser 解析一个“窗口片段”（非完整文件也可容错）。
 */
const parseWindow = windowText =>
  parse(windowText, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    ranges: true,
    plugins: [
      'jsx',
      'typescript',
      'classProperties',
      'classPrivateProperties',
      'classPrivateMethods',
      'decorators-legacy',
      'dynamicImport',
      'importAssertions',
      'topLevelAwait',
      'optionalChaining',
      'nullishCoalescingOperator',
      'objectRestSpread',
    ],
  });

/**
 * 在窗口片段中查找“包含 offset 的最小函数/方法片段”范围。
 */
const findEnclosingSnippetRange = (windowText, offsetInWindow) => {
  const loc = offsetToLineColumn(windowText, offsetInWindow);
  const ast = parseWindow(windowText);

  let best;
  traverse(ast, {
    enter(path) {
      if (!isFunctionLikePath(path)) return;
      const node = path.node;
      if (!node?.loc) return;
      if (!isLocWithin(loc, node.loc)) return;

      const root = pickSnippetRootPath(path);
      const rootNode = root.node;
      if (!rootNode || typeof rootNode.start !== 'number' || typeof rootNode.end !== 'number') return;
      if (rootNode.end <= rootNode.start) return;

      const size = rootNode.end - rootNode.start;
      if (!best || size < best.size) {
        best = { start: rootNode.start, end: rootNode.end, size };
      }
    },
  });

  return best;
};

/**
 * 尝试从 dist 产物中定位“包含报错位置的函数/方法”并输出格式化后的片段。
 * 找不到函数时返回 undefined，外层可回退到“行上下文”或“列窗口”。
 */
const extractEnclosingFunctionContext = async (code, line, column, _functionName) => {
  void _functionName;
  const src = String(code ?? '');
  const lineNo = Number(line) || 1;
  const colNo = Math.max(0, Number(column) || 0);
  if (!Number.isFinite(lineNo) || lineNo <= 0) return undefined;

  let offset = 0;
  let currentLine = 1;
  while (currentLine < lineNo && offset < src.length) {
    const nl = src.indexOf('\n', offset);
    if (nl < 0) return undefined;
    offset = nl + 1;
    currentLine += 1;
  }
  const absOffset = clamp(offset + colNo, 0, src.length);

  const radii = [120_000, 300_000, 800_000];
  let windowText = '';
  let offsetInWindow = 0;
  let range;
  for (const windowRadius of radii) {
    const windowStart = Math.max(0, absOffset - windowRadius);
    const windowEnd = Math.min(src.length, absOffset + windowRadius);
    windowText = src.slice(windowStart, windowEnd);
    offsetInWindow = absOffset - windowStart;
    try {
      range = findEnclosingSnippetRange(windowText, offsetInWindow);
    } catch {
      range = undefined;
    }
    if (range) break;
  }
  if (!range) return undefined;

  const raw0 = windowText.slice(range.start, range.end);
  const highlightIndex0 = clamp(offsetInWindow - range.start, 0, Math.max(0, raw0.length - 1));
  const raw = raw0;
  const highlightIndex = highlightIndex0;

  try {
    const formatted = await formatWithPrettier(raw, highlightIndex);
    const truncated = truncateFormattedSnippet(formatted.text, formatted.highlight, 2000);
    return { kind: 'function', text: truncated.text, highlight: truncated.highlight };
  } catch {
    const loc = offsetToLineColumn(raw, highlightIndex);
    const truncated = truncateFormattedSnippet(raw, loc, 2000);
    return { kind: 'function', text: truncated.text, highlight: truncated.highlight };
  }
};

const extractContext = (code, line, radius = 10) => {
  const lines = String(code ?? '').split(/\r?\n/);
  const total = lines.length;
  const center = Math.max(1, Math.min(total, Number(line) || 1));
  const start = Math.max(1, center - radius);
  const end = Math.min(total, center + radius);

  const snippet = [];
  for (let i = start; i <= end; i += 1) {
    const marker = i === center ? '>' : ' ';
    const label = String(i).padStart(5, ' ');
    snippet.push(`${marker}${label} | ${lines[i - 1] ?? ''}`);
  }

  return {
    start,
    end,
    center,
    text: snippet.join('\n'),
  };
};

/**
 * 从多行文本中抽取“中间附近”少量行做预览（用于 column window 的换行预览）。
 */
const previewLinesAroundCenter = (text, radius = 5) => {
  const lines = String(text ?? '').split('\n');
  if (lines.length <= radius * 2 + 1) {
    return lines.map((l, idx) => `${String(idx + 1).padStart(4, ' ')}| ${l}`).join('\n');
  }

  const center = Math.floor(lines.length / 2);
  const start = Math.max(0, center - radius);
  const end = Math.min(lines.length, center + radius + 1);
  const body = lines.slice(start, end).map((l, idx) => `${String(start + idx + 1).padStart(4, ' ')}| ${l}`);

  const head = start > 0 ? ['   …'] : [];
  const tail = end < lines.length ? ['   …'] : [];
  return [...head, ...body, ...tail].join('\n');
};

/**
 * 对单行超长文本按固定宽度换行，避免 popup 渲染性能问题。
 */
const wrapText = (text, width = 120) => {
  const s = String(text ?? '');
  const w = Math.max(20, Number(width) || 120);
  const out = [];
  for (let i = 0; i < s.length; i += w) {
    out.push(s.slice(i, i + w));
  }
  return out.join('\n');
};

/**
 * 针对“压缩产物一行超长文本”的场景：只截取 column 附近窗口并做等宽换行，避免 UI 卡死。
 */
const extractColumnWindow = (code, line, column, radius = 1800) => {
  const lines = String(code ?? '').split(/\r?\n/);
  const total = lines.length;
  const centerLine = Math.max(1, Math.min(total, Number(line) || 1));
  const lineText = lines[centerLine - 1] ?? '';
  const col = Math.max(0, Number(column) || 0);
  const start = Math.max(0, col - radius);
  const end = Math.min(lineText.length, col + radius);

  const text = lineText.slice(start, end);
  const wrapped = wrapText(text, 120);
  const preview = previewLinesAroundCenter(wrapped, 6);
  return {
    line: centerLine,
    column: col,
    startColumn: start,
    endColumn: end,
    text:
      `line=${centerLine}, column=${col}, window=[${start}, ${end})\n` +
      preview +
      `\n\n(提示：压缩产物通常是一行超长文本，这里展示 column 附近片段以便提取特征与人工确认)`,
  };
};

/**
 * dist 片段生成入口：优先尝试 AST 定位并格式化函数片段；失败时回退为行上下文/列窗口。
 */
export const extractDistContext = async (generatedCode, line, column, functionName) => {
  const code = String(generatedCode ?? '');
  const hasNewlines = code.includes('\n');
  const col = typeof column === 'number' && Number.isFinite(column) ? column : undefined;
  const shouldTryFunctionContext = col !== undefined && col > 0;

  if (shouldTryFunctionContext) {
    const funcContext = await extractEnclosingFunctionContext(code, line, col, functionName);
    if (funcContext) return funcContext;
  }

  if (!hasNewlines) return { kind: 'around', text: extractColumnWindow(code, line, col ?? 0, 1800).text };
  return { kind: 'around', text: extractContext(code, line, 10).text };
};
