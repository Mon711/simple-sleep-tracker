import { z } from 'zod';
import {
  createGoalSchema, emptySchema, entriesToolSchema, entryKeySchema, entrySchema, goalOverviewSchema,
  goalSchema, patternSchema, pauseGoalSchema, rangeSchema, summaryInputSchema, summarySchema, updateGoalSchema,
} from '../shared/schemas.ts';
import { safeError, TrackerError } from './errors.ts';
import type { Tracker } from './tracker.ts';

const version = '2026-07-28';
const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const rpcId = z.union([z.string().max(128), z.number().int(), z.null()]);
const envelope = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: rpcId.optional(),
  method: z.string().min(1).max(80),
  params: z.record(z.string(), z.unknown()).optional(),
});

function tool<I extends z.ZodType, O extends z.ZodType>(
  name: string,
  description: string,
  input: I,
  output: O,
  readOnly: boolean,
  handler: (tracker: Tracker, data: z.infer<I>) => Promise<z.input<O>>,
) {
  return {
    definition: {
      name, description,
      inputSchema: z.toJSONSchema(input, { target: 'draft-2020-12' }),
      outputSchema: z.toJSONSchema(output, { target: 'draft-2020-12' }),
      annotations: {
        readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false,
      },
    },
    async call(tracker: Tracker, argumentsValue: unknown) {
      const data = input.safeParse(argumentsValue);
      if (!data.success) throw new TrackerError(422, 'Invalid tool arguments. Check the required fields, date range, and values.');
      return output.parse(await handler(tracker, data.data));
    },
  };
}

const entriesResult = z.strictObject({
  entries: z.array(entrySchema).max(100),
  nextOffset: z.int().nonnegative().nullable(),
});

const tools = [
  tool('get_sleep_entries', 'Read your bedtime and wake check-ins by night date, up to 366 nights per request. Use nextOffset to continue.',
    entriesToolSchema, entriesResult, true, async (tracker, { from, to, limit = 50, offset = 0 }) => {
      const entries = await tracker.store.entries(from, to, limit + 1, offset);
      return { entries: entries.slice(0, limit), nextOffset: entries.length > limit ? offset + limit : null };
    }),
  tool('get_sleep_entry', 'Read one bedtime or wake check-in for a specified night. A missing check-in is returned as null.',
    entryKeySchema, z.strictObject({ entry: entrySchema.nullable() }), true, async (tracker, { night, kind }) =>
      ({ entry: await tracker.store.entry(night, kind) })),
  tool('get_sleep_summary', 'Read counts and average local clock times for a rolling seven-day or 30-day period.',
    summaryInputSchema, summarySchema, true, (tracker, { period, endNight }) => tracker.summary(period, endNight)),
  tool('get_sleep_goals', 'Read the current sleep plan, upcoming proposed adjustment, baseline progress, and 100 recent plan revisions.',
    emptySchema, goalOverviewSchema, true, tracker => tracker.goals()),
  tool('get_sleep_patterns', 'Read observed mood and nightmare counts and grouped bedtime averages when both groups have enough entries. Some hosting modes disable wellness fields.',
    rangeSchema, patternSchema, true, (tracker, { from, to }) => tracker.patterns(from, to)),
  tool('create_sleep_goal', 'Create an active plan after the seven-day baseline. Ask the user to approve the settings and include the current revision, or zero for the first plan.',
    createGoalSchema, goalSchema, false, (tracker, data) => tracker.createGoal(data)),
  tool('update_sleep_goal', 'Edit target settings or confirm a due proposal. Ask the user to approve the change and use the latest revision.',
    updateGoalSchema, goalSchema, false, (tracker, data) => tracker.updateGoal(data)),
  tool('pause_sleep_goal', 'Pause the active goal plan and preserve its history. Ask the user to confirm and use the latest revision.',
    pauseGoalSchema, goalSchema, false, (tracker, data) => tracker.pauseGoal(data)),
];

const registered = new Map(tools.map(value => [value.definition.name, value]));
const callSchema = z.strictObject({
  name: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
type Id = z.infer<typeof rpcId>;
const info = { name: 'simple-sleep-tracker', version: '0.1.0' };

function rpcError(id: Id, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleMcp(value: unknown, tracker: Tracker) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return rpcError(null, -32600, 'Invalid request.');
  const { method, params, id } = parsed.data;
  if (id === undefined) return null; // Notifications never invoke a tracker tool.
  const respond = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  if (method === 'server/discover') {
    return respond({ supportedVersions: [version], capabilities: { tools: {} } });
  }
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const protocolVersion = typeof requested === 'string' && legacyVersions.includes(requested) ? requested : version;
    return respond({ protocolVersion, capabilities: { tools: {} }, serverInfo: info });
  }
  if (method === 'ping') return respond({});
  if (method === 'tools/list') return respond({ tools: tools.map(value => value.definition) });
  if (method !== 'tools/call') return rpcError(id, -32601, 'Method not found.');
  const call = callSchema.safeParse(params);
  if (!call.success) return rpcError(id, -32602, 'Invalid tool request.');
  const target = registered.get(call.data.name);
  if (!target) return rpcError(id, -32602, 'Unknown tool.');
  try {
    const data = await target.call(tracker, call.data.arguments ?? {});
    return respond({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false });
  } catch (error) {
    return respond({ content: [{ type: 'text', text: safeError(error).message }], isError: true });
  }
}
