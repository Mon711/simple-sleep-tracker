export class TrackerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function safeError(error: unknown): TrackerError {
  if (error instanceof TrackerError) return error;
  return new TrackerError(500, 'The tracker could not finish the request. Please try again.');
}
