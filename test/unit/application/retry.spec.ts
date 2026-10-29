import { ExponentialBackoffWithFullJitter } from '../../../src/application/retry/backoff-strategy';
import { RetryPolicy } from '../../../src/application/retry/retry-policy';

describe('ExponentialBackoffWithFullJitter', () => {
  const settings = { baseDelayMs: 100, maxDelayMs: 10_000 };

  it('doubles the delay on each attempt and never passes the cap', () => {
    const withHighestJitter = new ExponentialBackoffWithFullJitter(settings, () => 0.999999);

    expect(withHighestJitter.delayBeforeRetryingAttempt(1)).toBe(99);
    expect(withHighestJitter.delayBeforeRetryingAttempt(4)).toBe(799);
    expect(withHighestJitter.delayBeforeRetryingAttempt(20)).toBe(9_999);
  });

  it('can retry right away when the jitter is zero', () => {
    const withLowestJitter = new ExponentialBackoffWithFullJitter(settings, () => 0);

    expect(withLowestJitter.delayBeforeRetryingAttempt(3)).toBe(0);
  });

  it('uses a random jitter by default', () => {
    const delay = new ExponentialBackoffWithFullJitter(settings).delayBeforeRetryingAttempt(1);

    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(100);
  });
});

describe('RetryPolicy', () => {
  it('allows retries only while there are attempts left and asks the backoff for the delay', () => {
    const retryPolicy = new RetryPolicy(3, { delayBeforeRetryingAttempt: (attempt) => attempt * 10 });

    expect(retryPolicy.hasAttemptsLeftAfter(2)).toBe(true);
    expect(retryPolicy.hasAttemptsLeftAfter(3)).toBe(false);
    expect(retryPolicy.delayBeforeRetryingAttempt(2)).toBe(20);
  });
});
