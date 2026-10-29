export interface BackoffStrategy {
  delayBeforeRetryingAttempt(attempt: number): number;
}

export interface ExponentialBackoffSettings {
  baseDelayMs: number;
  maxDelayMs: number;
}

export class ExponentialBackoffWithFullJitter implements BackoffStrategy {
  constructor(
    private readonly settings: ExponentialBackoffSettings,
    private readonly random: () => number = Math.random,
  ) {}

  delayBeforeRetryingAttempt(attempt: number): number {
    const exponentialDelay = this.settings.baseDelayMs * 2 ** (attempt - 1);
    const cappedDelay = Math.min(this.settings.maxDelayMs, exponentialDelay);
    return Math.floor(this.random() * cappedDelay);
  }
}
