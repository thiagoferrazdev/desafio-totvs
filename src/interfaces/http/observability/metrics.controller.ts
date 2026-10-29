import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from '../../../shared/metrics';

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('content-type', metricsRegistry.contentType)
  exportMetrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
