import { analyzeErrorWithQwen } from '../../services/aiService.js';
import { getLogs, getSnapshots, nowMs } from '../../services/errorService.js';
import { getStatus, startRecording } from './debugger.js';

/**
 * AI 自动诊断：调用 Qwen 输出错误原因与修复建议。
 * @param {{apiKey: string, error: any, distText: string, meta: any}} input
 * @returns {Promise<any>}
 */
export async function aiAnalyze({ apiKey, error, distText, meta }) {
  const result = await analyzeErrorWithQwen({ apiKey, error, distText, meta });
  return { ok: true, ...result };
}

/**
 * 安全解析 JSON：解析失败返回 null。
 * @param {string} text
 * @returns {any | null}
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

/**
 * 尝试从一段文本中提取 JSON（优先找 ```json ... ``` 代码块；否则兜底寻找第一个 { ... }）。
 * @param {string} text
 * @returns {string | null}
 */
function extractJsonCandidate(text) {
  const src = String(text ?? '');
  const fenced = src.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start >= 0 && end > start) return src.slice(start, end + 1).trim();
  return null;
}

/**
 * 调用 Qwen（DashScope OpenAI Compatible chat.completions），返回解析后的 JSON 响应体。
 * @param {{apiKey: string, messages: any[], tools?: any[]}} input
 * @returns {Promise<any>}
 */
async function callQwenChatCompletion({ apiKey, messages, tools }) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new Error('missing_apiKey');

  const body = {
    model: 'qwen-plus',
    temperature: 0.2,
    messages,
    ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: 'auto' } : {}),
  };

  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const hint = text && text.length > 300 ? `${text.slice(0, 300)}...` : text;
    throw new Error(`qwen_http_${res.status}${hint ? `: ${hint}` : ''}`);
  }

  const data = safeJsonParse(text);
  if (!data || typeof data !== 'object') throw new Error('qwen_invalid_json');
  return data;
}

/**
 * 构建闭环 Agent 的 tool 列表，以及执行 tool 的函数。
 * 约束：严格单次问题分析，不允许直接拉取“全量 logs/snapshots”。
 * @param {{tabId: number, issue: any}} input
 * @returns {{tools: any[], invoke: (name: string, args: any) => Promise<any>}}
 */
function createAgentTools({ tabId, issue }) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'get_status',
        description: '获取当前 Tab 的录制/调试状态（recording/debuggerAttached）。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_selected_log',
        description: '读取“当前要分析的那一条日志”（严格单次问题）。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_related_logs',
        description: '获取与当前问题强相关的日志（按 url/line 过滤；不会返回全量日志）。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回最新 N 条（默认 20，上限 50）。' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_related_snapshots',
        description: '获取与当前问题强相关的 Debugger.paused 快照（按 url/line 过滤；不会返回全量快照）。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回最新 N 条（默认 5，上限 10）。' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'start_recording',
        description: '开启录制（Runtime/Log/Network + 页面 hooks）。需要用户在页面重现操作才能产生新证据。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
  ];

  /**
   * 从日志中提取一个“主定位”（url/line），用于判定“强相关”。
   * @param {any} log
   * @returns {{url: string, line: number} | undefined}
   */
  const getPrimaryLocationFromLog = log => {
    const loc = log?.location && typeof log.location === 'object' ? log.location : undefined;
    if (loc && typeof loc.url === 'string' && typeof loc.line === 'number') return { url: loc.url, line: loc.line };
    const frame = Array.isArray(log?.frames) ? log.frames[0] : undefined;
    if (frame && typeof frame.url === 'string' && typeof frame.line === 'number')
      return { url: frame.url, line: frame.line };
    return undefined;
  };

  /**
   * 判断日志是否与 issue.primary 强相关（url 相同且行号邻近）。
   * @param {any} log
   * @returns {boolean}
   */
  const isRelatedLog = log => {
    const target = issue?.primary;
    if (!target?.url || typeof target.line !== 'number') return false;
    const loc = getPrimaryLocationFromLog(log);
    if (!loc || loc.url !== target.url) return false;
    return typeof loc.line === 'number' && Math.abs(loc.line - target.line) <= 2;
  };

  /**
   * 判断快照是否与 issue.primary 强相关（url 相同且行号邻近）。
   * @param {any} snapshot
   * @returns {boolean}
   */
  const isRelatedSnapshot = snapshot => {
    const target = issue?.primary;
    if (!target?.url || typeof target.line !== 'number') return false;
    const frames = Array.isArray(snapshot?.frames) ? snapshot.frames : [];
    for (const f of frames) {
      if (!f || typeof f !== 'object') continue;
      if (typeof f.url !== 'string' || typeof f.line !== 'number') continue;
      if (f.url !== target.url) continue;
      if (Math.abs(f.line - target.line) <= 2) return true;
    }
    return false;
  };

  /**
   * 执行 tool（由 background 实现）。
   * @param {string} name
   * @param {any} args
   * @returns {Promise<any>}
   */
  const invoke = async (name, args) => {
    if (name === 'get_status') return getStatus(tabId);
    if (name === 'get_selected_log') return { ok: true, item: issue?.selectedLog ?? null };
    if (name === 'get_related_logs') {
      const limit = Math.max(1, Math.min(50, Number(args?.limit) || 20));
      const items = await getLogs(tabId);
      const related = Array.isArray(items) ? items.filter(isRelatedLog) : [];
      return { ok: true, items: related.slice(0, limit) };
    }
    if (name === 'get_related_snapshots') {
      const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5));
      const items = await getSnapshots(tabId);
      const related = Array.isArray(items) ? items.filter(isRelatedSnapshot) : [];
      return { ok: true, items: related.slice(0, limit) };
    }
    if (name === 'start_recording') return startRecording(tabId);
    return { ok: false, error: 'unknown_tool' };
  };

  return { tools, invoke };
}

