import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTrackerDatabase } from '../local/sqlite.ts';
import { respond } from '../src/server/http.ts';
import type { Runtime } from '../src/server/http.ts';
import { Store } from '../src/server/store.ts';
import { Tracker } from '../src/server/tracker.ts';
import { clockAverage, localMinute, nextReview, parseLocalMinute } from '../src/shared/time.ts';
import type { EntryInput, GoalSettings } from '../src/shared/schemas.ts';

const fixtureNow = Date.parse('2026-06-17T19:25:16.124Z'); // 00:55:16 on 18 June in Asia/Kolkata.
const origin = 'https://tracker.example';
const settings: GoalSettings = {
  bedtime: '00:05', wakeTime: '07:30', period: 'weekly', stepMinutes: 15, direction: 'earlier',
};

let storage: ReturnType<typeof openTrackerDatabase>;
beforeEach(() => { storage = openTrackerDatabase(':memory:'); });
afterEach(() => storage.close());

function tracker(now = fixtureNow, owner = 'owner-one', wellness = true) {
  return new Tracker(new Store(storage.db, owner, wellness), now, wellness, wellness ? 'synthetic' : 'sites');
}

function record(overrides: Partial<EntryInput> = {}): EntryInput {
  return { kind: 'bed', night: '2026-06-10', localTime: '2026-06-11T00:10', ...overrides };
}

function runtime(owner: string | null = 'owner-one', now = fixtureNow, mode: Runtime['mode'] = 'synthetic'): Runtime {
  return { db: storage.db, mode, identity: () => owner, asset: () => undefined, clock: () => now };
}

function post(path: string, body: object, active = runtime(), headers: Record<string, string> = {}) {
  return respond(new Request(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(path === '/mcp' ? {} : { Origin: origin }), ...headers },
    body: JSON.stringify(body),
  }), active);
}

async function rpc(method: string, params: object = {}, active = runtime()) {
  return post('/mcp', { jsonrpc: '2.0', id: 17, method, params }, active);
}

async function call(name: string, args: object, active = runtime()) {
  return (await (await rpc('tools/call', { name, arguments: args }, active)).json()).result;
}

