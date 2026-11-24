import type { z } from 'zod';
import type {
  createGoalSchema, Entry, EntryInput, Goal, GoalOverview, GoalSettings, History, Kind, Pattern,
  pauseGoalSchema, Today, updateGoalSchema,
} from '../shared/schemas.ts';
import {
  clockAt, clockAverage, localMinute, localNight, MINUTE_MS, minuteClock,
  nextReview, nightDistance, parseLocalMinute, shiftNight, TIMEZONE, timeMinutes,
} from '../shared/time.ts';
import { TrackerError } from './errors.ts';
import { Store } from './store.ts';

function instant(at: number) {
  return new Date(at).toISOString();
}

function preferredNight(entries: Entry[], at: number) {
  const today = localNight(at);
  const yesterday = shiftNight(today, -1);
  const latest = entries.reduce<Entry | null>((best, entry) => {
    if (!best || entry.at > best.at || (entry.at === best.at && entry.kind === 'wake')) return entry;
    return best;
  }, null);
  const usable = latest && latest.night >= yesterday && latest.night <= today;
  const open = usable && latest.kind === 'bed' &&
    !entries.some(entry => entry.night === latest.night && entry.kind === 'wake') &&
    at - Date.parse(latest.at) <= 36 * 60 * MINUTE_MS;
  const beforeNoon = timeMinutes(clockAt(at)) < 12 * 60;
  const endedYesterday = entries.some(entry => entry.night === yesterday && entry.kind === 'wake');
  const defaultBed = beforeNoon && !endedYesterday ? yesterday : today;
  return {
    today,
    primary: open ? 'wake' : 'bed',
    bed: open ? latest.night : defaultBed,
    wake: usable ? latest.night : yesterday,
  } as const;
}

function summarize(entries: Entry[], from: string, to: string) {
  const series = (kind: Kind) => {
    const times = entries.filter(entry => entry.kind === kind).map(entry => clockAt(Date.parse(entry.at)));
    return { count: times.length, average: clockAverage(times) };
  };
  return {
    from, to, nightsLogged: new Set(entries.map(entry => entry.night)).size,
    bedtime: series('bed'), wakeTime: series('wake'),
  };
}

function patterns(entries: Entry[], from: string, to: string, wellness: boolean): Pattern {
  if (!wellness) {
    return { from, to, wellnessAvailable: false, bedtimeMood: null, wakeMood: null, nightmares: null, bedtimeByNightmare: null };
  }
  const countMood = (kind: Kind) => {
    const counts = { Anxious: 0, Okay: 0, Calm: 0 };
    for (const entry of entries) if (entry.kind === kind && entry.mood) counts[entry.mood]++;
    return counts;
  };
  const beds = new Map(entries.filter(entry => entry.kind === 'bed').map(entry => [entry.night, entry]));
  const nightmares = { yes: 0, no: 0, missing: 0 };
  const groups = { yes: [] as string[], no: [] as string[] };
  for (const entry of entries) {
    if (entry.kind !== 'wake') continue;
    if (entry.nightmare === null) {
      nightmares.missing++;
      continue;
    }
    const key = entry.nightmare ? 'yes' : 'no';
    nightmares[key]++;
    const bed = beds.get(entry.night);
    if (bed) groups[key].push(clockAt(Date.parse(bed.at)));
  }

  // Both groups need enough matched check-ins before reporting a pair of averages.
  const enough = groups.yes.length >= 3 && groups.no.length >= 3;
  return {
    from, to, wellnessAvailable: true, bedtimeMood: countMood('bed'), wakeMood: countMood('wake'), nightmares,
    bedtimeByNightmare: {
      yes: { count: groups.yes.length, averageBedtime: enough ? clockAverage(groups.yes) : null },
      no: { count: groups.no.length, averageBedtime: enough ? clockAverage(groups.no) : null },
    },
  };
}

function adjustment(goal: Goal) {
  const delta = goal.stepMinutes * (goal.direction === 'earlier' ? -1 : 1);
  const shift = (time: string | null) => time === null ? null : minuteClock(timeMinutes(time) + delta);
  return { bedtime: shift(goal.bedtime), wakeTime: shift(goal.wakeTime) };
}