/**
 * 将 OpenAI compatible 的 tool_calls 标准化为数组。
 * @param {any} message
 * @returns {any[]}
 */
function getToolCallsFromAssistantMessage(message) {
  const toolCalls = message?.tool_calls;
  return Array.isArray(toolCalls) ? toolCalls : [];
}

const agentSessions = new Map();
const AGENT_SESSION_TTL_MS = 15 * 60 * 1000;
const AGENT_SESSION_MAX = 20;

/**
 * 清理过期的 agent session（避免内存增长）。
 * @returns {void}
 */
function cleanupAgentSessions() {
  const now = nowMs();
  for (const [id, session] of agentSessions.entries()) {
    const createdAt = typeof session?.createdAtMs === 'number' ? session.createdAtMs : 0;
    if (!createdAt || now - createdAt > AGENT_SESSION_TTL_MS) agentSessions.delete(id);
  }
  if (agentSessions.size <= AGENT_SESSION_MAX) return;
  const entries = [...agentSessions.entries()].sort((a, b) => (a[1].createdAtMs ?? 0) - (b[1].createdAtMs ?? 0));
  for (const [id] of entries.slice(0, Math.max(0, entries.length - AGENT_SESSION_MAX))) {
    agentSessions.delete(id);
  }
}

/**
 * 生成“单次问题”的 issue 上下文：仅包含 selectedLog + 关联定位信息（不会携带全量 logs）。
 * @param {{tabId: number, selectedLogId: string}} input
 * @returns {Promise<any>}
 */
async function buildIssueContext({ tabId, selectedLogId }) {
  const logs = await getLogs(tabId);
  const selectedLog = Array.isArray(logs)
    ? logs.find(l => l && typeof l === 'object' && l.id === selectedLogId)
    : undefined;

  const primaryFromLog = (() => {
    const loc = selectedLog?.location && typeof selectedLog.location === 'object' ? selectedLog.location : undefined;
    if (loc && typeof loc.url === 'string' && typeof loc.line === 'number') return { url: loc.url, line: loc.line };
    const frame = Array.isArray(selectedLog?.frames) ? selectedLog.frames[0] : undefined;
    if (frame && typeof frame.url === 'string' && typeof frame.line === 'number')
      return { url: frame.url, line: frame.line };
    return undefined;
  })();

  return { selectedLog: selectedLog ?? null, primary: primaryFromLog };
}

/**
 * 运行闭环 Agent：
 * - Plan：模型在 messages 中产生下一步行动（tool calls）
 * - Act：background 执行 CDP/采集工具
 * - Observe：把工具输出回注入到对话
 * - Re-plan：继续下一轮，直至输出最终 JSON
 * @param {{
 *   apiKey: string,
 *   tabId: number,
 *   sessionId?: string,
 *   selectedLogId?: string,
 *   objective?: string,
 *   error: any,
 *   distText: string,
 *   meta: any,
 *   maxSteps?: number,
 * }} input
 * @returns {Promise<any>}
 */
