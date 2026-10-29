import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './infrastructure/config/app-config';
import { logger } from './shared/logger';
import { PinoNestLogger } from './infrastructure/logging/pino-nest-logger';

async function startServer(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger() });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
  logger.info({ port: config.port }, 'server listening');
}

void startServer();
