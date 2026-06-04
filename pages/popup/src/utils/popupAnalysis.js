import { extractDistContext } from '@src/utils/distSnippet';

/**
 * 本地时间格式化（iso -> HH:mm:ss）。
 * @param {string | undefined | null} iso
 * @returns {string}
 */
export const formatLocalTime = iso => {
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
 * @param {any[] | undefined | null} frames
 * @returns {any | undefined}
 */
export const pickPrimaryFrame = frames => {
  if (!Array.isArray(frames)) return undefined;
  const valid = frames.filter(f => f && typeof f === 'object' && typeof f.url === 'string' && f.url);
  return (
    valid.find(f => /^https?:\/\//.test(f.url)) ??
    valid.find(f => /^file:\/\//.test(f.url)) ??
    valid.find(f => !f.url.startsWith('extensions::') && !f.url.startsWith('chrome-extension://')) ??
    valid.find(f => f.url.startsWith('chrome-extension://')) ??
    frames[0]
  );
};

/**
 * 对日志 message 做粗分类，用于给出更贴近场景的排查建议。
 * @param {any} log
 * @returns {string}
 */
export const classifyErrorType = log => {
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
 * @param {string | undefined | null} message
 * @returns {{url?: string, status?: number, statusText?: string, netError?: string} | undefined}
 */
export const parseResourceLoadError = message => {
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
 * @param {string | undefined | null} message
 * @param {string | undefined | null} errorType
 * @returns {string}
 */
export const guessCause = (message, errorType) => {
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
 * 获取“当前问题”的主定位（url+line），用于做强相关过滤。
 * @param {any} selectedLog
 * @param {any} analysis
 * @returns {{url: string, line: number} | undefined}
 */
export const getIssuePrimaryLocation = (selectedLog, analysis) => {
  const primary =
    (analysis?.primaryFrame && typeof analysis.primaryFrame === 'object' ? analysis.primaryFrame : undefined) ??
    pickPrimaryFrame(selectedLog?.frames) ??
    selectedLog?.location;
  const url = typeof primary?.url === 'string' ? primary.url : undefined;
  const line = typeof primary?.line === 'number' ? primary.line : undefined;
  return url && typeof line === 'number' ? { url, line } : undefined;
};

/**
 * 判断某条日志是否与“当前问题”强相关（按 url/line 近邻）。
 * @param {any} log
 * @param {any} selectedLog
 * @param {any} analysis
 * @returns {boolean}
 */
export const isIssueRelatedLog = (log, selectedLog, analysis) => {
  const target = getIssuePrimaryLocation(selectedLog, analysis);
  if (!target) return false;
  const primary = pickPrimaryFrame(log?.frames) ?? log?.location;
  const url = typeof primary?.url === 'string' ? primary.url : undefined;
  const line = typeof primary?.line === 'number' ? primary.line : undefined;
  if (!url || typeof line !== 'number') return false;
  return url === target.url && Math.abs(line - target.line) <= 2;
};

/**
 * 判断某条 Debugger.paused 快照是否与“当前问题”强相关（按 url/line 近邻）。
 * @param {any} snapshot
 * @param {any} selectedLog
 * @param {any} analysis
 * @returns {boolean}
 */
export const isIssueRelatedSnapshot = (snapshot, selectedLog, analysis) => {
  const target = getIssuePrimaryLocation(selectedLog, analysis);
  if (!target) return false;
  const frames = Array.isArray(snapshot?.frames) ? snapshot.frames : [];
  return frames.some(f => {
    const url = typeof f?.url === 'string' ? f.url : undefined;
    const line = typeof f?.line === 'number' ? f.line : undefined;
    if (!url || typeof line !== 'number') return false;
    return url === target.url && Math.abs(line - target.line) <= 2;
  });
};

/**
 * 单条日志分析：
 * - 提取主堆栈帧并拉取对应 dist 代码
 * - 用 AST + Prettier 定位/格式化函数片段，必要时回退到上下文窗口
 * @param {any} log
 * @returns {Promise<any>}
 */
export const analyzeLog = async log => {
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
  const column = typeof primary.column === 'number' ? primary.column : undefined;
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
