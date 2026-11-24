export const TIMEZONE = 'Asia/Kolkata';
export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function isNight(value: string): boolean {
  if (!/^20\d\d-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftNight(night: string, days: number): string {
  return new Date(Date.parse(night + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightDistance(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / DAY_MS;
}

export function localMinute(ms: number): string {
  const fields = Object.fromEntries(civilFormatter.formatToParts(ms).map(part => [part.type, part.value]));
  return fields.year + '-' + fields.month + '-' + fields.day + 'T' + fields.hour + ':' + fields.minute;
}

export function localNight(ms: number): string {
  return localMinute(ms).slice(0, 10);
}

export function parseLocalMinute(value: string): number {
  const civilAsUtc = Date.parse(value + ':00Z');
  if (!Number.isFinite(civilAsUtc)) return NaN;
  const projected = Date.parse(localMinute(civilAsUtc) + ':00Z');
  const instant = civilAsUtc - (projected - civilAsUtc);
  return localMinute(instant) === value ? instant : NaN;
}

export function timeMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function minuteClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return String(Math.floor(wrapped / 60)).padStart(2, '0') + ':' + String(wrapped % 60).padStart(2, '0');
}

export function clockAt(ms: number): string {
  return localMinute(ms).slice(11);
}

export function clockLabel(value: string): string {
  const hour = Number(value.slice(0, 2));
  return (hour % 12 || 12) + ':' + value.slice(3, 5) + ' ' + (hour < 12 ? 'am' : 'pm');
}

export function nightLabel(night: string, withYear = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(night + 'T00:00:00Z'));
}

export function nextReview(night: string, period: 'weekly' | 'monthly'): string {
  if (period === 'weekly') return shiftNight(night, 7);
  const when = new Date(night + 'T00:00:00Z');
  const day = when.getUTCDate();
  when.setUTCDate(1);
  when.setUTCMonth(when.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 0)).getUTCDate();
  when.setUTCDate(Math.min(day, lastDay));
  return when.toISOString().slice(0, 10);
}

export function clockAverage(times: string[]): string | null {
  if (!times.length) return null;
  let x = 0;
  let y = 0;
  for (const time of times) {
    const angle = timeMinutes(time) * Math.PI / 720;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.hypot(x, y) / times.length < 0.1) return null;
  return minuteClock(Math.round(Math.atan2(y, x) * 720 / Math.PI));
}
