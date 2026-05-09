import { randomUUID } from 'node:crypto';
import * as http from 'node:http';

import { isCreateErrorEventRequest } from '@extension/protocol';

const events = [];
const tasks = [];

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

const readJsonBody = async (req, maxBytes = 1_000_000) => {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' });
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  return JSON.parse(text);
};

const sendJson = (res, response) => {
  const payload = JSON.stringify(response.body);
  res.writeHead(response.status, {
    ...corsHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const notFound = () => ({ status: 404, body: { error: 'not_found' } });

const badRequest = message => ({
  status: 400,
  body: { error: 'bad_request', message },
});

const nowIso = () => new Date().toISOString();

const handleCreateEvent = body => {
  if (!isCreateErrorEventRequest(body)) return badRequest('invalid_event_payload');

  const req = body;
  const id = typeof req.id === 'string' ? req.id : randomUUID();

  const event = {
    id,
    occurredAt: req.occurredAt,
    severity: req.severity,
    message: req.message,
    name: req.name,
    stack: req.stack,
    frames: req.frames,
    runtime: req.runtime,
    source: req.source,
    pageUrl: req.pageUrl,
    userAgent: req.userAgent,
    tags: req.tags,
    extra: req.extra,
  };

  events.unshift(event);
  if (events.length > 500) events.length = 500;

  return { status: 200, body: { id } };
};

const handleCreateTask = body => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badRequest('invalid_task_payload');
  const req = body;
  if (typeof req.kind !== 'string') return badRequest('invalid_task_kind');
  if (typeof req.input !== 'object' || req.input === null || Array.isArray(req.input))
    return badRequest('invalid_task_input');

  const createdAt = nowIso();
  const id = randomUUID();
  const task = {
    id,
    kind: req.kind,
    status: 'running',
    createdAt,
    updatedAt: createdAt,
    input: req.input,
  };

  if (task.kind === 'analyze-error') {
    const eventId = typeof req.input.eventId === 'string' ? req.input.eventId : undefined;
    const event = eventId ? events.find(e => e.id === eventId) : undefined;
    task.output = {
      summary: event ? `${event.name ?? 'Error'}: ${event.message}` : 'No event found for eventId',
      nextSteps: [
        'Capture console/network logs',
        'Collect user reproduction steps',
        'Sample affected users & environment',
      ],
      candidateQueries: event?.pageUrl
        ? [`Open page ${event.pageUrl}`, 'Search recent deploys']
        : ['Search recent deploys'],
    };
    task.status = 'succeeded';
    task.updatedAt = nowIso();
  } else {
    task.status = 'queued';
    task.updatedAt = nowIso();
  }

  tasks.unshift(task);
  if (tasks.length > 500) tasks.length = 500;

  return { status: 200, body: { id } };
};

const router = async req => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') {
    return { status: 200, body: { ok: true, time: nowIso() } };
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50;
    const sliced = Number.isFinite(limit) ? events.slice(0, limit) : events.slice(0, 50);
    return { status: 200, body: { items: sliced } };
  }

  if (method === 'GET' && url.pathname === '/api/tasks') {
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50;
    const sliced = Number.isFinite(limit) ? tasks.slice(0, limit) : tasks.slice(0, 50);
    return { status: 200, body: { items: sliced } };
  }

  if (method === 'POST' && url.pathname === '/api/events') {
    try {
      const body = await readJsonBody(req);
      return handleCreateEvent(body);
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'payload_too_large') {
        return { status: 413, body: { error: 'payload_too_large' } };
      }
      return badRequest('invalid_json');
    }
  }

  if (method === 'POST' && url.pathname === '/api/tasks') {
    try {
      const body = await readJsonBody(req);
      return handleCreateTask(body);
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'payload_too_large') {
        return { status: 413, body: { error: 'payload_too_large' } };
      }
      return badRequest('invalid_json');
    }
  }

  return notFound();
};

const port = Number(process.env.PORT ?? 8787);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const response = await router(req);
  sendJson(res, response);
});

server.listen(port, () => {
  process.stdout.write(`agent-server listening on http://localhost:${port}\n`);
});