describe('wall time and session association', () => {
  it('round trips Asia/Kolkata midnight while preserving the configured date', () => {
    expect(localMinute(fixtureNow)).toBe('2026-06-18T00:55');
    expect(parseLocalMinute('2026-06-18T00:55')).toBe(Date.parse('2026-06-17T19:25:00Z'));
    expect(parseLocalMinute('2026-02-30T00:30')).toBeNaN();
    expect(parseLocalMinute('2028-02-29T00:30')).not.toBeNaN();
  });

  it('averages across midnight and avoids giving an average for opposite times', () => {
    expect(clockAverage(['23:50', '00:10'])).toBe('00:00');
    expect(clockAverage(['00:00', '12:00'])).toBeNull();
    expect(clockAverage([])).toBeNull();
  });

  it('clamps monthly review dates to the last usable day', () => {
    expect(nextReview('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextReview('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(nextReview('2026-12-26', 'weekly')).toBe('2027-01-02');
  });

  it('uses the previous night after midnight and promotes the open morning check-in', async () => {
    const app = tracker();
    const empty = await app.today();
    expect(empty.primary).toBe('bed');
    expect(empty.bed.night).toBe('2026-06-17');
    const saved = await app.quick(empty.bed.night, 'bed');
    expect(saved).toMatchObject({
      created: true,
      entry: { at: '2026-06-17T19:25:16.124Z', timezone: 'Asia/Kolkata', mood: null, rested: null },
    });
    const during = await tracker(fixtureNow + 4 * 3600_000).today();
    expect(during).toMatchObject({ primary: 'wake', wake: { night: '2026-06-17', entry: null } });
    await tracker(fixtureNow + 4 * 3600_000).quick(during.wake.night, 'wake');
    expect(await tracker(fixtureNow + 4 * 3600_000 + 100).today()).toMatchObject({
      primary: 'bed', bed: { night: '2026-06-18', entry: null },
      wake: { night: '2026-06-17', entry: { revision: 1 } },
    });
  });

  it('follows recorded state even when bedtime was in the afternoon', async () => {
    const at = parseLocalMinute('2026-06-17T14:00');
    const app = tracker(at);
    await app.quick('2026-06-17', 'bed');
    expect(await tracker(at + 3 * 3600_000).today()).toMatchObject({
      primary: 'wake', wake: { night: '2026-06-17' },
    });
    expect(await tracker(at + 3 * 86_400_000).today()).toMatchObject({ primary: 'bed' });
  });

  it('allows a morning check-in by itself and later pairing by manual backdating', async () => {
    const app = tracker();
    const { wake } = await app.today();
    await app.quick(wake.night, 'wake');
    await app.edit(record({ night: wake.night, localTime: '2026-06-17T23:50' }));
    expect((await app.history(wake.night, wake.night)).entries.map(item => item.kind)).toEqual(['bed', 'wake']);
  });
});

describe('entries and persistence', () => {
  it('concurrent quick saves create one record and replay the original timestamp', async () => {
    const outcomes = await Promise.all([
      tracker().quick('2026-06-17', 'bed'),
      tracker(fixtureNow + 9000).quick('2026-06-17', 'bed'),
    ]);
    expect(outcomes.filter(item => item.created)).toHaveLength(1);
    expect(outcomes[0].entry.at).toBe(outcomes[1].entry.at);
    expect(await tracker().store.entries('2026-06-17', '2026-06-17')).toHaveLength(1);
  });

  it('saves optional details without discarding precise timestamps and permits moving to a new night', async () => {
    const app = tracker();
    const { entry } = await tracker(fixtureNow - 1000).quick('2026-06-17', 'bed');
    const edited = await app.edit(record({
      night: '2026-06-18', localTime: '2026-06-18T00:55', mood: 'Calm', difficulty: 'Hard to settle',
      previous: { night: entry.night, id: entry.id, revision: 1 },
    }));
    expect(edited).toMatchObject({ at: entry.at, night: '2026-06-18', mood: 'Calm', revision: 2 });
    expect(await app.store.entry(entry.night, 'bed')).toBeNull();
    await expect(app.edit(record({ night: '2026-06-18', localTime: '2026-06-18T00:54', previous: {
      night: '2026-06-18', id: entry.id, revision: 1,
    } }))).rejects.toMatchObject({ status: 409 });
  });

  it('rejects duplicate manual writes, invalid night dates, invalid optional fields, and impossible chronology', async () => {
    const app = tracker();
    const bed = await app.edit(record());
    await expect(app.edit(record())).rejects.toMatchObject({ status: 409 });
    await expect(app.edit(record({ localTime: '2026-06-12T00:10' }))).rejects.toMatchObject({ status: 422 });
    await expect(app.edit(record({ localTime: '2026-02-30T00:10' }))).rejects.toMatchObject({ status: 422 });
    await expect(app.edit(record({ night: '2026-06-18', localTime: '2026-06-18T10:00' }))).rejects.toMatchObject({ status: 422 });
    await expect(app.edit(record({ nightmare: true }))).rejects.toMatchObject({ status: 422 });
    await expect(app.edit(record({ kind: 'wake', localTime: '2026-06-10T07:30' }))).rejects.toMatchObject({ status: 409 });
    await app.edit(record({ kind: 'wake', localTime: '2026-06-11T07:30', nightmare: false }));
    await expect(app.edit(record({ localTime: '2026-06-11T11:00', previous: { night: bed.night, id: bed.id, revision: 1 } })))
      .rejects.toMatchObject({ status: 409 });
    expect((await app.store.entry('2026-06-10', 'wake'))?.nightmare).toBe(false);
  });

  it('does not overwrite another saved record when moving a check-in', async () => {
    const app = tracker();
    const bed = await app.edit(record());
    await app.edit(record({ night: '2026-06-11', localTime: '2026-06-11T23:00' }));
    await expect(app.edit(record({
      night: '2026-06-11', localTime: '2026-06-11T20:00', previous: { night: bed.night, id: bed.id, revision: 1 },
    }))).rejects.toMatchObject({ status: 409 });
    expect(await app.store.entries('2026-06-10', '2026-06-11')).toHaveLength(2);
  });

  it('rejects an old editor after a moved entry is replaced at its original night and revision', async () => {
    const app = tracker();
    const original = await app.edit(record());
    const previous = { night: original.night, id: original.id, revision: original.revision };
    await app.edit(record({ night: '2026-06-11', previous }));
    const replacement = await app.edit(record({ localTime: '2026-06-10T22:00' }));
    expect(replacement.revision).toBe(original.revision);
    await expect(app.edit(record({ localTime: '2026-06-10T20:00', previous }))).rejects.toMatchObject({ status: 409 });
    expect(await app.store.entry(original.night, 'bed')).toMatchObject({ id: replacement.id, at: replacement.at });
  });

  it('preserves data on an isolated disk database across process-equivalent closes and opens', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'tracker-synthetic-'));
    try {
      const path = join(temporary, 'test.sqlite');
      const first = openTrackerDatabase(path);
      try {
        const app = new Tracker(new Store(first.db, 'synthetic-actor', true), fixtureNow, true, 'synthetic');
        await app.edit(record({ mood: 'Okay' }));
        await app.createGoal({ expectedRevision: 0, settings });
      } finally {
        first.close();
      }
      const backupPath = join(temporary, 'backup.sqlite');
      const source = new DatabaseSync(path, { readOnly: true });
      try {
        await backup(source, backupPath);
      } finally {
        source.close();
      }
      const second = openTrackerDatabase(backupPath);
      try {
        const store = new Store(second.db, 'synthetic-actor', true);
        expect(await store.entry('2026-06-10', 'bed')).toMatchObject({ mood: 'Okay' });
        expect(await store.goals()).toMatchObject([{ bedtime: '00:05', revision: 1 }]);
      } finally {
        second.close();
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

describe('goals, history, and export', () => {
  it('requires a baseline before creating a goal and preserves changes without activating proposals automatically', async () => {
    const app = tracker();
    await expect(app.createGoal({ expectedRevision: 0, settings })).rejects.toMatchObject({ status: 422 });
    await app.edit(record());
    const created = await app.createGoal({ expectedRevision: 0, settings });
    expect(created).toMatchObject({ status: 'active', reviewNight: '2026-06-25', revision: 1 });
    const adjustment = { action: 'confirm_adjustment', expectedRevision: 1, confirm: true } as const;
    await expect(app.updateGoal(adjustment)).rejects.toMatchObject({ status: 422 });
    const later = tracker(parseLocalMinute('2026-06-25T19:00'));
    expect(await later.goals()).toMatchObject({
      current: { bedtime: '00:05' },
      upcoming: { bedtime: '23:50', wakeTime: '07:15', due: true },
    });
    const [result, stale] = await Promise.allSettled([later.updateGoal(adjustment), later.updateGoal(adjustment)]);
    expect([result.status, stale.status].sort()).toEqual(['fulfilled', 'rejected']);
    const updated = (await later.goals()).current;
    expect(updated).toMatchObject({ bedtime: '23:50', wakeTime: '07:15', revision: 2, reviewNight: '2026-07-02' });
    await later.pauseGoal({ expectedRevision: 2, confirm: true });
    expect(await later.goals()).toMatchObject({
      current: { revision: 3, status: 'paused' }, upcoming: null,
      history: [{ change: 'paused' }, { change: 'adjusted' }, { change: 'created' }],
    });
  });

  it('limits grouped averages to comparable sample sizes and counts missing responses separately', async () => {
    const app = tracker();
    for (let index = 10; index <= 16; index++) {
      const night = '2026-06-' + index;
      await app.edit(record({ night, localTime: night + 'T23:45', mood: 'Okay' }));
      await app.edit(record({
        night, kind: 'wake', localTime: '2026-06-' + (index + 1) + 'T07:30', nightmare: index === 16 ? null : index < 13,
      }));
    }
    const summary = await app.patterns('2026-06-10', '2026-06-16');
    expect(summary).toMatchObject({
      bedtimeMood: { Okay: 7 },
      nightmares: { yes: 3, no: 3, missing: 1 },
      bedtimeByNightmare: { yes: { count: 3, averageBedtime: '23:45' }, no: { count: 3, averageBedtime: '23:45' } },
    });
    expect(await app.patterns('2026-06-10', '2026-06-13')).toMatchObject({
      bedtimeByNightmare: { yes: { averageBedtime: null }, no: { averageBedtime: null } },
    });
  });

  it('exports complete owner-scoped JSON and CSV with the recorded dates and goals', async () => {
    await tracker().edit(record({ mood: 'Okay' }));
    await tracker().createGoal({ expectedRevision: 0, settings });
    await tracker(fixtureNow, 'owner-two').edit(record({ night: '2026-06-12', localTime: '2026-06-12T22:00' }));
    const json = await respond(new Request(origin + '/api/export?format=json'), runtime());
    expect(json.headers.get('content-disposition')).toBe('attachment; filename="sleep-export-2026-06-18.json"');
    expect(json.headers.get('cache-control')).toBe('private, no-store');
    expect(await json.json()).toMatchObject({
      version: 1, entries: [{ at: '2026-06-10T18:40:00.000Z', night: '2026-06-10', mood: 'Okay' }],
      goals: [{ bedtime: '00:05', revision: 1 }],
    });
    const csv = await respond(new Request(origin + '/api/export?format=csv'), runtime());
    const bytes = await csv.text();
    expect(bytes).toContain('"check_in","2026-06-10","bed","2026-06-10T18:40:00.000Z"');
    expect(bytes).toContain('"goal","2026-06-18"');
    expect(bytes).not.toContain('2026-06-12');
    expect(await (await respond(new Request(origin + '/api/export?format=json'), runtime('owner-two'))).json())
      .toMatchObject({ entries: [{ night: '2026-06-12' }], goals: [] });
    expect((await respond(new Request(origin + '/api/export?format=csv'), runtime(null))).status).toBe(401);
  });
});

describe('request and MCP boundaries', () => {
  it('limits origins and payloads; validates request shape and never trusts a caller owner field', async () => {
    expect((await post('/api/check-ins', record(), runtime(null), { 'oai-authenticated-user-id': 'owner-one' })).status).toBe(401);
    expect((await post('/api/check-ins', record(), runtime(), { Origin: 'https://outside.example' })).status).toBe(403);
    expect((await post('/api/check-ins', record(), runtime(), { 'Content-Type': 'text/plain' })).status).toBe(415);
    const exportFromOtherSite = await respond(new Request(origin + '/api/export?format=json', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    }), runtime());
    expect(exportFromOtherSite.status).toBe(403);
    expect((await post('/api/check-ins', { ...record(), owner: 'owner-two' })).status).toBe(422);
    expect((await post('/api/check-ins', { ...record(), surplus: 'x'.repeat(16_384) })).status).toBe(413);
    expect((await post('/api/check-ins', record(), runtime(), { 'Content-Length': '20000' })).status).toBe(413);
    const invalid = await respond(new Request(origin + '/api/history?from=2026-02-30&to=2026-03-03'), runtime());
    expect(invalid.status).toBe(422);
    expect((await tracker().store.entries('2026-01-01', '2026-12-31')).length).toBe(0);
  });

  it('rejects and redacts all wellness data on Sites, even if the database already contains it', async () => {
    const existing = await tracker().edit(record({ mood: 'Okay', difficulty: 'Hard to settle' }));
    const sites = runtime('owner-one', fixtureNow, 'sites');
    const rejected = await post('/api/check-ins', record({ mood: 'Anxious' }), sites);
    expect(rejected.status).toBe(422);
    expect(await call('get_sleep_entry', { night: '2026-06-10', kind: 'bed' }, sites))
      .toMatchObject({ structuredContent: { entry: { mood: null, difficulty: null } } });
    expect(await call('get_sleep_patterns', { from: '2026-06-10', to: '2026-06-17' }, sites))
      .toMatchObject({ structuredContent: { wellnessAvailable: false, nightmares: null } });
    expect(await (await respond(new Request(origin + '/api/export?format=json'), sites)).text()).not.toContain('Hard to settle');
    const edited = await post('/api/check-ins', record({
      localTime: '2026-06-11T00:11',
      previous: { id: existing.id, night: existing.night, revision: existing.revision },
    }), sites);
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ mood: null, difficulty: null });
    expect(await tracker().store.entry(existing.night, 'bed')).toMatchObject({
      mood: 'Okay', difficulty: 'Hard to settle', revision: 2,
    });
  });

  it('requires auth for MCP discovery and invokes only the eight declared tools', async () => {
    expect((await rpc('tools/list', {}, runtime(null))).status).toBe(401);
    expect((await post('/mcp', { jsonrpc: '2.0', method: 'tools/list', id: 1 }, runtime(), { Origin: origin })).status).toBe(403);
    expect(await (await rpc('server/discover')).json()).toMatchObject({ result: { supportedVersions: ['2026-07-28'] } });
    expect(await (await rpc('initialize', { protocolVersion: '2025-11-25' })).json())
      .toMatchObject({ result: { protocolVersion: '2025-11-25' } });
    const { result: { tools } } = await (await rpc('tools/list')).json();
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      'get_sleep_entries', 'get_sleep_entry', 'get_sleep_summary', 'get_sleep_goals', 'get_sleep_patterns',
      'create_sleep_goal', 'update_sleep_goal', 'pause_sleep_goal',
    ]);
    expect(tools.every((tool: { inputSchema: object; outputSchema: object }) => tool.inputSchema && tool.outputSchema)).toBe(true);
    expect(tools.filter((tool: { annotations: { readOnlyHint: boolean } }) => !tool.annotations.readOnlyHint)).toHaveLength(3);
    expect(await (await rpc('tools/call', { name: 'create_sleep_entry', arguments: record() })).json())
      .toMatchObject({ error: { code: -32602 } });
    const silent = await post('/mcp', { jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_sleep_goal' } });
    expect(silent.status).toBe(202);
    expect(await tracker().goals()).toMatchObject({ current: null });
  });

  it('validates MCP dates, paginates in owner scope, and applies goal changes to app data', async () => {
    await tracker().edit(record());
    await tracker().edit(record({ night: '2026-06-11', localTime: '2026-06-11T22:00' }));
    expect(await call('get_sleep_entries', { from: '2026-02-30', to: '2026-06-18' })).toMatchObject({ isError: true });
    expect(await call('get_sleep_entries', { from: '2024-01-01', to: '2026-06-18' })).toMatchObject({ isError: true });
    expect(await call('get_sleep_entries', { from: '2026-06-10', to: '2026-06-11', limit: 1 })).toMatchObject({
      structuredContent: { nextOffset: 1, entries: [{ night: '2026-06-11' }] },
    });
    expect(await call('get_sleep_entries', { from: '2026-06-10', to: '2026-06-11', limit: 1, offset: 1 })).toMatchObject({
      structuredContent: { nextOffset: null, entries: [{ night: '2026-06-10' }] },
    });
    expect(await call('get_sleep_entry', { night: '2026-06-10', kind: 'bed' }, runtime('owner-two')))
      .toMatchObject({ structuredContent: { entry: null } });
    expect(await call('get_sleep_summary', { period: 'week', endNight: '2026-06-11' })).toMatchObject({
      structuredContent: { from: '2026-06-05', to: '2026-06-11', nightsLogged: 2, bedtime: { count: 2 } },
    });
    expect(await call('create_sleep_goal', { expectedRevision: 0, settings })).toMatchObject({
      structuredContent: { bedtime: '00:05', revision: 1 },
    });
    expect(await call('update_sleep_goal', { action: 'confirm_adjustment', expectedRevision: 1 })).toMatchObject({ isError: true });
    expect(await call('update_sleep_goal', {
      action: 'edit', expectedRevision: 1, settings: { ...settings, bedtime: '23:55', period: 'monthly' },
    })).toMatchObject({ structuredContent: { bedtime: '23:55', revision: 2, reviewNight: '2026-07-18' } });
    expect(await call('pause_sleep_goal', { expectedRevision: 2, confirm: true })).toMatchObject({
      structuredContent: { revision: 3, status: 'paused' },
    });
    expect(await tracker().goals()).toMatchObject({ current: { revision: 3, status: 'paused' } });
  });

  it('accepts protocol metadata without using it as tool arguments or caller identity', async () => {
    await tracker().edit(record());
    const params = {
      name: 'get_sleep_entry',
      arguments: { night: '2026-06-10', kind: 'bed' },
      _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'synthetic-client', version: '1.0' }, owner: 'owner-one' },
    };
    const own = await rpc('tools/call', params);
    expect(await own.json()).toMatchObject({ result: { structuredContent: { entry: { night: '2026-06-10' } } } });
    const other = await rpc('tools/call', params, runtime('owner-two'));
    expect(await other.json()).toMatchObject({ result: { structuredContent: { entry: null } } });
    expect((await rpc('tools/call', params, runtime(null))).status).toBe(401);
    expect(await (await rpc('tools/call', { ...params, _meta: 'invalid' })).json())
      .toMatchObject({ error: { code: -32602 } });
    const injected = await rpc('tools/call', { ...params, arguments: { ...params.arguments, owner: 'owner-two' } });
    expect(await injected.json()).toMatchObject({ result: { isError: true } });
  });
});
