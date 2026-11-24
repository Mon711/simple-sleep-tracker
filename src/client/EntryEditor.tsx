import { useState } from 'react';
import type { FormEvent } from 'react';
import { difficulties, moods, restedValues } from '../shared/options.ts';
import type { Entry, EntryInput, Today } from '../shared/schemas.ts';
import { localMinute, shiftNight } from '../shared/time.ts';
import { Modal } from './Modal.tsx';
import { kindName } from './Today.tsx';
import type { EditSelection } from './Today.tsx';
import { readableError, request } from './api.ts';

function OptionalChoice({ label, name, options, value }: {
  label: string;
  name: string;
  options: readonly string[];
  value?: string | null;
}) {
  return (
    <div className="optional-field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={value ?? ''}>
        <option value="">Leave blank</option>
        {options.map(option => <option key={option}>{option}</option>)}
      </select>
    </div>
  );
}

export function EntryEditor({ selection, context, onClose, onSaved }: {
  selection: EditSelection;
  context: Today;
  onClose: () => void;
  onSaved: (entry: Entry) => void;
}) {
  const { kind, entry } = selection;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialTime = entry ? localMinute(Date.parse(entry.at)) : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const choice = (name: string) => values.get(name) || null;
    const nightmare = choice('nightmare');
    const input = {
      night: values.get('night'),
      kind,
      localTime: values.get('localTime'),
      ...(entry ? { previous: { night: entry.night, id: entry.id, revision: entry.revision } } : {}),
      ...(context.wellnessAvailable ? {
        mood: choice('mood'), difficulty: choice('difficulty'), rested: choice('rested'),
        nightmare: nightmare === null ? null : nightmare === 'Yes',
      } : {}),
    } as EntryInput;
    setBusy(true);
    setError('');
    try {
      onSaved(await request<Entry>('/api/check-ins', { body: input }));
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={entry ? 'Edit ' + kindName[kind].toLowerCase() : kindName[kind]} onClose={onClose} busy={busy}>
      <form onSubmit={save} className="editor">
        <p className="muted">{context.timezone}</p>
        <label>Night date
          <input name="night" type="date" defaultValue={selection.night} min="2000-01-01" max={context.date} required
            aria-describedby="night-help" />
          <span id="night-help" className="field-help">Pick the night this check-in belongs to. The recorded time can be on that date or the next day.</span>
        </label>
        <label>Recorded date and time
          <input name="localTime" type="datetime-local" defaultValue={initialTime}
            min="2000-01-01T00:00" max={shiftNight(context.date, 1) + 'T00:00'} required />
        </label>
        {context.wellnessAvailable && (
          <details>
            <summary>Optional details</summary>
            <OptionalChoice label="Mood" name="mood" options={moods} value={entry?.mood} />
            {kind === 'bed' ? <OptionalChoice label="Bedtime difficulty" name="difficulty" options={difficulties} value={entry?.difficulty} /> : (
              <>
                <OptionalChoice label="How rested do you feel?" name="rested" options={restedValues} value={entry?.rested} />
                <OptionalChoice label="Nightmare" name="nightmare" options={['Yes', 'No']}
                  value={entry?.nightmare == null ? null : entry.nightmare ? 'Yes' : 'No'} />
              </>
            )}
          </details>
        )}
        {error && <p className="message error" role="alert">{error}</p>}
        <div className="actions">
          <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save check-in'}</button>
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
