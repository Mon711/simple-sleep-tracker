import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Goal, GoalOverview, GoalSettings } from '../shared/schemas.ts';
import { nightLabel } from '../shared/time.ts';
import { readableError, request } from './api.ts';
import { Modal } from './Modal.tsx';
import { Targets } from './Today.tsx';

type GoalAction = 'create' | 'edit' | 'adjust' | 'pause';
const actionName = {
  create: 'Set targets',
  edit: 'Edit plan',
  adjust: 'Apply proposed adjustment',
  pause: 'Pause plan',
} as const;
const pastAction = { created: 'Plan started', edited: 'Plan edited', adjusted: 'Adjustment applied', paused: 'Plan paused' };

function GoalEditor({ action, data, onClose, onSaved }: {
  action: GoalAction;
  data: GoalOverview;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = data.current;
  const form = action === 'create' || action === 'edit';
  const messages = {
    create: 'Your targets are saved.',
    edit: 'Your plan was updated.',
    adjust: 'The adjustment is now active.',
    pause: 'Your plan is paused.',
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const settings: GoalSettings = {
      bedtime: String(values.get('bedtime') || '') || null,
      wakeTime: String(values.get('wakeTime') || '') || null,
      period: values.get('period') === 'monthly' ? 'monthly' : 'weekly',
      stepMinutes: Number(values.get('stepMinutes')),
      direction: values.get('direction') === 'later' ? 'later' : 'earlier',
    };
    const expectedRevision = current?.revision ?? 0;
    let path: string;
    let body: unknown;
    switch (action) {
      case 'create':
        path = 'create';
        body = { expectedRevision, settings };
        break;
      case 'edit':
        path = 'update';
        body = { expectedRevision, action: 'edit', settings };
        break;
      case 'adjust':
        path = 'update';
        body = { expectedRevision, action: 'confirm_adjustment', confirm: true };
        break;
      case 'pause':
        path = 'pause';
        body = { expectedRevision, confirm: true };
        break;
    }
    setBusy(true);
    setError('');
    try {
      await request<Goal>('/api/goals/' + path, { body });
      onSaved(messages[action]);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={actionName[action]} busy={busy} onClose={onClose}>
      <form onSubmit={save} className="editor">
        {form && (
          <>
            <p className="muted">Set one or both times in Asia/Kolkata.</p>
            <div className="field-pair">
              <label>Bedtime target<input type="time" name="bedtime" defaultValue={current?.bedtime ?? ''} /></label>
              <label>Wake-time target<input type="time" name="wakeTime" defaultValue={current?.wakeTime ?? ''} /></label>
            </div>
            <div className="optional-field">
              <label htmlFor="review-period">Review period</label>
              <select id="review-period" name="period" defaultValue={current?.period ?? 'weekly'}>
                <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field-pair">
              <label>Shift in minutes
                <input name="stepMinutes" type="number" inputMode="numeric" min="1" max="60" required defaultValue={current?.stepMinutes ?? 15} />
              </label>
              <div className="optional-field">
                <label htmlFor="shift-direction">Direction</label>
                <select id="shift-direction" name="direction" defaultValue={current?.direction ?? 'earlier'}>
                  <option value="earlier">Earlier</option><option value="later">Later</option>
                </select>
              </div>
            </div>
            <p className="muted">Proposed changes take effect only when you confirm them.</p>
          </>
        )}
        {action === 'pause' && <p className="muted">Targets will stop applying to new nights. Your past plan changes stay in History.</p>}
        {action === 'adjust' && data.upcoming && (
          <><p className="muted">These targets become active today.</p>
            <Targets bedtime={data.upcoming.bedtime} wakeTime={data.upcoming.wakeTime} /></>
        )}
        {error && <p className="message error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Saving…' : form ? 'Save targets' : action === 'adjust' ? 'Confirm adjustment' : 'Confirm pause'}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function Goals({ changed, date, onChanged }: { changed: number; date: string; onChanged: (message: string) => void }) {
  const [result, setResult] = useState<{ key: string; data?: GoalOverview; error?: string } | null>(null);
  const [action, setAction] = useState<GoalAction | null>(null);
  const [retry, setRetry] = useState(0);
  const key = date + '/' + changed + '/' + retry;
  const currentResult = result?.key === key ? result : null;
  const data = currentResult?.data;
  const current = data?.current;
  const active = current?.status === 'active';

  useEffect(() => {
    const controller = new AbortController();
    request<GoalOverview>('/api/goals', { signal: controller.signal }).then(
      overview => setResult({ key, data: overview }),
      error => { if (!controller.signal.aborted) setResult({ key, error: readableError(error) }); },
    );
    return () => controller.abort();
  }, [key]);

  return (
    <>
      <header className="screen-heading">
        <h1>Goals</h1>
        <p className="muted">Review and adjust your bedtime and wake-time targets.</p>
      </header>
      {!currentResult && <p className="message muted" role="status">Loading goals…</p>}
      {currentResult?.error && <div className="panel"><p className="error" role="alert">{currentResult.error}</p>
        <button className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button></div>}
      {data && (
        <div className="stack">
          {!current && (
            <section className="panel baseline">
              <h2>Seven-day baseline</h2>
              <p className="muted">{data.baseline.ready ? 'Your baseline is ready. Set targets when you want to.' :
                data.baseline.readyNight ? 'Keep checking in as usual. You can set targets on ' + nightLabel(data.baseline.readyNight) + '.' :
                  'Your first check-in starts a seven-day baseline.'}</p>
              <progress aria-label="Baseline days elapsed" max={7} value={data.baseline.elapsedDays} />
              <p className="muted">{data.baseline.elapsedDays} of 7 days elapsed</p>
              {data.baseline.ready && <button className="button primary" onClick={() => setAction('create')}>Set targets</button>}
            </section>
          )}
          {current && (
            <section className="panel">
              <h2>{active ? 'Current targets' : 'Plan paused'}</h2>
              {active ? (
                <>
                  <Targets bedtime={current.bedtime} wakeTime={current.wakeTime} />
                  <p className="muted">{current.period === 'weekly' ? 'Weekly' : 'Monthly'} review · {current.stepMinutes} minutes {current.direction}</p>
                  <div className="actions section-actions">
                    <button className="button primary" onClick={() => setAction('edit')}>Edit plan</button>
                    <button className="button secondary" onClick={() => setAction('pause')}>Pause plan</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">You can keep logging check-ins and start a plan when you’re ready.</p>
                  <button className="button primary section-actions" onClick={() => setAction('create')}>Start a plan</button>
                </>
              )}
            </section>
          )}
          {data.upcoming && (
            <section className="panel">
              <h2>Upcoming review</h2>
              <p className="muted">{nightLabel(data.upcoming.reviewNight)}</p>
              <Targets bedtime={data.upcoming.bedtime} wakeTime={data.upcoming.wakeTime} />
              <p className="muted">These proposed times need your confirmation before becoming active.</p>
              {data.upcoming.due && (
                <button className="button primary section-actions" onClick={() => setAction('adjust')}>Apply proposed adjustment</button>
              )}
            </section>
          )}
          {!!data.history.length && (
            <section className="panel plan-history">
              <h2>Goal history</h2>
              {data.history.map(goal => (
                <article key={goal.revision}>
                  <h3>{pastAction[goal.change]}</h3>
                  <p className="muted">{nightLabel(goal.effectiveNight, true)}</p>
                  {goal.status === 'active' && <Targets bedtime={goal.bedtime} wakeTime={goal.wakeTime} />}
                </article>
              ))}
              {data.history.length === 100 && <p className="muted">Download an export to see all goal changes.</p>}
            </section>
          )}
        </div>
      )}
      {action && data && (
        <GoalEditor action={action} data={data} onClose={() => setAction(null)} onSaved={message => {
          setAction(null);
          onChanged(message);
        }} />
      )}
    </>
  );
}
