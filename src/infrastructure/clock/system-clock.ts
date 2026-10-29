import { Clock } from '../../application/ports/clock';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
