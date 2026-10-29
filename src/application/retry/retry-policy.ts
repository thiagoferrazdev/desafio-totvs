import { BackoffStrategy } from './backoff-strategy';

export class RetryPolicy {
  constructor(
    private readonly maxAttempts: number,
    private readonly backoff: BackoffStrategy,
  ) {}

  hasAttemptsLeftAfter(attempt: number): boolean {
    return attempt < this.maxAttempts;
  }

  delayBeforeRetryingAttempt(attempt: number): number {
    return this.backoff.delayBeforeRetryingAttempt(attempt);
  }
}