async function runAiAgentLoop({ apiKey, tabId, sessionId, selectedLogId, objective, error, distText, meta, maxSteps }) {
  cleanupAgentSessions();

  const max = Math.max(1, Math.min(10, Number(maxSteps) || 6));
  const existingSession =
    sessionId && typeof sessionId === 'string' && agentSessions.has(sessionId) ? agentSessions.get(sessionId) : null;

  const resolvedSelectedLogId =
    (existingSession && typeof existingSession.selectedLogId === 'string' ? existingSession.selectedLogId : '') ||
    (typeof selectedLogId === 'string' ? selectedLogId : '');
  if (!resolvedSelectedLogId) throw new Error('missing_selectedLogId');

  const issue = await buildIssueContext({ tabId, selectedLogId: resolvedSelectedLogId });
  const { tools, invoke } = createAgentTools({ tabId, issue });

  const status = await getStatus(tabId);
  const relatedSnapshots = await (async () => {
    const items = await getSnapshots(tabId);
    if (!Array.isArray(items)) return [];
    const target = issue?.primary;
    if (!target?.url || typeof target.line !== 'number') return [];
    return items
      .filter(s => {
        const frames = Array.isArray(s?.frames) ? s.frames : [];
        return frames.some(
          f => f?.url === target.url && typeof f?.line === 'number' && Math.abs(f.line - target.line) <= 2,
        );
      })
      .slice(0, 5);
  })();

  const system = [
    '你是一个“闭环”的前端调试智能体（Plan → Act(tool) → Observe → Re-plan）。',
    '严格只分析“选中的那一条问题”（不要基于同 tab 的其它错误做推断）。',
    '输出要言简意赅：不要长篇大论，不要重复同一句话。',
    '当需要用户在页面重现/点击/刷新等配合操作时，输出 waiting 状态并给出清晰的操作指令。',
    '输出必须是严格 JSON（不要 Markdown），格式如下：',
    '{"status":"final|waiting","cause":"一句话根因","suggestion":["最多4条可执行建议"],"evidence":["最多5条证据"],"userAction":"当 status=waiting 时给用户的操作指令"}',
    '约束：cause <= 120 字；suggestion 每条 <= 80 字；evidence 每条 <= 120 字；不要输出多余字段。',
  ].join('\n');

  const baseUser = [
    objective ? `目标：${objective}` : '目标：对选中的单次问题给出根因与建议（必要时闭环采证）。',
    '',
    '选中日志（selectedLog）：',
    JSON.stringify(issue?.selectedLog ?? null, null, 2),
    '',
    '输入错误信息（来自 UI 归一化，不代表全量日志）：',
    JSON.stringify(error ?? {}, null, 2),
    '',
    'meta：',
    JSON.stringify(meta ?? {}, null, 2),
    '',
    'dist 片段（可能已格式化/截取）：',
    String(distText ?? '').slice(0, 12000) || '-',
    '',
    '当前观测（仅与该问题相关）：',
    JSON.stringify({ status, relatedSnapshots }, null, 2),
  ].join('\n');

  const messages = existingSession?.messages
    ? existingSession.messages
    : [
        { role: 'system', content: system },
        { role: 'user', content: baseUser },
      ];

  const actionsTaken = Array.isArray(existingSession?.actionsTaken) ? existingSession.actionsTaken : [];

  if (existingSession?.messages) {
    messages.push({
      role: 'user',
      content: '用户已按提示在页面完成操作，请继续分析。优先调用 get_related_logs/get_related_snapshots 获取新增证据。',
    });
  }

  for (let step = 0; step < max; step += 1) {
    const data = await callQwenChatCompletion({ apiKey, messages, tools });
    const assistant = data?.choices?.[0]?.message;

    if (!assistant || typeof assistant !== 'object') throw new Error('qwen_invalid_response');

    messages.push({
      role: 'assistant',
      content: typeof assistant.content === 'string' ? assistant.content : '',
      tool_calls: Array.isArray(assistant.tool_calls) ? assistant.tool_calls : undefined,
    });

    const toolCalls = getToolCallsFromAssistantMessage(assistant);
    if (!toolCalls.length) {
      const content = typeof assistant.content === 'string' ? assistant.content : '';
      const candidate = extractJsonCandidate(content);
      const parsed = candidate ? safeJsonParse(candidate) : null;

      if (parsed && typeof parsed === 'object') {
        const statusText = typeof parsed.status === 'string' ? parsed.status.trim() : '';
        const cause = typeof parsed.cause === 'string' ? parsed.cause.trim() : '';
        const suggestion = Array.isArray(parsed.suggestion) ? parsed.suggestion.filter(v => typeof v === 'string') : [];
        const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.filter(v => typeof v === 'string') : [];
        const userAction = typeof parsed.userAction === 'string' ? parsed.userAction.trim() : '';

        if (statusText === 'waiting') {
          const id = existingSession?.id ?? crypto.randomUUID();
          agentSessions.set(id, {
            id,
            createdAtMs: existingSession?.createdAtMs ?? nowMs(),
            tabId,
            selectedLogId: resolvedSelectedLogId,
            messages,
            actionsTaken,
          });
          return {
            ok: true,
            status: 'waiting',
            sessionId: id,
            userAction: userAction || '请在页面重现该问题后，点击“继续智能体分析”。',
            cause,
            suggestion,
            evidence,
            actionsTaken,
          };
        }

        if (statusText === 'final' && (cause || suggestion.length)) {
          if (existingSession?.id) agentSessions.delete(existingSession.id);
          return { ok: true, status: 'final', cause, suggestion, evidence, actionsTaken, raw: content };
        }
      }

      if (existingSession?.id) agentSessions.delete(existingSession.id);
      return {
        ok: true,
        status: 'final',
        cause: '（解析失败）',
        suggestion: [content.trim()].filter(Boolean),
        evidence: [],
        actionsTaken,
        raw: content,
      };
    }

    for (const call of toolCalls) {
      const toolCallId = typeof call?.id === 'string' ? call.id : crypto.randomUUID();
      const toolName = call?.function?.name;
      const toolArgsText = call?.function?.arguments;
      const toolArgs = typeof toolArgsText === 'string' ? safeJsonParse(toolArgsText) : null;

      let result;
      try {
        if (typeof toolName !== 'string' || !toolName) throw new Error('invalid_tool_name');
        result = await invoke(toolName, toolArgs && typeof toolArgs === 'object' ? toolArgs : {});
        actionsTaken.push(`${toolName}(${toolArgsText ?? '{}'})`);

        if (toolName === 'start_recording') {
          const id = existingSession?.id ?? crypto.randomUUID();
          agentSessions.set(id, {
            id,
            createdAtMs: existingSession?.createdAtMs ?? nowMs(),
            tabId,
            selectedLogId: resolvedSelectedLogId,
            messages,
            actionsTaken,
          });

          const instruction =
            '我已开启录制。请切回页面执行一次能稳定触发该报错的操作；检测到同类错误后插件会自动停止录制并继续分析。';

          return {
            ok: true,
            status: 'waiting',
            sessionId: id,
            userAction: instruction,
            cause: '',
            suggestion: [],
            evidence: [],
            actionsTaken,
          };
        }
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : 'tool_error' };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify(result ?? null),
      });
    }
  }

  if (existingSession?.id) agentSessions.delete(existingSession.id);
  return {
    ok: true,
    status: 'final',
    cause: '（达到最大迭代次数，未得到结论）',
    suggestion: ['请点击“继续智能体分析”，或让模型先调用 get_related_logs/get_related_snapshots 再给结论。'],
    evidence: [],
    actionsTaken,
    raw: '',
  };
}

/**
 * AI 闭环调试：基于工具调用（CDP/日志/快照）迭代得到最终结论。
 * @param {{apiKey: string, tabId: number, sessionId?: string, selectedLogId?: string, objective?: string, error: any, distText: string, meta: any, options?: any}} input
 * @returns {Promise<any>}
 */
export async function aiAgentLoop({
  apiKey,
  tabId,
  sessionId,
  selectedLogId,
  objective,
  error,
  distText,
  meta,
  options,
}) {
  const maxSteps = options && typeof options === 'object' ? options.maxSteps : undefined;
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) throw new Error('invalid_tabId');
  return runAiAgentLoop({ apiKey, tabId, sessionId, selectedLogId, objective, error, distText, meta, maxSteps });
}
