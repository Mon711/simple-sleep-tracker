import { useEffect, useState } from 'react';
import type { Entry, History as HistoryData, Pattern, Today } from '../shared/schemas.ts';
import { clockAt, clockLabel, localNight, nightLabel, shiftNight } from '../shared/time.ts';
import { historyRequest, readableError } from './api.ts';
import { Clock, kindName } from './Today.tsx';
import type { EditSelection } from './Today.tsx';
import { Trend } from './Trend.tsx';

function EntryRow({ entry, onEdit }: { entry: Entry; onEdit: (selection: EditSelection) => void }) {
  const recorded = Date.parse(entry.at);
  const details = [entry.mood, entry.difficulty, entry.rested,
    entry.nightmare === null ? null : entry.nightmare ? 'Nightmare reported' : 'No nightmare reported',
  ].filter(Boolean);
  const kind = entry.kind === 'bed' ? 'Bedtime' : 'Wake time';
  return (
    <div className="entry-row">
      <div>
        <p><strong>{kind}</strong> · <Clock value={clockAt(recorded)} /></p>
        {localNight(recorded) !== entry.night && <p className="muted">Recorded {nightLabel(localNight(recorded))}</p>}
        {!!details.length && <p className="muted">{details.join(' · ')}</p>}
      </div>
      <button className="text-button" aria-label={'Edit check-in for ' + kindName[entry.kind].toLowerCase() + ', ' + nightLabel(entry.night)}
        onClick={() => onEdit({ kind: entry.kind, night: entry.night, entry })}>Edit check-in</button>
    </div>
  );
}

function NotesSummary({ patterns }: { patterns: Pattern }) {
  const { bedtimeMood, wakeMood, nightmares, bedtimeByNightmare } = patterns;
  const renderMoods = (counts: NonNullable<typeof bedtimeMood>) => Object.entries(counts)
    .filter(([, count]) => count > 0).map(([mood, count]) => mood + ' ' + count).join(' · ');
  const evening = bedtimeMood ? renderMoods(bedtimeMood) : '';
  const morning = wakeMood ? renderMoods(wakeMood) : '';
  const hasNightmareReports = nightmares && nightmares.yes + nightmares.no > 0;
  if (!evening && !morning && !hasNightmareReports) return null;
  const yes = bedtimeByNightmare?.yes;
  const no = bedtimeByNightmare?.no;
  return (
    <section className="panel observations">
      <h2>Check-in details</h2>
      {evening && <p><strong>Evening moods</strong> <span className="muted">{evening}</span></p>}
      {morning && <p><strong>Morning moods</strong> <span className="muted">{morning}</span></p>}
      {hasNightmareReports && <p><strong>Nightmare reports</strong> <span className="muted">Yes {nightmares.yes} · No {nightmares.no} · Blank {nightmares.missing}</span></p>}
      {yes?.averageBedtime && no?.averageBedtime && (
        <p className="muted">Average bedtime was {clockLabel(yes.averageBedtime)} across {yes.count} nights with a nightmare report
          and {clockLabel(no.averageBedtime)} across {no.count} without. These are grouped observations.</p>
      )}
    </section>
  );
}

export function History({ context, changed, onEdit }: {
  context: Today;
  changed: number;
  onEdit: (selection: EditSelection) => void;
}) {
  const [period, setPeriod] = useState(7);
  const [end, setEnd] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; history?: HistoryData; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const to = end ?? context.date;
  const from = [shiftNight(to, 1 - period), '2000-01-01'].sort()[1];
  const key = from + '/' + to + '/' + changed + '/' + retry;
  const current = result?.key === key ? result : null;
  const history = current?.history;

  useEffect(() => {
    const controller = new AbortController();
    historyRequest(from, to, controller.signal).then(
      data => setResult({ key, history: data }),
      error => { if (!controller.signal.aborted) setResult({ key, error: readableError(error) }); },
    );
    return () => controller.abort();
  }, [from, to, key]);

  const nights = new Map<string, Entry[]>();
  for (const entry of history?.entries ?? []) {
    const group = nights.get(entry.night);
    if (group) group.push(entry);
    else nights.set(entry.night, [entry]);
  }
  return (
    <>
      <header className="screen-heading">
        <h1>History</h1>
        <p className="muted">Bedtimes and wake times in {context.timezone}.</p>
      </header>
      <div className="stack">
        <section className="panel filters" aria-label="History range">
          <div className="periods" aria-label="Range length" role="group">
            {[7, 30, 180].map(days => <button key={days} className="button secondary" type="button"
              aria-pressed={period === days} onClick={() => setPeriod(days)}>{days} days</button>)}
          </div>
          <label>Through night
            <input type="date" min="2000-01-01" max={context.date} value={to}
              onChange={event => {
                if (event.currentTarget.validity.valid && event.currentTarget.value) setEnd(event.currentTarget.value);
              }} />
          </label>
          <div className="actions section-actions">
            <button className="text-button" onClick={() => onEdit({ kind: 'bed', night: to })}>Add bedtime</button>
            <button className="text-button" onClick={() => onEdit({ kind: 'wake', night: to })}>Add wake time</button>
          </div>
        </section>
        {!current && <p className="message muted" role="status">Loading history…</p>}
        {current?.error && <div className="panel"><p className="error" role="alert">{current.error}</p>
          <button className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button></div>}
        {history && !history.entries.length && (
          <section className="panel empty"><h2>No check-ins in this range</h2><p className="muted">Log a check-in or choose a different range.</p></section>
        )}
        {history && !!history.entries.length && (
          <>
            <section aria-labelledby="trends" className="stack">
              <h2 className="section-heading" id="trends">Trends</h2>
              <Trend kind="bed" entries={history.entries.filter(entry => entry.kind === 'bed')}
                goals={history.goals} from={from} to={to} average={history.summary.bedtime.average} />
              <Trend kind="wake" entries={history.entries.filter(entry => entry.kind === 'wake')}
                goals={history.goals} from={from} to={to} average={history.summary.wakeTime.average} />
            </section>
            <NotesSummary patterns={history.patterns} />
            <section aria-labelledby="recorded-nights" className="stack">
              <h2 className="section-heading" id="recorded-nights">Check-ins</h2>
              {Array.from(nights, ([night, entries]) => (
                <article className="panel night-history" key={night}>
                  <h3>Night of {nightLabel(night, true)}</h3>
                  {entries.map(entry => <EntryRow key={entry.kind} entry={entry} onEdit={onEdit} />)}
                </article>
              ))}
            </section>
          </>
        )}
        <section className="panel">
          <div className="panel-header"><h2>Export your data</h2></div>
          <p className="muted">Download all check-ins and goal changes.</p>
          <div className="actions export-actions">
            <a className="button secondary" href="/api/export?format=json" download>Download JSON</a>
            <a className="button secondary" href="/api/export?format=csv" download>Download CSV</a>
          </div>
        </section>
      </div>
    </>
  );
}
