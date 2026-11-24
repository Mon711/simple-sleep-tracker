import type { Entry, Kind, Today as Context } from '../shared/schemas.ts';
import { clockAt, clockLabel, localNight, nightLabel } from '../shared/time.ts';

export const kindName = { bed: 'Evening check-in', wake: 'Morning check-in' } as const;

export type EditSelection = { kind: Kind; night: string; entry?: Entry | null };

export function Clock({ value }: { value: string }) {
  const [digits, period] = clockLabel(value).split(' ');
  return <>{digits}<span className="meridiem"> {period}</span></>;
}

export function Targets({ bedtime, wakeTime }: { bedtime: string | null; wakeTime: string | null }) {
  return (
    <dl className="targets">
      <div><dt>Bedtime</dt><dd>{bedtime ? <Clock value={bedtime} /> : '—'}</dd></div>
      <div><dt>Wake time</dt><dd>{wakeTime ? <Clock value={wakeTime} /> : '—'}</dd></div>
    </dl>
  );
}

function CheckIn({ kind, slot, primary, busy, onNow, onEdit }: {
  kind: Kind;
  slot: Context[Kind];
  primary: boolean;
  busy: boolean;
  onNow: (kind: Kind, night: string) => void;
  onEdit: (selection: EditSelection) => void;
}) {
  const { entry, night } = slot;
  const dateLabel = 'Night of ' + nightLabel(night);
  const label = kindName[kind];
  return (
    <section className={primary ? 'check-in check-in-hero ' + kind : 'check-in check-in-secondary'} aria-label={label}>
      {primary && <span className="night-art" aria-hidden="true"><span /></span>}
      <div className="check-in-info">
        <h2>{label}</h2>
        <p className="muted">{dateLabel}</p>
        {entry ? (
          <div className="saved-time">
            <p className="check-in-value"><Clock value={clockAt(Date.parse(entry.at))} /></p>
            <p className="muted">Saved · {nightLabel(localNight(Date.parse(entry.at)))}</p>
          </div>
        ) : primary && (
          <p className="check-in-value">{kind === 'bed' ? 'Going to bed?' : 'Just woke up?'}</p>
        )}
      </div>
      <div className="actions">
        {!entry && (
          <button className="button primary" disabled={busy} aria-label={'Log now for ' + label.toLowerCase()}
            onClick={() => onNow(kind, night)}>Log now</button>
        )}
        <button className={entry && primary ? 'button secondary' : 'text-button'} disabled={busy}
          aria-label={(entry ? 'Edit check-in' : 'Set time') + ' for ' + label.toLowerCase()}
          onClick={() => onEdit({ kind, night, entry })}>{entry ? 'Edit check-in' : 'Set time'}</button>
      </div>
    </section>
  );
}

export function Today({ context, busy, onNow, onEdit }: {
  context: Context;
  busy: boolean;
  onNow: (kind: Kind, night: string) => void;
  onEdit: (selection: EditSelection) => void;
}) {
  const order: Kind[] = context.primary === 'bed' ? ['bed', 'wake'] : ['wake', 'bed'];
  return (
    <>
      <header className="screen-heading">
        <h1>Today</h1>
        <p className="muted">{nightLabel(context.date)} <span aria-hidden="true">·</span> {context.timezone}</p>
      </header>
      <div className="stack check-ins">
        {order.map((kind, index) => (
          <CheckIn key={kind} kind={kind} slot={context[kind]} primary={index === 0}
            busy={busy} onNow={onNow} onEdit={onEdit} />
        ))}
        <section className="panel targets-panel">
          <div className="panel-header"><h2>Current targets</h2><a className="text-button" href="#goals">View goals</a></div>
          {context.goal ? <Targets bedtime={context.goal.bedtime} wakeTime={context.goal.wakeTime} /> : (
            <p className="muted">No active targets. You can log check-ins at your own pace.</p>
          )}
        </section>
      </div>
    </>
  );
}
