/**
 * 尝试从一段文本中提取 JSON（优先找 ```json ... ``` 代码块；否则兜底寻找第一个 { ... }）。
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
 * 安全解析 JSON：解析失败返回 null。
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

/**
 * 构建用于大模型诊断的 messages（OpenAI compatible chat.completions）。
 */
function buildMessages({ error, distText, meta }) {
  const err = error && typeof error === 'object' ? error : {};
  const m = meta && typeof meta === 'object' ? meta : {};

  const occurredAt = typeof err.occurredAt === 'string' ? err.occurredAt : undefined;
  const message = typeof err.message === 'string' ? err.message : '';
  const stack = typeof err.stack === 'string' ? err.stack : '';
  const errorType = typeof m.errorType === 'string' ? m.errorType : '';
  const guessedCause = typeof m.guessedCause === 'string' ? m.guessedCause : '';
  const primaryFrame =
    m.primaryFrame && typeof m.primaryFrame === 'object'
      ? {
          url: typeof m.primaryFrame.url === 'string' ? m.primaryFrame.url : undefined,
          line: typeof m.primaryFrame.line === 'number' ? m.primaryFrame.line : undefined,
          column: typeof m.primaryFrame.column === 'number' ? m.primaryFrame.column : undefined,
          functionName: typeof m.primaryFrame.functionName === 'string' ? m.primaryFrame.functionName : undefined,
        }
      : undefined;

  const contextText = String(distText ?? '');
  const trimmedContext =
    contextText.length > 12000 ? `${contextText.slice(0, 12000)}\n/* ...truncated */` : contextText;

  const system = [
    '你是一个前端工程师助手，擅长定位 JavaScript 运行时错误并给出可操作的修复建议。',
    '请基于错误信息、堆栈与 dist 片段综合判断，不要编造不存在的代码。',
    '输出必须是严格 JSON（不要 Markdown），格式如下：',
    '{"cause":"...","suggestion":"..."}',
    '其中 cause：清晰描述错误根源，可使用\n换行, suggestion 分点给出可直接落地的修改建议（包含可能的代码改动点/检查点），每一条用\n换行，条理清晰。',
  ].join('\n');

  const user = [
    `发生时间：${occurredAt ?? '-'}`,
    errorType ? `错误类型：${errorType}` : '',
    guessedCause ? `已有粗略原因：${guessedCause}` : '',
    primaryFrame && primaryFrame.url
      ? `定位：${primaryFrame.url}:${primaryFrame.line ?? '-'}:${primaryFrame.column ?? 0}${
          primaryFrame.functionName ? ` (${primaryFrame.functionName})` : ''
        }`
      : '',
    '',
    '错误 message：',
    message || '-',
    '',
    '错误 stack：',
    stack || '-',
    '',
    'dist 片段（可能已格式化/截取）：',
    trimmedContext || '-',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 调用 Qwen（DashScope OpenAI Compatible）并返回模型原始文本。
 */
async function callQwenChat({ apiKey, messages }) {
  const key = String(apiKey ?? '').trim();
  if (!key) throw new Error('missing_apiKey');

  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-plus',
      temperature: 0.2,
      messages,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    const hint = text && text.length > 300 ? `${text.slice(0, 300)}...` : text;
    throw new Error(`qwen_http_${res.status}${hint ? `: ${hint}` : ''}`);
  }

  const data = safeJsonParse(text);
  const content = data?.choices?.[0]?.message?.content; // todo:
  if (typeof content !== 'string' || !content.trim()) throw new Error('qwen_empty_response');
  return content;
}

/**
 * 使用 Qwen 自动分析错误原因与修复建议。
 */
export async function analyzeErrorWithQwen({ apiKey, error, distText, meta }) {
  const messages = buildMessages({ error, distText, meta });
  const content = await callQwenChat({ apiKey, messages });

  const candidate = extractJsonCandidate(content);
  const parsed = candidate ? safeJsonParse(candidate) : null;

  const cause = typeof parsed?.cause === 'string' ? parsed.cause.trim() : '';
  const suggestion = typeof parsed?.suggestion === 'string' ? parsed.suggestion.trim() : '';

  if (cause || suggestion) {
    return {
      cause: cause || '（模型未返回 cause 字段）',
      suggestion: suggestion || '（模型未返回 suggestion 字段）',
      raw: content,
    };
  }

  return { cause: '（解析失败）', suggestion: content.trim(), raw: content };
}
