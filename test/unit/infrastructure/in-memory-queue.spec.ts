import { OrderMessage } from '../../../src/application/ports/order-queue';
import { InMemoryQueue } from '../../../src/infrastructure/messaging/in-memory-queue';
import { metricsRegistry } from '../../../src/shared/metrics';

function messageFor(orderId: string, enqueuedAt = Date.now()): OrderMessage {
  return { messageId: `m-${orderId}`, orderId, attempt: 1, correlationId: 'c-1', enqueuedAt };
}

describe('InMemoryQueue', () => {
  it('gives up waiting when messages stay in the queue for too long', async () => {
    const queue = new InMemoryQueue('test-timeout', 1);
    queue.publish(messageFor('order-1'));

    await expect(queue.waitUntilEmpty(10)).rejects.toThrow('queue test-timeout still has 1 messages');
  });

  it('reports the age of the oldest waiting message', async () => {
    const queue = new InMemoryQueue('test-age', 1);

    queue.publish(messageFor('order-1', Date.now() - 5_000));

    const metric = await metricsRegistry.getSingleMetric('queue_oldest_message_age_seconds')!.get();
    const ageForThisQueue = metric.values.find((value) => value.labels.queue === 'test-age')!.value;
    expect(ageForThisQueue).toBeGreaterThanOrEqual(5);
  });

  it('delivers a message again when the handler crashes', async () => {
    const queue = new InMemoryQueue('test-crash', 1);
    const handler = jest.fn().mockRejectedValueOnce(new Error('crash')).mockResolvedValue(undefined);
    jest.useFakeTimers();
    queue.subscribe(handler);

    queue.publish(messageFor('order-1'));
    await jest.advanceTimersByTimeAsync(1_100);
    jest.useRealTimers();

    expect(handler).toHaveBeenCalledTimes(2);
    queue.unsubscribe();
  });
});
