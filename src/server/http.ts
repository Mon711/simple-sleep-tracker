import { z } from 'zod';
import {
  createGoalSchema, entryInputSchema, pauseGoalSchema, quickSchema, rangeSchema, updateGoalSchema,
} from '../shared/schemas.ts';
import type { Today } from '../shared/schemas.ts';
import { localNight } from '../shared/time.ts';
import { safeError, TrackerError } from './errors.ts';
import { handleMcp } from './mcp.ts';
import { Store } from './store.ts';
import type { Database } from './store.ts';
import { Tracker } from './tracker.ts';

export type Asset = { body: BodyInit; contentType: string };
export type Runtime = {
  db: Database;
  mode: Today['mode'];
  identity: (request: Request, channel: 'browser' | 'mcp') => string | null;
  asset: (path: string) => Asset | undefined;
  clock?: () => number;
};

const maxBody = 16_384;
const security = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function send(body: BodyInit | null, status = 200, headers: HeadersInit = {}) {
  const all = new Headers({ ...security, 'Cache-Control': 'private, no-store' });
  new Headers(headers).forEach((value, name) => all.set(name, value));
  return new Response(body, { status, headers: all });
}

function json(data: unknown, status = 200) {
  return send(JSON.stringify(data), status, { 'Content-Type': 'application/json; charset=utf-8' });
}

export function isSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin
    && request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function readJson(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new TrackerError(415, 'Send the request as JSON.');
  }
  if (Number(request.headers.get('content-length')) > maxBody) {
    throw new TrackerError(413, 'That request is too large.');
  }
  if (!request.body) throw new TrackerError(400, 'Send a JSON request body.');
  const reader = request.body.getReader();
  const buffer = new Uint8Array(maxBody);
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > maxBody - position) {
        // Do not wait for a producer to finish sending an oversized body.
        void reader.cancel().catch(() => undefined);
        throw new TrackerError(413, 'That request is too large.');
      }
      buffer.set(value, position);
      position += value.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, position))) as unknown;
  } catch (error) {
    if (error instanceof TrackerError) throw error;
    throw new TrackerError(400, 'The request contains invalid JSON.');
  } finally {
    reader.releaseLock();
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const message = result.error.issues.find(issue => issue.code === 'custom' || issue.code === 'invalid_format')?.message;
  throw new TrackerError(422, message ?? 'Check the required fields and their values.');
}

async function api(request: Request, url: URL, tracker: Tracker, at: number) {
  if (request.method === 'GET') {
    switch (url.pathname) {
      case '/api/today': return json(await tracker.today());
      case '/api/goals': return json(await tracker.goals());
      case '/api/history': {
        const { from, to } = parse(rangeSchema, Object.fromEntries(url.searchParams));
        return json(await tracker.history(from, to));
      }
      case '/api/export': {
        const format = url.searchParams.get('format');
        if (format !== 'csv' && format !== 'json') throw new TrackerError(422, 'Choose JSON or CSV.');
        return send(await tracker.export(format), 200, {
          'Content-Disposition': 'attachment; filename="sleep-export-' + localNight(at) + '.' + format + '"',
          'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        });
      }
    }
  }
  if (request.method === 'POST') {
    if (!isSameOrigin(request)) throw new TrackerError(403, 'Open the tracker directly to save changes.');
    switch (url.pathname) {
      case '/api/check-ins/now': {
        const { night, kind } = parse(quickSchema, await readJson(request));
        const result = await tracker.quick(night, kind);
        return json(result, result.created ? 201 : 200);
      }
      case '/api/check-ins': return json(await tracker.edit(parse(entryInputSchema, await readJson(request))));
      case '/api/goals/create': return json(await tracker.createGoal(parse(createGoalSchema, await readJson(request))), 201);
      case '/api/goals/update': return json(await tracker.updateGoal(parse(updateGoalSchema, await readJson(request))));
      case '/api/goals/pause': return json(await tracker.pauseGoal(parse(pauseGoalSchema, await readJson(request))));
    }
  }
  return json({ error: 'This route was not found.' }, 404);
}

export async function respond(request: Request, runtime: Runtime) {
  const url = new URL(request.url);
  const mcp = url.pathname === '/mcp';
  if (!mcp && !url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(null, 405);
    const asset = runtime.asset(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!asset) return send(null, 404);
    const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'private, no-store';
    return send(request.method === 'HEAD' ? null : asset.body, 200, {
      'Content-Type': asset.contentType, 'Cache-Control': cache,
    });
  }
  try {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (mcp && (request.headers.has('origin') || fetchSite === 'cross-site' || fetchSite === 'same-site')) {
      throw new TrackerError(403, 'Use an authenticated MCP connection.');
    }
    if (!mcp && (fetchSite === 'cross-site' || fetchSite === 'same-site')) {
      throw new TrackerError(403, 'Open the tracker directly to access records.');
    }
    const owner = runtime.identity(request, mcp ? 'mcp' : 'browser');
    if (!owner) return json({ error: 'Sign in to access this tracker.', mode: runtime.mode }, 401);
    const at = (runtime.clock ?? Date.now)();
    const wellness = runtime.mode !== 'sites';
    const tracker = new Tracker(new Store(runtime.db, owner, wellness), at, wellness, runtime.mode);
    if (!mcp) return await api(request, url, tracker, at);
    if (request.method !== 'POST') return send(null, 405, { Allow: 'POST' });
    let message: unknown;
    try {
      message = await readJson(request);
    } catch (error) {
      if (!(error instanceof TrackerError) || error.status !== 400) throw error;
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }, 400);
    }
    const result = await handleMcp(message, tracker);
    return result ? json(result) : send(null, 202);
  } catch (error) {
    const safe = safeError(error);
    return json({ error: safe.message }, safe.status);
  }
}
