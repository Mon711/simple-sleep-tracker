import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

const manifest = JSON.parse(await readFile('dist/.openai/hosting.json', 'utf8'));
assert.equal(manifest.d1, 'DB');
assert.ok(manifest.capabilities.includes('mcp'));
assert.equal(manifest.static, undefined);

const worker = new Miniflare({
  workers: [{
    config: {
      name: 'tracker',
      compatibilityDate: '2026-07-28',
      manifest: {
        mainModule: 'index.js',
        modules: { 'index.js': { type: 'esm', contents: await readFile('dist/server/index.js', 'utf8') } },
      },
      env: { DB: { type: 'd1', id: 'tracker-synthetic-d1' } },
    },
  }],
  cf: false,
  enableDevRegistry: false,
  logRequests: false,
  telemetry: { enabled: false },
});
const url = 'https://tracker.test';
const owner = 'synthetic-site-owner';

function call(path, { as = owner, body, browser = false } = {}) {
  return worker.dispatchFetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(as ? { 'oai-authenticated-user-id': as } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(browser ? { origin: url } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rpc(method, params = {}, as = owner) {
  return call('/mcp', { as, body: { jsonrpc: '2.0', id: 'worker-test', method, params } });
}

try {
  const database = await worker.getD1Database('DB');
  const sql = await readFile('drizzle/0000_tracker.sql', 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    await database.prepare(statement.trim()).run();
  }
  const front = await call('/', { as: null });
  assert.equal(front.status, 200);
  assert.match(front.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const script = (await front.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(script);
  const asset = await call(script, { as: null });
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.doesNotMatch(await asset.text(), /SLEEP_MCP_TOKEN|oai-authenticated-user-id|synthetic-site-owner/);
  assert.equal((await call('/manifest.webmanifest', { as: null })).status, 200);
  assert.equal((await call('/__trial-cleanup')).status, 404);
  assert.equal((await call('/api/today', { as: null })).status, 401);
  assert.equal((await rpc('tools/list', {}, null)).status, 401);
  assert.equal((await call('/api/export?format=csv', { as: null })).status, 401);

  const before = await (await call('/api/today')).json();
  assert.equal(before.mode, 'sites');
  assert.equal(before.wellnessAvailable, false);
  assert.equal(before.goal, null);

  const bed = { kind: 'bed', night: '2026-05-18', localTime: '2026-05-19T00:10' };
  const wellness = await call('/api/check-ins', { browser: true, body: { ...bed, mood: 'Calm' } });
  assert.equal(wellness.status, 422);
  assert.equal((await call('/api/check-ins', { body: bed })).status, 403);
  assert.equal((await call('/api/check-ins', { browser: true, body: bed })).status, 200);
  assert.equal((await call('/api/check-ins', { browser: true, body: bed })).status, 409);
  const impossible = await call('/api/check-ins', { browser: true, body: {
    kind: 'wake', night: bed.night, localTime: '2026-05-18T07:40',
  } });
  assert.equal(impossible.status, 409, await impossible.text());
  assert.equal((await call('/api/check-ins', { browser: true, body: {
    kind: 'wake', night: bed.night, localTime: '2026-05-19T07:40',
  } })).status, 200);

  const output = await (await rpc('tools/list')).json();
  assert.equal(output.result.tools.length, 8);
  assert.ok(output.result.tools.every(tool => tool.inputSchema && tool.outputSchema));
  const key = { night: bed.night, kind: bed.kind };
  const metadata = { 'io.modelcontextprotocol/clientInfo': { name: 'synthetic-client', version: '1.0' } };
  const entry = await (await rpc('tools/call', { name: 'get_sleep_entry', arguments: key, _meta: metadata })).json();
  assert.equal(entry.result.structuredContent.entry.at, '2026-05-18T18:40:00.000Z');
  const stranger = await (await rpc('tools/call', { name: 'get_sleep_entry', arguments: key }, 'synthetic-other-owner')).json();
  assert.equal(stranger.result.structuredContent.entry, null);
  const goal = await (await rpc('tools/call', { name: 'create_sleep_goal', _meta: metadata, arguments: {
    expectedRevision: 0, settings: { bedtime: '00:00', wakeTime: '07:30', period: 'weekly', stepMinutes: 15, direction: 'earlier' },
  } })).json();
  assert.equal(goal.result.structuredContent.revision, 1);
  const exported = await (await call('/api/export?format=json')).json();
  assert.equal(exported.entries.length, 2);
  assert.equal(exported.goals.length, 1);
  assert.ok(exported.entries.every(item => item.mood === null && item.nightmare === null));
  const independent = await (await call('/api/export?format=json', { as: 'synthetic-other-owner' })).json();
  assert.deepEqual(independent.entries, []);
  assert.deepEqual(independent.goals, []);
  console.log('Built Worker + local D1 passed asset, migration, private access, owner isolation, wellness restriction, chronology, export, and MCP checks.');
} finally {
  await worker.dispose();
}
