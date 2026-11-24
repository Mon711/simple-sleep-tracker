import { z } from 'zod';
import { difficulties, moods, restedValues } from './options.ts';
import { isNight, nightDistance, TIMEZONE } from './time.ts';

export const nightSchema = z.string().length(10).refine(isNight, 'Enter a valid night from 2000 through 2099.');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time in HH:MM format.');
const instant = z.iso.datetime();
const counters = z.int().nonnegative();
const revision = z.int().min(1).max(1_000_000);
export const kindSchema = z.enum(['bed', 'wake']);
const wellness = {
  mood: z.enum(moods).nullable(),
  difficulty: z.enum(difficulties).nullable(),
  rested: z.enum(restedValues).nullable(),
  nightmare: z.boolean().nullable(),
};
const keyFields = { night: nightSchema, kind: kindSchema };
export const entryKeySchema = z.strictObject(keyFields);
export const entrySchema = z.strictObject({
  ...keyFields,
  id: z.uuid(),
  at: instant,
  timezone: z.literal(TIMEZONE),
  revision,
  ...wellness,
});
export const quickSchema = z.strictObject({ night: nightSchema, kind: kindSchema });
export const entryInputSchema = z.strictObject({
  ...keyFields,
  localTime: z.string().regex(/^20\d\d-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Enter a date and time.'),
  mood: wellness.mood.optional(),
  difficulty: wellness.difficulty.optional(),
  rested: wellness.rested.optional(),
  nightmare: wellness.nightmare.optional(),
  previous: z.strictObject({ night: nightSchema, id: z.uuid(), revision }).optional(),
});

const rangeFields = { from: nightSchema, to: nightSchema };
const boundedRange = ({ from, to }: { from: string; to: string }) => {
  const days = nightDistance(from, to);
  return days >= 0 && days < 366;
};
export const rangeSchema = z.strictObject(rangeFields).refine(boundedRange, 'Choose a date range of 1 to 366 nights.');
export const entriesToolSchema = z.strictObject({
  ...rangeFields,
  limit: z.int().min(1).max(100).optional(),
  offset: z.int().min(0).max(732).optional(),
}).refine(boundedRange, 'Choose a date range of 1 to 366 nights.');

export const goalFields = {
  bedtime: clock.nullable(),
  wakeTime: clock.nullable(),
  period: z.enum(['weekly', 'monthly']),
  stepMinutes: z.int().min(1).max(60),
  direction: z.enum(['earlier', 'later']),
};
export const goalSettingsSchema = z.strictObject(goalFields).refine(
  input => input.bedtime !== null || input.wakeTime !== null,
  'Set at least one target time.',
);
export const goalSchema = z.strictObject({
  ...goalFields,
  revision,
  status: z.enum(['active', 'paused']),
  effectiveNight: nightSchema,
  reviewNight: nightSchema.nullable(),
  changedAt: instant,
  change: z.enum(['created', 'edited', 'adjusted', 'paused']),
});
export const createGoalSchema = z.strictObject({
  expectedRevision: z.int().min(0).max(999_999),
  settings: goalSettingsSchema,
});
export const updateGoalSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('edit'), expectedRevision: revision, settings: goalSettingsSchema }),
  z.strictObject({ action: z.literal('confirm_adjustment'), expectedRevision: revision, confirm: z.literal(true) }),
]);
export const pauseGoalSchema = z.strictObject({ expectedRevision: revision, confirm: z.literal(true) });
export const goalOverviewSchema = z.strictObject({
  current: goalSchema.nullable(),
  upcoming: z.strictObject({
    reviewNight: nightSchema,
    bedtime: clock.nullable(),
    wakeTime: clock.nullable(),
    due: z.boolean(),
  }).nullable(),
  history: z.array(goalSchema).max(100),
  baseline: z.strictObject({
    startedNight: nightSchema.nullable(),
    readyNight: nightSchema.nullable(),
    elapsedDays: z.int().min(0).max(7),
    ready: z.boolean(),
  }),
});
export const summaryInputSchema = z.strictObject({
  period: z.enum(['week', 'month']),
  endNight: nightSchema.optional(),
});
export const summarySchema = z.strictObject({
  from: nightSchema,
  to: nightSchema,
  nightsLogged: counters,
  bedtime: z.strictObject({ count: counters, average: clock.nullable() }),
  wakeTime: z.strictObject({ count: counters, average: clock.nullable() }),
});
const moodCounts = z.strictObject({ Anxious: counters, Okay: counters, Calm: counters });
const nightmareGroup = z.strictObject({ count: counters, averageBedtime: clock.nullable() });
export const patternSchema = z.strictObject({
  from: nightSchema,
  to: nightSchema,
  wellnessAvailable: z.boolean(),
  bedtimeMood: moodCounts.nullable(),
  wakeMood: moodCounts.nullable(),
  nightmares: z.strictObject({ yes: counters, no: counters, missing: counters }).nullable(),
  bedtimeByNightmare: z.strictObject({ yes: nightmareGroup, no: nightmareGroup }).nullable(),
});
export const todaySchema = z.strictObject({
  now: instant,
  date: nightSchema,
  timezone: z.literal(TIMEZONE),
  primary: kindSchema,
  bed: z.strictObject({ night: nightSchema, entry: entrySchema.nullable() }),
  wake: z.strictObject({ night: nightSchema, entry: entrySchema.nullable() }),
  goal: goalSchema.nullable(),
  wellnessAvailable: z.boolean(),
  mode: z.enum(['synthetic', 'private', 'sites']),
});
export const historySchema = z.strictObject({
  entries: z.array(entrySchema),
  goals: z.array(goalSchema),
  summary: summarySchema,
  patterns: patternSchema,
});
export const quickOutputSchema = z.strictObject({ entry: entrySchema, created: z.boolean() });
export const emptySchema = z.strictObject({});

export type Entry = z.infer<typeof entrySchema>;
export type EntryInput = z.infer<typeof entryInputSchema>;
export type Kind = z.infer<typeof kindSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type GoalSettings = z.infer<typeof goalSettingsSchema>;
export type GoalOverview = z.infer<typeof goalOverviewSchema>;
export type Today = z.infer<typeof todaySchema>;
export type History = z.infer<typeof historySchema>;
export type Pattern = z.infer<typeof patternSchema>;
