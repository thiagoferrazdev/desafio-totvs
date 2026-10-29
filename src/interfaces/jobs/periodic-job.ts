import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { logger } from '../../shared/logger';

export class PeriodicJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly run: () => Promise<unknown>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      logger.error({ err: String(error), job: this.name }, 'periodic job failed');
    }
  }
}
