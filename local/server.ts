import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { isSameOrigin, respond, send } from '../src/server/http.ts';
import { readAssets } from './assets.mjs';
import { openTrackerDatabase } from './sqlite.ts';

const profile = process.env.SLEEP_PROFILE ?? 'synthetic';
if (profile !== 'synthetic' && profile !== 'private') throw new Error('Choose a supported tracker profile.');
const mode: 'synthetic' | 'private' = profile;
const port = Number(process.env.SLEEP_PORT ?? 4175);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Set a valid loopback port.');
const origin = new URL(mode === 'private' ? process.env.SLEEP_ORIGIN ?? 'http://invalid' : 'http://127.0.0.1:' + port);
const ownerLogin = process.env.SLEEP_OWNER_LOGIN;
const mcpToken = process.env.SLEEP_MCP_TOKEN;
if (mcpToken && !/^[A-Za-z0-9_-]{32,128}$/.test(mcpToken)) {
  throw new Error('The MCP token must be a random base64url value of at least 32 characters.');
}
if (mode === 'private' && (origin.protocol !== 'https:' || origin.username || origin.password
  || origin.pathname !== '/' || origin.search || origin.hash || !ownerLogin || !process.env.SLEEP_DB)) {
  throw new Error('Private mode requires a bare HTTPS origin, owner login, and explicit database path.');
}
const databasePath = resolve(process.env.SLEEP_DB ?? 'data/synthetic/tracker.sqlite');
const projectRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const inProject = (path: string) => path === projectRoot || path.startsWith(projectRoot + sep);
if (mode === 'private' && inProject(databasePath)) {
  throw new Error('Store the private database outside the source folder.');
}
process.umask(0o077);
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const canonicalPath = existsSync(databasePath) ? realpathSync(databasePath)
  : join(realpathSync(dirname(databasePath)), basename(databasePath));
if (mode === 'private' && inProject(canonicalPath)) {
  throw new Error('Store the private database outside the source folder.');
}
if (mode === 'private' && existsSync(databasePath) && (statSync(databasePath).mode & 0o077)) {
  throw new Error('The private database must be readable and writable only by its owner.');
}
const { db, close } = openTrackerDatabase(canonicalPath);
const assets = readAssets(fileURLToPath(new URL('../dist/client', import.meta.url)));
const demoSession = randomBytes(32).toString('base64url');
const cookieName = 'tracker_demo';
const owner = mode === 'private' ? 'private-owner' : 'synthetic-owner';

function securelyEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function identity(request: Request, channel: 'browser' | 'mcp') {
  if (channel === 'mcp' && mcpToken
    && securelyEqual(request.headers.get('authorization') ?? '', 'Bearer ' + mcpToken)) return owner;
  if (mode === 'private') {
    const login = request.headers.get('tailscale-user-login');
    return login && login === ownerLogin ? owner : null;
  }
  if (channel === 'mcp') return null;
  const demoCookie = request.headers.get('cookie')?.split(';').map(item => item.trim())
    .find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
  return securelyEqual(demoCookie, demoSession) ? owner : null;
}

function app(request: Request) {
  const path = new URL(request.url).pathname;
  if (mode === 'synthetic' && (path === '/demo/sign-in' || path === '/demo/sign-out')) {
    if (request.method !== 'POST' || !isSameOrigin(request)) return send(null, 403);
    const cookie = path === '/demo/sign-in' ? demoSession : '; Max-Age=0';
    return send(null, 303, {
      Location: '/',
      'Set-Cookie': cookieName + '=' + cookie + '; HttpOnly; SameSite=Strict; Path=/',
    });
  }
  return respond(request, {
    db, mode, identity,
    asset(path) {
      const record = assets.get(path);
      return record ? { body: new Uint8Array(record.bytes), contentType: record.contentType } : undefined;
    },
  });
}

const server = createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || incoming.headers.host !== origin.host) {
      outgoing.writeHead(400, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const destination = new URL(incoming.url, origin);
    if (destination.origin !== origin.origin) {
      outgoing.writeHead(400, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(destination, {
      method,
      headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
        value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(part => [name, part]),
      ),
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
    } as RequestInit);
    const response = await app(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Cache-Control': 'no-store' });
    outgoing.end('The tracker could not finish the request.');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Tracker (' + mode + ') listening on 127.0.0.1:' + port);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => close()));
}
