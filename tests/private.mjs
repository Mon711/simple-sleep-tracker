import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const origin = 'https://tracker.test';
const host = new URL(origin).host;
const login = 'owner@example.test';
const token = randomBytes(32).toString('base64url');
const directory = await mkdtemp(join(tmpdir(), 'tracker-private-'));
const database = join(directory, 'synthetic.sqlite');
const reservation = createServer();
await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
const { port } = reservation.address();
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', 'local/server.ts'], {
  env: {
    ...process.env, SLEEP_PROFILE: 'private', SLEEP_OWNER_LOGIN: login, SLEEP_ORIGIN: origin,
    SLEEP_MCP_TOKEN: token, SLEEP_PORT: String(port), SLEEP_DB: database,
  },
  stdio: 'ignore',
});
const stopped = new Promise(resolve => server.once('exit', resolve));

function fetchLocal(path, headers = {}, data) {
  return new Promise((resolve, reject) => {
    const body = data === undefined ? undefined : JSON.stringify(data);
    const outgoing = request({
      hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET',
      headers: {
        Host: host, ...headers,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', bytes => chunks.push(bytes));
      response.on('end', () => resolve({
        status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(2000, () => outgoing.destroy(new Error('Private test request timed out.')));
    outgoing.end(body);
  });
}

try {
  let alive = false;
  for (let retry = 0; retry < 40 && !alive; retry++) {
    if (server.exitCode !== null) break;
    try { alive = (await fetchLocal('/')).status === 200; } catch { await sleep(100); }
  }
  assert.ok(alive, 'The private server should start on loopback.');
  assert.equal((await fetchLocal('/api/today', { Host: 'wrong.test' })).status, 400);
  assert.equal((await fetchLocal('/api/today')).status, 401);
  assert.equal((await fetchLocal('/api/today', { 'Tailscale-User-Login': 'other@example.test' })).status, 401);
  assert.equal((await fetchLocal('/api/today', { 'OAI-Authenticated-User-Id': 'fictional-site-user' })).status, 401);
  assert.equal((await fetchLocal('/demo/sign-in', { Origin: origin }, {})).status, 405);

  const identity = { 'Tailscale-User-Login': login };
  const current = await fetchLocal('/api/today', identity);
  assert.equal(current.status, 200);
  const state = JSON.parse(current.body);
  assert.equal(state.mode, 'private');
  assert.equal(state.wellnessAvailable, true);
  const quick = await fetchLocal('/api/check-ins/now', { ...identity, Origin: origin }, {
    kind: 'bed', night: state.bed.night,
  });
  assert.equal(quick.status, 201);
  assert.equal((await stat(database)).mode & 0o077, 0, 'Owner-only SQLite permissions');

  const tool = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: 'get_sleep_entry', arguments: { kind: 'bed', night: state.bed.night },
  } };
  assert.equal((await fetchLocal('/mcp', {}, tool)).status, 401);
  assert.equal((await fetchLocal('/mcp', { Authorization: 'Bearer invalid' }, tool)).status, 401);
  assert.equal((await fetchLocal('/api/today', { Authorization: 'Bearer ' + token })).status, 401);
  const mcp = await fetchLocal('/mcp', { Authorization: 'Bearer ' + token }, tool);
  assert.equal(mcp.status, 200);
  assert.equal(JSON.parse(mcp.body).result.structuredContent.entry.at, JSON.parse(quick.body).entry.at);
  assert.equal((await fetchLocal('/mcp', { ...identity, Origin: origin }, tool)).status, 403);
  assert.equal((await fetchLocal('/api/export?format=json', { ...identity, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  console.log('Private server passed synthetic owner, origin, loopback, credential separation, file permissions, and MCP checks.');
} finally {
  server.kill('SIGTERM');
  await stopped;
  await rm(directory, { recursive: true, force: true });
}
