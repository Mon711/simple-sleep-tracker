import type { History, Today } from '../shared/schemas.ts';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly mode?: Today['mode']) {
    super(message);
  }
}

export async function request<T>(path: string, options: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const writing = options.body !== undefined;
  const response = await fetch(path, {
    method: writing ? 'POST' : 'GET',
    headers: writing ? { 'Content-Type': 'application/json' } : undefined,
    body: writing ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error ?? 'The tracker could not finish the request.', data?.mode);
  }
  return response.json() as Promise<T>;
}

export function historyRequest(from: string, to: string, signal: AbortSignal) {
  return request<History>('/api/history?' + new URLSearchParams({ from, to }), { signal });
}

export function readableError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Could not connect. Check your connection and try again.';
}
