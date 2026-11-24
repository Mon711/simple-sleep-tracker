import type { Entry, EntryInput, Goal, Kind } from '../shared/schemas.ts';
import type { TIMEZONE } from '../shared/time.ts';
import { TrackerError } from './errors.ts';

type Binding = string | number | null;
type Results<T = unknown> = { results: T[] };
export interface Statement {
  bind(...values: Binding[]): Statement;
  all<T>(): Promise<Results<T>>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T>(statements: Statement[]): Promise<Results<T>[]>;
}

type EntryRow = {
  night: string;
  kind: Kind;
  entry_id: string;
  at_ms: number;
  timezone: typeof TIMEZONE;
  mood: Entry['mood'];
  difficulty: Entry['difficulty'];
  rested: Entry['rested'];
  nightmare: 0 | 1 | null;
  revision: number;
};

type GoalRow = {
  revision: number;
  status: Goal['status'];
  bedtime: string | null;
  wake_time: string | null;
  period: Goal['period'];
  step_minutes: number;
  direction: Goal['direction'];
  effective_night: string;
  review_night: string | null;
  changed_at_ms: number;
  change_kind: Goal['change'];
};

const entryColumns = 'night, kind, entry_id, at_ms, timezone, mood, difficulty, rested, nightmare, revision';
const goalColumns = 'revision, status, bedtime, wake_time, period, step_minutes, direction, effective_night, review_night, changed_at_ms, change_kind';
const goalSelect = 'SELECT ' + goalColumns + ' FROM goals WHERE owner = ?';

function mapGoal(row: GoalRow): Goal {
  return {
    revision: row.revision,
    status: row.status,
    bedtime: row.bedtime,
    wakeTime: row.wake_time,
    period: row.period,
    stepMinutes: row.step_minutes,
    direction: row.direction,
    effectiveNight: row.effective_night,
    reviewNight: row.review_night,
    changedAt: new Date(row.changed_at_ms).toISOString(),
    change: row.change_kind,
  };
}

function entryConflict(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('entry_order')) {
    throw new TrackerError(409, 'Wake time must be on or after bedtime for the same night.');
  }
  if (message.includes('UNIQUE constraint failed')) {
    throw new TrackerError(409, 'That night already has this check-in. Open the saved entry to edit it.');
  }
  throw error;
}

export class Store {
  constructor(
    private readonly db: Database,
    private readonly owner: string,
    private readonly wellness: boolean,
  ) {}

  private mapEntry(row: EntryRow): Entry {
    return {
      night: row.night,
      kind: row.kind,
      id: row.entry_id,
      at: new Date(row.at_ms).toISOString(),
      timezone: row.timezone,
      revision: row.revision,
      mood: this.wellness ? row.mood : null,
      difficulty: this.wellness ? row.difficulty : null,
      rested: this.wellness ? row.rested : null,
      nightmare: this.wellness && row.nightmare !== null ? row.nightmare === 1 : null,
    };
  }

  async entries(from: string, to: string, limit = 732, offset = 0) {
    const { results } = await this.db.prepare(
      'SELECT ' + entryColumns + ' FROM entries WHERE owner = ? AND night BETWEEN ? AND ? ORDER BY night DESC, kind LIMIT ? OFFSET ?',
    ).bind(this.owner, from, to, limit, offset).all<EntryRow>();
    return results.map(row => this.mapEntry(row));
  }

  async entry(night: string, kind: Kind) {
    const { results } = await this.db.prepare(
      'SELECT ' + entryColumns + ' FROM entries WHERE owner = ? AND night = ? AND kind = ?',
    ).bind(this.owner, night, kind).all<EntryRow>();
    return results[0] ? this.mapEntry(results[0]) : null;
  }

  async firstNight() {
    const { results } = await this.db.prepare(
      'SELECT night FROM entries WHERE owner = ? ORDER BY night LIMIT 1',
    ).bind(this.owner).all<{ night: string }>();
    return results[0]?.night ?? null;
  }

  async saveEntry(entry: Entry, previous?: EntryInput['previous']) {
    const times = [Date.parse(entry.at), entry.timezone];
    const details = [entry.mood, entry.difficulty, entry.rested, entry.nightmare === null ? null : Number(entry.nightmare)];
    const updateDetails = this.wellness ? ', mood = ?, difficulty = ?, rested = ?, nightmare = ?' : '';
    try {
      // RETURNING captures exactly the row this mutation wrote, even if a second request edits it.
      const statement = previous
        ? this.db.prepare(
          'UPDATE entries SET night = ?, at_ms = ?, timezone = ?' + updateDetails + ', revision = revision + 1 ' +
          'WHERE owner = ? AND night = ? AND kind = ? AND entry_id = ? AND revision = ? RETURNING ' + entryColumns,
        ).bind(entry.night, ...times, ...(this.wellness ? details : []), this.owner, previous.night, entry.kind, previous.id, previous.revision)
        : this.db.prepare(
          'INSERT INTO entries (owner, night, kind, entry_id, at_ms, timezone, mood, difficulty, rested, nightmare) ' +
          'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM entries WHERE owner = ? AND night = ? AND kind = ?) RETURNING ' + entryColumns,
        ).bind(this.owner, entry.night, entry.kind, entry.id, ...times, ...details, this.owner, entry.night, entry.kind);
      const { results } = await statement.all<EntryRow>();
      return results[0] ? this.mapEntry(results[0]) : null;
    } catch (error) {
      return entryConflict(error);
    }
  }

  async goals(limit = 100, offset = 0) {
    const { results } = await this.db.prepare(goalSelect + ' ORDER BY revision DESC LIMIT ? OFFSET ?')
      .bind(this.owner, limit, offset).all<GoalRow>();
    return results.map(mapGoal);
  }

  async goalsForRange(from: string, to: string) {
    const { results } = await this.db.prepare(goalSelect +
      ' AND effective_night <= ? AND (effective_night >= ? OR revision = ' +
      '(SELECT revision FROM goals WHERE owner = ? AND effective_night < ? ORDER BY effective_night DESC, revision DESC LIMIT 1)) ' +
      'ORDER BY effective_night DESC, revision DESC',
    ).bind(this.owner, to, from, this.owner, from).all<GoalRow>();
    return results.map(mapGoal);
  }

  async addGoal(goal: Goal, expected: number) {
    const { results } = await this.db.prepare(
      'INSERT INTO goals (owner, ' + goalColumns + ') ' +
      'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE COALESCE((SELECT MAX(revision) FROM goals WHERE owner = ?), 0) = ? ' +
      'RETURNING ' + goalColumns,
    ).bind(this.owner, goal.revision, goal.status, goal.bedtime, goal.wakeTime, goal.period,
      goal.stepMinutes, goal.direction, goal.effectiveNight, goal.reviewNight, Date.parse(goal.changedAt),
      goal.change, this.owner, expected).all<GoalRow>();
    if (!results[0]) throw new TrackerError(409, 'The goal changed. Reopen it and try again.');
    return mapGoal(results[0]);
  }

  async snapshot() {
    const [entries, goals] = await this.db.batch<EntryRow | GoalRow>([
      this.db.prepare('SELECT ' + entryColumns + ' FROM entries WHERE owner = ? ORDER BY night, kind').bind(this.owner),
      this.db.prepare(goalSelect + ' ORDER BY revision').bind(this.owner),
    ]);
    return {
      entries: (entries.results as EntryRow[]).map(row => this.mapEntry(row)),
      goals: (goals.results as GoalRow[]).map(mapGoal),
    };
  }
}
