import { LoggerService } from '@nestjs/common';
import { logger } from '../../shared/logger';

export class PinoNestLogger implements LoggerService {
  log(message: unknown, nestContext?: string): void {
    logger.info({ nestContext }, String(message));
  }

  error(message: unknown, stackTrace?: string, nestContext?: string): void {
    logger.error({ nestContext, stackTrace }, String(message));
  }

  warn(message: unknown, nestContext?: string): void {
    logger.warn({ nestContext }, String(message));
  }

  debug(message: unknown, nestContext?: string): void {
    logger.debug({ nestContext }, String(message));
  }

  verbose(message: unknown, nestContext?: string): void {
    logger.trace({ nestContext }, String(message));
  }
}