function csvCell(value: string | number | boolean | null) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export class Tracker {
  constructor(
    readonly store: Store,
    private readonly now: number,
    private readonly wellness: boolean,
    private readonly mode: Today['mode'],
  ) {}

  async today(): Promise<Today> {
    const date = localNight(this.now);
    const [entries, goals] = await Promise.all([
      this.store.entries(shiftNight(date, -2), date),
      this.store.goals(1),
    ]);
    const preferred = preferredNight(entries, this.now);
    const entry = (kind: Kind, night: string) => ({
      night, entry: entries.find(item => item.kind === kind && item.night === night) ?? null,
    });
    return {
      now: instant(this.now), date, timezone: TIMEZONE, primary: preferred.primary,
      bed: entry('bed', preferred.bed), wake: entry('wake', preferred.wake),
      goal: goals[0]?.status === 'active' ? goals[0] : null,
      mode: this.mode, wellnessAvailable: this.wellness,
    };
  }

  async quick(night: string, kind: Kind) {
    const saved = await this.store.entry(night, kind);
    if (saved) return { entry: saved, created: false };
    this.validateTime(night, this.now);
    const entry = await this.store.saveEntry({
      night, kind, id: crypto.randomUUID(), at: instant(this.now), timezone: TIMEZONE, revision: 1,
      mood: null, difficulty: null, rested: null, nightmare: null,
    });
    if (entry) return { entry, created: true };
    const concurrent = await this.store.entry(night, kind);
    if (!concurrent) throw new TrackerError(409, 'The check-in changed. Reopen Today and try again.');
    return { entry: concurrent, created: false };
  }

  async edit(input: EntryInput) {
    if (!this.wellness && [input.mood, input.difficulty, input.rested, input.nightmare].some(value => value != null)) {
      throw new TrackerError(422, 'Optional wellness details are unavailable on ChatGPT Sites.');
    }
    if ((input.kind === 'wake' && input.difficulty != null)
      || (input.kind === 'bed' && (input.rested != null || input.nightmare != null))) {
      throw new TrackerError(422, 'Choose optional details that match the check-in.');
    }
    const previous = input.previous ? await this.store.entry(input.previous.night, input.kind) : null;
    if (input.previous && (previous?.revision !== input.previous.revision || previous.id !== input.previous.id)) {
      throw new TrackerError(409, 'This check-in changed. Reopen it before editing.');
    }
    const existingInstant = previous ? Date.parse(previous.at) : null;
    const at = existingInstant !== null && localMinute(existingInstant) === input.localTime
      ? existingInstant : parseLocalMinute(input.localTime);
    this.validateTime(input.night, at);

    const result = await this.store.saveEntry({
      night: input.night, kind: input.kind, id: previous?.id ?? crypto.randomUUID(),
      at: instant(at), timezone: TIMEZONE, revision: 1,
      mood: input.mood === undefined ? previous?.mood ?? null : input.mood,
      difficulty: input.difficulty === undefined ? previous?.difficulty ?? null : input.difficulty,
      rested: input.rested === undefined ? previous?.rested ?? null : input.rested,
      nightmare: input.nightmare === undefined ? previous?.nightmare ?? null : input.nightmare,
    }, input.previous);
    if (!result) {
      throw new TrackerError(409, input.previous
        ? 'This check-in changed. Reopen it before editing.'
        : 'That night already has this check-in. Open the saved entry to edit it.');
    }
    return result;
  }

  private validateTime(night: string, at: number) {
    if (!Number.isFinite(at) || at > this.now) {
      throw new TrackerError(422, 'Enter a valid date and time at or before now.');
    }
    const day = localNight(at);
    if (day !== night && day !== shiftNight(night, 1)) {
      throw new TrackerError(422, 'The check-in must be on the chosen night date or the next day.');
    }
  }

  async history(from: string, to: string): Promise<History> {
    const [entries, goals] = await Promise.all([this.store.entries(from, to), this.store.goalsForRange(from, to)]);
    return { entries, goals, summary: summarize(entries, from, to), patterns: patterns(entries, from, to, this.wellness) };
  }

  async summary(period: 'week' | 'month', end?: string) {
    const to = end ?? localNight(this.now);
    const from = shiftNight(to, period === 'week' ? -6 : -29);
    if (from < '2000-01-01') throw new TrackerError(422, 'The full summary must fall in 2000 or later.');
    return summarize(await this.store.entries(from, to), from, to);
  }

  async patterns(from: string, to: string) {
    const entries = this.wellness ? await this.store.entries(from, to) : [];
    return patterns(entries, from, to, this.wellness);
  }

  private async baseline() {
    const startedNight = await this.store.firstNight();
    const readyNight = startedNight ? shiftNight(startedNight, 7) : null;
    const elapsedDays = startedNight ? Math.min(7, Math.max(0, nightDistance(startedNight, localNight(this.now)))) : 0;
    return { startedNight, readyNight, elapsedDays, ready: elapsedDays === 7 };
  }

  async goals(): Promise<GoalOverview> {
    const [history, baseline] = await Promise.all([this.store.goals(), this.baseline()]);
    const current = history[0] ?? null;
    const reviewNight = current?.reviewNight;
    return {
      current, baseline, history,
      upcoming: current?.status === 'active' && reviewNight
        ? { reviewNight, ...adjustment(current), due: localNight(this.now) >= reviewNight } : null,
    };
  }

  async createGoal({ expectedRevision, settings }: z.infer<typeof createGoalSchema>) {
    const [latest] = await this.store.goals(1);
    this.checkRevision(latest, expectedRevision);
    if (latest?.status === 'active') throw new TrackerError(409, 'Edit or pause your current plan first.');
    if (!(await this.baseline()).ready) {
      throw new TrackerError(422, 'Start a seven-day baseline with your first check-in before setting a target.');
    }
    return this.appendGoal(settings, expectedRevision, 'active', 'created');
  }

  async updateGoal(input: z.infer<typeof updateGoalSchema>) {
    const [latest] = await this.store.goals(1);
    this.checkRevision(latest, input.expectedRevision);
    if (!latest || latest.status !== 'active') throw new TrackerError(409, 'Start a new plan to change your targets.');
    if (input.action === 'edit') return this.appendGoal(input.settings, latest.revision, 'active', 'edited');
    if (!latest.reviewNight || localNight(this.now) < latest.reviewNight) {
      throw new TrackerError(422, 'The proposed adjustment is available on the scheduled review date.');
    }
    return this.appendGoal({ ...latest, ...adjustment(latest) }, latest.revision, 'active', 'adjusted');
  }

  async pauseGoal({ expectedRevision }: z.infer<typeof pauseGoalSchema>) {
    const [latest] = await this.store.goals(1);
    this.checkRevision(latest, expectedRevision);
    if (!latest || latest.status !== 'active') throw new TrackerError(409, 'There is no active plan to pause.');
    return this.appendGoal(latest, expectedRevision, 'paused', 'paused');
  }

  private checkRevision(latest: Goal | undefined, expected: number) {
    if ((latest?.revision ?? 0) !== expected) throw new TrackerError(409, 'The goal changed. Reopen it and try again.');
  }

  private appendGoal(settings: GoalSettings, expected: number, status: Goal['status'], change: Goal['change']) {
    const effectiveNight = localNight(this.now);
    const reviewNight = status === 'active' ? nextReview(effectiveNight, settings.period) : null;
    return this.store.addGoal({
      bedtime: settings.bedtime, wakeTime: settings.wakeTime, period: settings.period,
      direction: settings.direction, stepMinutes: settings.stepMinutes, revision: expected + 1,
      status, effectiveNight, reviewNight, changedAt: instant(this.now), change,
    }, expected);
  }

  async export(format: 'json' | 'csv') {
    const { entries, goals } = await this.store.snapshot();
    if (format === 'json') {
      return JSON.stringify({
        version: 1, timezone: TIMEZONE, exportedAt: instant(this.now), entries, goals,
      }, null, 2) + '\n';
    }
    const rows = [[
      'record_type', 'night', 'check_in', 'recorded_at_utc', 'timezone', 'mood', 'difficulty', 'rested',
      'nightmare', 'revision', 'goal_status', 'bedtime_target_local', 'wake_target_local',
      'review_period', 'step_minutes', 'shift_direction', 'review_night', 'goal_change', 'check_in_id',
    ]];
    for (const entry of entries) {
      rows.push([
        'check_in', entry.night, entry.kind, entry.at, entry.timezone, entry.mood ?? '', entry.difficulty ?? '',
        entry.rested ?? '', entry.nightmare === null ? '' : String(entry.nightmare), String(entry.revision),
        '', '', '', '', '', '', '', '', entry.id,
      ]);
    }
    for (const goal of goals) {
      rows.push([
        'goal', goal.effectiveNight, '', goal.changedAt, TIMEZONE, '', '', '', '', String(goal.revision), goal.status,
        goal.bedtime ?? '', goal.wakeTime ?? '', goal.period, String(goal.stepMinutes), goal.direction,
        goal.reviewNight ?? '', goal.change, '',
      ]);
    }
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}
