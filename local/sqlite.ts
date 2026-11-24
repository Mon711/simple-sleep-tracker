import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Database, Statement } from '../src/server/store.ts';

const migration = readFileSync(new URL('../drizzle/0000_tracker.sql', import.meta.url), 'utf8');

export function openTrackerDatabase(path: string) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA busy_timeout = 5000');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const version = sqlite.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 0) {
      sqlite.exec(migration);
      sqlite.exec('PRAGMA user_version = 1');
    } else if (version !== 1) {
      throw new Error('This database requires a different version of the tracker.');
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    sqlite.close();
    throw error;
  }

  const reads = new WeakMap<Statement, () => unknown[]>();
  const db: Database = {
    prepare(sql) {
      const query = sqlite.prepare(sql);
      const prepare = (params: (string | number | null)[]): Statement => {
        const read = () => query.all(...params);
        const statement: Statement = {
          bind(...values) { return prepare(values); },
          async all<T>() { return { results: read() as T[] }; },
          async run() { return { meta: { changes: Number(query.run(...params).changes) } }; },
        };
        reads.set(statement, read);
        return statement;
      };
      return prepare([]);
    },
    async batch<T>(statements: Statement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          const read = reads.get(statement);
          if (!read) throw new Error('Invalid database statement.');
          return { results: read() as T[] };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, close: () => sqlite.close() };
}
