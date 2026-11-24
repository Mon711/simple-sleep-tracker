import { useEffect, useRef } from 'react';
import type { Entry, Goal, Kind } from '../shared/schemas.ts';
import { clockAt, clockLabel, minuteClock, nightDistance, shiftNight, timeMinutes } from '../shared/time.ts';

function shortestArc(minutes: number[]) {
  const values = Array.from(new Set(minutes)).sort((a, b) => a - b);
  let start = values[0];
  let gap = 0;
  for (let i = 0; i < values.length; i++) {
    const next = values[(i + 1) % values.length];
    const distance = next - values[i] + (i === values.length - 1 ? 1440 : 0);
    if (distance > gap) {
      gap = distance;
      start = next;
    }
  }
  return (minute: number) => minute < start ? minute + 1440 : minute;
}

function showDate(night: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(night + 'T00:00:00Z'));
}

function draw(canvas: HTMLCanvasElement, entries: Entry[], goals: Goal[], kind: Kind, from: string, to: string) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx || width < 170) return;
  ctx.scale(ratio, ratio);
  const points = new Map(entries.map(entry => [entry.night, timeMinutes(clockAt(Date.parse(entry.at)))]));
  const dayCount = nightDistance(from, to) + 1;
  const target = Array.from({ length: dayCount }, (_, index) => {
    const night = shiftNight(from, index);
    const goal = goals.find(item => item.effectiveNight <= night);
    const time = goal?.status === 'active' ? (kind === 'bed' ? goal.bedtime : goal.wakeTime) : null;
    return time ? timeMinutes(time) : null;
  });
  const times = [...points.values(), ...target.filter(value => value !== null)];
  const project = shortestArc(times);
  const projected = times.map(project);
  const min = 60 * Math.floor((Math.min(...projected) - 10) / 60);
  const max = Math.max(min + 120, 60 * Math.ceil((Math.max(...projected) + 10) / 60));
  const left = 62;
  const top = 12;
  const right = width - 10;
  const bottom = height - 25;
  const x = (index: number) => left + index * (right - left) / Math.max(1, dayCount - 1);
  const y = (value: number) => bottom - (bottom - top) * (project(value) - min) / (max - min);

  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#b9c0dc';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#39415e';
  ctx.lineWidth = 1;
  const tick = 60 * Math.ceil((max - min) / 240);
  for (let minutes = min; minutes <= max; minutes += tick) {
    const line = bottom - (bottom - top) * (minutes - min) / (max - min);
    ctx.beginPath();
    ctx.moveTo(left, line);
    ctx.lineTo(right, line);
    ctx.stroke();
    ctx.fillText(clockLabel(minuteClock(minutes)), 0, line);
  }
  ctx.fillText(showDate(from), left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(showDate(to), right, height - 8);

  ctx.strokeStyle = '#a990cc';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  let previous: number | null = null;
  target.forEach((value, index) => {
    if (value !== null) {
      if (previous === null) {
        ctx.moveTo(x(index), y(value));
        ctx.lineTo(x(index) + 1, y(value));
      } else ctx.lineTo(x(index), y(value));
    }
    previous = value;
  });
  ctx.stroke();
  ctx.setLineDash([]);
  target.forEach((value, index) => {
    if (value != null && target[index - 1] == null && target[index + 1] == null) {
      ctx.strokeRect(x(index) - 3, y(value) - 3, 6, 6);
    }
  });

  ctx.fillStyle = '#d9ceff';
  ctx.strokeStyle = '#b3a4e9';
  for (const [night, value] of points) {
    const index = nightDistance(from, night);
    const next = points.get(shiftNight(night, 1));
    if (next !== undefined) {
      ctx.beginPath();
      ctx.moveTo(x(index), y(value));
      ctx.lineTo(x(index + 1), y(next));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x(index), y(value), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function Trend({ entries, goals, kind, from, to, average }: {
  entries: Entry[];
  goals: Goal[];
  kind: Kind;
  from: string;
  to: string;
  average: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = kind === 'bed' ? 'Bedtimes' : 'Wake times';
  const hasTrend = entries.length >= 2;
  const hasTarget = goals.some(goal => goal.status === 'active' && (kind === 'bed' ? goal.bedtime : goal.wakeTime));
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => draw(element, entries, goals, kind, from, to);
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    paint();
    return () => observer.disconnect();
  }, [entries, goals, kind, from, to, hasTrend]);

  return (
    <section className="panel trend">
      <h3>{label}</h3>
      {hasTrend ? (
        <>
          <p className="muted">{entries.length} check-ins{average ? ' · Average ' + clockLabel(average) : ' · Times vary too widely for an average'}</p>
          <canvas ref={canvas} role="img" aria-label={label + ' by night. Individual times are listed below.'} />
          <p className="chart-key"><span>Logged</span>{hasTarget && <span>Target in effect</span>}</p>
        </>
      ) : <p className="muted">{entries.length ? 'One check-in in this range.' : 'No check-ins of this type in this range.'}</p>}
    </section>
  );
}
